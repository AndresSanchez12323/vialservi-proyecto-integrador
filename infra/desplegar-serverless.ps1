param([switch]$SoloApi)
$ErrorActionPreference = 'Stop'
$env:AWS_PROFILE = 'personal'
$env:AWS_REGION = 'us-east-1'
$regionVial = 'us-east-1'
$perfilVial = 'personal'

function AwsVial {
  $resultado = & aws @args --profile $perfilVial --region $regionVial
  if ($LASTEXITCODE -ne 0) { throw 'Fallo AWS; revisar el diagnostico antes de continuar.' }
  return $resultado
}
function PasoLocal([string]$Programa, [string[]]$Argumentos) {
  & $Programa @Argumentos
  if ($LASTEXITCODE -ne 0) { throw "Fallo $Programa; despliegue detenido." }
}
Push-Location (Join-Path $PSScriptRoot '..')
$apiWebAnterior = $env:VITE_API_URL
try {
  $identidadVial = AwsVial sts get-caller-identity --output json | ConvertFrom-Json
  $identidadVial | ConvertTo-Json
  if ($identidadVial.Account -ne '102098709715') { throw 'Cuenta equivocada: solo AndresX 102098709715.' }
  $pilaActual = AwsVial cloudformation describe-stacks --stack-name vialservi --output json | ConvertFrom-Json
  $modo = $pilaActual.Stacks[0].Parameters | Where-Object ParameterKey -eq OrigenApi
  if ($modo.ParameterValue -ne 'lambda') {
    throw 'El corte a Lambda aun no esta confirmado. Este script solo redespliega un montaje serverless ya activo; seguir docs/migracion-serverless.md para migrar.'
  }
  # No crear una pila nueva con defaults que borren la configuracion de correo.
  $null = AwsVial cloudformation describe-stacks --stack-name vialservi-lambda --output json
  # Las pruebas escriben: nunca permitir que apunten a la base en AWS.
  PasoLocal node @('--input-type=module', '-e', 'import dotenv from "dotenv"; dotenv.config({path:"apps/api/.env",quiet:true}); const u=new URL(process.env.DATABASE_URL); if (!["localhost","127.0.0.1","[::1]"].includes(u.hostname)) { console.error("Pruebas bloqueadas: DATABASE_URL no es local"); process.exit(1); }')
  PasoLocal npm @('test')
  PasoLocal npm @('run', 'build:api')
  # '/' se normaliza a origen actual; evita heredar un .env con localhost.
  $env:VITE_API_URL = '/'
  PasoLocal npm @('run', 'build:web')
  $etiquetaVial = 'lambda-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  $repositorioVial = '102098709715.dkr.ecr.us-east-1.amazonaws.com/vialservi-api'
  $imagenVial = "${repositorioVial}:$etiquetaVial"
  PasoLocal docker @('build', '--platform', 'linux/amd64', '--provenance=false', '-f', 'Dockerfile.lambda', '-t', $imagenVial, '.')
  AwsVial ecr get-login-password | & docker login --username AWS --password-stdin '102098709715.dkr.ecr.us-east-1.amazonaws.com'
  if ($LASTEXITCODE -ne 0) { throw 'Fallo la autenticacion ECR.' }
  PasoLocal docker @('push', $imagenVial)
  $digestVial = AwsVial ecr describe-images --repository-name vialservi-api --image-ids "imageTag=$etiquetaVial" --query 'imageDetails[0].imageDigest' --output text
  # URI inmutable; los demas parametros se reutilizan de la pila existente.
  AwsVial cloudformation deploy --stack-name vialservi-lambda --template-file infra/cloudformation/lambda.yml --capabilities CAPABILITY_IAM --parameter-overrides "ImagenApi=${repositorioVial}@$digestVial" --no-fail-on-empty-changeset
  $urlVial = ($pilaActual.Stacks[0].Outputs | Where-Object OutputKey -eq Url).OutputValue
  $listoVial = Invoke-RestMethod "$urlVial/api/listo" -TimeoutSec 35
  if ($listoVial.estado -ne 'listo') { throw 'La API no esta lista. No publicar la interfaz.' }
  if (!$SoloApi) {
    $bucketVial = ($pilaActual.Stacks[0].Outputs | Where-Object OutputKey -eq BucketWebNombre).OutputValue
    $distVial = ($pilaActual.Stacks[0].Outputs | Where-Object OutputKey -eq IdDistribucion).OutputValue
    # Assets nuevos primero; mantener los antiguos para pestanas abiertas.
    AwsVial s3 sync apps/web/dist "s3://$bucketVial" --exclude index.html --cache-control 'public,max-age=31536000,immutable' --only-show-errors
    AwsVial s3 cp apps/web/dist/index.html "s3://$bucketVial/index.html" --cache-control 'no-cache,no-store,must-revalidate' --only-show-errors
    AwsVial cloudfront create-invalidation --distribution-id $distVial --paths '/*' --query 'Invalidation.Id' --output text
  }
  Write-Output "Despliegue verificado: $urlVial"
} finally { $env:VITE_API_URL = $apiWebAnterior; Pop-Location }
