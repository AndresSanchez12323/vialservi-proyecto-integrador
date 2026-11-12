param(
    [Parameter(Mandatory=$true)][ValidateSet('Bootstrap','Build','Infrastructure','Publish')][string]$Phase,
    [string]$Configuration = (Join-Path $PSScriptRoot '../terraform.tfvars.json'),
    [switch]$Apply
)
. "$PSScriptRoot/Common.ps1"
$Configuration = (Resolve-Path -LiteralPath $Configuration).Path
$c = ReadConfiguration $Configuration
AssertTarget $c
$artifactDirectory = Join-Path $TerraformRoot 'artifacts'
$null = New-Item -ItemType Directory -Force -Path $artifactDirectory
$bootstrap = Join-Path $TerraformRoot 'bootstrap'
if ($Phase -eq 'Bootstrap') {
    $bootstrapConfig = Join-Path $artifactDirectory 'bootstrap.tfvars.json'
    $bootstrapJson = @{ aws_profile=$c.aws_profile; target_account_id=$c.target_account_id; aws_region=$c.aws_region; project=$c.project } | ConvertTo-Json
    [IO.File]::WriteAllText($bootstrapConfig, $bootstrapJson, [Text.UTF8Encoding]::new($false))
    Run terraform @("-chdir=$bootstrap",'init','-input=false')
    $plan = Join-Path $artifactDirectory 'bootstrap.tfplan'
    Run terraform @("-chdir=$bootstrap",'plan','-input=false',"-var-file=$bootstrapConfig","-out=$plan")
    if ($Apply) { AssertTarget $c; Run terraform @("-chdir=$bootstrap",'apply','-input=false',$plan) }
    exit
}
if ($Phase -eq 'Build') {
    if (!$Apply) { throw 'Build publica una imagen en ECR; indique -Apply cuando autorice ese paso.' }
    Push-Location $RepoRoot
    $previousNode = $env:NODE_ENV
    $previousApi = $env:VITE_API_URL
    try {
        Run git @('diff','--exit-code',$c.source_commit,'--','apps','package.json','package-lock.json','Dockerfile.lambda')
        $untracked = & git ls-files --others --exclude-standard apps
        if ($untracked) { throw 'Hay archivos sin versionar en apps. No construir una version no revisada.' }
        Run npm.cmd @('ci','--include=dev')
        Run npx.cmd @('prisma','generate','--schema','apps/api/prisma/schema.prisma')
        $env:NODE_ENV = 'production'; $env:VITE_API_URL = '/'
        Run npm.cmd @('run','build:api')
        Run npm.cmd @('run','build:web')
        $repository = "$($c.target_account_id).dkr.ecr.$($c.aws_region).amazonaws.com/$($c.project)-api"
        $tag = "commit-$($c.source_commit)"
        $existing = AwsJson @('ecr','list-images','--repository-name',"$($c.project)-api",'--filter','tagStatus=TAGGED') $c
        if (!($existing.imageIds | Where-Object imageTag -eq $tag)) {
            Run docker @('build','--platform','linux/amd64','--provenance=false','-f','Dockerfile.lambda','-t',"${repository}:$tag",'.')
            # Nombres validados; cmd conserva el token por stdin en PowerShell 5.1.
            $login = "aws ecr get-login-password --profile $($c.aws_profile) --region $($c.aws_region) | docker login --username AWS --password-stdin $($c.target_account_id).dkr.ecr.$($c.aws_region).amazonaws.com"
            Run cmd @('/c',$login)
            AssertTarget $c
            Run docker @('push',"${repository}:$tag")
        }
        $image = AwsJson @('ecr','describe-images','--repository-name',"$($c.project)-api",'--image-ids',"imageTag=$tag") $c
        $digest = $image.imageDetails[0].imageDigest
        $imageJson = @{image_uri="${repository}@$digest"} | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $TerraformRoot 'image.auto.tfvars.json'), $imageJson, [Text.UTF8Encoding]::new($false))
        $c.source_commit | Set-Content -LiteralPath (Join-Path $artifactDirectory 'web-commit.txt') -Encoding ascii
    } finally { $env:NODE_ENV=$previousNode; $env:VITE_API_URL=$previousApi; Pop-Location }
    exit
}
if ($Phase -eq 'Infrastructure') {
    if (!$env:TF_VAR_jwt_secret) { throw 'Cargue los secretos con Set-Secrets.ps1 en esta sesion.' }
    if ($c.mail_mode -eq 'smtp' -and (!$env:TF_VAR_smtp_password -or $env:TF_VAR_smtp_password -eq 'sin-configurar')) { throw 'Falta la clave SMTP.' }
    $backend = Join-Path $TerraformRoot 'backend.hcl'
    @"
bucket = "$($c.project)-tfstate-$($c.target_account_id)-$($c.aws_region)"
key = "$($c.project)/terraform.tfstate"
region = "$($c.aws_region)"
profile = "$($c.aws_profile)"
allowed_account_ids = ["$($c.target_account_id)"]
encrypt = true
use_lockfile = true
"@ | Set-Content -LiteralPath $backend -Encoding ascii
    Run terraform @("-chdir=$TerraformRoot",'init',"-backend-config=$backend",'-input=false')
    Run terraform @("-chdir=$TerraformRoot",'validate')
    $plan = Join-Path $artifactDirectory 'infrastructure.tfplan'
    Run terraform @("-chdir=$TerraformRoot",'plan','-input=false',"-var-file=$Configuration","-out=$plan")
    if ($Apply) { AssertTarget $c; Run terraform @("-chdir=$TerraformRoot",'apply','-input=false',$plan) }
    exit
}
if ($Phase -eq 'Publish') {
    if (!$Apply) { throw 'Publish escribe en S3; indique -Apply cuando la base este migrada y verificada.' }
    $o = Outputs
    $built = (Get-Content (Join-Path $artifactDirectory 'web-commit.txt') -Raw).Trim()
    if ($built -ne $c.source_commit -or $o.source_commit.value -ne $built) { throw 'Imagen, estado y web deben usar el mismo commit.' }
    $url = $o.url.value
    $ready = $false
    foreach ($attempt in 1..4) {
        try { $result = Invoke-RestMethod "$url/api/listo" -TimeoutSec 35; $ready = $result.estado -eq 'listo' } catch { $ready = $false }
        if ($ready) { break }
        if ($attempt -lt 4) { Start-Sleep -Seconds 15 }
    }
    if (!$ready) { throw 'API/base no disponibles. No publicar.' }
    AssertTarget $c
    Run aws @('s3','sync',(Join-Path $RepoRoot 'apps/web/dist'),"s3://$($o.web_bucket.value)",'--exclude','index.html','--cache-control','public,max-age=31536000,immutable','--only-show-errors','--profile',$c.aws_profile,'--region',$c.aws_region)
    Run aws @('s3','cp',(Join-Path $RepoRoot 'apps/web/dist/index.html'),"s3://$($o.web_bucket.value)/index.html",'--cache-control','no-cache,no-store,must-revalidate','--only-show-errors','--profile',$c.aws_profile,'--region',$c.aws_region)
    $null = AwsJson @('cloudfront','create-invalidation','--distribution-id',$o.distribution_id.value,'--paths','/*') $c
    Write-Host "Publicado en cuenta DESTINO: $url"
}
