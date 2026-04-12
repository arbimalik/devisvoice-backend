# CLAUDE.md — DevisVoice Backend

> Ce fichier est la source de vérité pour toute session de travail avec Claude Code sur ce projet.
> Lis-le en entier avant d'écrire la moindre ligne de code.

---

## Contexte du projet

**DevisVoice** est une application web qui permet à des artisans de créer, envoyer et faire signer des devis par commande vocale ou saisie manuelle, alimentée par l'IA (Claude d'Anthropic).

Ce dépôt est le **backend** de l'application. Il expose une API REST consommée par un frontend séparé (non présent dans ce repo).

- **Domaine email** : `devisvoice.fr`
- **Email d'envoi** : `devis@devisvoice.fr`
- **Provider email** : Resend (`api.resend.com`)
- **IA** : Claude (Anthropic) via proxy `/api/claude`

---

## Stack technique

| Composant     | Technologie                     |
|---------------|---------------------------------|
| Runtime       | Node.js                         |
| Framework     | Express 4                       |
| Base de données | PostgreSQL (via `pg` + pool)  |
| ORM           | Aucun — SQL brut                |
| Email         | Resend API (fetch natif)        |
| IA            | Anthropic Claude API (proxy)    |
| Déploiement   | Variable `PORT` + `DATABASE_URL` (Railway ou similaire) |

### Dépendances (`package.json`)
```
express ^4.18.2
cors    ^2.8.5
pg      ^8.11.3
```

### Variables d'environnement requises
```
DATABASE_URL       — Connexion PostgreSQL (avec SSL)
RESEND_API_KEY     — Clé API Resend pour l'envoi d'emails
ANTHROPIC_API_KEY  — Clé API Anthropic / Claude
PORT               — Port d'écoute (défaut : 8080)
```

### Variables d'environnement à venir (V2/V3)
```
STRIPE_SECRET_KEY      — Clé secrète Stripe (paiements, séquestre via Stripe Connect)
STRIPE_WEBHOOK_SECRET  — Secret webhook Stripe pour valider les événements entrants
SUPABASE_URL           — URL du projet Supabase (si migration vers Supabase)
SUPABASE_SERVICE_KEY   — Clé service Supabase (accès admin, côté backend uniquement)
```

> Ces clés ne sont pas encore utilisées dans le code. Les ajouter aux variables Railway et au `.env` local dès qu'elles sont disponibles.

---

## Architecture du projet

```
devisvoice-backend/
├── server.js        — Point d'entrée unique. Contient toute la logique.
├── package.json     — Dépendances et script de démarrage
└── CLAUDE.md        — Ce fichier
```

Le projet est **intentionnellement monolithique** : tout le code est dans `server.js`. Ne pas fragmenter en modules sauf si explicitement demandé.

---

## Base de données

### Table `devis`

```sql
CREATE TABLE IF NOT EXISTS devis (
  id            VARCHAR(50) PRIMARY KEY,
  data          JSONB NOT NULL,          -- Tout le contenu du devis (lignes, totaux, client, etc.)
  artisan_email VARCHAR(255),
  client_email  VARCHAR(255),
  artisan_nom   VARCHAR(255),
  accepted      BOOLEAN DEFAULT FALSE,
  accepted_by   VARCHAR(255),           -- Nom du client signataire
  accepted_at   TIMESTAMP,
  signature     TEXT,                   -- Signature en base64 (canvas PNG)
  created_at    TIMESTAMP DEFAULT NOW()
);
```

**Champ `data` (JSONB)** — Structure attendue (déduite des requêtes stats) :
```json
{
  "total_ttc": "1234.56",
  "client": {
    "nom": "Dupont Marie"
  }
}
```

**Migrations** : gérées au démarrage via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Pas d'outil de migration externe.

---

## API — Routes existantes

### `POST /api/claude`
Proxy transparent vers l'API Anthropic. Le frontend envoie `{ payload: { ...anthropicPayload } }`.

### `POST /api/send-devis`
Envoie le devis PDF/HTML au client par email.
```json
{ "artisanNom": "", "artisanEmail": "", "clientEmail": "", "subject": "", "html": "" }
```

### `POST /api/send-acceptation`
Envoie deux emails à l'acceptation du devis : un à l'artisan, un au client.
```json
{ "artisanNom": "", "artisanEmail": "", "clientEmail": "", "clientNom": "", "numero": "", "montant": "", "sigB64": "", "today": "" }
```
- `sigB64` : image PNG en base64 de la signature manuscrite (optionnel)

### `POST /api/devis/save`
Sauvegarde ou met à jour un devis (upsert sur `id`).
```json
{ "id": "", "data": {}, "artisanEmail": "", "artisanNom": "", "clientEmail": "" }
```

### `GET /api/devis/:id`
Récupère un devis complet par son identifiant.

