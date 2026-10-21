require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const db = require('./src/db');
const { hash } = require('./src/auth');

const app = express();
app.set('trust proxy', true); // detrás de Cloudflare Tunnel
app.use(express.json({ limit: '5mb' })); // la firma viaja como imagen base64
app.use(cookieParser());

// Cabeceras de seguridad básicas
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // OpenStreetMap exige el origen para entregar el mapa
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use('/api', require('./src/api'));
app.get('/r/:token', (req, res) => res.redirect(`/api/public/report/${req.params.token}`));
// Librerías servidas localmente (la app no depende de CDNs externos)
const nm = (p) => path.join(__dirname, 'node_modules', p);
app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(nm('chart.js/dist/chart.umd.js')));
app.use('/vendor/plex-sans', express.static(nm('@fontsource/ibm-plex-sans')));
app.use('/vendor/plex-mono', express.static(nm('@fontsource/ibm-plex-mono')));
app.use('/vendor/leaflet', express.static(nm('leaflet/dist')));
// index.html con versión en app.js y styles.css: así cada publicación se ve al tiro,
// aunque Cloudflare o el navegador guarden copias de esos archivos por horas.
const PUB = path.join(__dirname, 'public');
const VERSION = require('crypto').createHash('sha1')
  .update(fs.readFileSync(path.join(PUB, 'app.js'))).update(fs.readFileSync(path.join(PUB, 'styles.css'))).digest('hex').slice(0, 10);
const INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  .replace('src="/app.js"', `src="/app.js?v=${VERSION}"`).replace('href="/styles.css"', `href="/styles.css?v=${VERSION}"`);
const sendIndex = (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(INDEX); };
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(PUB, { extensions: ['html'], index: false }));
app.get('/{*splat}', sendIndex);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno: ' + err.message });
});

// Crea el administrador inicial si la base está vacía
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
  const email = (process.env.ADMIN_EMAIL || 'admin@empresa.cl').toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || 'cambiar-esta-clave';
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run('Administrador', email, hash(pw));
  console.log(`Administrador inicial creado: ${email} / ${pw}  (cámbiala al entrar)`);
}

const PORT = +process.env.PORT || 3000;
// HOST=127.0.0.1 en producción: solo accesible por el túnel de Cloudflare
app.listen(PORT, process.env.HOST, () => console.log(`CoolLab escuchando en http://${process.env.HOST || 'localhost'}:${PORT}`));
