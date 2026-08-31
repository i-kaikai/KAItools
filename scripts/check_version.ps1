[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw -Encoding UTF8).Trim()

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "VERSION must use semantic versioning (x.y.z): $Version"
}

$Failures = [System.Collections.Generic.List[string]]::new()
$Package = Get-Content -LiteralPath (Join-Path $RepoRoot 'frontend\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Package.PSObject.Properties.Name -contains 'version') {
    $Failures.Add('frontend/package.json must not maintain a version field')
}

$PyProject = Get-Content -LiteralPath (Join-Path $RepoRoot 'pyproject.toml') -Raw -Encoding UTF8
if ($PyProject -notmatch '(?m)^dynamic\s*=\s*\["version"\]') {
    $Failures.Add('pyproject.toml must declare version as dynamic')
}
if ($PyProject -notmatch '(?m)^version\s*=\s*\{\s*file\s*=\s*\["VERSION"\]\s*\}') {
    $Failures.Add('pyproject.toml must read its version from VERSION')
}

$VersionInfoPath = Join-Path $RepoRoot 'packaging\version_info.txt'
if (Test-Path -LiteralPath $VersionInfoPath) {
    $Failures.Add('packaging/version_info.txt must not be a maintained version source')
}

$Spec = Get-Content -LiteralPath (Join-Path $RepoRoot 'KAITools.spec') -Raw -Encoding UTF8
if ($Spec -notmatch 'APP_VERSION\s*=\s*VERSION_FILE\.read_text' -or $Spec -notmatch 'WINDOWS_VERSION_RESOURCE\.write_text') {
    $Failures.Add('KAITools.spec must generate Windows version metadata from VERSION')
}

if ($Failures.Count -gt 0) {
    throw "Version metadata must derive from VERSION ($Version): $($Failures -join '; ')"
}

& (Join-Path $PSScriptRoot 'check_release_notes.ps1') -AllowDraft
Write-Host "VERSION_OK version=$Version"