### `POST /api/factures/save`
Crée ou met à jour une facture (upsert sur `id`). Accepte des `lignes` JSONB pour libellés personnalisés indépendants du devis.
```json
{ "id": "", "devisId": "", "artisanEmail": "", "clientNom": "", "numero": "", "lignes": [] }
```

### `GET /api/factures/:id`
Récupère une facture complète par son identifiant.

### `PATCH /api/factures/:id/statut`
Met à jour le statut d'une facture. Valeurs acceptées : `non_envoyee`, `envoyee`, `payee`.
```json
{ "statut": "payee" }
```

### `GET /api/factures?email=xxx`
Liste toutes les factures d'un artisan, triées par date décroissante.

### `GET /api/siret/:siret`
Recherche une entreprise par son numéro SIRET via l'API publique du service public français (sans clé API).
Valide le format 14 chiffres. Retourne les infos prêtes à pré-remplir le formulaire client.
```json
{ "siret": "", "siren": "", "nom": "", "adresse": "", "code_postal": "", "ville": "", "activite": "" }
```

### `POST /api/devis/accept`
Marque un devis comme accepté. Idempotent protégé : retourne `409` si déjà accepté.
```json
{ "id": "", "acceptedBy": "", "acceptedAt": "", "signature": "" }
```

### `GET /api/stats?email=xxx`
Statistiques mensuelles pour le tableau de bord artisan.
```json
{
  "total_mois": 12,
  "acceptes_mois": 5,
  "montant_mois": 8750.00,
  "derniers": [...]
}
```

---

## Helper email centralisé

```js
sendEmail({ artisanNom, artisanEmail, to, subject, html })
```
- Expéditeur affiché : `"${artisanNom} via DevisVoice" <devis@devisvoice.fr>`
- `reply_to` : email de l'artisan (ou `contact@devisvoice.fr`)
- Toujours utiliser ce helper, jamais appeler Resend directement

---

## Règles de travail

1. **Langue** : tout le code, les commentaires, les messages d'erreur et les logs sont en français ou anglais technique standard. Les réponses de Claude sont en français.

2. **Fichier unique** : tout le code reste dans `server.js` sauf instruction contraire explicite. Pas de dossiers `routes/`, `controllers/`, `models/` sans demande.

3. **SQL brut** : pas d'ORM (Sequelize, Prisma, etc.). Utiliser `pool.query()` directement.

4. **Migrations au démarrage** : les évolutions de schéma se font avec `ADD COLUMN IF NOT EXISTS` au boot du serveur, dans le bloc d'initialisation existant.

5. **Pas d'auth pour l'instant** : l'artisan est identifié uniquement par son email. Ne pas ajouter de JWT, sessions ou OAuth sans demande explicite.

6. **Emails via `sendEmail()`** : toujours passer par le helper centralisé, ne jamais appeler `fetch('https://api.resend.com/...')` directement ailleurs.

7. **Pas de breaking changes silencieux** : toute modification de la structure de la table `devis` ou du format des réponses API doit être signalée explicitement avant implémentation.

8. **Gestion d'erreurs** : chaque route doit avoir un `try/catch` qui retourne `res.status(500).json({ error: err.message })`.

9. **Sécurité** : ne jamais exposer `DATABASE_URL`, `RESEND_API_KEY` ou `ANTHROPIC_API_KEY` dans les réponses API. Ne jamais construire des requêtes SQL avec des interpolations de chaîne (`${}`) — toujours utiliser les paramètres positionnels (`$1, $2...`).

10. **Tests** : pas de suite de tests automatisés pour l'instant. Tester manuellement via curl ou Postman avant de déclarer une fonctionnalité terminée.

---

## Roadmap

### V1 — En cours

- [x] Couleur des en-têtes de devis liée au thème de l'artisan — `getAccentColor()` + `applyThemeToCSS()` dans `devis-pdf.html`, 4 thèmes (orange clair/foncé, bleu, vert)
- [x] Recherche client par SIRET via l'API du service public français — `GET /api/siret/:siret`
- [x] Module factures : libellés personnalisés + nom client — table `factures` + 4 routes
- [ ] Nom de domaine propre par artisan
- [ ] Publication App Store (iOS)

### V2 — Planifiée

- [ ] Onglet "Chantier en cours" avec validation de fin de chantier et envoi automatique de la facture au client et au comptable
- [ ] Zone texte dictée à la voix pour les impératifs / remarques du chantier
- [ ] Suivi des factures : statut payée ou en attente
- [ ] Champ email comptable dans le profil artisan
- [ ] IA qui mémorise les modifications de l'artisan (préférences, formulations, habitudes)
- [ ] Mémoire client : retrouver un client par nom ou SIRET (approche décidée : table `clients` PostgreSQL liée à `artisan_email`, routes `POST /api/clients/save` + `GET /api/clients/search?email=&q=`, autocomplétion frontend sur nom et SIRET dès les premiers caractères)
- [ ] Site web public avec espace client authentifié et dashboard personnel

