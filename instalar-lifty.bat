@echo off
setlocal EnableExtensions
title Instalar Lifty
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Lifty - instalacion
echo  ==========================================
echo.

rem ---- 1) Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo [1/4] No encontre Node.js. Lo instalo con winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  No tengo winget para instalarlo solo.
    echo  Descarga Node.js LTS de https://nodejs.org , instalalo
    echo  y volve a ejecutar este archivo.
    start "" https://nodejs.org
    pause
    exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js se instalo pero esta ventana todavia no lo ve.
  echo  Cerra esta ventana y ejecuta instalar-lifty.bat de nuevo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [1/4] Node.js %%v OK

rem ---- 2) Dependencias ----
echo [2/4] Instalando dependencias (la primera vez tarda unos minutos)...
call npm install
if errorlevel 1 goto :error
echo        Descargando el motor de la ventana (Electron, solo la primera vez)...
call node node_modules\electron\install.js
if errorlevel 1 goto :error

rem ---- 3) Compilar ----
echo [3/4] Compilando Lifty...
call npm run build
if errorlevel 1 goto :error
call npm run build -w @lifty/desktop
if errorlevel 1 goto :error

rem En pruebas automaticas (LIFTY_NO_PROMPT=1) no se pregunta nada.
if defined LIFTY_NO_PROMPT (
  echo Listo.
  exit /b 0
)

rem ---- 4) Instalador opcional ----
echo.
choice /c SN /m "[4/4] Queres generar el instalador de Windows (Lifty Setup .exe) para instalarlo como programa"
if errorlevel 2 goto :run
call npm run dist -w @lifty/desktop
if errorlevel 1 goto :error
echo.
echo  Instalador listo en: apps\desktop\release
start "" "%~dp0apps\desktop\release"

:run
echo.
echo  Listo! Para abrir Lifty cuando quieras: doble clic en iniciar-lifty.bat
echo  (Si Windows pregunta por el firewall, permitilo en redes privadas
echo   para que el celular se pueda conectar.)
echo.
choice /c SN /m "Abrir Lifty ahora"
if errorlevel 2 exit /b 0
start "" cmd /c "%~dp0iniciar-lifty.bat"
exit /b 0

:error
echo.
echo  Algo fallo. Copia el mensaje de arriba y pasamelo.
if not defined LIFTY_NO_PROMPT pause
exit /b 1
