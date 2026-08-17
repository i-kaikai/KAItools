[CmdletBinding()]
param(
    [string]$PortableRoot,
    [int]$Seconds = 6
)

$ErrorActionPreference = 'Stop'
if (-not $PortableRoot) {
    $PortableRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\KAITools'
}
$Executable = Join-Path $PortableRoot 'KAITools.exe'
if (-not (Test-Path -LiteralPath $Executable)) {
    throw "Executable not found: $Executable"
}

$LogPath = Join-Path $PortableRoot 'data\logs\devtoolkit.log'
$InitialLogLineCount = 0
$InitialProcessIds = @(Get-Process -Name 'KAITools' -ErrorAction SilentlyContinue | ForEach-Object Id)
if (Test-Path -LiteralPath $LogPath) {
    $InitialLogLineCount = @(Get-Content -LiteralPath $LogPath -Encoding UTF8).Count
}
$Launcher = Start-Process -FilePath $Executable -WorkingDirectory $PortableRoot -WindowStyle Hidden -PassThru
try {
    Start-Sleep -Seconds $Seconds
    $NewProcesses = @(
        Get-Process -Name 'KAITools' -ErrorAction SilentlyContinue |
            Where-Object { $InitialProcessIds -notcontains $_.Id }
    )
    $WindowProcess = $NewProcesses | Select-Object -First 1
    if (-not $WindowProcess) { throw 'KAITools did not create a live process' }
    $Started = $false
    if (Test-Path -LiteralPath $LogPath) {
        $NewLogLines = @(Get-Content -LiteralPath $LogPath -Encoding UTF8) | Select-Object -Skip $InitialLogLineCount
        $Started = [bool]($NewLogLines | Where-Object { $_ -match 'application_start' })
    }
    if (-not $Started) {
        throw 'KAITools process is alive but the main WebView2 window did not start'
    }
    Write-Host "SMOKE_OK pid=$($WindowProcess.Id) seconds=$Seconds"
}
finally {
    $NewProcesses = @(
        Get-Process -Name 'KAITools' -ErrorAction SilentlyContinue |
            Where-Object { $InitialProcessIds -notcontains $_.Id }
    )
    foreach ($Process in $NewProcesses) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        $Process.WaitForExit(5000)
    }
}
