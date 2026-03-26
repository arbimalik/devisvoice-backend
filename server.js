const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
 
const app = express();
app.use(cors());
app.use(express.json({limit: '10mb'}));
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
 
pool.query(`
  CREATE TABLE IF NOT EXISTS devis (
    id VARCHAR(50) PRIMARY KEY,
    data JSONB NOT NULL,
    artisan_email VARCHAR(255),
    client_email VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
  )
`).then(() => console.log('Table devis OK'))
  .catch(err => console.error('Erreur creation table:', err));
 
app.post('/api/claude', async (req, res) => {
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
 
app.post('/api/resend', async (req, res) => {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + req.body.apiKey, 'Content-Type': 'application/json'},
      body: JSON.stringify(req.body.payload)
    });
    const data = await response.json();
    res.status(response.ok ? 200 : 400).json(data);
  } catch (err) { res.status(500).json({error: err.message}); }
});
 
app.post('/api/devis/save', async (req, res) => {
  const { id, data, artisanEmail, clientEmail } = req.body;
  try {
        await pool.query(
      'INSERT INTO devis (id, data, artisan_email, client_email) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data=$2',
      [id, JSON.stringify(data), artisanEmail, clientEmail]
    );
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({error: err.message}); }
});
 
app.get('/api/devis/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM devis WHERE id=$1', [req.params.id]);
    if(result.rows.length === 0) return res.status(404).json({error: 'Devis introuvable'});
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({error: err.message}); }
});
 
app.post('/api/accept-devis', async (req, res) => {
  const { resendKey, artisanEmail, artisanNom, clientNom, numeroDevis, montantTTC } = req.body;
  try {
    const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;color:#222"><div style="background:#FF4500;padding:18px 22px;border-radius:8px 8px 0 0"><h1 style="color:#fff;font-size:20px;margin:0">Devis accepte !</h1></div><div style="background:#fff;padding:22px;border:1px solid #eee;border-top:none"><p style="font-size:15px;margin-bottom:16px">Bonjour <strong>${artisanNom}</strong>,</p><p style="font-size:14px;margin-bottom:16px"><strong>${clientNom}</strong> vient d'accepter votre devis.</p><div style="background:#fff8f5;border:1px solid #ffd0b0;border-radius:8px;padding:14px;margin-bottom:16px"><p style="margin:0;font-size:13px;color:#666">Reference</p><p style="margin:4px 0 8px;font-size:18px;font-weight:700;color:#FF4500">${numeroDevis}</p><p style="margin:0;font-size:13px;color:#666">Montant TTC</p><p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#222">${montantTTC}</p></div><p style="font-size:12px;color:#999">Genere avec DevisVoice</p></div></div>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({from:'onboarding@resend.dev', to:[artisanEmail], subject:'Devis '+numeroDevis+' accepte par '+clientNom, html})
    });
    const data = await response.json();
    res.status(response.ok ? 200 : 400).json(data);
  } catch (err) { res.status(500).json({error: err.message}); }
});
 
const PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log('OK port ' + PORT); });
