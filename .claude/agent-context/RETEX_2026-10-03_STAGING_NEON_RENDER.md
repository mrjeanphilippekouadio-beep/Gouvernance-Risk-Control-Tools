# RETEX — Staging Neon / Render / contexte agents — 2026-10-03

## 1. Objet

Ce RETEX conserve le contexte technique de la transition vers l'environnement **STAGING** de GRC Tools. Il doit être lu par les agents Claude/Codex/agents spécialisés avant toute intervention sur Neon, Render, QA/TestSprite, API ou WebSocket.

---

## 2. État de référence

- Dépôt : `mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools`
- Frontend : React + TypeScript + Vite, workspace npm, design system atomique `@djamo/design-system`.
- Backend : TypeScript + Node.js + Express, Docker.
- Base : PostgreSQL sur Neon.
- Cible : Frontend → Cloudflare → Render Backend → Neon PostgreSQL.
- WebSocket : couche ultérieure, déjà cadrée par le PRD realtime ; PostgreSQL reste la source de vérité.
- Échelle cible : environ 100 utilisateurs simultanés.
- Auth normale : Google SSO.
- QA staging : authentification locale dédiée pour TestSprite, sans réutiliser de compte Google personnel/professionnel.

---

## 3. Décision d'environnement

### Neon

Deux projets existent :

1. **GRT Tools NEON**
   - projet de référence/production ;
   - ne pas modifier pendant les opérations staging sans autorisation explicite.

2. **grc-staging**
   - environnement staging ;
   - utilisé pour les migrations, tests d'intégration et E2E.

La base `grc-staging` a été reconstruite à partir des **43 migrations GitHub** et validée avec :

- 43 entrées dans `schema_migrations` ;
- 41 tables publiques ;
- `grc_app_runtime` présent ;
- `grc_migrator_runtime` présent.

Leçon importante : **le runner de migrations du dépôt est la source de vérité**. Ne pas réimplémenter durablement le moteur avec un parseur SQL maison. Les difficultés rencontrées (commentaires contenant des `;`, blocs `$$`, commandes multiples, migration partiellement appliquée) ont montré qu'un parseur naïf est dangereux.

---

## 4. Données staging

Un tenant staging `Djamo` a été créé.

Les comptes QA préparés dans staging sont :

- `charles.kouassi@djamo.io`
- `jean-philippe.kouadio@djamo.ci`
- `aboubacar.ouattara@djamo.io`
- `ibra.mbaye@djamo.io`
- `qagrctest@gmail.com`
- `khadim.dieng@djamo.io`
- `yves.kissi@djamo.io`
- `elfried.didehia@djamo.io`

Pour permettre la recette et le feedback, ils disposent actuellement des permissions fonctionnelles disponibles dans la référence staging. Cette décision est **spécifique au staging** et ne doit pas être copiée automatiquement en production : la production doit rester fondée sur des rôles explicites et le principe du moindre privilège.

---

## 5. Auth QA / TestSprite

L'authentification locale staging est destinée à la QA et à TestSprite.

### Configuration retenue

Backend Render STAGING :

```env
APP_ENV=staging
AUTH_PROVIDER=local
LOCAL_AUTH_USERS_JSON=<secret>
LOCAL_AUTH_TOKEN_SECRET=<secret>
LOCAL_AUTH_TOKEN_TTL_SECONDS=3600
CORS_ALLOWED_ORIGINS=<URL frontend staging>
```

Frontend Render STAGING :

```env
VITE_AUTH_PROVIDER=local
VITE_API_BASE_URL=<URL backend staging sans slash final>
```

Le fichier de configuration local accepte plusieurs comptes sous la forme :

```json
[
  {
    "email": "<email>",
    "passwordHash": "<scrypt hash>"
  }
]
```

Le mot de passe commun de recette est `grc_tools`. Il reste **strictement limité au staging**.

Le rôle, le tenant et les permissions ne sont jamais fournis par le navigateur : après authentification du compte, le backend résout l'appartenance et les permissions côté PostgreSQL.