### V3 — Vision long terme

- [ ] Dashboard admin interne : ventes, suivi des bugs, suivi des clients
- [ ] Extension multi-secteurs : onboarding guidé et bibliothèque de prestations dynamique par métier
- [ ] Séquestre de paiement via Stripe Connect
- [ ] Photos d'avancement de chantier (upload et suivi)
- [ ] Portail client complet (accès historique devis/factures, messagerie, suivi chantier)

---

## Hébergement site web

### Architecture finale de déploiement

| URL | Contenu | Hébergement |
|-----|---------|-------------|
| `devisvoice.fr` | Site marketing + espace client authentifié | Vercel |
| `api.devisvoice.fr` | Backend `server.js` | Railway |
| PWA app artisan | Application artisan (actuelle) | GitHub Pages |

### Vercel — Site web
- Stack : **React + TypeScript + Tailwind CSS + shadcn**
- Déploiement automatique depuis GitHub à chaque push sur `main`
- Variables d'environnement Vercel pointent vers le backend Railway (`api.devisvoice.fr`)
- Domaine cible : `devisvoice.fr`

### Railway — Backend
- Expose l'API REST sur `api.devisvoice.fr`
- Base de données PostgreSQL hébergée sur Railway
- Variables d'environnement : `DATABASE_URL`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`

---

## Extension multi-métiers

L'app est actuellement **limitée au BTP** avec 13 corps de métier. L'objectif V3 est d'étendre à tous les secteurs avec des bibliothèques hardcodées complètes.

### Architecture prévue

- **Onboarding** : l'utilisateur choisit son secteur principal puis coche un ou plusieurs métiers
- **Bibliothèque dynamique** : les prestations se construisent selon les métiers cochés
- **Contexte IA** : les métiers sélectionnés sont injectés dans le prompt Claude
- **Personnalisation** : l'artisan peut modifier les prix par défaut et ajouter ses propres prestations
- **Hardcoding** : chaque métier a sa bibliothèque complète avec prestations, unités et prix unitaires réalistes

### Secteurs à hardcoder

| # | Secteur |
|---|---------|
| 1 | Événementiel |
| 2 | Bien-être |
| 3 | Auto |
| 4 | Paysagisme |
| 5 | Nettoyage |
| 6 | Déménagement |
| 7 | Informatique |
| 8 | Restauration |
| 9 | Photographie |
| 10 | Coiffure |
| 11 | Esthétique |
| 12 | Architecture d'intérieur |
| 13 | Sécurité |
| 14 | Transport |

### État actuel
- BTP : 13 corps de métier — **hardcodé, opérationnel**
- Autres secteurs : **à implémenter (V3)**

---

## Publication App & Paiements

### Publication App Store & Google Play

| Élément | Choix |
|---------|-------|
| Outil de packaging | **Capacitor** (pas PWABuilder) |
| iOS | App Store via Xcode |
| Android | Google Play via Android Studio |

Capacitor transforme la PWA existante en app native iOS et Android sans réécrire le code. Le micro et Web Audio API fonctionnent nativement via Capacitor.

**Fonctionnalités natives à activer via Capacitor :**
- Microphone — déjà fonctionnel dans la PWA, natif via plugin Capacitor
- Notifications push — V2
- Caméra pour photos chantier — V3

---

### Authentification

- **Provider** : NextAuth.js avec OAuth
- **Méthodes** : connexion Google, Apple, Facebook
- **Emplacement** : pages inscription et login à créer sur le site Vercel (`devisvoice.fr`)

---

### Paiement — Abonnements Artisans

Provider : **Stripe Subscriptions**

| Plan | Prix mensuel |
|------|-------------|
| Solo | 29 € / mois |
| Équipe | 49 € / mois |
| Pro | 79 € / mois |

Stripe gère automatiquement : renouvellements, annulations, relances en cas d'échec de paiement.

---

### Paiement — Client Final via l'App

- **Provider** : **Stripe Connect**
- Le client de l'artisan paie sa facture directement par CB dans l'app
- L'argent va directement sur le compte bancaire de l'artisan (Stripe Connect Express)
- DevisVoice ne touche jamais les fonds — modèle marketplace transparent

---

### Commission DevisVoice sur les Paiements Clients

| Phase | Seuil | Commission DevisVoice | Frais Stripe seuls |
|-------|-------|-----------------------|--------------------|
| **Phase 1** — Lancement | 0 à 300 abonnés | **0%** | 1,4% + 0,25 € (carte européenne) |
| **Phase 2** — Croissance | 300 abonnés et plus | **0,5% par transaction** | 1,4% + 0,25 € |

