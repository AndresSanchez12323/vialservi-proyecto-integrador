param([switch]$GenerateJwt, [switch]$Smtp)
$ErrorActionPreference = 'Stop'
# Solo preparar variables del proceso. No AWS, archivos, historial ni stdout.
if ($GenerateJwt) {
    if ($env:TF_VAR_jwt_secret) { throw 'JWT ya cargado. No se rota implicitamente.' }
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $env:TF_VAR_jwt_secret = [Convert]::ToBase64String($bytes)
} else {
    $secure = Read-Host 'JWT de destino (entrada oculta; conservar en su gestor seguro)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:TF_VAR_jwt_secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
if ($Smtp) {
    $secure = Read-Host 'Clave de aplicacion SMTP (entrada oculta)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:TF_VAR_smtp_password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
Write-Host 'Secretos cargados solo en esta sesion; nunca imprimirlos. No cambie secret_version sin una rotacion deliberada.'
