@echo off
setlocal
cd /d "%~dp0"
title MyBay - Repair

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-control.ps1" -Action repair
if errorlevel 1 (
  echo.
  echo MyBay could not be repaired. Review the message above.
)
pause