**Point critique :** Render staging peut utiliser `NODE_ENV=production` pour exécuter le serveur. La protection contre l'auth locale doit donc dépendre de `APP_ENV=production`, et non de `NODE_ENV`.

TestSprite :

- uniquement staging ;
- aucun mot de passe Google, cookie Google, OTP Google ou token personnel ;
- aucune écriture de recette vers production ;
- aucune permission IAM privilégiée sans besoin de test explicite.

---

## 6. URLs et Render

Le frontend utilise déjà :

```ts
import.meta.env["VITE_API_BASE_URL"]
```

Donc les URLs d'environnement ne doivent pas être hardcodées dans le code applicatif.

### Convention

`VITE_API_BASE_URL` doit contenir l'URL backend **sans slash final**.

Backend staging :

```env
DATABASE_URL=<Neon grc-staging>
APP_ENV=staging
AUTH_PROVIDER=local
CORS_ALLOWED_ORIGINS=<URL frontend staging>
```

Frontend staging :

```env
VITE_API_BASE_URL=<URL backend Render staging sans slash final>
```

Un changement de `VITE_*` nécessite un nouveau build/redeploy du frontend Vite.

Avant TestSprite, vérifier :

1. `GET /health` → HTTP 200 ;
2. `GET /ready` → HTTP 200 et connexion PostgreSQL ;
3. frontend staging → backend staging ;
4. login QA ;
5. appels authentifiés ;
6. isolation staging/production.

---

## 7. PR et qualité

PR déjà fusionnées avant ce RETEX :

- #81 — correction du contexte de build Docker backend ;
- #82 — migrations PostgreSQL portables/reproductibles ;
- #83 — RETEX déploiement Render + Neon ;
- #84 — alignement build frontend Render/workspaces ;
- #85 — RETEX frontend Render/QA.

PR documentaire #87 :

- stratégie API/feedback/environnements ;
- contexte destiné aux agents ;
- séparation staging/production ;
- API backend comme autorité ;
- TestSprite/User Feedback ;
- backend WebSocket-ready.

PR #89 :

- authentification locale staging/TestSprite multi-comptes ;
- Google SSO conservé pour la production ;
- bearer token local signé et expirant ;
- résolution tenant/rôles/permissions côté PostgreSQL ;
- aucun tenant/rôle/permission accepté depuis le navigateur.

Un échec CI avait été rencontré sur la branche d'auth locale au `typecheck`. Les corrections ont porté notamment sur :

1. le narrowing TypeScript des éléments du hash scrypt ;
2. le remplacement de l'entrée de mot de passe par une lecture TTY non-échoïque ;
3. les usages de constructeur restants dans les tests.

---

## 8. WebSocket

Le WebSocket est une **couche finale**, après la stabilisation staging/QA.

Principes non négociables :

- PostgreSQL reste la source de vérité ;
- WebSocket ne décide jamais des permissions ;
- autorisation côté backend ;
- événements versionnés ;
- idempotence ;
- ordering ;
- reconnect/resync ;
- backpressure ;
- présence et notifications ;
- outbox/pubsub/workers si nécessaire ;
- pas de logique métier critique uniquement en mémoire WebSocket.

---

## 9. Séquence de travail restante

1. ~~Finaliser l'auth locale staging~~ — **fait, PR #89 mergée dans `staging`**.
2. ~~Configurer Render STAGING~~ — **fait**.
3. ~~Configurer les variables frontend/backend~~ — **fait**.
4. ~~Valider `/health` et la connexion backend~~ — **fait**.
5. ~~Valider frontend → backend → Neon staging~~ — **fait**.
6. **Configurer/valider Userback.**
7. **Exécuter TestSprite en staging.**
8. Corriger les régressions issues de QA/feedback.
9. Effectuer les contrôles techniques : corrélation/tracing, observabilité, indépendance, concurrence/idempotence, tenant isolation/RBAC, résilience, charge, sécurité.
10. Implémenter ensuite la couche WebSocket.

