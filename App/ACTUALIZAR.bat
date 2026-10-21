@echo off
title CoolLab - Subir actualizaciones
cd /d "%~dp0"

:menu
cls
echo ============================================
echo    CoolLab - Subir actualizaciones
echo ============================================
echo.
echo   1. Copia de pruebas  (dev-coollab.auroragenesys.com)
echo   2. App real          (coollab.auroragenesys.com)
echo   3. Las dos (primero pruebas, despues la real)
echo   4. Salir
echo.
set "op="
set /p op="Elige una opcion (1-4): "
if "%op%"=="1" goto dev
if "%op%"=="2" goto prod
if "%op%"=="3" goto ambas
if "%op%"=="4" exit /b
goto menu

:dev
call :subir dev
goto fin

:prod
call :confirmar
if errorlevel 1 goto menu
call :subir prod
goto fin

:ambas
call :subir dev
if errorlevel 1 goto fin
echo.
echo Revisa la copia de pruebas: https://dev-coollab.auroragenesys.com
call :confirmar
if errorlevel 1 goto fin
call :subir prod
goto fin

:confirmar
echo.
set "si="
set /p si="Vas a actualizar la APP REAL. Escribe SI para continuar: "
if /i "%si%"=="SI" exit /b 0
echo Cancelado.
exit /b 1

:subir
echo.
echo ---- Subiendo a: %1 ----
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\subir.ps1" %1
if errorlevel 1 (
  echo.
  echo [ERROR] Algo fallo al subir a %1. Revisa los mensajes de arriba.
  exit /b 1
)
echo [OK] %1 actualizado.
exit /b 0

:fin
echo.
pause
goto menu
