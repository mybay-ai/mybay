@echo off
setlocal
cd /d "%~dp0"
title MyBay - Logs

echo Press Ctrl+C to stop following the logs.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-control.ps1" -Action logs
if errorlevel 1 (
  echo.
  echo Logs could not be opened. Review the message above.
)
pause
