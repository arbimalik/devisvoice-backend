const { Pool } = require('pg');

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

pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMP
`).then(() => console.log('Colonnes Stripe users OK'))
  .catch(err => console.error('Migration Stripe users:', err));

module.exports = pool;
