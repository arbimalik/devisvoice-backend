const router = require('express').Router();
const pool = require('../db');
const { sendEmail } = require('../helpers/email');

router.post('/send-fin-chantier', async (req, res) => {
  const { artisanNom, clientEmail, comptableEmail, clientNom, numero, montant, html, pdfBase64 } = req.body;
  const artisanEmail = req.user.email;
  try {
    const userRow = await pool.query('SELECT plan FROM users WHERE email=$1', [artisanEmail]);
    const plan = (userRow.rows[0]?.plan || 'gratuit').toLowerCase();
    if (plan === 'gratuit') {
      return res.status(403).json({ error: 'L\'envoi de factures est réservé aux plans payants.', code: 'PLAN_UPGRADE_REQUIRED' });
    }
    const subject = `Facture ${numero} - ${artisanNom}`;
    const attachments = pdfBase64
      ? [{ filename: `${numero}.pdf`, content: pdfBase64 }]
      : [];

    if (clientEmail) {
      await sendEmail({ artisanNom, artisanEmail, to: clientEmail, subject, html, attachments });
    }

    if (comptableEmail) {
      const subjectComptable = `[Copie comptable] Facture ${numero} — ${clientNom}`;
      await sendEmail({ artisanNom, artisanEmail, to: comptableEmail, subject: subjectComptable, html, attachments });
    }

    if (numero) {
      await pool.query(
        "UPDATE factures SET statut='envoyee', updated_at=NOW() WHERE numero=$1 AND artisan_email=$2",
        [numero, artisanEmail]
      ).catch(() => {});
    }

    res.json({ success: true, clientEnvoye: !!clientEmail, comptableEnvoye: !!comptableEmail });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/factures/save', async (req, res) => {
  const { id, devisId, clientNom, numero, lignes, libelle, _libelleOnly } = req.body;
  const artisanEmail = req.user.email;
  if (!id) return res.status(400).json({ error: 'Paramètres manquants' });
  try {
    if (_libelleOnly) {
      await pool.query(
        'UPDATE factures SET libelle=$2, updated_at=NOW() WHERE id=$1 AND artisan_email=$3',
        [id, libelle || null, artisanEmail]
      );
    } else {
      const userRow = await pool.query('SELECT plan FROM users WHERE email=$1', [artisanEmail]);
      const plan = (userRow.rows[0]?.plan || 'gratuit').toLowerCase();
      if (plan === 'starter') {
        const countRes = await pool.query(
          "SELECT COUNT(*) AS count FROM factures WHERE artisan_email=$1 AND created_at >= date_trunc('month', NOW())",
          [artisanEmail]
        );
        if (parseInt(countRes.rows[0].count) >= 10) {
          return res.status(403).json({ error: 'Limite de 10 factures/mois atteinte sur le plan Pro.', code: 'QUOTA_EXCEEDED' });
        }
      }
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

router.get('/factures/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM factures WHERE id=$1 AND artisan_email=$2', [req.params.id, req.user.email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/factures/:id/statut', async (req, res) => {
  const { statut } = req.body;
  const statuts = ['non_envoyee', 'envoyee', 'en_attente', 'payee'];
  if (!statuts.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
  const email = req.user.email;
  try {
    const result = await pool.query(
      'UPDATE factures SET statut=$2, updated_at=NOW() WHERE id=$1 AND artisan_email=$3 RETURNING *',
      [req.params.id, statut, email]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    res.json({ success: true, statut: result.rows[0].statut });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/factures', async (req, res) => {
  const email = req.user.email;
  try {
    const result = await pool.query(
      'SELECT id, devis_id, client_nom, numero, statut, libelle, created_at FROM factures WHERE artisan_email=$1 ORDER BY created_at DESC',
      [email]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
