@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: Chi Windows — yeu cau Administrator (tu dong UAC neu chua co quyen)
net session >nul 2>&1
if %errorLevel% neq 0 (
  if /i not "%~1"=="__elevated__" (
    echo.
    echo Can quyen Administrator - dang yeu cau UAC...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru -ArgumentList '__elevated__','%*'; if ($null -eq $p) { exit 1 } else { exit $p.ExitCode }"
    exit /b %ERRORLEVEL%
  )
  echo.
  echo SETUP CAN QUYEN ADMINISTRATOR.
  echo Chuot phai setup.bat -^> Run as administrator
  pause
  exit /b 1
)
if /i "%~1"=="__elevated__" shift

echo ============================================================
echo   webuiproxymikrotik - 1-click HE THONG PROXY ^(Windows^)
echo   WebUI + hub + router scripts + auto-provision WAN
echo   Router moi: Winbox MAC hoac 192.168.88.1 - tu bat SSH
echo ============================================================

if /I not "%SETUP_SKIP_PREREQS%"=="1" (
  echo.
  echo Kiem tra / tu cai Node + Docker + Python ^(winget^)...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-windows-prereqs.ps1"
  if errorlevel 1 (
    echo.
    echo Bo qua tu cai: set SETUP_SKIP_PREREQS=1 roi chay lai
    pause
    exit /b 1
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo Can Node.js 20+ ^(https://nodejs.org^)
  pause
  exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
  echo Can Docker Desktop ^(docker CLI trong PATH^)
  pause
  exit /b 1
)

set "WIZARD_ONLY=0"
if /i "%~1"=="--wizard-only" (
  set "WIZARD_ONLY=1"
  echo.
  echo Chay wizard cau hinh...
  node scripts\setup-wizard.js
  set EXIT=!ERRORLEVEL!
  goto :finish
)

if not exist setup.config.json (
  echo.
  echo Chua co setup.config.json - chay wizard...
  node scripts\setup-wizard.js
  if errorlevel 1 pause & exit /b 1
)

node setup\orchestrator.js %*
set EXIT=%ERRORLEVEL%

:finish
echo.
if "!WIZARD_ONLY!"=="1" (
  if !EXIT!==0 (
    echo WIZARD HOAN TAT - da luu setup.config.json
    echo Chay setup.bat de deploy len router
  ) else (
    echo WIZARD LOI
  )
) else if !EXIT!==0 (
  echo SETUP HOAN TAT - mo WebUI trong setup-report.json
) else (
  echo SETUP LOI - xem setup-report.json
)
pause
exit /b !EXIT!