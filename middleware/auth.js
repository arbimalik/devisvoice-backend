const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'devisvoice_secret_2026';

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token invalide' });
  let decoded;
  try {
    decoded = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
  try {
    const u = await pool.query('SELECT email FROM users WHERE id=$1', [decoded.userId]);
    if (u.rows.length === 0) return res.status(401).json({ error: 'Token invalide' });
    req.user = { userId: decoded.userId, email: u.rows[0].email };
    next();
  } catch (err) {
    next(err);
  }
}

const PUBLIC_ROUTES = new Set([
  'POST /api/users/register',
  'POST /api/users/login',
  'POST /api/users/verify-token',
  'POST /api/stripe/webhook',
  'POST /api/users/forgot-password',
  'POST /api/users/reset-password',
]);

module.exports = { requireAuth, PUBLIC_ROUTES };
