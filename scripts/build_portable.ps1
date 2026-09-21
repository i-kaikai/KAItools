[CmdletBinding()]
param(
    [switch]$SkipE2E,
    [string]$SigningKeyPath = $env:KAITOOLS_UPDATE_SIGNING_KEY
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$BuildWork = Join-Path $RepoRoot 'build\pyinstaller'
$UpdaterBuildWork = Join-Path $RepoRoot 'build\pyinstaller-updater'
$DistRoot = Join-Path $RepoRoot 'dist'
$UpdaterDistRoot = Join-Path $RepoRoot 'build\updater-dist'
$PortableRoot = Join-Path $DistRoot 'KAITools'
$ReleaseRoot = Join-Path $RepoRoot 'release'
$Version = (Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw -Encoding UTF8).Trim()
$ZipPath = Join-Path $ReleaseRoot "KAITools-v$Version-windows-x64.zip"
$HashPath = "$ZipPath.sha256"

if (-not $SigningKeyPath) {
    throw 'SigningKeyPath is required. Use a local ignored key or the KAITOOLS_UPDATE_SIGNING_KEY release secret.'
}
$SigningKeyPath = [System.IO.Path]::GetFullPath($SigningKeyPath)
if (-not (Test-Path -LiteralPath $SigningKeyPath)) {
    throw "Update signing key is missing: $SigningKeyPath"
}

& (Join-Path $PSScriptRoot 'check_release_notes.ps1')
& (Join-Path $PSScriptRoot 'verify.ps1') -SkipE2E:$SkipE2E
if ($LASTEXITCODE -ne 0) { throw 'Verification failed' }

foreach ($Target in @($BuildWork, $UpdaterBuildWork, $UpdaterDistRoot, $PortableRoot)) {
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
    & $Python -m PyInstaller --noconfirm --clean --distpath $UpdaterDistRoot --workpath $UpdaterBuildWork (Join-Path $RepoRoot 'KAIToolsUpdater.spec')
    if ($LASTEXITCODE -ne 0) { throw 'Updater build failed' }
    & $Python -m PyInstaller --noconfirm --clean --distpath $DistRoot --workpath $BuildWork (Join-Path $RepoRoot 'KAITools.spec')
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
}
finally {
    Pop-Location
}

$UpdaterExecutable = Join-Path $UpdaterDistRoot 'KAIToolsUpdater.exe'
if (-not (Test-Path -LiteralPath $UpdaterExecutable)) {
    throw "Packaged updater is missing: $UpdaterExecutable"
}
Copy-Item -LiteralPath $UpdaterExecutable -Destination (Join-Path $PortableRoot 'KAIToolsUpdater.exe')

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
Copy-Item -LiteralPath (Join-Path $RepoRoot 'RELEASE_NOTES.md') -Destination (Join-Path $PortableRoot 'RELEASE_NOTES.md')
New-Item -ItemType Directory -Path (Join-Path $PortableRoot 'data') -Force | Out-Null
& $Python (Join-Path $RepoRoot 'scripts\build_update_release.py') --portable-root $PortableRoot --release-root $ReleaseRoot --private-key $SigningKeyPath
if ($LASTEXITCODE -ne 0) { throw 'Update release artifact generation failed' }
if (-not (Test-Path -LiteralPath (Join-Path $PortableRoot 'app-manifest.json'))) {
    throw 'Packaged application manifest is missing'
}
Compress-Archive -Path (Join-Path $PortableRoot '*') -DestinationPath $ZipPath -CompressionLevel Optimal
$ZipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
Set-Content -LiteralPath $HashPath -Value "$ZipHash  $(Split-Path -Leaf $ZipPath)" -Encoding ascii

Write-Host "PORTABLE_ROOT=$PortableRoot"
Write-Host "ZIP_PATH=$ZipPath"
Write-Host "ZIP_SHA256=$ZipHash"
