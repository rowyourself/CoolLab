@echo off
setlocal
title CoolLab - Subir cambios a GitHub
cd /d "%~dp0"
git rev-parse --is-inside-work-tree >nul 2>nul || ( echo Esta carpeta no esta conectada. Ejecuta primero GIT-CONFIGURAR.bat & pause & exit /b 1 )
echo Cambios:
git status --short
for /f %%n in ('git status --porcelain ^| find /c /v ""') do set "PEND=%%n"
if "%PEND%"=="0" ( echo No hay cambios nuevos para subir. & goto push )
echo.
set "MSG="
set /p MSG="Describe el cambio (Enter = fecha y hora): "
if "%MSG%"=="" set "MSG=Cambios del %date% %time:~0,5%"
git add -A
git commit -m "%MSG%" || ( pause & exit /b 1 )
:push
echo.
echo Trayendo primero los cambios del otro PC...
git pull --rebase --autostash
if errorlevel 1 (
  echo [ATENCION] Hay cambios en conflicto con el otro PC. No se subio nada.
  pause & exit /b 1
)
git push
if errorlevel 1 ( echo [ERROR] No se pudo subir. & pause & exit /b 1 )
echo.
echo [OK] Cambios guardados en GitHub. Para publicarlos en la pagina usa ACTUALIZAR.bat
pause
