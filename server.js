const express = require(‘express’);
const cors = require(‘cors’);
const fetch = require(‘node-fetch’);

const app = express();
app.use(cors());
app.use(express.json());

// Route génération devis via Claude
app.post(’/api/generer’, async (req, res) => {
const { texte, metier, nature } = req.body;

const prompt = `Tu es un assistant spécialisé dans les devis du bâtiment en France. Un artisan t’a dicté ses postes avec SES propres tarifs. Tu dois ABSOLUMENT respecter les prix qu’il a mentionnés.

Texte dicté : “${texte}”
Corps de métier : ${metier}
Nature du chantier : ${nature}

Génère UNIQUEMENT un JSON valide (sans markdown, sans backticks) :
{
“lignes”: [
{
“designation”: “désignation professionnelle bâtiment”,
“type”: “MO” ou “MAT” ou “FO”,
“unite”: “m²” ou “ml” ou “u” ou “forfait” ou “h”,
“quantite”: nombre ou null si forfait,
“prixUnitaire”: prix extrait de la dictée,
“total”: calcul
}
],
“totalHT”: nombre,
“tauxTVA”: 10,
“montantTVA”: nombre,
“totalTTC”: nombre,
“acompte”: 30,
“conditions”: “Acompte de 30% à la signature du devis. Solde à réception des travaux après levée des réserves.”,
“validite”: “30 jours”
}`;

try {
const response = await fetch(‘https://api.anthropic.com/v1/messages’, {
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘x-api-key’: process.env.ANTHROPIC_API_KEY,
‘anthropic-version’: ‘2023-06-01’
},
body: JSON.stringify({
model: ‘claude-sonnet-4-20250514’,
max_tokens: 1000,
messages: [{ role: ‘user’, content: prompt }]
})
});

```
const data = await response.json();
const brut = data.content.map(b => b.text || '').join('');
const devis = JSON.parse(brut.replace(/```json|```/g, '').trim());
res.json({ success: true, devis });
```

} catch (err) {
console.error(err);
res.status(500).json({ success: false, error: ‘Erreur génération devis’ });
}
});

// Route envoi mail via Resend
app.post(’/api/envoyer’, async (req, res) => {
const { resendKey, expediteur, clientEmail, clientNom, artisanNom, devis, refDevis, joursRelance } = req.body;

const dateRelance = new Date();
dateRelance.setDate(dateRelance.getDate() + parseInt(joursRelance));

const lignesHtml = devis.lignes.map(l => `<tr> <td style="padding:8px 12px;border-bottom:1px solid #f0ece4;">${l.designation}</td> <td style="padding:8px 12px;border-bottom:1px solid #f0ece4;text-align:right;">${l.quantite ?`${l.quantite} ${l.unite}` : 'Forfait'}</td> <td style="padding:8px 12px;border-bottom:1px solid #f0ece4;text-align:right;font-weight:bold;">${Number(l.total).toLocaleString('fr-FR', {minimumFractionDigits:2})} €</td> </tr>`).join(’’);

const htmlEmail = ` <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1c1a17;"> <div style="background:#1c1a17;padding:24px 32px;border-radius:8px 8px 0 0;"> <h1 style="color:white;font-size:22px;margin:0;">🏗️ DevisVoice</h1> <p style="color:#7a7060;font-size:13px;margin:4px 0 0;">Devis professionnel du bâtiment</p> </div> <div style="background:white;padding:32px;border:1px solid #e0d8cc;"> <p>Bonjour <strong>${clientNom}</strong>,</p> <p style="color:#7a7060;">Veuillez trouver votre devis <strong>${refDevis}</strong> établi par <strong>${artisanNom}</strong>.</p> <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;"> <thead> <tr style="background:#f2ede4;"> <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#7a7060;">Désignation</th> <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#7a7060;">Qté</th> <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#7a7060;">Total HT</th> </tr> </thead> <tbody>${lignesHtml}</tbody> </table> <div style="background:#1c1a17;color:white;padding:16px 20px;border-radius:6px;display:flex;justify-content:space-between;"> <span style="font-size:12px;opacity:0.7;text-transform:uppercase;">Total TTC</span> <strong style="font-size:20px;">${Number(devis.totalTTC).toLocaleString('fr-FR', {minimumFractionDigits:2})} €</strong> </div> <p style="font-size:12px;color:#7a7060;margin-top:20px;font-style:italic;">${devis.conditions}</p> <p style="font-size:12px;color:#7a7060;">Relance prévue le ${dateRelance.toLocaleDateString('fr-FR')} sans réponse de votre part.</p> </div> <div style="background:#f2ede4;padding:16px 32px;border-radius:0 0 8px 8px;text-align:center;"> <p style="font-size:11px;color:#7a7060;">Envoyé via DevisVoice — L'agent devis du bâtiment</p> </div> </div>`;

try {
const response = await fetch(‘https://api.resend.com/emails’, {
method: ‘POST’,
headers: {
‘Authorization’: `Bearer ${resendKey}`,
‘Content-Type’: ‘application/json’
},
body: JSON.stringify({
from: expediteur,
to: [clientEmail],
subject: `Devis ${refDevis} — ${artisanNom}`,
html: htmlEmail
})
});

```
const data = await response.json();
if (response.ok) {
  res.json({ success: true, dateRelance: dateRelance.toLocaleDateString('fr-FR') });
} else {
  res.status(400).json({ success: false, error: data.message });
}
```

} catch (err) {
console.error(err);
res.status(500).json({ success: false, error: ‘Erreur envoi mail’ });
}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DevisVoice backend démarré sur le port ${PORT}`));
