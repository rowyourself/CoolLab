@echo off
REM Inicia CoolLab con PM2 (se reinicia solo si falla). Ejecutar desde la carpeta del proyecto.
cd /d "%~dp0\.."
if not exist .env copy .env.example .env
call npm install --omit=dev
call npm install -g pm2
call pm2 start server.js --name coollab
call pm2 save
echo.
echo CoolLab corriendo en http://localhost:3000
pause