---

# 10. RETEX opérationnel — Auth locale multi-comptes et validation STAGING

**Date : 2026-10-03**  
**Périmètre :** Neon `grc-staging`, Render STAGING backend/frontend, authentification locale QA, validation multi-comptes.  
**Statut : VALIDÉ**

## 10.1 Actions réalisées

1. Création/maintien de la branche `staging` comme cible des évolutions STAGING.
2. Configuration du backend Render STAGING pour utiliser :
   - `APP_ENV=staging`
   - `AUTH_PROVIDER=local`
   - `LOCAL_AUTH_USERS_JSON`
   - `LOCAL_AUTH_TOKEN_SECRET`
   - TTL de token de 3600 secondes.
3. Configuration du frontend STAGING pour utiliser l'authentification locale et l'API backend STAGING.
4. Correction du garde-fou de sécurité DB : `APP_ENV` est utilisé pour déterminer si le contrôle de rôle PostgreSQL de production doit s'appliquer.
5. Ajout du compte `qagrctest@gmail.com` dans Neon STAGING ; les sept autres comptes QA étaient déjà présents.
6. Vérification que les huit comptes sont actifs dans le même tenant STAGING.
7. Remplacement de la configuration locale mono-compte par une configuration multi-comptes.
8. Régénération des hashes scrypt de recette pour le mot de passe commun `grc_tools`.
9. Déploiement du backend et du frontend STAGING.
10. Validation manuelle de la connexion avec plusieurs adresses email : **au moins trois comptes ont été testés avec succès**.
11. Validation de l'accès à l'application après authentification : session active, navigation et appels authentifiés fonctionnels.

## 10.2 Points bloquants rencontrés

### Blocage 1 — démarrage backend STAGING refusé par l'auth Google

**Symptôme :**

```
GOOGLE_OAUTH_CLIENT_ID is required when AUTH_PROVIDER=google
```

**Cause :**

Le backend STAGING était configuré en `AUTH_PROVIDER=google`, alors que STAGING doit utiliser l'authentification locale pour la QA/TestSprite.

### Blocage 2 — contrôle du rôle PostgreSQL appliqué à tort en STAGING

**Symptôme :**

Le backend refusait de démarrer avec :

```
Database security check failed for role "neondb_owner"
```

**Cause :**

Render exécute le conteneur avec `NODE_ENV=production`. Le serveur transmettait `NODE_ENV` au contrôle de sécurité PostgreSQL alors que la distinction environnementale réelle est portée par `APP_ENV`.

### Blocage 3 — 401 sur l'authentification locale

**Symptôme :**

```
401 Invalid local credentials
```

**Investigation :**

- vérification de la présence des comptes dans Neon STAGING ;
- constat que `qagrctest@gmail.com` était le seul compte manquant ;
- vérification de la configuration Render STAGING ;
- remplacement de la configuration de hashes par un JSON multi-comptes cohérent ;
- retest de plusieurs comptes.

**Résultat :** le 401 est résolu et l'authentification multi-comptes est validée.

## 10.3 Solutions appliquées

| Point | Solution |
|---|---|
| Auth staging | `AUTH_PROVIDER=local` |
| Environnement réel | utilisation de `APP_ENV`, pas de `NODE_ENV`, pour les garde-fous environnementaux |
| Comptes QA | `LOCAL_AUTH_USERS_JSON` multi-comptes |
| Mot de passe QA | `grc_tools`, staging uniquement |
| Hash | scrypt avec un hash distinct par compte |
| Rôles/permissions | résolus côté backend depuis PostgreSQL |
| Utilisateur manquant | ajout de `qagrctest@gmail.com` dans Neon STAGING |
| Frontend | `VITE_AUTH_PROVIDER=local` + API STAGING |
| Production | aucune modification de `GRT Tools NEON` ni de l'auth Google production |

## 10.4 Recommandations

