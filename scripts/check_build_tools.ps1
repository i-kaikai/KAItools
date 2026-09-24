[CmdletBinding()]
param(
    [string]$PythonPath = 'python'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ExpectedNode = (Get-Content -LiteralPath (Join-Path $RepoRoot '.node-version') -Raw -Encoding UTF8).Trim()
$ExpectedPython = (Get-Content -LiteralPath (Join-Path $RepoRoot '.python-version') -Raw -Encoding UTF8).Trim()
$Package = Get-Content -LiteralPath (Join-Path $RepoRoot 'frontend\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ExpectedPnpm = [string]$Package.packageManager -replace '^pnpm@', ''

function Invoke-VersionCommand {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    $output = & $Command @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read version from $Command"
    }
    return ($output | Select-Object -First 1).ToString().Trim()
}

$ActualPython = Invoke-VersionCommand $PythonPath @('--version')
$ActualPython = $ActualPython -replace '^Python\s+', ''
$FrontendRoot = Join-Path $RepoRoot 'frontend'
Push-Location $FrontendRoot
try {
    $ActualNode = (Invoke-VersionCommand 'corepack' @('pnpm', 'exec', 'node', '--version')).TrimStart('v')
    $ActualPnpm = Invoke-VersionCommand 'corepack' @('pnpm', '--version')
}
finally {
    Pop-Location
}

$failures = @()
if ($ActualNode -ne $ExpectedNode) { $failures += "Node.js $ActualNode (expected $ExpectedNode)" }
if ($ActualPython -ne $ExpectedPython) { $failures += "Python $ActualPython (expected $ExpectedPython)" }
if ($ActualPnpm -ne $ExpectedPnpm) { $failures += "pnpm $ActualPnpm (expected $ExpectedPnpm)" }

if ($failures.Count -gt 0) {
    throw "Build tool version mismatch: $($failures -join '; ')"
}

Write-Host "BUILD_TOOLS_OK node=$ActualNode python=$ActualPython pnpm=$ActualPnpm"
