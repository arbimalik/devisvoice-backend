const router = require('express').Router();
const pool = require('../db');

router.post('/clients/save', async (req, res) => {
  const { nom, email, telephone, siret, adresse, ville, codePostal } = req.body;
  const artisanEmail = req.user.email;
  if (!nom) return res.status(400).json({ error: 'nom requis' });
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

// Sans q : tous les clients triés par nom (menu déroulant au chargement)
// Avec q : filtre multi-champs (autocomplétion, max 10 résultats)
router.get('/clients', async (req, res) => {
  const email = req.user.email;
  try {
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

router.get('/siret/:siret', async (req, res) => {
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

module.exports = router;
