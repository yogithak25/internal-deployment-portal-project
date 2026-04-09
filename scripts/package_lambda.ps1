$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Build = Join-Path $Root "build"
$Pkg = Join-Path $Build "lambda_pkg"
$Zip = Join-Path $Build "lambda.zip"
$Backend = Join-Path $Root "backend"

if (Test-Path $Pkg) { Remove-Item -Recurse -Force $Pkg }
New-Item -ItemType Directory -Force -Path $Build | Out-Null
New-Item -ItemType Directory -Force -Path $Pkg | Out-Null

python -m pip install -r (Join-Path $Backend "requirements.txt") -t $Pkg
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Get-ChildItem -Path $Backend -Filter "*.py" -File | Copy-Item -Destination $Pkg

if (Test-Path $Zip) { Remove-Item -Force $Zip }
Compress-Archive -Path (Join-Path $Pkg "*") -DestinationPath $Zip -Force
Write-Host "Created $Zip"
