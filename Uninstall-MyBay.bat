@echo off
setlocal
cd /d "%~dp0"
title MyBay - Uninstall

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-control.ps1" -Action uninstall
if errorlevel 1 (
  echo.
  echo MyBay could not be uninstalled. Review the message above.
)
pause
