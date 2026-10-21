#!/usr/bin/env bash
# Instala/actualiza CoolLab en el servidor después de subir el código.
#   bash deploy/actualizar.sh prod   -> /opt/coollab      (puerto 3100, coollab.auroragenesys.com)
#   bash deploy/actualizar.sh dev    -> /opt/coollab-dev  (puerto 3200, dev-coollab.auroragenesys.com, con datos demo)
set -euo pipefail
MODE=${1:-prod}
if [ "$MODE" = dev ]; then DIR=/opt/coollab-dev; NAME=coollab-dev; PORT=3200; else DIR=/opt/coollab; NAME=coollab; PORT=3100; fi
cd "$DIR"
if [ ! -f .env ]; then
  cp deploy/env.produccion.example .env
  sed -i "s/^PORT=.*/PORT=$PORT/" .env
  if [ "$MODE" = dev ]; then
    sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://dev-coollab.auroragenesys.com#; s/^COMPANY_NAME=.*/COMPANY_NAME=CoolLab (pruebas)/" .env
  fi
  # Clave inicial del administrador: aleatoria (nunca escrita en el código, que es público)
  PW=$(head -c 512 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 16)
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$PW/" .env
  echo "==> Clave inicial del administrador ($MODE): $PW   (anotala; tambien queda en $DIR/.env)"
fi
chmod 600 .env
chown -R coollab:coollab "$DIR"
echo "==> Instalando dependencias (1-3 min)"
sudo -u coollab npm install --omit=dev --no-audit --no-fund --loglevel=error
sudo -u coollab mkdir -p data uploads
FIRST=0; [ -f data/coollab.db ] || FIRST=1
if sudo -u coollab pm2 describe "$NAME" >/dev/null 2>&1; then
  sudo -u coollab pm2 restart "$NAME" --update-env >/dev/null
elif [ "$MODE" = prod ] && [ -f deploy/ecosystem.config.js ]; then
  sudo -u coollab pm2 start deploy/ecosystem.config.js >/dev/null
else
  sudo -u coollab pm2 start server.js --name "$NAME" --cwd "$DIR" >/dev/null
fi
sleep 3
# En la copia de pruebas se cargan datos demo la primera vez (técnicos, supervisores, empresas, solicitudes)
if [ "$MODE" = dev ] && [ "$FIRST" = 1 ]; then sudo -u coollab npm run demo --silent; sudo -u coollab pm2 restart "$NAME" >/dev/null; sleep 2; fi
sudo -u coollab pm2 save >/dev/null
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null && echo "OK: $NAME actualizado y respondiendo en el puerto $PORT"
