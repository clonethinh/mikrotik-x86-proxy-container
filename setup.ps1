# webuiproxymikrotik — deploy 1-click lên MikroTik mới
# Source gốc: thư mục này (C:\Users\PC\Desktop\webuiproxymikrotik)
#
# Lần đầu:
#   1. Copy setup.config.example.json -> setup.config.json
#   2. Điền router.host, router.sshPass, wan.host
#   3. Chạy: .\setup.ps1
#
# Yêu cầu: Node.js, Docker Desktop, Python

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "setup.config.json")) {
    Write-Host "Chua co setup.config.json" -ForegroundColor Red
    Write-Host "Copy: Copy-Item setup.config.example.json setup.config.json"
    Write-Host "Roi dien router.sshPass va wan.host"
    exit 1
}

Write-Host "============================================================"
Write-Host "  webuiproxymikrotik deploy"
Write-Host "  Source: $PSScriptRoot"
Write-Host "============================================================"

node setup/orchestrator.js @args
exit $LASTEXITCODE