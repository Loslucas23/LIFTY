@echo off
setlocal EnableExtensions
title Actualizar Lifty
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Lifty - actualizar a la ultima version
echo  ==========================================
echo.
echo  Tus datos NO se tocan (estan en %%APPDATA%%\Lifty\data).
echo.

rem Cerrar Lifty si esta abierto, para poder reemplazar los archivos.
taskkill /im electron.exe /f >nul 2>nul
taskkill /im lifty.exe /f >nul 2>nul

if exist ".git" (
  where git >nul 2>nul
  if errorlevel 1 goto :nogit
  echo [1/3] Bajando la ultima version...
  git pull
  if errorlevel 1 goto :error
) else (
  goto :nogit
)

echo [2/3] Instalando dependencias...
call npm install
if errorlevel 1 goto :error
call node node_modules\electron\install.js
if errorlevel 1 goto :error

echo [3/3] Compilando...
call npm run build
if errorlevel 1 goto :error
call npm run build -w @lifty/desktop
if errorlevel 1 goto :error

echo.
echo  Listo! Abriendo Lifty...
start "" cmd /c "%~dp0iniciar-lifty.bat"
exit /b 0

:nogit
echo  Esta carpeta no se descargo con git, asi que no se puede actualizar sola.
echo  Baja el ZIP nuevo desde GitHub (Code - Download ZIP), descomprimilo
echo  ENCIMA de esta carpeta (reemplazando archivos) y ejecuta instalar-lifty.bat.
echo  Tus datos no se pierden.
pause
exit /b 1

:error
echo.
echo  Algo fallo. Copia el mensaje de arriba y pasamelo.
pause
exit /b 1
