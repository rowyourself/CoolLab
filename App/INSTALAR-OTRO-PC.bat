@echo off
setlocal
title CoolLab - Instalar en este PC
REM Descarga el proyecto desde GitHub y lo deja listo en este PC (para un PC que aun no tiene nada).
set "REPO=https://github.com/rowyourself/CoolLab.git"
set "DEST=%USERPROFILE%\Documents\CoolLab-GitHub"
echo ============================================
echo    CoolLab - Instalar en este PC
echo ============================================
echo Se instalara en: %DEST%
echo.
where git >nul 2>nul || ( echo Falta Git. Instalalo con las opciones por defecto y vuelve a ejecutar este archivo. & start https://git-scm.com/download/win & pause & exit /b 1 )
where node >nul 2>nul || ( echo Falta Node.js. Instala la version LTS y vuelve a ejecutar este archivo. & start https://nodejs.org & pause & exit /b 1 )

git config --global user.name >nul 2>nul || ( set /p GN="Tu nombre (para el historial): " & call git config --global user.name "%%GN%%" )
git config --global user.email >nul 2>nul || ( set /p GE="Tu correo de GitHub: " & call git config --global user.email "%%GE%%" )

if exist "%DEST%\.git" (
  echo Ya estaba descargado: trayendo la ultima version...
  git -C "%DEST%" pull --rebase --autostash
) else (
  echo Descargando el proyecto. Si te lo pide, inicia sesion en GitHub en el navegador...
  git clone "%REPO%" "%DEST%" || ( echo [ERROR] No se pudo descargar. & pause & exit /b 1 )
)
cd /d "%DEST%\App" || ( echo [ERROR] No se encontro la carpeta App. & pause & exit /b 1 )
if not exist ".env" ( copy ".env.example" ".env" >nul & echo Se creo .env desde .env.example, editalo si necesitas otra clave de admin local. )
echo.
echo Instalando dependencias, tarda 1 a 3 minutos...
call npm install || ( echo [ERROR] Fallo npm install. & pause & exit /b 1 )
echo.
echo [OK] Listo. Tu proyecto esta en:
echo   %DEST%\App
echo  - Probar en este PC:   npm start   y abrir http://localhost:3000
echo  - Guardar cambios:     GIT-SUBIR.bat      Traer cambios: GIT-BAJAR.bat
echo  - Publicar en la web:  ACTUALIZAR.bat
explorer "%DEST%\App"
pause