1. **Ne plus utiliser un compte local unique** pour TestSprite : conserver `LOCAL_AUTH_USERS_JSON` pour les scénarios multi-rôles.
2. **Ne jamais mettre les rôles ou permissions dans `LOCAL_AUTH_USERS_JSON`**. Les credentials authentifient un email ; l'autorisation reste déterminée par le backend et PostgreSQL.
3. **Ne jamais modifier Neon production pour résoudre un problème STAGING.**
4. Maintenir `grc_tools` exclusivement comme secret de recette STAGING ; ne jamais le réutiliser en production.
5. Avant chaque campagne QA, vérifier :
   - présence du compte dans Neon STAGING ;
   - présence du compte dans `LOCAL_AUTH_USERS_JSON` ;
   - hash correspondant au mot de passe de recette ;
   - membership actif ;
   - rôle/permissions attendus.
6. Pour toute nouvelle variable `VITE_*`, prévoir explicitement le redeploy du frontend Vite.
7. Pour toute nouvelle évolution d'environnement, mettre à jour le RETEX dans la même PR ou dans une PR documentaire immédiatement associée.

## 10.5 Essentiel à retenir

> **L'authentification locale STAGING est une couche de credentials de test, pas une source de rôles ou de permissions.**

Le flux de référence est :

```
Frontend STAGING
      ↓
email + mot de passe
      ↓
LOCAL_AUTH_USERS_JSON
      ↓
authentification locale
      ↓
lookupMembership(email)
      ↓
Neon grc-staging
      ↓
tenant + rôles + permissions
      ↓
session Bearer
```

Les environnements doivent rester strictement séparés :

```
STAGING
  ├── Render STAGING
  ├── Neon grc-staging
  ├── Auth locale
  └── TestSprite / QA

PRODUCTION
  ├── Render PROD
  ├── GRT Tools NEON
  └── Google SSO
```

---

# 11. Nouveau format standard des RETEX

À partir de ce RETEX, les nouveaux retours d'expérience opérationnels doivent suivre ce format minimal et déterministe :

1. **Contexte / périmètre**
2. **Statut de validation**
3. **Actions réalisées**
4. **Points bloquants / symptômes**
5. **Cause**
6. **Solutions appliquées**
7. **Résultat / validation**
8. **Recommandations**
9. **Essentiel à retenir**
10. **Impact sur la suite / prochaines étapes**

Règles :

- distinguer systématiquement **symptôme**, **cause** et **solution** ;
- indiquer explicitement ce qui a été réellement testé ;
- ne jamais déclarer une validation non exécutée ;
- documenter les décisions qui deviennent des règles pour les agents ;
- ne jamais écrire de secret, mot de passe, token ou valeur sensible dans le RETEX ;
- associer le RETEX à la branche/environnement concerné ;
- pour les travaux STAGING, le RETEX doit être intégré dans `staging` avant de considérer l'étape comme documentée.

---

## 12. Règles pour les agents

Avant toute modification :

- lire `CLAUDE.md` ;
- lire `.claude/agent-context/README.md` ;
- consulter `SHARED_LOG.md` et `ACTION_ITEMS.md` ;
- vérifier les PR/branches récentes ;
- ne pas supposer que staging et production sont interchangeables ;
- ne jamais exposer ou committer de secrets ;
- ne pas modifier Neon production pour résoudre un problème staging ;
- ne pas utiliser RACI comme source d'autorisation ;
- ne pas déplacer la source de vérité métier dans WebSocket ;
- conserver les décisions et findings dans le contexte agent ;
- appliquer le nouveau format RETEX à toute nouvelle étape significative.

---

## 13. Leçon principale

La transition a confirmé une règle de gouvernance technique : **les décisions d'environnement, les migrations, les garde-fous de sécurité et les résultats de QA doivent être documentés dans GitHub, dans le contexte inter-agents, et non rester uniquement dans une conversation humaine.**

Le dépôt doit donc être considéré comme une mémoire opérationnelle du projet : code + ADR/PRD + RETEX + `.claude/agent-context` + historique PR/CI.
