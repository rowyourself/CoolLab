#!/usr/bin/env bash
# Instala dependencias y deja CoolLab corriendo con PM2. Ejecutar como root desde /opt/coollab.
set -euo pipefail
APP_DIR=/opt/coollab
APP_USER=coollab
cd "$APP_DIR"

[ -f .env ] || { echo "Falta $APP_DIR/.env (copia .env.example y edítalo)"; exit 1; }
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 .env

sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund
sudo -u "$APP_USER" mkdir -p data uploads

# PM2 corre como el usuario coollab y arranca solo al reiniciar el servidor
sudo -u "$APP_USER" pm2 start deploy/ecosystem.config.js
sudo -u "$APP_USER" pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

# Respaldo diario a las 03:30
cat > /etc/cron.d/coollab-backup <<CRON
30 3 * * * $APP_USER bash $APP_DIR/deploy/backup.sh >> /var/backups/coollab/backup.log 2>&1
CRON

sleep 2
curl -fsS http://127.0.0.1:3100/ >/dev/null && echo "OK: CoolLab responde en el puerto 3100"
