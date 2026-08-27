[CmdletBinding()]
param(
    [switch]$SkipE2E
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$BuildWork = Join-Path $RepoRoot 'build\pyinstaller'
$DistRoot = Join-Path $RepoRoot 'dist'
$PortableRoot = Join-Path $DistRoot 'KAITools'
$ReleaseRoot = Join-Path $RepoRoot 'release'
$Version = (Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw -Encoding UTF8).Trim()
$ZipPath = Join-Path $ReleaseRoot "KAITools-v$Version-windows-x64.zip"
$HashPath = "$ZipPath.sha256"

& (Join-Path $PSScriptRoot 'verify.ps1') -SkipE2E:$SkipE2E
if ($LASTEXITCODE -ne 0) { throw 'Verification failed' }

foreach ($Target in @($BuildWork, $PortableRoot)) {
    if (Test-Path -LiteralPath $Target) {
        Remove-Item -LiteralPath $Target -Recurse -Force
    }
}
New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
if (Test-Path -LiteralPath $HashPath) { Remove-Item -LiteralPath $HashPath -Force }

Push-Location $RepoRoot
try {
    & $Python -m PyInstaller --noconfirm --clean --distpath $DistRoot --workpath $BuildWork (Join-Path $RepoRoot 'KAITools.spec')
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
}
finally {
    Pop-Location
}

$PackagedWeb = Join-Path $PortableRoot '_internal\web'
if (-not (Test-Path -LiteralPath (Join-Path $PackagedWeb 'index.html'))) {
    throw "Packaged web assets are missing: $PackagedWeb"
}
if (-not (Test-Path -LiteralPath (Join-Path $PackagedWeb 'brand\kaitools-app-icon.ico'))) {
    throw "Packaged application icon is missing: $PackagedWeb"
}

$SourceWeb = Join-Path $RepoRoot 'build\web'
$SourceFiles = Get-ChildItem -LiteralPath $SourceWeb -Recurse -File
foreach ($SourceFile in $SourceFiles) {
    $Relative = $SourceFile.FullName.Substring($SourceWeb.Length + 1)
    $PackagedFile = Join-Path $PackagedWeb $Relative
    if (-not (Test-Path -LiteralPath $PackagedFile)) {
        throw "Packaged asset is missing: $Relative"
    }
    $SourceHash = (Get-FileHash -LiteralPath $SourceFile.FullName -Algorithm SHA256).Hash
    $PackagedHash = (Get-FileHash -LiteralPath $PackagedFile -Algorithm SHA256).Hash
    if ($SourceHash -ne $PackagedHash) {
        throw "Packaged asset differs from source: $Relative"
    }
}

Copy-Item -LiteralPath (Join-Path $RepoRoot 'README.md') -Destination (Join-Path $PortableRoot 'README.md')
New-Item -ItemType Directory -Path (Join-Path $PortableRoot 'data') -Force | Out-Null
Compress-Archive -Path (Join-Path $PortableRoot '*') -DestinationPath $ZipPath -CompressionLevel Optimal
$ZipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
Set-Content -LiteralPath $HashPath -Value "$ZipHash  $(Split-Path -Leaf $ZipPath)" -Encoding ascii

Write-Host "PORTABLE_ROOT=$PortableRoot"
Write-Host "ZIP_PATH=$ZipPath"
Write-Host "ZIP_SHA256=$ZipHash"
