// Cambia la contraseña de los administradores de CoolLab.
// Uso en el servidor:  cd /opt/coollab && sudo -u coollab node deploy/reset-admin.js NUEVA-CLAVE [correo]
require('dotenv').config({ quiet: true });
const db = require('../src/db');
const { hash } = require('../src/auth');
const [pw, email] = process.argv.slice(2);
if (!pw || pw.length < 8) { console.error('Indica una clave de al menos 8 caracteres.'); process.exit(1); }
const r = email
  ? db.prepare('UPDATE users SET password_hash=?, active=1 WHERE email=?').run(hash(pw), email.toLowerCase())
  : db.prepare("UPDATE users SET password_hash=?, active=1 WHERE role='admin'").run(hash(pw));
console.log(r.changes ? `Listo: clave actualizada (${r.changes} usuario/s).` : 'No se encontró el usuario.');
