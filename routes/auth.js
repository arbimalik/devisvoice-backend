const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'devisvoice_secret_2026';
const { sendEmail } = require('../helpers/email');
const { buildEmailBienvenue } = require('../helpers/emailBienvenue');

router.post('/users/register', async (req, res) => {
  try {
    const { email, prenom, nom, entreprise, telephone, mot_de_passe, famille, metier, metiers, document_type, plaque, taux_journalier } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email requis' });

    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Un compte existe déjà avec cet email', code: 'EMAIL_EXISTS' });
    }

    const hash = mot_de_passe ? await bcrypt.hash(mot_de_passe, 10) : null;
    const tj = (taux_journalier === undefined || taux_journalier === null || taux_journalier === '') ? null : Number(taux_journalier);

    const result = await pool.query(
      `INSERT INTO users (email, prenom, nom, entreprise, telephone, mot_de_passe_hash, famille, metier, metiers, document_type, plaque, taux_journalier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, email, prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plaque, taux_journalier`,
      [email, prenom || null, nom || null, entreprise || null, telephone || null,
       hash, famille || null, metier || null, JSON.stringify(metiers || []), document_type || 'devis',
       plaque || null, tj]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '365d' });

    // Email de bienvenue — non-bloquant
    sendEmail({
      to: user.email,
      subject: 'Bienvenue sur DevisVoice 🎙️',
      html: buildEmailBienvenue(user.prenom)
    }).catch(() => {});

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

router.post('/users/login', async (req, res) => {
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

router.put('/users/account', async (req, res) => {
  try {
    const { prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plaque, taux_journalier } = req.body;
    const tj = (taux_journalier === undefined || taux_journalier === null || taux_journalier === '') ? null : Number(taux_journalier);
    const metiersJson = metiers !== undefined ? JSON.stringify(metiers) : null;
    const result = await pool.query(
      `UPDATE users
         SET prenom=COALESCE($2, prenom),
             nom=COALESCE($3, nom),
             entreprise=COALESCE($4, entreprise),
             telephone=COALESCE($5, telephone),
             famille=COALESCE($6, famille),
             metier=COALESCE($7, metier),
             metiers=COALESCE($8::jsonb, metiers),
             document_type=COALESCE($9, document_type),
             plaque=COALESCE($10, plaque),
             taux_journalier=COALESCE($11, taux_journalier),
             updated_at=NOW()
       WHERE id=$1
       RETURNING id, email, prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plaque, taux_journalier`,
      [req.user.userId,
       prenom || null, nom || null, entreprise || null, telephone || null,
       famille || null, metier || null, metiersJson,
       document_type || null, plaque || null, tj]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users/profile', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plan, plaque, taux_journalier, created_at FROM users WHERE id=$1',
      [req.user.userId]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, userId: decoded.userId, email: decoded.email });
  } catch {
    res.json({ valid: false });
  }
});

router.delete('/users/account', async (req, res) => {
  try {
    const email = req.user.email;

    await pool.query('DELETE FROM devis WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM bon_commande WHERE conducteur_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM factures WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM clients WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM artisan_prefs WHERE artisan_email=$1', [email]).catch(()=>{});
    await pool.query('DELETE FROM users WHERE id=$1', [req.user.userId]);

    res.json({ success:true });
  } catch (err) {
    res.status(500).json({ success:false, error: err.message });
  }
});

router.get('/users/export', async (req, res) => {
  try {
    const u = await pool.query(
      'SELECT id, email, prenom, nom, entreprise, telephone, famille, metier, metiers, document_type, plan, plaque, taux_journalier, created_at FROM users WHERE id=$1',
      [req.user.userId]
    );
    if (u.rows.length === 0) return res.status(404).json({ error:'Compte introuvable' });
    const user = u.rows[0];

    const devisRes = await pool.query(
      'SELECT id, created_at FROM devis WHERE artisan_email=$1 ORDER BY created_at DESC',
      [req.user.email]
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

router.get('/stats', async (req, res) => {
  const email = req.user.email;
  try {
    const debutMois = new Date();
    debutMois.setDate(1); debutMois.setHours(0,0,0,0);

    const debutPrecedent = new Date(debutMois);
    debutPrecedent.setMonth(debutPrecedent.getMonth() - 1);
    const finPrecedent = new Date(debutMois);

    const debutAnnee = new Date(debutMois.getFullYear(), 0, 1);

    const [totalMois, acceptesMois, totalPrecedent, acceptesPrecedent, facturesAttente, derniers, parMois] = await Promise.all([
      pool.query(
        "SELECT COUNT(*) as count FROM devis WHERE artisan_email=$1 AND created_at >= $2 AND statut != 'fusionné'",
        [email, debutMois]
      ),
      pool.query(
        "SELECT COUNT(*) as count, COALESCE(SUM((data->>'total_ttc')::numeric), 0) as montant FROM devis WHERE artisan_email=$1 AND accepted=TRUE AND accepted_at >= $2",
        [email, debutMois]
      ),
      pool.query(
        "SELECT COUNT(*) as count FROM devis WHERE artisan_email=$1 AND created_at >= $2 AND created_at < $3 AND statut != 'fusionné'",
        [email, debutPrecedent, finPrecedent]
      ),
      pool.query(
        "SELECT COUNT(*) as count, COALESCE(SUM((data->>'total_ttc')::numeric), 0) as montant FROM devis WHERE artisan_email=$1 AND accepted=TRUE AND accepted_at >= $2 AND accepted_at < $3",
        [email, debutPrecedent, finPrecedent]
      ),
      pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM((d.data->>'total_ttc')::numeric), 0) as montant
         FROM factures f
         JOIN devis d ON f.devis_id = d.id
         WHERE f.artisan_email=$1 AND f.statut != 'payee'`,
        [email]
      ),
      pool.query(
        "SELECT id, data->>'total_ttc' as montant, data->'client'->>'nom' as client, accepted, created_at FROM devis WHERE artisan_email=$1 ORDER BY created_at DESC LIMIT 5",
        [email]
      ),
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

module.exports = router;
