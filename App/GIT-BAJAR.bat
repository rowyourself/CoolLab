@echo off
setlocal
title CoolLab - Bajar cambios de GitHub
cd /d "%~dp0"
git rev-parse --is-inside-work-tree >nul 2>nul || ( echo Esta carpeta no esta conectada. Ejecuta primero GIT-CONFIGURAR.bat & pause & exit /b 1 )
for /f %%n in ('git status --porcelain ^| find /c /v ""') do set "PEND=%%n"
if not "%PEND%"=="0" (
  echo Tienes cambios sin subir en este PC:
  git status --short
  echo Ejecuta primero GIT-SUBIR.bat para no perderlos.
  pause & exit /b 1
)
for /f %%h in ('git rev-parse HEAD') do set "ANTES=%%h"
git pull --rebase --autostash
if errorlevel 1 ( echo [ERROR] No se pudieron bajar los cambios. & pause & exit /b 1 )
git diff --quiet %ANTES% HEAD -- package.json package-lock.json || ( echo Cambiaron las dependencias: npm install... & call npm install )
echo.
echo [OK] Tu carpeta esta al dia con GitHub.
git log --oneline -5
pause
