@echo off
title Lifty
cd /d "%~dp0"
if not exist "apps\desktop\dist\main.cjs" (
  echo Primero ejecuta instalar-lifty.bat
  pause
  exit /b 1
)
cd /d "%~dp0apps\desktop"
start "Lifty" /min cmd /c "npx electron ."
