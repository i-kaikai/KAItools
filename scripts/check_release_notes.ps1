[CmdletBinding()]
param(
    [switch]$AllowDraft
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw -Encoding UTF8).Trim()
$NotesPath = Join-Path $RepoRoot 'RELEASE_NOTES.md'

if (-not (Test-Path -LiteralPath $NotesPath)) {
    throw 'RELEASE_NOTES.md is missing'
}

$Notes = Get-Content -LiteralPath $NotesPath -Raw -Encoding UTF8
$ReleasePattern = '(?m)^## v(?<version>\d+\.\d+\.\d+)\s*$'
$ReleaseMatches = [regex]::Matches($Notes, $ReleasePattern)
$Failures = [System.Collections.Generic.List[string]]::new()

if ($ReleaseMatches.Count -eq 0) {
    $Failures.Add('RELEASE_NOTES.md must contain at least one version entry')
}
elseif ($ReleaseMatches[0].Groups['version'].Value -ne $Version) {
    $Failures.Add("the first version entry must be v$Version")
}

$CurrentMatch = $null
foreach ($ReleaseMatch in $ReleaseMatches) {
    if ($ReleaseMatch.Groups['version'].Value -eq $Version) {
        $CurrentMatch = $ReleaseMatch
        break
    }
}

if ($null -eq $CurrentMatch) {
    $Failures.Add("a v$Version entry is required")
}
elseif (-not $AllowDraft) {
    $SectionStart = $CurrentMatch.Index + $CurrentMatch.Length
    $SectionEnd = $Notes.Length
    foreach ($ReleaseMatch in $ReleaseMatches) {
        if ($ReleaseMatch.Index -gt $CurrentMatch.Index) {
            $SectionEnd = $ReleaseMatch.Index
            break
        }
    }

    $Section = $Notes.Substring($SectionStart, $SectionEnd - $SectionStart)
    $SectionLines = @(($Section -split '\r?\n') | Where-Object { $_.Trim().Length -gt 0 })

    if ($Section -match '(?m)\bTBD\b') {
        $Failures.Add("the v$Version entry still contains TBD")
    }
    if ($SectionLines.Count -eq 0 -or $SectionLines[0] -notmatch '\d{4}-\d{2}-\d{2}\s*$') {
        $Failures.Add("the v$Version entry must start with a release date in YYYY-MM-DD format")
    }

    $ChangesHeadingIndex = -1
    for ($Index = 0; $Index -lt $SectionLines.Count; $Index++) {
        if ($SectionLines[$Index] -match '^###\s+\S') {
            $ChangesHeadingIndex = $Index
            break
        }
    }

    $HasChangeItem = $false
    if ($ChangesHeadingIndex -ge 0) {
        for ($Index = $ChangesHeadingIndex + 1; $Index -lt $SectionLines.Count; $Index++) {
            if ($SectionLines[$Index] -match '^###\s+\S') {
                break
            }
            if ($SectionLines[$Index] -match '^\s*-\s+\S' -and $SectionLines[$Index] -notmatch '\bTBD\b') {
                $HasChangeItem = $true
                break
            }
        }
    }
    if (-not $HasChangeItem) {
        $Failures.Add("the v$Version changes section must contain at least one item")
    }
}

if ($Failures.Count -gt 0) {
    throw "Release notes validation failed: $($Failures -join '; ')"
}

$Status = if ($AllowDraft) { 'draft' } else { 'ready' }
Write-Host "RELEASE_NOTES_OK version=$Version status=$Status"
