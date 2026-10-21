# Publicar CoolLab en https://coollab.auroragenesys.com

**Ya configurado en Cloudflare:**
- Túnel **coollab** (ID `75add1f9-07a2-405b-9cfa-e6fc40c59a6c`).
- Ruta `coollab.auroragenesys.com` → `http://localhost:3100`, con el registro DNS creado y proxied.

**Sin tocar:** `auroragenesys.com` y `www`, que siguen apuntando al juego en 64.176.22.141, y el túnel "aurora".

CoolLab corre en el **mismo Vultr** que el juego, pero:
- usa el puerto **3100**, porque el juego usa el 3000;
- escucha solo dentro del servidor (`HOST=127.0.0.1`);
- corre con su propio usuario (`coollab`) y en su propia carpeta (`/opt/coollab`);
- no se cambia el firewall ni se actualiza Node.

## 1. Preparar el servidor
Desde PowerShell en tu PC:
```
cd "C:\Users\RowBY\Downloads\PROYECTO FRANCISCO UNIVERSIDAD\CoolLab"
scp deploy\vultr-setup.sh root@64.176.22.141:/root/
ssh root@64.176.22.141 "bash /root/vultr-setup.sh"
```
Si aparece *"AVISO: el servidor tiene Node vXX"*, detente y avísame: el juego usa una versión antigua de Node y hay que instalar otra en paralelo.

## 2. Subir el código (sin node_modules, .env ni datos)
```
tar --exclude=node_modules --exclude=.env --exclude=data --exclude=uploads -czf $env:TEMP\coollab.tgz .
scp $env:TEMP\coollab.tgz root@64.176.22.141:/tmp/
ssh root@64.176.22.141 "tar -xzf /tmp/coollab.tgz -C /opt/coollab && cp /opt/coollab/deploy/env.produccion.example /opt/coollab/.env"
ssh root@64.176.22.141 "nano /opt/coollab/.env"
```
En `.env`, cambia al menos `ADMIN_PASSWORD` y `COMPANY_NAME`.

## 3. Instalar y arrancar
```
ssh root@64.176.22.141 "bash /opt/coollab/deploy/instalar-app.sh"
```
Debe terminar con `OK: CoolLab responde en el puerto 3100`.

## 4. Conectar el túnel
1. Cloudflare → **Tunnels** → **coollab** → *Overview* → *Add a replica* → **Debian** → copia el comando **"Install as service"** (`sudo cloudflared service install eyJ...`).
2. Pégalo en el servidor (`ssh root@64.176.22.141`).

> El token es una credencial: no lo compartas ni lo subas a GitHub.

En menos de un minuto el túnel aparece **Healthy**. Abre https://coollab.auroragenesys.com

## 5. Comprobar
- Entra con el administrador del `.env` y cambia la clave.
- Desde el celular, prueba el GPS, la cámara y un informe PDF (el QR debe abrir coollab.auroragenesys.com).
- https://auroragenesys.com (el juego) debe seguir funcionando igual.

## Operación
| Qué | Comando (en el servidor) |
|---|---|
| Estado / logs | `sudo -u coollab pm2 status` · `sudo -u coollab pm2 logs coollab` |
| Reiniciar | `sudo -u coollab pm2 restart coollab` |
| Actualizar código | repetir el paso 2 (sin el `cp` del .env) y luego `cd /opt/coollab && sudo -u coollab npm ci --omit=dev && sudo -u coollab pm2 restart coollab` |
| Respaldos | automáticos a las 03:30 en `/var/backups/coollab` (14 días) |
