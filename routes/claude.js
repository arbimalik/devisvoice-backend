const router = require('express').Router();
const pool = require('../db');

router.post('/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body.payload)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) { res.status(500).json({error: err.message}); }
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
