const router = require('express').Router();
const pool = require('../db');
const { sendEmail } = require('../helpers/email');

router.post('/send-devis', async (req, res) => {
  const { artisanNom, clientEmail, subject, html, attachments } = req.body;
  const artisanEmail = req.user.email;
  try {
    const data = await sendEmail({ artisanNom, artisanEmail, to: clientEmail, subject, html, attachments });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/send-acceptation', async (req, res) => {
  const { artisanNom, clientEmail, clientNom, numero, montant, sigB64, today } = req.body;
  const artisanEmail = req.user.email;
  try {
    const sigHtmlArtisan = sigB64
      ? `<div style="margin:16px 0;border:1px solid #eee;border-radius:8px;padding:10px;text-align:center;background:#fafafa"><p style="font-size:11px;color:#888;margin-bottom:6px">Signature du client</p><img src="${sigB64}" style="max-height:70px;max-width:260px"></div>`
      : `<p style="font-size:12px;color:#aaa;font-style:italic">Acceptation sans signature manuscrite.</p>`;

    const sigHtmlClient = sigB64
      ? `<div style="margin:16px 0;border:1px solid #eee;border-radius:8px;padding:10px;text-align:center;background:#fafafa"><p style="font-size:11px;color:#888;margin-bottom:6px">Votre signature</p><img src="${sigB64}" style="max-height:70px;max-width:260px"></div>`
      : '';

    await sendEmail({
      artisanNom,
      artisanEmail,
      to: artisanEmail,
      subject: `✅ Devis ${numero} accepté par ${clientNom}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#222"><div style="background:#FF4500;padding:20px 24px;border-radius:8px 8px 0 0"><h1 style="color:#fff;font-size:18px;margin:0">✅ Devis accepté !</h1></div><div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px"><p style="font-size:14px;margin-bottom:16px">Bonne nouvelle ! Votre devis vient d'être accepté.</p><table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px"><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Devis</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0">${numero}</td></tr><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Client</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0">${clientNom}</td></tr><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Montant TTC</td><td style="padding:8px 0;font-weight:600;color:#FF4500;border-bottom:1px solid #f0f0f0">${montant}</td></tr><tr><td style="padding:8px 0;color:#888">Date</td><td style="padding:8px 0;font-weight:600">${today}</td></tr></table>${sigHtmlArtisan}<div style="background:#e8f8ef;border-radius:8px;padding:12px 16px;text-align:center;margin-top:16px"><span style="color:#00a651;font-weight:700;font-size:14px">✓ BON POUR ACCORD — ${clientNom} — ${today}</span></div><p style="font-size:11px;color:#aaa;margin-top:20px;text-align:center">Généré avec DevisVoice</p></div></div>`
    });

    if (clientEmail) {
      await sendEmail({
        artisanNom,
        artisanEmail,
        to: clientEmail,
        subject: `Confirmation — Devis ${numero} accepté`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#222"><div style="background:#111;padding:20px 24px;border-radius:8px 8px 0 0"><h1 style="color:#fff;font-size:18px;margin:0">Confirmation d'acceptation</h1></div><div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px"><p style="font-size:14px;margin-bottom:16px">Bonjour ${clientNom},<br><br>Votre acceptation du devis <strong>${numero}</strong> a bien été enregistrée.</p><table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px"><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Artisan</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0">${artisanNom}</td></tr><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Montant TTC</td><td style="padding:8px 0;font-weight:600;color:#FF4500;border-bottom:1px solid #f0f0f0">${montant}</td></tr><tr><td style="padding:8px 0;color:#888">Date</td><td style="padding:8px 0;font-weight:600">${today}</td></tr></table>${sigHtmlClient}<div style="background:#e8f8ef;border-radius:8px;padding:12px 16px;text-align:center;margin-top:16px"><span style="color:#00a651;font-weight:700;font-size:14px">✓ BON POUR ACCORD — ${clientNom} — ${today}</span></div><p style="font-size:11px;color:#aaa;margin-top:20px;text-align:center">Généré avec DevisVoice</p></div></div>`
      });
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/devis/save', async (req, res) => {
  const { id, data, artisanNom, clientEmail, libelle, _libelleOnly } = req.body;
  if (!id) return res.status(400).json({ error: 'Paramètres manquants' });
  const email = req.user.email;
  try {
    if (_libelleOnly) {
      const r = await pool.query(
        'UPDATE devis SET libelle=$2 WHERE id=$1 AND artisan_email=$3 RETURNING id',
        [id, libelle || null, email]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable ou non autorisé' });
      res.json({ success: true, id });
    } else {
      const familleVal = (data && data.famille) || null;
      // ON CONFLICT WHERE devis.artisan_email=$3 : empêche un attaquant de
      // réécrire le devis d'un autre artisan en envoyant son id (IDOR write).
      // Si l'id existe déjà chez un autre artisan, RETURNING renvoie 0 lignes.
      const result = await pool.query(
        `INSERT INTO devis (id, data, artisan_email, artisan_nom, client_email, libelle, famille)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE
           SET data=$2, artisan_nom=$4, libelle=COALESCE($6, devis.libelle), famille=COALESCE($7, devis.famille)
           WHERE devis.artisan_email=$3
         RETURNING share_token`,
        [id, JSON.stringify(data), email, artisanNom, clientEmail, libelle || null, familleVal]
      );
      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Ce devis appartient à un autre artisan' });
      }
      res.json({ success: true, id, share_token: result.rows[0].share_token });
    }
  } catch (err) { res.status(500).json({error: err.message}); }
});

// Route publique — accès client via lien email (token UUID non-devinable)
router.get('/devis/share/:token', async (req, res) => {
  const token = req.params.token;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return res.status(400).json({ error: 'Token invalide' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM devis WHERE share_token=$1',
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/devis/:id — artisan authentifié uniquement
router.get('/devis/:id', async (req, res) => {
  const email = req.user.email;
  try {
    const result = await pool.query(
      'SELECT * FROM devis WHERE id=$1 AND artisan_email=$2',
      [req.params.id, email]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/devis', async (req, res) => {
  const email = req.user.email;
  try {
    const result = await pool.query(
      `SELECT id, data->>'total_ttc' as montant, data->'client'->>'nom' as client,
              accepted, statut, fusion_id, libelle, created_at
       FROM devis
       WHERE artisan_email=$1
       ORDER BY created_at DESC`,
      [email]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/devis/accept', async (req, res) => {
  const { id, acceptedBy, acceptedAt, signature } = req.body;
  if(!id || !acceptedBy) return res.status(400).json({error: 'Paramètres manquants'});
  try {
    const check = await pool.query('SELECT accepted FROM devis WHERE id=$1', [id]);
    if(check.rows.length === 0) return res.status(404).json({error: 'Devis introuvable'});
    if(check.rows[0].accepted) return res.status(409).json({error: 'Devis déjà accepté', already: true});
    await pool.query(
      'UPDATE devis SET accepted=TRUE, accepted_by=$2, accepted_at=$3, signature=$4 WHERE id=$1',
      [id, acceptedBy, acceptedAt || new Date().toISOString(), signature || null]
    );
    const updated = await pool.query('SELECT client_email, artisan_email, artisan_nom FROM devis WHERE id=$1', [id]);
    const row = updated.rows[0];
    res.json({
      success: true,
      id,
      acceptedBy,
      clientEmail: row?.client_email || null,
      artisanEmail: row?.artisan_email || null,
      artisanNom: row?.artisan_nom || null
    });
  } catch (err) { res.status(500).json({error: err.message}); }
});

// Fusionne plusieurs devis acceptés en un seul nouveau devis (irréversible)
// Si chantier_termine=true, crée aussi la facture et envoie les deux par email
router.post('/devis/fusion', async (req, res) => {
  const { ids, artisanNom, chantierTermine } = req.body;
  const artisanEmail = req.user.email;
  if (!ids || !Array.isArray(ids) || ids.length < 2) {
    return res.status(400).json({ error: 'Au moins 2 devis requis pour une fusion' });
  }

  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const devisResult = await pool.query(
      `SELECT * FROM devis WHERE id IN (${placeholders}) AND artisan_email=$${ids.length + 1} AND accepted=TRUE AND statut='actif'`,
      [...ids, artisanEmail]
    );

    if (devisResult.rows.length !== ids.length) {
      return res.status(400).json({ error: 'Certains devis sont introuvables, non acceptés ou déjà fusionnés' });
    }

    const allLignes = [];
    let totalHT = 0;
    let totalTTC = 0;
    const clientEmail = devisResult.rows[0].client_email;
    const firstData = devisResult.rows[0].data;

    for (const d of devisResult.rows) {
      const lignes = d.data.lignes || [];
      allLignes.push(...lignes);
      totalHT += parseFloat(d.data.total_ht || 0);
      totalTTC += parseFloat(d.data.total_ttc || 0);
    }

    const newId = 'DV-FUSION-' + Date.now();
    const newData = {
      ...firstData,
      lignes: allLignes,
      total_ht: totalHT.toFixed(2),
      total_ttc: totalTTC.toFixed(2),
      fusion_sources: ids
    };

    await pool.query(
      `INSERT INTO devis (id, data, artisan_email, artisan_nom, client_email, accepted, accepted_by, accepted_at, statut)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, NOW(), 'actif')`,
      [newId, JSON.stringify(newData), artisanEmail, artisanNom || null, clientEmail, firstData?.client?.nom || 'Fusion']
    );

    // Les IDs commencent à $2 car $1 est réservé à newId
    const updatePlaceholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    await pool.query(
      `UPDATE devis SET statut='fusionné', fusion_id=$1 WHERE id IN (${updatePlaceholders})`,
      [newId, ...ids]
    );

    let factureId = null;
    if (chantierTermine) {
      factureId = 'F-' + newId;
      const numeroFacture = factureId + '-' + new Date().getFullYear();
      await pool.query(
        `INSERT INTO factures (id, devis_id, artisan_email, client_nom, numero, lignes, statut)
         VALUES ($1, $2, $3, $4, $5, $6, 'non_envoyee')
         ON CONFLICT (id) DO NOTHING`,
        [factureId, newId, artisanEmail, firstData?.client?.nom || '', numeroFacture, JSON.stringify(allLignes)]
      );
    }

    res.json({ success: true, newDevisId: newId, factureId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
