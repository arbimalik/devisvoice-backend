const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// Route Claude API
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

// Route Resend — envoi email
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

// Route accept-devis — notification artisan quand client accepte
app.post('/api/accept-devis', async (req, res) => {
  const { resendKey, artisanEmail, artisanNom, clientNom, numeroDevis, montantTTC } = req.body;
  try {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;color:#222">
        <div style="background:#FF4500;padding:18px 22px;border-radius:8px 8px 0 0">
          <h1 style="color:#fff;font-size:20px;margin:0">🎉 Devis accepté !</h1>
        </div>
        <div style="background:#fff;padding:22px;border:1px solid #eee;border-top:none">
          <p style="font-size:15px;margin-bottom:16px">Bonjour <strong>${artisanNom}</strong>,</p>
          <p style="font-size:14px;margin-bottom:16px">
            Bonne nouvelle — <strong>${clientNom}</strong> vient d'accepter votre devis.
          </p>
          <div style="background:#fff8f5;border:1px solid #ffd0b0;border-radius:8px;padding:14px;margin-bottom:16px">
            <p style="margin:0;font-size:13px;color:#666">Référence devis</p>
            <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#FF4500">${numeroDevis}</p>
            <p style="margin:8px 0 0;font-size:13px;color:#666">Montant TTC</p>
            <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#222">${montantTTC}</p>
          </div>
          <p style="font-size:12px;color:#999;margin-top:16px">Généré avec DevisVoice</p>
        </div>
      </div>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: [artisanEmail],
        subject: '🎉 Devis ' + numeroDevis + ' accepté par ' + clientNom,
        html
      })
    });
    const data = await response.json();
    res.status(response.ok ? 200 : 400).json(data);
  } catch (err) { res.status(500).json({error: err.message}); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log('OK port ' + PORT); });
