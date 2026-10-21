#!/usr/bin/env bash
# Prepara un servidor Vultr (Ubuntu 22.04/24.04) para correr CoolLab.
# Uso (como root):  bash vultr-setup.sh
# Es seguro ejecutarlo más de una vez. No toca otros sitios que ya tengas en el servidor.
set -euo pipefail

APP_DIR=/opt/coollab
APP_USER=coollab

echo "==> Paquetes base"
apt-get update -y
apt-get install -y curl ca-certificates build-essential sqlite3 tar

echo "==> Node.js (solo se instala si NO existe; no se actualiza para no afectar el juego)"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
elif [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  echo "AVISO: el servidor tiene Node $(node -v) (CoolLab necesita 20+). No lo actualizo para no romper el juego."
  echo "Instala nvm para el usuario coollab o avísame antes de seguir."; exit 1
fi
node -v

echo "==> PM2"
command -v pm2 >/dev/null || npm install -g pm2

echo "==> Usuario y carpeta de la app"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" /var/backups/coollab
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/backups/coollab

echo "==> Cloudflared (túnel hacia Cloudflare)"
if ! command -v cloudflared >/dev/null; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y && apt-get install -y cloudflared
fi

# Firewall: NO se modifica (el juego Crónicas de Aurora usa este mismo servidor).
# CoolLab escucha solo en 127.0.0.1:3100 y Cloudflare entra por el túnel.

cat <<MSG

Listo. Siguientes pasos (ver GUIA-VULTR-CLOUDFLARE.md):
  1. Subir el código a $APP_DIR
  2. Crear $APP_DIR/.env
  3. Ejecutar deploy/instalar-app.sh
  4. Conectar el túnel:  cloudflared service install <TOKEN del túnel coollab>
MSG
