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
$NotesPath = Join-Path $RepoRoot 'RELEASE_NOTES.md'
$NotesTemplatePath = Join-Path $PSScriptRoot 'templates\release-notes-entry.md'
$NotesMarker = '<!-- RELEASE_NOTES:INSERT -->'

if (-not (Test-Path -LiteralPath $NotesPath)) {
    throw 'RELEASE_NOTES.md is missing'
}
if (-not (Test-Path -LiteralPath $NotesTemplatePath)) {
    throw 'Release notes entry template is missing'
}

$Notes = Get-Content -LiteralPath $NotesPath -Raw -Encoding UTF8
$VersionHeadingPattern = '(?m)^## v' + [regex]::Escape($Version) + '\s*$'
if ($Notes -notmatch $VersionHeadingPattern) {
    if (-not $Notes.Contains($NotesMarker)) {
        throw 'RELEASE_NOTES.md insertion marker is missing'
    }

    $NotesTemplate = Get-Content -LiteralPath $NotesTemplatePath -Raw -Encoding UTF8
    $NotesEntry = $NotesTemplate.Replace('{{VERSION}}', $Version).Trim()
    $Notes = $Notes.Replace($NotesMarker, "$NotesMarker`n`n$NotesEntry")
}

[System.IO.File]::WriteAllText($VersionPath, "$Version`n", $Utf8NoBom)
[System.IO.File]::WriteAllText($NotesPath, $Notes.TrimEnd() + "`n", $Utf8NoBom)

& (Join-Path $PSScriptRoot 'check_version.ps1')
Write-Host "VERSION_UPDATED version=$Version"
