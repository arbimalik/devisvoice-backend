const router = require('express').Router();
const pool = require('../db');
const rateLimit = require('express-rate-limit');

const claudeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 20,
  keyGenerator: (req) => req.user.userId,
  message: { error: 'Trop de requêtes — réessayez dans une heure.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false
});

const QUOTAS = {
  devis: { gratuit: 5,  starter: 10, pro: null },
  vox:   { gratuit: 10, starter: 20, pro: 30   }
};
const MAX_TOKENS = { devis: 4096, vox: 1024 };

async function checkAndIncrementQuota(email, plan, type) {
  const row = await pool.query(
    'SELECT claude_calls_devis_month, claude_calls_vox_month, claude_tokens_month, claude_calls_reset_at FROM users WHERE email=$1',
    [email]
  );
  if (!row.rows.length) throw new Error('Utilisateur introuvable');
  const u = row.rows[0];

  // Reset si nouveau mois
  const resetAt = new Date(u.claude_calls_reset_at);
  const now = new Date();
  const newMonth = resetAt.getFullYear() !== now.getFullYear() || resetAt.getMonth() !== now.getMonth();
  if (newMonth) {
    await pool.query(
      'UPDATE users SET claude_calls_devis_month=0, claude_calls_vox_month=0, claude_tokens_month=0, claude_calls_reset_at=NOW() WHERE email=$1',
      [email]
    );
    u.claude_calls_devis_month = 0;
    u.claude_calls_vox_month = 0;
  }

  const planKey = (plan || 'gratuit').toLowerCase();
  const limit = QUOTAS[type][planKey];
  const current = type === 'devis' ? u.claude_calls_devis_month : u.claude_calls_vox_month;

  if (limit !== null && current >= limit) {
    const label = type === 'vox' ? 'messages Vox' : 'appels IA';
    return { exceeded: true, message: `Limite de ${limit} ${label}/mois atteinte sur votre plan.` };
  }

  return { exceeded: false };
}

async function incrementCounters(email, type, tokensUsed) {
  const col = type === 'devis' ? 'claude_calls_devis_month' : 'claude_calls_vox_month';
  await pool.query(
    `UPDATE users SET ${col}=${col}+1, claude_tokens_month=claude_tokens_month+$1 WHERE email=$2`,
    [tokensUsed, email]
  );
}

router.post('/claude', claudeRateLimit, async (req, res) => {
  try {
    const email = req.user.email;
    const userRow = await pool.query('SELECT plan FROM users WHERE email=$1', [email]);
    const plan = (userRow.rows[0]?.plan || 'gratuit').toLowerCase();
    const type = req.body.type === 'vox' ? 'vox' : 'devis';

    const quota = await checkAndIncrementQuota(email, plan, type);
    if (quota.exceeded) return res.status(403).json({ error: quota.message, code: 'QUOTA_EXCEEDED' });

    // Forcer modèle et max_tokens
    const payload = req.body.payload;
    payload.model = 'claude-sonnet-4-6';
    payload.max_tokens = Math.min(payload.max_tokens || MAX_TOKENS[type], MAX_TOKENS[type]);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    // Incrémenter compteurs après succès
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    await incrementCounters(email, type, tokensUsed);

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/preferences', async (req, res) => {
  const email = req.user.email;
  try {
    const r = await pool.query('SELECT style_data FROM artisan_prefs WHERE artisan_email=$1', [email]);
    res.json(r.rows.length ? r.rows[0].style_data : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/preferences/update', async (req, res) => {
  const { observations, descriptions, acomptePct, metiers, conditions } = req.body;
  const artisanEmail = req.user.email;
  try {
    const existing = await pool.query('SELECT style_data FROM artisan_prefs WHERE artisan_email=$1', [artisanEmail]);
    const prev = existing.rows.length ? existing.rows[0].style_data : {};

    const obsActuelles = prev.observations_recentes || [];
    const nouvObs = observations ? [observations, ...obsActuelles].filter(Boolean).filter((v,i,a) => a.indexOf(v) === i).slice(0, 5) : obsActuelles;

    const formActuelles = prev.formulations_types || [];
    const nouvForm = descriptions ? [...new Set([...descriptions, ...formActuelles])].slice(0, 10) : formActuelles;

    const metiersActuels = prev.metiers_frequents || {};
    if (metiers && Array.isArray(metiers)) {
      metiers.forEach(m => { metiersActuels[m] = (metiersActuels[m] || 0) + 1; });
    }

    const styleData = {
      observations_recentes: nouvObs,
      formulations_types:    nouvForm,
      acompte_habituel:      acomptePct || prev.acompte_habituel || 0,
      conditions_habituelles: conditions || prev.conditions_habituelles || '',
      metiers_frequents:     metiersActuels,
      updated_at:            new Date().toISOString()
    };

    await pool.query(
      `INSERT INTO artisan_prefs (artisan_email, style_data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (artisan_email) DO UPDATE SET style_data=$2, updated_at=NOW()`,
      [artisanEmail, JSON.stringify(styleData)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/preferences/reset', async (req, res) => {
  const email = req.user.email;
  try {
    await pool.query('DELETE FROM artisan_prefs WHERE artisan_email=$1', [email]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
