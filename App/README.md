# CoolLab — App de visitas técnicas de refrigeración

App web para los técnicos en terreno (se usa desde el celular y se puede instalar como app) y dashboards para la empresa.

## Qué hace

**Técnico (celular)**
- Inicia la visita: tipo (reparación, mantención preventiva, visita rutinaria, implementación), empresa, equipo, folio (automático o manual), prioridad y motivo.
- Al iniciar se guardan la hora, la ubicación GPS y el **clima exterior** (Open-Meteo, sin API key).
- Durante la visita: cronómetro, **mediciones** (temperatura, humedad, presiones, temperaturas de línea, aire del evaporador, corriente, voltaje) marcadas como *inicial* o *final*, **fotos** con cámara (antes / durante / después, comprimidas solas), checklist según el tipo de visita, diagnóstico, trabajo realizado, repuestos y refrigerante recargado.
- **KPIs en vivo** con alertas: recalentamiento, subenfriamiento, ΔT del evaporador, approach de condensación (usa el clima de la API), temperatura de descarga, desviación vs setpoint, % de mediciones en rango, recuperación de temperatura, punto de rocío, tasa de fuga y t CO₂e emitidas.
- Termina la visita: resultado, nombre y **firma del cliente en pantalla**, satisfacción de 1 a 5 → **se genera el informe PDF**.

**Informe PDF** (cambia según el tipo de visita): datos de la visita y del equipo, resultado, clima al inicio y al final, tabla de KPIs con semáforo, alertas, mediciones inicial/final, detalle técnico, repuestos, checklist, fotos, firmas y un **QR** que abre el informe en línea (sirve para mandárselo al cliente).

**Dashboards**
- Empresa: visitas, duración promedio, MTTR, resolución en la primera visita (FTFR), % preventivo, satisfacción, MTBF por equipo, refrigerante recargado y CO₂e, visitas por mes y tipo, duración por tipo, ranking de técnicos, clientes y mantenciones próximas o vencidas. Filtros por fecha, tipo, empresa y técnico.
- Por técnico: los mismos indicadores solo para él (cada técnico ve "Mis KPI").
- Exportar todas las visitas a Excel (CSV).

## Registro de asistencia (iniciar / terminar)
Al presionar **Iniciar visita** y **Terminar visita** la app toma la ubicación GPS del celular en ese momento. El servidor guarda la hora (el técnico no puede cambiarla), la dirección aproximada y la distancia hasta la ubicación registrada de la empresa. Si el inicio y el término quedan dentro de 300 m (ajustable con `GEOFENCE_M`), el informe muestra **"Presencia verificada"**, con enlaces al mapa. Si no hay GPS, el técnico puede seguir igual, pero el informe indica "Registro sin GPS". La primera visita con GPS a una empresa fija su ubicación de referencia (el administrador también puede escribirla en Clientes).

## Mediciones
El técnico lee sus instrumentos (termómetro, higrómetro, manómetros, pinza amperimétrica, anemómetro) y escribe los valores en la **planilla de mediciones** de la visita: elige "Al llegar (inicial)" o "Al terminar (final)", completa lo que midió y guarda todo junto. También puede agregar una medición en un punto específico (ej. puerta de la cámara). Los KPI se calculan solos.

## Permisos
| Acción | Técnico (usuario) | Supervisor | Administrador |
|---|---|---|---|
| Iniciar / terminar sus visitas, mediciones, fotos | ✓ | ✓ | ✓ |
| Editar una visita después de terminada | — | ✓ | ✓ |
| Ver visitas de otros técnicos | — | ✓ | ✓ |
| Dashboard | Solo el suyo | Empresa completa | Empresa completa |
| Registrar visitas a nombre de otro / con otra hora (queda marcado "registro manual") | — | ✓ | ✓ |
| Crear empresas y equipos | ✓ | ✓ | ✓ |
| Editar empresas y equipos, exportar CSV, reabrir/anular visitas | — | ✓ | ✓ |
| Crear usuarios y asignar roles | — | — | ✓ |

Todos los permisos se validan en el servidor, no solo en la pantalla.

## Instalación en Windows

1. Instala **Node.js LTS** (versión 20 o superior) desde https://nodejs.org
2. Copia la carpeta `coollab` a tu computador, por ejemplo `C:\CoolLab`.
3. Abre una terminal (PowerShell) en esa carpeta y ejecuta:
   ```
   npm install
   copy .env.example .env
   ```
4. Edita `.env` (nombre de tu empresa, correo y contraseña del administrador, tu dominio).
5. Arranca:
   ```
   npm start
   ```
   Abre http://localhost:3000 y entra con el administrador del `.env`.

> ¿Quieres ver la app llena de datos para probar? Antes del primer uso ejecuta `npm run demo` (crea clientes ficticios, 4 técnicos y 6 meses de visitas). Para partir en limpio después, borra la carpeta `data` y `uploads`.

### Dejarla corriendo siempre
Ejecuta `deploy\iniciar-windows.bat`. Usa PM2, que reinicia la app si se cae. Para que arranque al prender el PC, crea una tarea en el *Programador de tareas* de Windows "Al iniciar sesión" con la acción `pm2 resurrect`.

## Publicarla en tu dominio con Cloudflare Tunnel

No necesitas abrir puertos en el router ni tener IP fija. Cloudflare entrega el HTTPS (necesario para que funcionen el GPS y la cámara en el celular).

1. Instala cloudflared:
   ```
   winget install --id Cloudflare.cloudflared
   ```
2. Inicia sesión y autoriza tu dominio (se abre el navegador):
   ```
   cloudflared tunnel login
   ```
3. Crea el túnel y el subdominio:
   ```
   cloudflared tunnel create coollab
   cloudflared tunnel route dns coollab visitas.tudominio.cl
   ```
4. Copia `deploy\cloudflared-config.yml` a `C:\Users\<tu-usuario>\.cloudflared\config.yml` y reemplaza el ID del túnel (lo mostró el paso 3), tu usuario y tu dominio.
5. Pruébalo: `cloudflared tunnel run coollab` → abre https://visitas.tudominio.cl
6. Instálalo como servicio de Windows para que arranque solo (PowerShell como administrador):
   ```
   cloudflared service install
   ```
   Si el servicio no encuentra la configuración, copia `config.yml` y el archivo `.json` del túnel a `C:\Windows\System32\config\systemprofile\.cloudflared\`.

Recomendado en Cloudflare: activa **Zero Trust → Access** si quieres una capa extra de login para el panel, y deja `COOKIE_SECURE=1` en el `.env`.

## En el celular de los técnicos
Abre https://visitas.tudominio.cl en Chrome (Android) o Safari (iPhone) → menú → **Agregar a pantalla de inicio**. Queda como app, con acceso a cámara y GPS.

## Respaldos
Toda la información está en dos carpetas: `data` (base de datos SQLite) y `uploads` (fotos). Respáldalas a diario (OneDrive, Google Drive o un disco externo). Si el computador se apaga, la app deja de estar disponible: si necesitas que esté 24/7, se puede mover igual a un VPS.

## Estructura
```
server.js           servidor Express
src/db.js           base de datos (usuarios, clientes, equipos, visitas, mediciones, fotos)
src/api.js          API REST
src/kpis.js         cálculo de KPIs por visita y agregados
src/weather.js      clima (Open-Meteo / OpenWeatherMap)
src/pdf.js          informe PDF
src/catalog.js      tipos de visita, mediciones, refrigerantes (GWP), checklists — edítalo para personalizar
src/seed.js         datos demo
public/             interfaz (app del técnico y dashboards)
```
