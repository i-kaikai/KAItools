[CmdletBinding()]
param(
    [switch]$SkipE2E
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$Frontend = Join-Path $RepoRoot 'frontend'

& (Join-Path $PSScriptRoot 'check_version.ps1')

if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Missing .venv. Create it with the Python version declared in .python-version and install requirements-dev.txt.'
}

& (Join-Path $PSScriptRoot 'check_build_tools.ps1') -PythonPath $Python
if ($LASTEXITCODE -ne 0) { throw 'Build tool version check failed' }

Push-Location $Frontend
try {
    & corepack pnpm install --frozen-lockfile --config.confirmModulesPurge=false
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    & corepack pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw 'frontend typecheck failed' }
    & corepack pnpm test
    if ($LASTEXITCODE -ne 0) { throw 'frontend unit tests failed' }
    & corepack pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
    if (-not $SkipE2E) {
        & corepack pnpm test:e2e
        if ($LASTEXITCODE -ne 0) { throw 'Playwright tests failed' }
    }
    & corepack pnpm build:web
    if ($LASTEXITCODE -ne 0) { throw 'web frontend build failed' }
    if (-not $SkipE2E) {
        & corepack pnpm test:e2e:web
        if ($LASTEXITCODE -ne 0) { throw 'Web Playwright tests failed' }
    }
    # PyInstaller consumes build/web, so leave desktop-mode assets there.
    & corepack pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'desktop frontend rebuild failed' }
}
finally {
    Pop-Location
}

& $Python -m compileall -q (Join-Path $RepoRoot 'desktop')
if ($LASTEXITCODE -ne 0) { throw 'Python compileall failed' }
& $Python -m pytest
if ($LASTEXITCODE -ne 0) { throw 'Python tests failed' }

Write-Host 'VERIFICATION_OK'
