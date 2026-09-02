@echo off
setlocal
cd /d "%~dp0"
title MyBay - Start

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0quick-start.ps1" -InstallPrerequisites -UsePrebuiltImage -PromptAdminPassword -OpenBrowser
if %ERRORLEVEL% EQU 10 (
  echo.
  echo Windows must restart to finish WSL setup.
  echo MyBay will continue automatically after you sign in again.
  pause
  exit /b 0
)
if errorlevel 1 (
  echo.
  echo MyBay could not start. Review the message above, then run this file again.
  pause
  exit /b 1
)

echo.
echo MyBay is ready. You can close this window.
pause
