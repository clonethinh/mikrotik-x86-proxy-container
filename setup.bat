@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   webuiproxymikrotik - 1-click setup
echo ============================================================

where node >nul 2>&1
if errorlevel 1 (
  echo Can cai Node.js 20+ ^(https://nodejs.org^)
  pause
  exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
  echo Can Docker Desktop ^(docker CLI trong PATH^)
  pause
  exit /b 1
)

if not exist setup.config.json (
  echo.
  echo Chua co setup.config.json - chay wizard...
  node scripts\setup-wizard.js
  if errorlevel 1 pause & exit /b 1
)

node setup\orchestrator.js %*
set EXIT=%ERRORLEVEL%

echo.
if %EXIT%==0 (
  echo SETUP HOAN TAT - mo WebUI trong setup-report.json
) else (
  echo SETUP LOI - xem setup-report.json
)
pause
exit /b %EXIT%