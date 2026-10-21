# Sube el código de esta carpeta al servidor Vultr y lo actualiza.
# Uso (PowerShell, dentro de la carpeta CoolLab):
#   powershell -ExecutionPolicy Bypass -File deploy\subir.ps1 dev    # copia de pruebas
#   powershell -ExecutionPolicy Bypass -File deploy\subir.ps1 prod   # app real
param([ValidateSet('dev','prod')][string]$modo = 'dev', [string]$servidor = 'root@64.176.22.141')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$dir = if ($modo -eq 'dev') { '/opt/coollab-dev' } else { '/opt/coollab' }
$tgz = Join-Path $env:TEMP 'coollab.tgz'
Write-Host "1/3 Empaquetando el codigo..." -ForegroundColor Cyan
tar --exclude=node_modules --exclude=.env --exclude=data --exclude=uploads --exclude=docs --exclude=.git -czf $tgz .
Write-Host "2/3 Subiendo al servidor (pide la clave del servidor)..." -ForegroundColor Cyan
scp $tgz "${servidor}:/tmp/coollab.tgz"
if ($LASTEXITCODE -ne 0) { Write-Host "No se pudo subir el archivo al servidor." -ForegroundColor Red; exit 1 }
Write-Host "3/3 Instalando en $dir (pide la clave otra vez)..." -ForegroundColor Cyan
ssh $servidor "mkdir -p $dir && tar -xzf /tmp/coollab.tgz -C $dir && bash $dir/deploy/actualizar.sh $modo"
if ($LASTEXITCODE -ne 0) { Write-Host "La instalacion en el servidor fallo." -ForegroundColor Red; exit 1 }
Write-Host "Listo: $modo actualizado." -ForegroundColor Green
