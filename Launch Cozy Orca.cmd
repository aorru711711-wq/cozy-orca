@echo off
setlocal
cd /d "%~dp0"
set "TEMP=%~dp0.tmp"
set "TMP=%TEMP%"
set "COZY_DATA_DIR=%~dp0data"
if not exist "%TEMP%" mkdir "%TEMP%"
if exist "%~dp0Cozy Orca.exe" (
  start "" "%~dp0Cozy Orca.exe"
) else (
  node "%~dp0scripts\run.cjs"
)
