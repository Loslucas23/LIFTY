@echo off
title Lifty
cd /d "%~dp0"
if not exist "apps\desktop\dist\main.cjs" (
  echo Primero ejecuta instalar-lifty.bat
  pause
  exit /b 1
)
if not exist "node_modules\.bin\electron.cmd" (
  echo Faltan dependencias. Ejecuta instalar-lifty.bat
  pause
  exit /b 1
)
start "Lifty" /min cmd /c ""%~dp0node_modules\.bin\electron.cmd" "%~dp0apps\desktop""
