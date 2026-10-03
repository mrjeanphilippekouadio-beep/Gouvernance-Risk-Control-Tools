# RETEX — Staging Neon / Render / contexte agents — 2026-10-03

## 1. Objet

Ce RETEX conserve le contexte technique de la transition vers l'environnement **STAGING** de GRC Tools. Il doit être lu par les agents Claude/Codex/agents spécialisés avant toute intervention sur Neon, Render, QA/TestSprite, API ou WebSocket.

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

## 4. Données staging

Un tenant staging `Djamo` a été créé.

Sept utilisateurs ont été préparés dans staging :

- `charles.kouassi@djamo.io`
- `jean-philippe.kouadio@djamo.ci`
- `aboubacar.ouattara@djamo.io`
- `ibra.mbaye@djamo.io`
- `khadim.dieng@djamo.io`
- `yves.kissi@djamo.io`
- `elfried.didehia@djamo.io`

Pour permettre la recette et le feedback, ils disposent actuellement des permissions fonctionnelles disponibles dans la référence staging. Cette décision est **spécifique au staging** et ne doit pas être copiée automatiquement en production : la production doit rester fondée sur des rôles explicites et le principe du moindre privilège.

## 5. Auth QA / TestSprite

Le PRD d'authentification locale est porté par la PR #86.

Compte QA prévu :

- `qagrctest@gmail.com`
- staging uniquement.

Variables backend attendues :

```env
APP_ENV=staging
AUTH_PROVIDER=local
LOCAL_AUTH_EMAIL=qagrctest@gmail.com
LOCAL_AUTH_PASSWORD_HASH=<secret>
LOCAL_AUTH_TOKEN_SECRET=<secret>
LOCAL_AUTH_TOKEN_TTL_SECONDS=3600
```

Variables frontend :

```env
VITE_AUTH_PROVIDER=local
VITE_LOCAL_AUTH_EMAIL=qagrctest@gmail.com
```

**Point critique :** Render staging peut utiliser `NODE_ENV=production` pour exécuter le serveur. La protection contre l'auth locale doit donc dépendre de `APP_ENV=production`, et non de `NODE_ENV`.

Le script de hash du mot de passe doit lire le secret sans l'exposer dans les arguments du processus.

TestSprite :

- uniquement staging ;
- aucun mot de passe Google, cookie Google, OTP Google ou token personnel ;
- aucune écriture de recette vers production ;
- aucune permission IAM privilégiée sans besoin de test explicite.

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

PR #86 :

- authentification locale staging/TestSprite ;
- Google SSO conservé ;
- bearer token local signé et expirant ;
- résolution tenant/rôles/permissions côté PostgreSQL ;
- aucun tenant/rôle/permission accepté depuis le navigateur.

Un échec CI a été rencontré sur #86 au `typecheck`. Deux corrections ont été apportées sur la branche :

1. narrowing TypeScript des éléments du hash scrypt ;
2. remplacement de l'entrée de mot de passe par une lecture TTY non-échoïque.

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

## 9. Séquence de travail restante

1. Finaliser/merger l'auth locale staging (#86) après CI vert.
2. Configurer Render STAGING.
3. Configurer les variables frontend/backend.
4. Valider `/health` et `/ready`.
5. Valider frontend → backend → Neon staging.
6. Configurer/valider Userback.
7. Exécuter TestSprite en staging.
8. Corriger les régressions issues de QA/feedback.
9. Effectuer les contrôles techniques : corrélation/tracing, observabilité, indépendance, concurrence/idempotence, tenant isolation/RBAC, résilience, charge, sécurité.
10. Implémenter ensuite la couche WebSocket.

## 10. Règles pour les agents

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
- conserver les décisions et findings dans le contexte agent.

## 11. Leçon principale

La transition a confirmé une règle de gouvernance technique : **les décisions d'environnement, les migrations, les garde-fous de sécurité et les résultats de QA doivent être documentés dans GitHub, dans le contexte inter-agents, et non rester uniquement dans une conversation humaine.**

Le dépôt doit donc être considéré comme une mémoire opérationnelle du projet : code + ADR/PRD + RETEX + `.claude/agent-context` + historique PR/CI.
