@echo off
setlocal
cd /d "%~dp0"
title MyBay - Stop

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-control.ps1" -Action stop
if errorlevel 1 (
  echo.
  echo MyBay could not be stopped. Review the message above.
)
pause
