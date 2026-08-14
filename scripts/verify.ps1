[CmdletBinding()]
param(
    [switch]$SkipE2E
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$Frontend = Join-Path $RepoRoot 'frontend'

if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Missing .venv. Create it with Python 3.13 and install requirements-dev.txt.'
}

Push-Location $Frontend
try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    & pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw 'frontend typecheck failed' }
    & pnpm test
    if ($LASTEXITCODE -ne 0) { throw 'frontend unit tests failed' }
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
    if (-not $SkipE2E) {
        & pnpm test:e2e
        if ($LASTEXITCODE -ne 0) { throw 'Playwright tests failed' }
    }
    & pnpm build:web
    if ($LASTEXITCODE -ne 0) { throw 'web frontend build failed' }
    if (-not $SkipE2E) {
        & pnpm test:e2e:web
        if ($LASTEXITCODE -ne 0) { throw 'Web Playwright tests failed' }
    }
    # PyInstaller consumes build/web, so leave desktop-mode assets there.
    & pnpm build
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
