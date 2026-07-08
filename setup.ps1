# webuiproxymikrotik — deploy 1-click (CHỈ WINDOWS, cần Administrator)
# Chạy: chuột phải setup.ps1 → Run with PowerShell (hoặc dùng setup.bat)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Test-IsAdmin {
    $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $IsWindows) {
    Write-Host "SETUP chi ho tro Windows." -ForegroundColor Red
    exit 1
}

if (-not (Test-IsAdmin)) {
    Write-Host "Can quyen Administrator - dang yeu cau UAC..." -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($args.Count -gt 0) { $argList += $args }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit 0
}

Write-Host "============================================================"
Write-Host "  webuiproxymikrotik deploy (Windows + Admin)"
Write-Host "  Source: $PSScriptRoot"
Write-Host "============================================================"

if ($env:SETUP_SKIP_PREREQS -ne "1") {
    & "$PSScriptRoot\scripts\ensure-windows-prereqs.ps1"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path "setup.config.json")) {
    Write-Host ""
    Write-Host "Chua co setup.config.json — chay wizard..." -ForegroundColor Yellow
    node scripts/setup-wizard.js
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

node setup/orchestrator.js @args
exit $LASTEXITCODE