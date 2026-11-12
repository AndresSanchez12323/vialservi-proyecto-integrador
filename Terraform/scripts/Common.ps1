Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$TerraformRoot = Split-Path $PSScriptRoot -Parent
$RepoRoot = Split-Path $TerraformRoot -Parent

function Run([string]$Program, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Program @Arguments | Out-Host; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw "Fallo $Program (codigo $code). Detenido." }
}
function AwsJson([string[]]$Arguments, $Configuration) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $result = & aws @Arguments --profile $Configuration.aws_profile --region $Configuration.aws_region --output json 2>&1 |
            Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw 'Fallo AWS. No continuar; revisar permisos y conectividad sin volcar secretos.' }
    return ($result | ConvertFrom-Json)
}
function ReadConfiguration([string]$Path) {
    $configuration = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($configuration.target_account_id -notmatch '^\d{12}$' -or
        $configuration.target_account_id -in @('102098709715', '497502378363', '000000000000')) {
        throw 'Configure una cuenta destino real, distinta de las cuentas actuales.'
    }
    if ($configuration.aws_profile -notmatch '^[a-zA-Z0-9_-]+$' -or
        $configuration.aws_profile.ToLower() -in @('default','personal','andresx')) {
        throw 'Use un perfil dedicado a destino.'
    }
    if ($configuration.aws_region -ne 'us-east-1') { throw 'Region preparada: us-east-1.' }
    if ($configuration.project -notmatch '^[a-z][a-z0-9-]{2,24}$') { throw 'Nombre de proyecto invalido.' }
    return $configuration
}
function AssertTarget($Configuration) {
    $identity = AwsJson @('sts','get-caller-identity') $Configuration
    if ($identity.Account -ne $Configuration.target_account_id) { throw 'STS no coincide con cuenta destino. Detenido.' }
    Write-Host "Cuenta DESTINO verificada: $($identity.Account), perfil $($Configuration.aws_profile), region $($Configuration.aws_region)"
}
function Outputs {
    $raw = & terraform "-chdir=$TerraformRoot" output -json
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el estado Terraform de destino.' }
    return ($raw | ConvertFrom-Json)
}
