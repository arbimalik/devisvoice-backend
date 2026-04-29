require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const JWT_SECRET = process.env.JWT_SECRET || 'devisvoice_secret_2026';

const app = express();
app.use(cors());
app.use(express.json({limit: '10mb'}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS artisan_prefs (
    artisan_email  VARCHAR(255) PRIMARY KEY,
    style_data     JSONB NOT NULL DEFAULT '{}',
    updated_at     TIMESTAMP DEFAULT NOW()
  )
`).then(() => console.log('Table artisan_prefs OK'))
  .catch(err => console.error('Erreur creation table artisan_prefs:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS clients (
    id            SERIAL PRIMARY KEY,
    artisan_email VARCHAR(255) NOT NULL,
    nom           VARCHAR(255),
    email         VARCHAR(255),
    telephone     VARCHAR(50),
    siret         VARCHAR(14),
    adresse       TEXT,
    ville         VARCHAR(100),
    code_postal   VARCHAR(10),
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
  )
`).then(() =>
  pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_artisan_nom_idx
    ON clients (artisan_email, nom)
  `)
).then(() => console.log('Table clients OK'))
  .catch(err => console.error('Erreur creation table clients:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS factures (
    id VARCHAR(50) PRIMARY KEY,
    devis_id VARCHAR(50) REFERENCES devis(id) ON DELETE SET NULL,
    artisan_email VARCHAR(255),
    client_nom VARCHAR(255),
    numero VARCHAR(50),
    statut VARCHAR(20) DEFAULT 'non_envoyee',
    lignes JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`).then(() =>
  pool.query(`
    ALTER TABLE factures
    ADD COLUMN IF NOT EXISTS libelle TEXT
  `)
).then(() => console.log('Table factures OK'))
  .catch(err => console.error('Erreur creation table factures:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS devis (
    id VARCHAR(50) PRIMARY KEY,
    data JSONB NOT NULL,
    artisan_email VARCHAR(255),
    client_email VARCHAR(255),
    artisan_nom VARCHAR(255),
    accepted BOOLEAN DEFAULT FALSE,
    accepted_by VARCHAR(255),
    accepted_at TIMESTAMP,
    signature TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
`).then(() => {
  return pool.query(`
    ALTER TABLE devis
    ADD COLUMN IF NOT EXISTS accepted BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS signature TEXT,
    ADD COLUMN IF NOT EXISTS artisan_nom VARCHAR(255)
  `);
}).then(() =>
  pool.query(`
    ALTER TABLE devis
    ADD COLUMN IF NOT EXISTS libelle TEXT,
    ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif',
    ADD COLUMN IF NOT EXISTS fusion_id VARCHAR(50)
  `)
).then(() =>
  pool.query(`
    ALTER TABLE devis
    ADD COLUMN IF NOT EXISTS famille VARCHAR(20)
  `)
).then(() =>
  // Migration : remplir famille depuis le blob JSON pour les lignes existantes
  pool.query(`
    UPDATE devis
    SET famille = data->>'famille'
    WHERE famille IS NULL
      AND data->>'famille' IS NOT NULL
      AND data->>'famille' != ''
  `)
).then(() =>
  // Token de partage UUID — accès public sécurisé pour le client final
  // (lien d'acceptation envoyé par email). DEFAULT gen_random_uuid() backfill
  // automatique des lignes existantes en PostgreSQL 11+.
  pool.query(`
    ALTER TABLE devis
    ADD COLUMN IF NOT EXISTS share_token UUID DEFAULT gen_random_uuid()
  `)
).then(() =>
  pool.query(`CREATE INDEX IF NOT EXISTS devis_share_token_idx ON devis (share_token)`)
).then(() => console.log('Table devis OK'))
  .catch(err => console.error('Erreur creation table:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id               SERIAL PRIMARY KEY,
    email            VARCHAR(255) UNIQUE NOT NULL,
    prenom           VARCHAR(100),
    nom              VARCHAR(100),
    entreprise       VARCHAR(255),
    telephone        VARCHAR(20),
    mot_de_passe_hash VARCHAR(255),
    famille          VARCHAR(50),
    metiers          JSONB DEFAULT '[]',
    document_type    VARCHAR(20) DEFAULT 'devis',
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
  )
`).then(() => console.log('Table users OK'))
  .catch(err => console.error('Erreur table users:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS bon_commande (
    id                 VARCHAR(20) PRIMARY KEY,
    conducteur_email   VARCHAR(255) NOT NULL,
    conducteur_nom     VARCHAR(255),
    plaque             VARCHAR(20),
    passager_nom       VARCHAR(255),
    passager_email     VARCHAR(255),
    passager_tel       VARCHAR(50),
    date_commande      TIMESTAMP NOT NULL,
    date_prise_charge  TIMESTAMP,
    lieu_prise_charge  TEXT,
    destination        TEXT,
    distance_km        NUMERIC(8,2),
    montant_ttc        NUMERIC(10,2),
    pdf_html           TEXT,
    created_at         TIMESTAMP DEFAULT NOW()
  )
`).then(() =>
  pool.query(`CREATE INDEX IF NOT EXISTS idx_bon_commande_email ON bon_commande(conducteur_email)`)
).then(() => console.log('Table bon_commande OK'))
  .catch(err => console.error('Erreur table bon_commande:', err));

// ===== HELPER ENVOI EMAIL CENTRALISÉ =====
// Tous les emails partent depuis devis@devisvoice.fr
// L'artisan apparaît comme expéditeur via le "from name"
async function sendEmail({ artisanNom, artisanEmail, to, subject, html, attachments }) {
  const fromName = artisanNom ? `${artisanNom} via DevisVoice` : 'DevisVoice';
  const payload = {
    from: `${fromName} <devis@devisvoice.fr>`,
    reply_to: artisanEmail || 'contact@devisvoice.fr',
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };
  if (attachments && attachments.length) {
    payload.attachments = attachments.map(a => ({
      ...a,
      content_type: a.content_type || 'application/pdf'
    }));
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Erreur envoi email');
  return data;
}

// ===== API CLAUDE =====
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

// ===== ENVOI DEVIS PAR EMAIL =====
app.post('/api/send-devis', async (req, res) => {
  const { artisanNom, artisanEmail, clientEmail, subject, html, attachments } = req.body;
  try {
    const data = await sendEmail({ artisanNom, artisanEmail, to: clientEmail, subject, html, attachments });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ENVOI FIN DE CHANTIER (facture → client + comptable) =====
app.post('/api/send-fin-chantier', async (req, res) => {
  const { artisanNom, artisanEmail, clientEmail, comptableEmail, clientNom, numero, montant, html, pdfBase64 } = req.body;
  if (!artisanEmail) return res.status(400).json({ error: 'artisanEmail requis' });
  try {
    const subject = `Facture ${numero} - ${artisanNom}`;
    const attachments = pdfBase64
      ? [{ filename: `${numero}.pdf`, content: pdfBase64 }]
      : [];

    // Email au client
    if (clientEmail) {
      await sendEmail({ artisanNom, artisanEmail, to: clientEmail, subject, html, attachments });
    }

    // Copie au comptable
    if (comptableEmail) {
      const subjectComptable = `[Copie comptable] Facture ${numero} — ${clientNom}`;
      await sendEmail({ artisanNom, artisanEmail, to: comptableEmail, subject: subjectComptable, html, attachments });
    }

    // Mise à jour statut facture en BDD
    if (numero) {
      const factureId = 'F-' + numero.replace(/^F-/, '');
      await pool.query(
        "UPDATE factures SET statut='envoyee', updated_at=NOW() WHERE numero=$1 AND artisan_email=$2",
        [numero, artisanEmail]
      ).catch(() => {});
    }

    res.json({ success: true, clientEnvoye: !!clientEmail, comptableEnvoye: !!comptableEmail });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ENVOI EMAIL ACCEPTATION =====
app.post('/api/send-acceptation', async (req, res) => {
  const { artisanNom, artisanEmail, clientEmail, clientNom, numero, montant, sigB64, today } = req.body;
  try {
    const sigHtmlArtisan = sigB64
      ? `<div style="margin:16px 0;border:1px solid #eee;border-radius:8px;padding:10px;text-align:center;background:#fafafa"><p style="font-size:11px;color:#888;margin-bottom:6px">Signature du client</p><img src="${sigB64}" style="max-height:70px;max-width:260px"></div>`
      : `<p style="font-size:12px;color:#aaa;font-style:italic">Acceptation sans signature manuscrite.</p>`;

    const sigHtmlClient = sigB64
      ? `<div style="margin:16px 0;border:1px solid #eee;border-radius:8px;padding:10px;text-align:center;background:#fafafa"><p style="font-size:11px;color:#888;margin-bottom:6px">Votre signature</p><img src="${sigB64}" style="max-height:70px;max-width:260px"></div>`
      : '';

    // Email artisan
    await sendEmail({
      artisanNom,
      artisanEmail,
      to: artisanEmail,
      subject: `✅ Devis ${numero} accepté par ${clientNom}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#222"><div style="background:#FF4500;padding:20px 24px;border-radius:8px 8px 0 0"><h1 style="color:#fff;font-size:18px;margin:0">✅ Devis accepté !</h1></div><div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px"><p style="font-size:14px;margin-bottom:16px">Bonne nouvelle ! Votre devis vient d'être accepté.</p><table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px"><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Devis</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0">${numero}</td></tr><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Client</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0f0f0">${clientNom}</td></tr><tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f0f0f0">Montant TTC</td><td style="padding:8px 0;font-weight:600;color:#FF4500;border-bottom:1px solid #f0f0f0">${montant}</td></tr><tr><td style="padding:8px 0;color:#888">Date</td><td style="padding:8px 0;font-weight:600">${today}</td></tr></table>${sigHtmlArtisan}<div style="background:#e8f8ef;border-radius:8px;padding:12px 16px;text-align:center;margin-top:16px"><span style="color:#00a651;font-weight:700;font-size:14px">✓ BON POUR ACCORD — ${clientNom} — ${today}</span></div><p style="font-size:11px;color:#aaa;margin-top:20px;text-align:center">Généré avec DevisVoice</p></div></div>`
    });

    // Email client
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

// ===== SAUVEGARDE DEVIS =====
app.post('/api/devis/save', async (req, res) => {
  const { id, data, artisanEmail, artisanNom, clientEmail, libelle, _libelleOnly } = req.body;
  if (!id || !artisanEmail) return res.status(400).json({ error: 'Paramètres manquants' });
  try {
    if (_libelleOnly) {
      // Mise à jour du libellé uniquement, sans toucher aux données du devis
      await pool.query(
        'UPDATE devis SET libelle=$2 WHERE id=$1 AND artisan_email=$3',
        [id, libelle || null, artisanEmail]
      );
      res.json({ success: true, id });
    } else {
      const familleVal = (data && data.famille) || null;
      const result = await pool.query(
        `INSERT INTO devis (id, data, artisan_email, artisan_nom, client_email, libelle, famille)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET data=$2, artisan_nom=$4, libelle=COALESCE($6, devis.libelle), famille=COALESCE($7, devis.famille)
         RETURNING share_token`,
        [id, JSON.stringify(data), artisanEmail, artisanNom, clientEmail, libelle || null, familleVal]
      );
      res.json({ success: true, id, share_token: result.rows[0].share_token });
    }
  } catch (err) { res.status(500).json({error: err.message}); }
});

// ===== GET DEVIS (artisan authentifié uniquement) =====
// Pour l'accès public du client final via lien email, voir /api/devis/share/:token
app.get('/api/devis/:id', async (req, res) => {
  const decoded = decodeAuth(req);
  if (!decoded) return res.status(401).json({ error: 'Token invalide' });
  try {
    const u = await pool.query('SELECT email FROM users WHERE id=$1', [decoded.userId]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const email = u.rows[0].email;
    const result = await pool.query(
      'SELECT * FROM devis WHERE id=$1 AND artisan_email=$2',
      [req.params.id, email]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== GET DEVIS PAR TOKEN DE PARTAGE (accès public client final) =====
// Le client n'est pas authentifié. Le token UUID non-devinable est envoyé
// dans le lien d'acceptation par email.
app.get('/api/devis/share/:token', async (req, res) => {
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

// ===== HISTORIQUE DEVIS =====
app.get('/api/devis', async (req, res) => {
  const decoded = decodeAuth(req);
  if (!decoded) return res.status(401).json({ error: 'Token invalide' });
  try {
    const u = await pool.query('SELECT email FROM users WHERE id=$1', [decoded.userId]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const email = u.rows[0].email;
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

// ===== ACCEPTATION DEVIS =====
app.post('/api/devis/accept', async (req, res) => {
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


// ===== FUSION DE DEVIS =====
// Fusionne plusieurs devis acceptés en un seul nouveau devis (irréversible)
// Si chantier_termine=true, crée aussi la facture et envoie les deux par email
app.post('/api/devis/fusion', async (req, res) => {
  const { ids, artisanEmail, artisanNom, chantierTermine } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length < 2) {
    return res.status(400).json({ error: 'Au moins 2 devis requis pour une fusion' });
  }
  if (!artisanEmail) return res.status(400).json({ error: 'artisanEmail requis' });

  try {
    // Récupérer tous les devis à fusionner
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const devisResult = await pool.query(
      `SELECT * FROM devis WHERE id IN (${placeholders}) AND artisan_email=$${ids.length + 1} AND accepted=TRUE AND statut='actif'`,
      [...ids, artisanEmail]
    );

    if (devisResult.rows.length !== ids.length) {
      return res.status(400).json({ error: 'Certains devis sont introuvables, non acceptés ou déjà fusionnés' });
    }

    // Fusionner toutes les lignes et recalculer les totaux
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

    // Créer le nouveau devis fusionné
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

    // Marquer les anciens devis comme fusionnés
    // Les IDs commencent à $2 car $1 est réservé à newId
    const updatePlaceholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    await pool.query(
      `UPDATE devis SET statut='fusionné', fusion_id=$1 WHERE id IN (${updatePlaceholders})`,
      [newId, ...ids]
    );

    // Si chantier terminé : créer la facture automatiquement
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

// ===== MODULE FACTURES =====

// Sauvegarde / mise à jour d'une facture
app.post('/api/factures/save', async (req, res) => {
  const { id, devisId, artisanEmail, clientNom, numero, lignes, libelle, _libelleOnly } = req.body;
  if (!id || !artisanEmail) return res.status(400).json({ error: 'Paramètres manquants' });
  try {
    if (_libelleOnly) {
      await pool.query(
        'UPDATE factures SET libelle=$2, updated_at=NOW() WHERE id=$1 AND artisan_email=$3',
        [id, libelle || null, artisanEmail]
      );
    } else {
      await pool.query(
        `INSERT INTO factures (id, devis_id, artisan_email, client_nom, numero, lignes, libelle, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE
         SET client_nom=$4, numero=$5, lignes=$6, libelle=COALESCE($7, factures.libelle), updated_at=NOW()`,
        [id, devisId || null, artisanEmail, clientNom || null, numero || null, JSON.stringify(lignes || []), libelle || null]
      );
    }
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Récupération d'une facture
app.get('/api/factures/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM factures WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mise à jour du statut (non_envoyee → envoyee → payee)
app.patch('/api/factures/:id/statut', async (req, res) => {
  const { statut } = req.body;
  const statuts = ['non_envoyee', 'envoyee', 'en_attente', 'payee'];
  if (!statuts.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
  try {
    const result = await pool.query(
      'UPDATE factures SET statut=$2, updated_at=NOW() WHERE id=$1 RETURNING *',
      [req.params.id, statut]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    res.json({ success: true, statut: result.rows[0].statut });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Liste des factures d'un artisan
app.get('/api/factures', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email requis' });
  try {
    const result = await pool.query(
      'SELECT id, devis_id, client_nom, numero, statut, libelle, created_at FROM factures WHERE artisan_email=$1 ORDER BY created_at DESC',
      [email]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== MODULE CLIENTS =====

// Sauvegarde / mise à jour d'un client (upsert sur artisan_email + siret, ou artisan_email + nom si pas de SIRET)
app.post('/api/clients/save', async (req, res) => {
  const { artisanEmail, nom, email, telephone, siret, adresse, ville, codePostal } = req.body;
  if (!artisanEmail || !nom) return res.status(400).json({ error: 'artisanEmail et nom requis' });
  try {
    await pool.query(
      `INSERT INTO clients (artisan_email, nom, email, telephone, siret, adresse, ville, code_postal, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (artisan_email, nom) DO UPDATE
       SET email=$3, telephone=$4, siret=$5, adresse=$6, ville=$7, code_postal=$8, updated_at=NOW()`,
      [artisanEmail, nom, email || null, telephone || null, siret || null, adresse || null, ville || null, codePostal || null]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Liste tous les clients de l'artisan authentifié (pour menu déroulant)
// Si q est fourni : filtre par nom ou SIRET (autocomplétion)
// Si q est absent  : retourne tous les clients triés par nom
app.get('/api/clients', async (req, res) => {
  const decoded = decodeAuth(req);
  if (!decoded) return res.status(401).json({ error: 'Token invalide' });
  try {
    const u = await pool.query('SELECT email FROM users WHERE id=$1', [decoded.userId]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const email = u.rows[0].email;
    const { q } = req.query;
    let result;
    if (q && q.trim()) {
      result = await pool.query(
        `SELECT id, nom, email, telephone, siret, adresse, ville, code_postal
         FROM clients
         WHERE artisan_email=$1 AND (
           nom       ILIKE $2 OR
           email     ILIKE $2 OR
           telephone LIKE  $3 OR
           siret     LIKE  $3 OR
           adresse   ILIKE $2 OR
           ville     ILIKE $2 OR
           code_postal LIKE $3
         )
         ORDER BY nom ASC
         LIMIT 10`,
        [email, `%${q.trim()}%`, `${q.trim()}%`]
      );
    } else {
      result = await pool.query(
        `SELECT id, nom, email, telephone, siret, adresse, ville, code_postal
         FROM clients
         WHERE artisan_email=$1
         ORDER BY nom ASC`,
        [email]
      );
    }
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== RECHERCHE SIRET =====
app.get('/api/siret/:siret', async (req, res) => {
  const siret = req.params.siret.replace(/\s/g, '');
  if (!/^\d{14}$/.test(siret)) {
    return res.status(400).json({ error: 'SIRET invalide — 14 chiffres requis' });
  }
  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siret}&page=1&per_page=1`);
    if (!response.ok) throw new Error('Erreur API service public');
    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ error: 'Entreprise introuvable' });
    }
    const e = data.results[0];
    const siege = e.siege || {};
    res.json({
      siret: siege.siret || siret,
      siren: e.siren || '',
      nom: e.nom_raison_sociale || e.nom_complet || '',
      adresse: siege.adresse || '',
      code_postal: siege.code_postal || '',
      ville: siege.libelle_commune || '',
      activite: siege.activite_principale || ''
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== PRÉFÉRENCES ARTISAN (mémoire IA) =====

app.get('/api/preferences', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email requis' });
  try {
    const r = await pool.query('SELECT style_data FROM artisan_prefs WHERE artisan_email=$1', [email]);
    res.json(r.rows.length ? r.rows[0].style_data : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/preferences/update', async (req, res) => {
  const { artisanEmail, observations, descriptions, acomptePct, metiers, conditions } = req.body;
  if (!artisanEmail) return res.status(400).json({ error: 'artisanEmail requis' });
  try {
    // Récupérer les préfs existantes
    const existing = await pool.query('SELECT style_data FROM artisan_prefs WHERE artisan_email=$1', [artisanEmail]);
    const prev = existing.rows.length ? existing.rows[0].style_data : {};

    // Garder les 5 dernières observations uniques
    const obsActuelles = prev.observations_recentes || [];
    const nouvObs = observations ? [observations, ...obsActuelles].filter(Boolean).filter((v,i,a) => a.indexOf(v) === i).slice(0, 5) : obsActuelles;

    // Garder les 10 dernières formulations uniques
    const formActuelles = prev.formulations_types || [];
    const nouvForm = descriptions ? [...new Set([...descriptions, ...formActuelles])].slice(0, 10) : formActuelles;

    // Garder les 5 métiers les plus fréquents
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

app.delete('/api/preferences/reset', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email requis' });
  try {
    await pool.query('DELETE FROM artisan_prefs WHERE artisan_email=$1', [email]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== STATS TABLEAU DE BORD =====
app.get('/api/stats', async (req, res) => {
  const decoded = decodeAuth(req);
  if(!decoded) return res.status(401).json({error: 'Token invalide'});
  try {
    const u = await pool.query('SELECT email FROM users WHERE id=$1', [decoded.userId]);
    if(u.rows.length === 0) return res.status(404).json({error: 'Utilisateur introuvable'});
    const email = u.rows[0].email;
    // Bornes mois actuel
    const debutMois = new Date();
    debutMois.setDate(1); debutMois.setHours(0,0,0,0);

    // Bornes mois précédent
    const debutPrecedent = new Date(debutMois);
    debutPrecedent.setMonth(debutPrecedent.getMonth() - 1);
    const finPrecedent = new Date(debutMois);

    // Bornes de l'année en cours (jan → mois actuel)
    const debutAnnee = new Date(debutMois.getFullYear(), 0, 1);

    const [totalMois, acceptesMois, totalPrecedent, acceptesPrecedent, facturesAttente, derniers, parMois] = await Promise.all([
      // Devis créés ce mois
      pool.query(
        "SELECT COUNT(*) as count FROM devis WHERE artisan_email=$1 AND created_at >= $2 AND statut != 'fusionné'",
        [email, debutMois]
      ),
      // Devis acceptés ce mois + montant
      pool.query(
        "SELECT COUNT(*) as count, COALESCE(SUM((data->>'total_ttc')::numeric), 0) as montant FROM devis WHERE artisan_email=$1 AND accepted=TRUE AND accepted_at >= $2",
        [email, debutMois]
      ),
      // Devis créés le mois précédent
      pool.query(
        "SELECT COUNT(*) as count FROM devis WHERE artisan_email=$1 AND created_at >= $2 AND created_at < $3 AND statut != 'fusionné'",
        [email, debutPrecedent, finPrecedent]
      ),
      // Devis acceptés le mois précédent + montant
      pool.query(
        "SELECT COUNT(*) as count, COALESCE(SUM((data->>'total_ttc')::numeric), 0) as montant FROM devis WHERE artisan_email=$1 AND accepted=TRUE AND accepted_at >= $2 AND accepted_at < $3",
        [email, debutPrecedent, finPrecedent]
      ),
      // Factures en attente (non payées) — montant depuis les devis liés
      pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM((d.data->>'total_ttc')::numeric), 0) as montant
         FROM factures f
         JOIN devis d ON f.devis_id = d.id
         WHERE f.artisan_email=$1 AND f.statut != 'payee'`,
        [email]
      ),
      // 5 derniers devis
      pool.query(
        "SELECT id, data->>'total_ttc' as montant, data->'client'->>'nom' as client, accepted, created_at FROM devis WHERE artisan_email=$1 ORDER BY created_at DESC LIMIT 5",
        [email]
      ),
      // Données mois par mois depuis janvier
      pool.query(
        `SELECT
           EXTRACT(MONTH FROM created_at)::int AS mois,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE accepted = TRUE) AS acceptes,
           COALESCE(SUM((data->>'total_ttc')::numeric) FILTER (WHERE accepted = TRUE), 0) AS montant
         FROM devis
         WHERE artisan_email=$1
           AND created_at >= $2
           AND statut != 'fusionné'
         GROUP BY mois
         ORDER BY mois`,
        [email, debutAnnee]
      )
    ]);

    const total     = parseInt(totalMois.rows[0].count);
    const acceptes  = parseInt(acceptesMois.rows[0].count);
    const montant   = parseFloat(acceptesMois.rows[0].montant) || 0;
    const totalPrec = parseInt(totalPrecedent.rows[0].count);
    const acceptesPrec = parseInt(acceptesPrecedent.rows[0].count);
    const montantPrec  = parseFloat(acceptesPrecedent.rows[0].montant) || 0;

    // Construire tableau des 12 mois (jan=1 → dec=12), valeur 0 si absent
    const moisLabels = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const parMoisMap = {};
    parMois.rows.forEach(r => { parMoisMap[r.mois] = r; });
    const historique = moisLabels.map((label, i) => {
      const m = parMoisMap[i + 1];
      return {
        mois: label,
        total:    m ? parseInt(m.total)    : 0,
        acceptes: m ? parseInt(m.acceptes) : 0,
        montant:  m ? parseFloat(m.montant): 0
      };
    });

    res.json({
      total_mois:               total,
      acceptes_mois:            acceptes,
      montant_mois:             montant,
      taux_acceptation:         total > 0 ? Math.round(acceptes / total * 100) : 0,
      total_precedent:          totalPrec,
      acceptes_precedent:       acceptesPrec,
      montant_precedent:        montantPrec,
      taux_precedent:           totalPrec > 0 ? Math.round(acceptesPrec / totalPrec * 100) : 0,
      factures_attente_nb:      parseInt(facturesAttente.rows[0].count),
      factures_attente_montant: parseFloat(facturesAttente.rows[0].montant) || 0,
      historique,
      derniers:                 derniers.rows
    });
  } catch(err) { res.status(500).json({error: err.message}); }
});

// Migration : colonnes users
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'gratuit'`)
  .catch(err => console.error('Migration plan:', err));

pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS famille TEXT,
  ADD COLUMN IF NOT EXISTS metier TEXT,
  ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'gratuit',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS plaque VARCHAR(20),
  ADD COLUMN IF NOT EXISTS taux_journalier NUMERIC(10,2)
`).then(() => console.log('Colonnes users OK'))
  .catch(err => console.error('ALTER users:', err));

// ===== AUTHENTIFICATION UTILISATEURS =====

app.post('/api/users/register', async (req, res) => {
  try {
    const { email, prenom, nom, entreprise, telephone, mot_de_passe, famille, metier, metiers, document_type, plaque, taux_journalier } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email requis' });

    const hash = mot_de_passe ? await bcrypt.hash(mot_de_passe, 10) : null;
    const tj = (taux_journalier === undefined || taux_journalier === null || taux_journalier === '') ? null : Number(taux_journalier);

    const result = await pool.query(
      `INSERT INTO users (email, prenom, nom, entreprise, telephone, mot_de_passe_hash, famille, metier, metiers, document_type, plaque, taux_journalier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (email) DO UPDATE
         SET prenom=COALESCE($2, users.prenom),
             nom=COALESCE($3, users.nom),
             entreprise=COALESCE($4, users.entreprise),
             telephone=COALESCE($5, users.telephone),
             famille=COALESCE($7, users.famille),
             metier=COALESCE($8, users.metier),
             metiers=COALESCE($9, users.metiers),
             document_type=COALESCE($10, users.document_type),
             plaque=COALESCE($11, users.plaque),
             taux_journalier=COALESCE($12, users.taux_journalier),
             updated_at=NOW()
       RETURNING id, email, prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plaque, taux_journalier`,
      [email, prenom || null, nom || null, entreprise || null, telephone || null,
       hash, famille || null, metier || null, JSON.stringify(metiers || []), document_type || 'devis',
       plaque || null, tj]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });

    res.json({
      success: true, token,
      userId: user.id, email: user.email,
      prenom: user.prenom, nom: user.nom,
      entreprise: user.entreprise, telephone: user.telephone,
      famille: user.famille, metier: user.metier, metiers: user.metiers,
      document_type: user.document_type,
      plaque: user.plaque,
      taux_journalier: user.taux_journalier
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    if (!email || !mot_de_passe) return res.json({ success: false, error: 'Email et mot de passe requis' });

    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (result.rows.length === 0) return res.json({ success: false, error: 'Email ou mot de passe incorrect' });

    const user = result.rows[0];
    if (!user.mot_de_passe_hash) return res.json({ success: false, error: 'Email ou mot de passe incorrect' });

    const valid = await bcrypt.compare(mot_de_passe, user.mot_de_passe_hash);
    if (!valid) return res.json({ success: false, error: 'Email ou mot de passe incorrect' });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });

    res.json({
      success: true, token,
      userId: user.id, email: user.email,
      prenom: user.prenom, nom: user.nom,
      entreprise: user.entreprise, telephone: user.telephone,
      famille: user.famille, metiers: user.metiers,
      document_type: user.document_type,
      plaque: user.plaque,
      taux_journalier: user.taux_journalier
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/users/profile', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
    const token = auth.slice(7);
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
    }
    const result = await pool.query(
      'SELECT id, email, prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plan, plaque, taux_journalier, created_at FROM users WHERE id=$1',
      [decoded.userId]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, userId: decoded.userId, email: decoded.email });
  } catch {
    res.json({ valid: false });
  }
});

// Helper : décode le JWT depuis le header Authorization
function decodeAuth(req){
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try { return jwt.verify(auth.slice(7), JWT_SECRET); } catch { return null; }
}

// Mise à jour du compte (email et/ou mot de passe)
app.put('/api/users/account', async (req, res) => {
  const decoded = decodeAuth(req);
  if (!decoded) return res.status(401).json({ success:false, error:'Token invalide' });
  try {
    const { email, mot_de_passe } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      return res.status(400).json({ success:false, error:'Email invalide' });
    }

    const dup = await pool.query('SELECT id FROM users WHERE email=$1 AND id<>$2', [email, decoded.userId]);
    if (dup.rows.length > 0) return res.status(409).json({ success:false, error:'Cet email est déjà utilisé.' });

    if (mot_de_passe){
      if (String(mot_de_passe).length < 6) return res.status(400).json({ success:false, error:'Mot de passe trop court' });
      const hash = await bcrypt.hash(mot_de_passe, 10);
      await pool.query('UPDATE users SET email=$1, mot_de_passe_hash=$2, updated_at=NOW() WHERE id=$3', [email, hash, decoded.userId]);
    } else {
      await pool.query('UPDATE users SET email=$1, updated_at=NOW() WHERE id=$2', [email, decoded.userId]);
    }
    res.json({ success:true, email });
  } catch (err) {
    res.status(500).json({ success:false, error: err.message });
  }
});

// Suppression du compte et de toutes les données associées
app.delete('/api/users/account', async (req, res) => {
  const decoded = decodeAuth(req);
  if (!decoded) return res.status(401).json({ success:false, error:'Token invalide' });
  try {
    const u = await pool.query('SELECT email FROM users WHERE id=$1', [decoded.userId]);
    if (u.rows.length === 0) return res.status(404).json({ success:false, error:'Compte introuvable' });
    const email = u.rows[0].email;

    await pool.query('DELETE FROM devis WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM bon_commande WHERE conducteur_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM factures WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM clients WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM artisan_prefs WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM users WHERE id=$1', [decoded.userId]);

    res.json({ success:true });
  } catch (err) {
    res.status(500).json({ success:false, error: err.message });
  }
});

// Export des données (compte + nombre de devis, sans contenu)
app.get('/api/users/export', async (req, res) => {
  const decoded = decodeAuth(req);
  if (!decoded) return res.status(401).json({ error:'Token invalide' });
  try {
    const u = await pool.query(
      'SELECT id, email, prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plan, plaque, taux_journalier, created_at FROM users WHERE id=$1',
      [decoded.userId]
    );
    if (u.rows.length === 0) return res.status(404).json({ error:'Compte introuvable' });
    const user = u.rows[0];

    const devisRes = await pool.query(
      'SELECT id, created_at FROM devis WHERE artisan_email=$1 ORDER BY created_at DESC',
      [user.email]
    );
    const devisListe = devisRes.rows.map(d => ({ id: d.id, created_at: d.created_at }));

    res.json({
      exporte_le: new Date().toISOString(),
      compte: user,
      devis_count: devisListe.length,
      devis: devisListe
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== STRIPE =====

app.post('/api/stripe/checkout', async (req, res) => {
  try {
    const { priceId, userEmail } = req.body;
    if(!priceId) return res.status(400).json({ error: 'Price ID non configuré' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!userEmail || !emailRegex.test(userEmail)){
      return res.status(400).json({ error: 'Email invalide' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 30 },
      success_url: 'https://devisvoice.fr/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://devisvoice.fr/pricing.html'
    });
    res.json({ url: session.url });
  } catch(err) {
    console.log('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stripe/create-checkout', async (req, res) => {
  try {
    console.log('Stripe body reçu:', req.body);
    const { priceId, userEmail, mode } = req.body;
    if(!priceId) {
      return res.status(400).json({ error: 'Price ID non configuré' });
    }
    const session = await stripe.checkout.sessions.create({
      mode: mode || 'subscription',
      payment_method_types: ['card'],
      customer_email: userEmail || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://devisvoice.fr/pricing-success.html?session={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://devisvoice.fr/pricing.html'
    });
    res.json({ url: session.url });
  } catch(err) {
    console.log('Stripe error détail:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stripe/session/:sessionId', async (req, res) => {
  if(!stripe) return res.status(500).json({ error: 'Stripe non configuré' });
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId, {
      expand: ['line_items']
    });
    const priceId = session.line_items?.data?.[0]?.price?.id || '';
    const planMap = {
      'price_1TNaVs7LHQgZGOp76yslWd3O': 'starter',
      'price_1TNaWo7LHQgZGOp7vTLsMTLI': 'starter',
      'price_1TNaXu7LHQgZGOp7Ouzq7yHc': 'pro',
      'price_1TNaXL7LHQgZGOp7HjJjdpfb': 'pro'
    };
    const plan  = planMap[priceId] || 'starter';
    const email = session.customer_email || session.customer_details?.email || '';
    if(email){
      await pool.query('UPDATE users SET plan=$1, updated_at=NOW() WHERE email=$2', [plan, email])
        .catch(err => console.error('Session update plan:', err));
    }
    res.json({ plan, email });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch(err) {
    return res.status(400).json({ error: `Webhook signature invalide: ${err.message}` });
  }

  if(event.type === 'checkout.session.completed'){
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const fullSession = await stripe.checkout.sessions.retrieve(
      session.id, { expand: ['line_items'] }
    );
    const priceId = fullSession.line_items?.data?.[0]?.price?.id;

    const planMap = {
      'price_1TNaVs7LHQgZGOp76yslWd3O': 'starter',
      'price_1TNaWo7LHQgZGOp7vTLsMTLI': 'starter',
      'price_1TNaXu7LHQgZGOp7Ouzq7yHc': 'pro',
      'price_1TNaXL7LHQgZGOp7HjJjdpfb': 'pro'
    };
    const plan = planMap[priceId] || 'starter';
    console.log('Webhook session email:', email, 'priceId:', priceId, 'plan:', plan);

    if(email){
      await pool.query('UPDATE users SET plan=$1, updated_at=NOW() WHERE email=$2', [plan, email])
        .catch(err => console.error('Webhook update plan:', err));
    }
  }

  res.json({ received: true });
});

// ===== BON DE COMMANDE VTC/TAXI =====

// Numérotation BC-{annee}-{NNNN} avec 3-retry sur collision PRIMARY KEY
app.post('/api/bon-commande/save', async (req, res) => {
  const {
    conducteurEmail, conducteurNom, plaque,
    passagerNom, passagerEmail, passagerTel,
    dateCommande, datePriseCharge, lieuPriseCharge, destination,
    distanceKm, montantTTC, pdfHtml
  } = req.body;

  if (!conducteurEmail) return res.status(400).json({ error: 'conducteurEmail requis' });
  if (!dateCommande)    return res.status(400).json({ error: 'dateCommande requise' });

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

app.get('/api/bon-commande/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bon_commande WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Bon de commande introuvable' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bon-commande', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email requis' });
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

// Envoi du bon de commande au passager (PDF en pièce jointe base64)
app.post('/api/send-bon-commande', async (req, res) => {
  const { conducteurNom, conducteurEmail, passagerEmail, subject, html, pdfBase64, numero } = req.body;
  if (!conducteurEmail) return res.status(400).json({ error: 'conducteurEmail requis' });
  if (!passagerEmail)   return res.status(400).json({ error: 'passagerEmail requis' });
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log('OK port ' + PORT); });
