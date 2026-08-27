[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$VersionPath = Join-Path $RepoRoot 'VERSION'
[System.IO.File]::WriteAllText($VersionPath, "$Version`n", $Utf8NoBom)

& (Join-Path $PSScriptRoot 'check_version.ps1')
Write-Host "VERSION_UPDATED version=$Version"
