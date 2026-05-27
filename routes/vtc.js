const router = require('express').Router();
const pool = require('../db');
const { sendEmail } = require('../helpers/email');

// Numérotation BC-{annee}-{NNNN} avec 3-retry sur collision PRIMARY KEY
router.post('/bon-commande/save', async (req, res) => {
  const {
    conducteurNom, plaque,
    passagerNom, passagerEmail, passagerTel,
    dateCommande, datePriseCharge, lieuPriseCharge, destination,
    distanceKm, montantTTC, pdfHtml
  } = req.body;
  const conducteurEmail = req.user.email;

  if (!dateCommande) return res.status(400).json({ error: 'dateCommande requise' });

  const annee = new Date(dateCommande).getFullYear();

  try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM '\\d+$') AS INT)), 0) AS max_num
         FROM bon_commande
         WHERE id LIKE $1`,
        [`BC-${annee}-%`]
      );
      const nextNum = parseInt(maxResult.rows[0].max_num) + 1 + attempt;
      const id = `BC-${annee}-${String(nextNum).padStart(4, '0')}`;

      try {
        const result = await pool.query(
          `INSERT INTO bon_commande
             (id, conducteur_email, conducteur_nom, plaque,
              passager_nom, passager_email, passager_tel,
              date_commande, date_prise_charge, lieu_prise_charge, destination,
              distance_km, montant_ttc, pdf_html)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id, created_at`,
          [
            id, conducteurEmail, conducteurNom || null, plaque || null,
            passagerNom || null, passagerEmail || null, passagerTel || null,
            dateCommande, datePriseCharge || null, lieuPriseCharge || null, destination || null,
            distanceKm || null, montantTTC || null, pdfHtml || null
          ]
        );
        return res.json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at });
      } catch (err) {
        // 23505 = unique_violation (collision PRIMARY KEY entre 2 requêtes simultanées)
        if (err.code === '23505') { lastError = err; continue; }
        throw err;
      }
    }
    throw lastError || new Error('Impossible de générer un ID unique après 3 tentatives');
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/bon-commande/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bon_commande WHERE id=$1 AND conducteur_email=$2', [req.params.id, req.user.email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Bon de commande introuvable' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/bon-commande', async (req, res) => {
  const email = req.user.email;
  try {
    const result = await pool.query(
      `SELECT id, conducteur_nom, plaque, passager_nom, passager_email, passager_tel,
              date_commande, date_prise_charge, lieu_prise_charge, destination,
              distance_km, montant_ttc, created_at
       FROM bon_commande
       WHERE conducteur_email=$1
       ORDER BY date_commande DESC`,
      [email]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/send-bon-commande', async (req, res) => {
  const { conducteurNom, passagerEmail, subject, html, pdfBase64, numero } = req.body;
  const conducteurEmail = req.user.email;
  if (!passagerEmail) return res.status(400).json({ error: 'passagerEmail requis' });
  try {
    const attachments = pdfBase64
      ? [{ filename: `${numero || 'bon-commande'}.pdf`, content: pdfBase64 }]
      : [];
    const data = await sendEmail({
      artisanNom:   conducteurNom,
      artisanEmail: conducteurEmail,
      to:           passagerEmail,
      subject:      subject || `Bon de commande ${numero || ''}`.trim(),
      html,
      attachments
    });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
