@echo off
setlocal
cd /d "%~dp0"
title MyBay - Diagnostics

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-acceptance.ps1"
if errorlevel 1 (
  echo.
  echo MyBay diagnostics could not be completed. Review the message above.
  pause
  exit /b 1
)

echo.
echo The diagnostic report is ready. It does not include passwords or secret keys.
pause
