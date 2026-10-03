# QA TestSprite — authentification locale de staging

## Objectif

Permettre à TestSprite et aux autres agents QA d'exécuter des parcours E2E authentifiés sans réutiliser un compte Google personnel/professionnel et sans contourner le contrôle d'accès de l'application.

Le compte de test retenu pour cette stratégie est :

- **Email QA : `qagrctest@gmail.com`**
- **Environnement : staging uniquement**
- **Provider temporaire : `local`**
- **Provider normal : `google`**

## Décision

Le SSO Google reste l'authentification normale de GRC Tools.

Pour la recette automatisée, le backend accepte temporairement un provider local lorsqu'il est explicitement configuré :

`AUTH_PROVIDER=local`

Cette configuration est interdite lorsque `NODE_ENV=production`. Le code refuse donc de démarrer une production avec l'authentification locale.

Le provider local :

1. authentifie l'adresse QA et son mot de passe ;
2. émet un bearer token signé de courte durée ;
3. résout ensuite l'utilisateur, le tenant et les permissions depuis PostgreSQL ;
4. ne fait jamais confiance à un tenant, rôle ou permission fourni par le navigateur.

## Configuration staging

Backend :

```env
AUTH_PROVIDER=local
LOCAL_AUTH_EMAIL=qagrctest@gmail.com
LOCAL_AUTH_PASSWORD_HASH=<secret>
LOCAL_AUTH_TOKEN_SECRET=<random-secret-at-least-32-characters>
LOCAL_AUTH_TOKEN_TTL_SECONDS=3600
```

Frontend :

```env
VITE_AUTH_PROVIDER=local
VITE_LOCAL_AUTH_EMAIL=qagrctest@gmail.com
```

Les valeurs secrètes ne doivent jamais être commit dans GitHub.

Pour produire un hash de mot de passe local :

```bash
npm run auth:hash-password -- <password>
```

Puis placer uniquement le hash obtenu dans le secret de déploiement `LOCAL_AUTH_PASSWORD_HASH`.

## Compte dans la base

L'adresse `qagrctest@gmail.com` doit également correspondre à une ligne active dans `users`, avec le tenant et les rôles/permissions de QA souhaités.

Le provider local ne crée pas automatiquement un utilisateur et ne permet pas de choisir un tenant depuis l'interface.

## TestSprite

Le parcours attendu devient :

1. TestSprite ouvre GRC Tools staging.
2. Il utilise l'écran de connexion local.
3. Il fournit `qagrctest@gmail.com` et le secret QA configuré dans l'environnement de test.
4. L'application obtient un bearer token.
5. TestSprite exécute les parcours UI/API autorisés par le rôle QA.
6. Les données créées pendant la recette restent dans staging.

Aucun mot de passe Google, cookie Google, OTP Google ou token personnel ne doit être fourni à TestSprite, Claude, Codex ou au dépôt.

## Retour au SSO

Après la campagne QA :

```env
AUTH_PROVIDER=google
```

et le frontend :

```env
VITE_AUTH_PROVIDER=google
```

Le SSO Google redevient le seul parcours utilisateur normal.

Le compte local peut rester présent dans la base mais être désactivé, ou être conservé uniquement comme identité QA de staging selon la politique retenue.

## Garde-fous

- Le provider local est **staging/test uniquement**.
- Il est explicitement bloqué en `NODE_ENV=production`.
- Le secret de token doit comporter au minimum 32 caractères.
- Le mot de passe n'est jamais stocké en clair dans le dépôt.
- Le token local expire.
- Les rôles et permissions restent résolus côté serveur.
- Les tests d'écriture doivent viser la base staging, jamais la production.
- Le compte QA ne doit pas recevoir de privilèges d'administration IAM sauf scénario de test explicitement nécessaire.

## Agents

Claude, Codex et TestSprite doivent considérer cette configuration comme un mécanisme de QA temporaire et déterministe.

Ils doivent :

- inspecter la configuration existante avant toute modification ;
- ne pas supprimer le Google SSO ;
- ne pas ajouter de bypass d'autorisation ;
- ne pas demander de credentials Google personnels ;
- ne pas committer de secrets ;
- vérifier que `AUTH_PROVIDER=local` est impossible en production ;
- couvrir le login local et les appels authentifiés par des tests ;
- remettre `AUTH_PROVIDER=google` avant toute promotion vers l'environnement normal.