> **Argument commercial fort (Phase 1)** : zéro commission DevisVoice sur les paiements clients. L'artisan ne paie que les frais Stripe standard.
> Le passage en Phase 2 se fait avec un **préavis de 30 jours** notifié à tous les utilisateurs actifs.

---

## Pages d'Authentification

### Page d'Accueil / Login (site Vercel + app Capacitor)

Première page que voit l'artisan au lancement de l'app et sur le site.

**Design :**
- Logo DevisVoice centré
- Fond sombre, thème Nuit/Orange par défaut
- Épuré — aucun élément superflu

**Connexion sociale (prioritaire) :**
- Continuer avec Google
- Continuer avec Apple
- Continuer avec Facebook

**Email / mot de passe** — option secondaire, en bas de page

**Redirections après connexion :**
- Nouveau compte → onboarding (choix secteur + métiers)
- Compte existant → dashboard directement

---

### Onboarding Nouvel Artisan (après première connexion)

Flux en 4 étapes linéaires, une étape par écran :

| Étape | Contenu |
|-------|---------|
| **1 — Secteur** | Choix du secteur principal (BTP, Événementiel, Bien-être, Auto, etc.) |
| **2 — Métiers** | Multi-sélection des métiers dans ce secteur |
| **3 — Profil** | Nom entreprise, SIRET, téléphone, logo |
| **4 — Abonnement** | Choix du plan Solo / Équipe / Pro + paiement Stripe |

**Après onboarding :** accès direct à l'app avec la bibliothèque de prestations prête selon les métiers choisis. Aucune configuration supplémentaire requise.

---

## Sécurité

### Ce qui est déjà en place

- HTTPS partout — GitHub Pages, Railway, Vercel
- Variables d'environnement sur Railway — clés API jamais dans le code
- Requêtes SQL paramétrées — pas d'injection SQL possible
- PostgreSQL avec SSL activé

### Authentification

- JWT avec expiration courte + refresh tokens sécurisés
- OAuth Google / Apple / Facebook via NextAuth.js — aucun mot de passe stocké côté DevisVoice
- Sessions invalidées côté serveur à la déconnexion

### Isolation des Données

- Chaque artisan ne voit que ses propres données — filtrage strict par `user_id` sur **toutes** les routes API
- Chiffrement des données sensibles en base : IBAN, SIRET
- Aucune donnée client exposée dans les URLs

### Protection de l'API

- Rate limiting sur toutes les routes — bloquer force brute et spam
- CORS configuré strictement — uniquement les domaines autorisés
- Validation et sanitisation de toutes les entrées utilisateur
- Headers de sécurité HTTP via `helmet.js`

### Paiements

- Stripe gère tout le chiffrement CB — jamais de numéro de carte stocké chez DevisVoice
- Conformité PCI DSS assurée automatiquement par Stripe
- Stripe Connect avec vérification d'identité artisan (KYC obligatoire)

### RGPD

- Politique de confidentialité obligatoire pour App Store et Google Play
- Consentement cookies sur le site Vercel
- Droit à l'effacement des données implémenté (suppression compte + données associées)
- Données hébergées en Europe — Railway région Europe

### Règle Absolue

> Ne **jamais** exposer dans le code, les logs ou les réponses API :
> `DATABASE_URL` · `RESEND_API_KEY` · `ANTHROPIC_API_KEY` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `SUPABASE_SERVICE_KEY`

---

## Inspiration Design & Composants UI

> Détail complet dans `inspiration/composants-ui.md`

Le **site web** (distinct de l'app artisan) sera construit en **React + Tailwind CSS + TypeScript + shadcn**.

### Composants clés
| Composant | Librairie | Usage |
|---|---|---|
| `SplineScene` | `@splinetool/react-spline` | Scène 3D interactive — hero du site |
| `ContainerScroll` | `framer-motion` | Mockup téléphone incliné en 3D au scroll |
| `VoicePoweredOrb` | `ogl` (WebGL) | Orbe vocal temps réel — remplace le bouton micro |
| `LiquidGlassButton` | `@radix-ui/react-slot` | Boutons CTA effet verre liquide |

### Direction design
- Interface **premium et moderne**
- 3D **purposeful** : montre le produit, ne décore pas
- Mockup iPhone 3D sur le hero
- L'orbe vocal est l'**élément signature** de DevisVoice

### npm à installer sur le site
```
@splinetool/runtime @splinetool/react-spline framer-motion ogl @radix-ui/react-slot class-variance-authority
```

---

## Notes de déploiement

- Le serveur démarre avec `node server.js` (`npm start`)
- Le port est défini par `process.env.PORT` (défaut `8080`)
- La connexion PostgreSQL requiert SSL (`rejectUnauthorized: false`)
- Aucun `.env` local n'est commité — les variables sont injectées par la plateforme de déploiement
