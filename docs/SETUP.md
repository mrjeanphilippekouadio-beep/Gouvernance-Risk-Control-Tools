# Configuration de l'infrastructure — GRC Tools

Ce guide couvre les 3 comptes/services externes nécessaires pour faire
tourner le backend pour de vrai. Aucun ne peut être créé à votre place —
chacun nécessite une connexion avec vos identifiants. Une fois faits,
tout le reste (migrations, démarrage) est déjà scripté.

## 1. Neon (PostgreSQL)

1. Créer un compte sur [neon.tech](https://neon.tech) (le plan gratuit
   suffit pour démarrer).
2. Créer un projet, puis une branche dédiée au développement (`dev`) —
   ne travaillez pas directement sur `main`, c'est tout l'intérêt de
   Neon : vous pourrez réinitialiser `dev` sans toucher aux données de
   référence plus tard.
3. Copier la **connection string** (Dashboard > Connection Details),
   qui ressemble à :
   ```
   postgresql://<user>:<password>@<host>.neon.tech/<db>?sslmode=require
   ```
4. La coller dans `backend/.env` (copié depuis `.env.example`) sous
   `DATABASE_URL`.

## 2. Google Cloud — Client OAuth (Identity Platform / Workspace SSO)

1. Aller sur [console.cloud.google.com](https://console.cloud.google.com),
   créer un projet (ou réutiliser un projet Djamo existant).
2. **APIs & Services > OAuth consent screen** : configurer l'écran de
   consentement (type interne si le domaine Djamo est un Google
   Workspace, sinon externe).
3. **APIs & Services > Credentials > Create Credentials > OAuth client ID** :
   - Type d'application : **Web application**
   - Origines JavaScript autorisées : `http://localhost:5173` (dev),
     puis l'URL de prod du frontend une fois déployée
   - Pas besoin de "Redirect URI" pour Google Identity Services (le flux
     utilisé ici est le bouton "Sign in with Google" qui renvoie
     directement un ID token, pas un redirect OAuth classique)
4. Copier le **Client ID** généré (`....apps.googleusercontent.com`) :
   - dans `backend/.env` sous `GOOGLE_OAUTH_CLIENT_ID`
   - dans `frontend/.env.local` sous `VITE_GOOGLE_CLIENT_ID`

## 3. Google Drive — Service Account (stockage des preuves)

1. Dans le même projet Google Cloud : **APIs & Services > Library**,
   activer **Google Drive API**.
2. **APIs & Services > Credentials > Create Credentials > Service Account**.
   Pas besoin de rôle IAM particulier au niveau projet — l'accès se fait
   au niveau du Drive partagé (étape suivante).
3. Sur le compte de service créé, onglet **Keys > Add Key > Create new
   key > JSON** : télécharge un fichier JSON. **Ne jamais le committer.**
   Le placer par exemple dans `backend/secrets/drive-service-account.json`
   (`secrets/` est déjà dans le `.gitignore` racine — vérifier quand même
   `git status` avant de committer quoi que ce soit à côté, par prudence).
4. Créer un **Drive partagé** (Shared Drive) dans Google Workspace pour
   Djamo, et y ajouter l'adresse e-mail du compte de service
   (`....gserviceaccount.com`, visible dans le fichier JSON ou la
   console) comme **Gestionnaire de contenu**.
5. Noter l'ID du dossier racine de ce Drive partagé (dans l'URL Drive :
   `https://drive.google.com/drive/folders/<CET_ID>`).
6. Dans `backend/.env`, `GOOGLE_DRIVE_CREDENTIALS_PATH` pointe vers le
   fichier JSON de l'étape 3.
7. Une fois la base Neon migrée (section suivante), renseigner cet ID de
   dossier sur le tenant :
   ```sql
   UPDATE tenants SET drive_folder_id = '<CET_ID>' WHERE id = '<tenant_id>';
   ```

## 4. Tout assembler

```bash
cd backend
cp .env.example .env
# remplir DATABASE_URL, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_CREDENTIALS_PATH
npm install
npm run migrate
# charger le tenant/utilisateur de démo, ou créer les vôtres :
psql "$DATABASE_URL" -f ../database/postgresql/seed/dev_seed.sql
npm run dev
```

```bash
cd frontend
cp .env.example .env.local
# remplir VITE_API_BASE_URL=http://localhost:8080, VITE_GOOGLE_CLIENT_ID
npm install
npm run dev
```

Ouvrir `http://localhost:5173` : le bouton "Sign in with Google" doit
apparaître (au lieu du repli dev). Se connecter avec un compte dont
l'email correspond à un utilisateur créé dans `users` (le seed dev crée
`dev@example.com` — pas un vrai compte Google, donc remplacez-le par une
vraie adresse Djamo avant de tester la connexion réelle).

## Ce qui n'est pas encore fait

- Rôle Postgres dédié avec privilèges restreints (pas de `UPDATE`/`DELETE`
  sur `audit_log`) — voir l'item ouvert dans `database/README.md`.
- Pas de script automatisé pour ces étapes (volontairement — voir
  ADR-001 §8.14, la génération de scripts d'installation vérifie la
  sécurité de la config avant de s'exécuter, ce qui n'est pas encore
  construit).
