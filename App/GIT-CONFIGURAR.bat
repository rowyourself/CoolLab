@echo off
setlocal
title CoolLab - Conectar con GitHub
cd /d "%~dp0"
set "REPO=https://github.com/rowyourself/CoolLab.git"
echo ============================================
echo    CoolLab - Conectar con GitHub (una vez)
echo ============================================
echo.
where git >nul 2>nul || (
  echo No tienes Git instalado. Se abrira la pagina de descarga:
  echo instala con las opciones por defecto y vuelve a ejecutar este archivo.
  start https://git-scm.com/download/win
  pause & exit /b 1
)
git rev-parse --is-inside-work-tree >nul 2>nul && (
  echo Esta carpeta ya esta conectada a GitHub:
  git remote -v
  echo.
  echo Usa GIT-SUBIR.bat para guardar cambios y GIT-BAJAR.bat para traerlos.
  pause & exit /b 0
)

REM Nombre y correo para el historial (solo si faltan)
git config --global user.name >nul 2>nul || (
  set /p GN="Tu nombre (para el historial): "
  call git config --global user.name "%%GN%%"
)
git config --global user.email >nul 2>nul || (
  set /p GE="Tu correo de GitHub: "
  call git config --global user.email "%%GE%%"
)

REM Se descarga el repositorio al lado de esta carpeta, en "CoolLab-GitHub"
set "DEST=%~dp0..\CoolLab-GitHub"
if exist "%DEST%\.git" ( echo Ya existe "%DEST%". Trabaja desde esa carpeta. & pause & exit /b 0 )
echo Descargando %REPO% en:
echo   %DEST%
echo (si te lo pide, inicia sesion en GitHub en el navegador)
git clone "%REPO%" "%DEST%" || ( echo [ERROR] No se pudo descargar. & pause & exit /b 1 )
if not exist "%DEST%\App\server.js" ( echo [ERROR] El repositorio no tiene la carpeta App. & pause & exit /b 1 )

echo.
echo Copiando tu configuracion y datos locales (no van a GitHub)...
if exist ".env" copy /y ".env" "%DEST%\App\.env" >nul
if exist "data" robocopy "data" "%DEST%\App\data" /E /NFL /NDL /NJH /NJS >nul
if exist "uploads" robocopy "uploads" "%DEST%\App\uploads" /E /NFL /NDL /NJH /NJS >nul
if exist "docs" robocopy "docs" "%DEST%\App\docs" /E /NFL /NDL /NJH /NJS >nul
if exist "node_modules" ( robocopy "node_modules" "%DEST%\App\node_modules" /E /NFL /NDL /NJH /NJS >nul ) else ( pushd "%DEST%\App" & call npm install & popd )

echo.
echo [OK] Listo. Desde ahora trabaja en:
echo   %DEST%\App
echo Esta carpeta antigua queda como respaldo (puedes borrarla cuando confirmes que todo funciona).
explorer "%DEST%\App"
pause
