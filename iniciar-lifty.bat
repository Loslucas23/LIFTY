@echo off
title Lifty
cd /d "%~dp0"
if not exist "apps\desktop\dist\main.cjs" (
  echo Primero ejecuta instalar-lifty.bat
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0apps\desktop"
