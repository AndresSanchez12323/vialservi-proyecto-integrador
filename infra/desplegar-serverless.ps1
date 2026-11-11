param([switch]$SoloApi)
$ErrorActionPreference = 'Stop'
$env:AWS_PROFILE = 'personal'
$env:AWS_REGION = 'us-east-1'
$regionVial = 'us-east-1'
$perfilVial = 'personal'

function AwsVial {
  # El aviso de la CLI no es un fallo. Se aparta de la salida real para que el
  # JSON siga siendo parseable y para que solo el codigo de salida detenga el
  # despliegue: cortar a mitad deja la imagen subida y la pila sin actualizar.
  $avisos = [System.Collections.Generic.List[string]]::new()
  $previo = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $resultado = & aws @args --profile $perfilVial --region $regionVial 2>&1 |
      Where-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $avisos.Add("$_"); $false }
        else { $true }
      }
  } finally { $ErrorActionPreference = $previo }
  if ($LASTEXITCODE -ne 0) {
    $avisos | ForEach-Object { Write-Host $_ }
    throw 'Fallo AWS; revisar el diagnostico antes de continuar.'
  }
  $avisos | ForEach-Object { Write-Host $_ }
  return $resultado
}
function PasoLocal([string]$Programa, [string[]]$Argumentos) {
  # docker y npm escriben su PROGRESO en stderr, no solo sus fallos. Windows
  # PowerShell 5.1 convierte esa salida en error de terminacion cuando
  # ErrorActionPreference es Stop, y ni 2>&1 lo evita: hay que bajar la
  # preferencia mientras corre el programa y volver a subirla despues.
  # El codigo de salida es el unico juez de si el paso fallo.
  $previo = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Programa @Argumentos 2>&1 | ForEach-Object { Write-Host $_ } }
  finally { $ErrorActionPreference = $previo }
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
  # En archivo, no inline: PowerShell le quita las comillas dobles al programa
  # que se le pasa a node y el guardian moria de sintaxis sin comprobar nada.
  PasoLocal node @('infra/verificar-base-local.mjs')
  PasoLocal npm @('test')
  PasoLocal npm @('run', 'build:api')
  # '/' se normaliza a origen actual; evita heredar un .env con localhost.
  $env:VITE_API_URL = '/'
  PasoLocal npm @('run', 'build:web')
  $etiquetaVial = 'lambda-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  $repositorioVial = '102098709715.dkr.ecr.us-east-1.amazonaws.com/vialservi-api'
  $imagenVial = "${repositorioVial}:$etiquetaVial"
  PasoLocal docker @('build', '--platform', 'linux/amd64', '--provenance=false', '-f', 'Dockerfile.lambda', '-t', $imagenVial, '.')
  # La tuberia de Windows PowerShell 5.1 corrompe el token al entregarlo a un
  # proceso nativo y ECR responde 400. Se delega la tuberia a cmd, que la pasa
  # byte a byte. La clave sigue viajando por stdin: nunca aparece en la linea
  # de comandos, ni en el historial, ni en este registro.
  $registroEcr = '102098709715.dkr.ecr.us-east-1.amazonaws.com'
  $ordenEcr = "aws ecr get-login-password --profile $perfilVial --region $regionVial | " +
              "docker login --username AWS --password-stdin $registroEcr 2>&1"
  $previoEcr = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { cmd /c $ordenEcr | ForEach-Object { Write-Host $_ } }
  finally { $ErrorActionPreference = $previoEcr }
  if ($LASTEXITCODE -ne 0) { throw 'Fallo la autenticacion ECR.' }
  PasoLocal docker @('push', $imagenVial)
  $digestVial = AwsVial ecr describe-images --repository-name vialservi-api --image-ids "imageTag=$etiquetaVial" --query 'imageDetails[0].imageDigest' --output text
  # URI inmutable; los demas parametros se reutilizan de la pila existente.
  AwsVial cloudformation deploy --stack-name vialservi-lambda --template-file infra/cloudformation/lambda.yml --capabilities CAPABILITY_IAM --parameter-overrides "ImagenApi=${repositorioVial}@$digestVial" --no-fail-on-empty-changeset
  $urlVial = ($pilaActual.Stacks[0].Outputs | Where-Object OutputKey -eq Url).OutputValue
  # Aurora queda pausada en 0 ACU: la primera peticion puede agotar el tiempo
  # mientras el cluster despierta, y eso no significa que el despliegue fallara.
  # /api/listo es la lectura de reactivacion, la unica que el diseño permite
  # reintentar; una escritura jamas se reintenta. Cuatro intentos cubren de
  # sobra los ~25 s que tarda en volver de la pausa.
  $listoVial = $null
  foreach ($intentoVial in 1..4) {
    try {
      $listoVial = Invoke-RestMethod "$urlVial/api/listo" -TimeoutSec 35
      if ($listoVial.estado -eq 'listo') { break }
    } catch {
      Write-Host "Intento ${intentoVial}: la base todavia despierta ($($_.Exception.Message))"
      $listoVial = $null
    }
    if ($intentoVial -lt 4) { Start-Sleep -Seconds 15 }
  }
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
