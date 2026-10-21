const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');

// Secreto JWT: usa JWT_SECRET del .env o genera uno y lo guarda en la base
function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let row = db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get();
  if (!row) {
    const s = crypto.randomBytes(48).toString('hex');
    db.prepare("INSERT INTO settings(key,value) VALUES('jwt_secret',?)").run(s);
    row = { value: s };
  }
  return row.value;
}
const SECRET = secret();

function issue(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '30d' });
  res.cookie('cl_token', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 30 * 86400000,
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies?.cl_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const p = jwt.verify(token, SECRET);
    const u = db.prepare('SELECT id,name,email,role,phone,active FROM users WHERE id=?').get(p.id);
    if (!u || !u.active) return res.status(401).json({ error: 'Usuario inactivo' });
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: 'Sesión expirada' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Sin permisos' });

const hash = (pw) => bcrypt.hashSync(pw, 10);
const check = (pw, h) => bcrypt.compareSync(pw, h);

module.exports = { issue, requireAuth, requireRole, hash, check };
