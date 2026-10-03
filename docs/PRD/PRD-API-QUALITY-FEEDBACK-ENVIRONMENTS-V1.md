# PRD — API, Qualité, Feedback utilisateur et stratégie d'environnements

**Document ID:** PRD-GRC-API-QUALITY-001  
**Version:** 1.0  
**Statut:** PROPOSED — directive d'architecture et de développement  
**Date:** 2026-10-03  
**Produit:** GRC Tools / Gouvernance-Risk-Control-Tools

---

## 1. Objet

Ce PRD formalise l'orientation cible du projet après la mise en place du backend, du frontend, du déploiement Render/Neon et des premières campagnes de QA.

L'objectif n'est pas seulement de faire fonctionner l'application. Le produit doit disposer d'une boucle continue :

**développement → staging → tests automatisés → feedback utilisateur → correction → re-test → validation → production.**

Ce document sert de **source de contexte pour les agents IA et les développeurs** (Claude, Codex et futurs outils de QA tels que TestSprite).

Il doit être lu avant toute modification importante de l'API, du backend, du frontend, du système de permissions ou de l'infrastructure.

---

## 2. Décisions structurantes

### DEC-ENV-001 — Git

La convention retenue est :

```text
dev / feature/*
       ↓
      main
       ↓
    STAGING
       ↓
validation
       ↓
      prod
       ↓
  PRODUCTION
```

- `main` = branche de référence **STAGING**.
- `prod` = branche de référence **PRODUCTION**.
- Les branches `feature/*` sont les branches de développement.
- Une fonctionnalité n'est pas considérée comme prête pour production uniquement parce qu'elle compile.
- `prod` reçoit uniquement du code validé sur `main`.

Les documents, ADR, PRD, REX et décisions techniques versionnés dans Git font partie de l'historique du produit et peuvent donc accompagner le code jusqu'à `prod`.

En revanche, les **données, secrets, comptes QA et credentials d'environnement** ne doivent jamais être transportés entre environnements.

### DEC-ENV-002 — Séparation des environnements

```text
STAGING
Git: main
Frontend: Render staging
Backend: Render staging
DB: Neon staging
Auth: Google ou local QA temporaire
Données: test / QA

PRODUCTION
Git: prod
Frontend: Render production
Backend: Render production
DB: Neon production
Auth: Google SSO
Données: métier réelles
```

Les URLs, secrets, `DATABASE_URL`, OAuth configuration et credentials sont propres à chaque environnement.

### DEC-ENV-003 — QA account

`qagrctest@gmail.com` est une identité de test dédiée au staging.

Elle ne doit pas être utilisée comme compte de production.

L'authentification locale prévue pour les tests est une capacité **staging uniquement**. Elle ne doit jamais devenir un mécanisme d'accès production.

---

## 3. Architecture technique de référence

Architecture actuelle :

```text
Utilisateur
   ↓
Render Frontend
React + TypeScript + Vite
   ↓ HTTPS
Render Backend
Node + TypeScript + Express
   ↓
Repository / Services / Domain
   ↓
Neon PostgreSQL
```

Architecture temps réel déjà spécifiée :

```text
HTTP API
   ↓
Application Service
   ↓
Authorization
   ↓
Business logic
   ↓
PostgreSQL transaction
   ├── Audit
   └── Outbox
          ↓
       Event Bus / Worker
          ↓
      Notifications / Realtime
```

Le PRD WebSocket existant reste la référence pour le temps réel :

`docs/PRD/PRD-REALTIME-WEBSOCKET-BACKEND-V1.md`

Le présent document ajoute la dimension **qualité produit, feedback utilisateur, API contractuelle et gestion des environnements**.

---

## 4. Principes API

### 4.1 API versionnée

Toutes les APIs métier publiques utilisent :

```text
/api/v1/*
```

Une évolution incompatible nécessite une nouvelle version.

### 4.2 Backend autoritaire

Le frontend ne décide jamais :

- des permissions ;
- du tenant ;
- de l'identité réelle ;
- des transitions métier ;
- des scopes ;
- de l'accès à une ressource.

Le frontend demande.

Le backend décide.

### 4.3 Tenant isolation

Toute donnée métier doit rester strictement scoped par tenant.

Le client ne peut pas imposer librement :

```text
tenantId
userId
role
permission
scope
```

Ces valeurs sont résolues côté serveur.

### 4.4 RACI

Le RACI reste **déclaratif**.

```text
RACI ≠ permission technique
```

Une personne responsable ou accountable d'une activité ne reçoit pas automatiquement un droit d'écriture ou d'administration.

### 4.5 Audit

Les opérations métier significatives doivent être auditables.

Le realtime, le feedback et les tests ne remplacent jamais le journal d'audit.

### 4.6 Soft delete

La suppression physique n'est pas le comportement par défaut.

Lorsqu'une entité est supprimable, le modèle doit privilégier le soft delete lorsque cela est compatible avec le domaine.

Les données d'audit et de feedback doivent conserver leur valeur historique.

---

## 5. Contrat HTTP cible

Les APIs doivent suivre une convention homogène.

### Succès

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

Pour les listes :

```json
{
  "data": [],
  "meta": {
    "requestId": "...",
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "total": 100
    }
  }
}
```

### Erreur

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "requestId": "..."
  }
}
```

Les erreurs ne doivent jamais exposer :

- secrets ;
- stack traces en production ;
- credentials ;
- détails internes PostgreSQL ;
- tokens ;
- informations cross-tenant.

### Codes HTTP

Convention minimale :

| Situation | HTTP |
|---|---:|
| Succès | 200 |
| Création | 201 |
| Pas de contenu | 204 |
| Requête invalide | 400 |
| Authentification absente/invalide | 401 |
| Autorisation insuffisante | 403 |
| Ressource inexistante | 404 |
| Conflit métier | 409 |
| Validation métier | 422 |
| Erreur serveur | 500 |
| Service temporairement indisponible | 503 |

---

## 6. Idempotence et concurrence

Les commandes métier sensibles doivent pouvoir être protégées contre les doublons.

Lorsqu'une opération peut être rejouée par :

- navigateur ;
- retry ;
- worker ;
- WebSocket ;
- TestSprite ;
- réseau instable ;

elle doit définir une stratégie d'idempotence appropriée.

Les opérations critiques doivent pouvoir être corrélées par :

```text
requestId
correlationId
causationId
eventId
```

La version métier d'une ressource doit être utilisée lorsqu'un contrôle optimiste de concurrence est nécessaire.

---

## 7. API et temps réel

Le backend doit rester **WebSocket-ready**.

Le domaine et les services métier ne doivent jamais appeler directement :

```text
websocket.emit()
socket.broadcast()
socket.to()
```

Ils produisent des événements applicatifs via abstraction.

Le pipeline cible est :

```text
HTTP / Command
      ↓
Application Service
      ↓
Authorization
      ↓
Business transaction
      ↓
PostgreSQL
      ├── Audit
      └── Outbox
             ↓
          Event
             ↓
      Realtime / Notification / Worker
```

Une indisponibilité WebSocket ne doit jamais annuler une transaction métier.

---

## 8. Feedback utilisateur — objectif produit

Le feedback utilisateur devient une **fonction produit**, pas uniquement un outil de support.

Les utilisateurs autorisés doivent pouvoir laisser un feedback depuis l'application afin de permettre l'amélioration continue de :

- l'expérience utilisateur ;
- l'ergonomie ;
- la compréhension des fonctionnalités ;
- la navigation ;
- la pertinence métier ;
- la qualité des écrans ;
- la documentation et les libellés.

Le feedback complète les tests automatisés.

### 8.1 Ce que les tests automatisés mesurent

TestSprite / Codex / Claude peuvent vérifier :

- liens ;
- boutons ;
- formulaires ;
- API ;
- permissions ;
- parcours ;
- erreurs ;
- régressions ;
- comportement attendu.

### 8.2 Ce que le feedback humain apporte

Un utilisateur peut signaler :

- « je ne comprends pas cette page » ;
- « je ne trouve pas cette action » ;
- « le bouton est difficile à identifier » ;
- « cette information devrait être affichée autrement » ;
- « le workflow métier ne correspond pas à mon besoin ».

Ce type de signal ne doit pas être considéré comme une anomalie technique classique.

---

## 9. Feedback contextuel

Le système de feedback doit conserver autant que possible le contexte utile au moment de la soumission.

Contexte recommandé :

```text
feedbackId
tenantId
userId
page / route
resourceType
resourceId (si pertinent)
category
message
status
createdAt
resolvedAt
applicationVersion
requestId (si pertinent)
```

Le système doit éviter de collecter inutilement des données sensibles.

Le feedback ne doit jamais contenir de mot de passe, token ou secret.

### Catégories actuelles

Le modèle existant utilise notamment :

```text
BUG
IDEA
RECOMMENDATION
OTHER
```

Les catégories ne doivent pas être modifiées arbitrairement par un agent sans décision produit.

### Cycle de vie

Le modèle existant prévoit :

```text
NEW
ACKNOWLEDGED
IN_PROGRESS
RESOLVED
DECLINED
```

Le changement de statut est une mutation métier contrôlée.

---

## 10. Feedback Admin

`FeedbackAdmin` doit évoluer progressivement vers un espace de pilotage produit.

Objectifs :

- consulter les feedbacks ;
- filtrer ;
- catégoriser ;
- suivre le statut ;
- identifier les problèmes récurrents ;
- identifier les pages générant le plus de difficultés ;
- distinguer bug, UX et suggestion ;
- conserver l'historique ;
- relier un feedback à une amélioration.

Le volume de feedback ne doit pas être utilisé seul pour déterminer la priorité.

Un feedback unique peut révéler un problème critique.

---

## 11. Boucle qualité globale

Le produit adopte trois couches complémentaires :

```text
                 QUALITÉ GRC TOOLS
                        │
       ┌────────────────┼────────────────┐
       │                │                │
       ↓                ↓                ↓
  AUTOMATED QA      TECHNICAL QA      USER FEEDBACK
  TestSprite       Claude / Codex       utilisateurs
       │                │                │
       ↓                ↓                ↓
 Fonctionnel        Code / API          UX / UI
 Régression         Sécurité            Pertinence
 Parcours           Architecture        Ergonomie
       │                │                │
       └────────────────┼────────────────┘
                        ↓
                BACKLOG PRODUIT
                        ↓
                 développement
                        ↓
                    nouveau QA
```

Aucun de ces mécanismes ne remplace les autres.

---

## 12. TestSprite

TestSprite est considéré comme une couche de régression et de parcours automatisés du staging.

Règles :

1. Tester le staging, jamais la production.
2. Utiliser une identité QA dédiée.
3. Ne jamais fournir un mot de passe Google personnel.
4. Ne jamais contourner Google OAuth ou l'autorisation backend.
5. Ne jamais utiliser un cookie ou token personnel.
6. Les tests d'écriture utilisent uniquement des données de test.
7. Les données créées par les tests doivent être nettoyables.
8. Chaque anomalie détectée doit être reproductible.
9. Un correctif doit être accompagné d'un test lorsque c'est pertinent.
10. Une suite verte ne signifie pas que l'UX est validée.

L'intégration technique exacte de TestSprite doit suivre les capacités réellement disponibles dans l'environnement d'exécution ; aucun agent ne doit prétendre qu'un test TestSprite a été exécuté sans preuve d'exécution.

---

## 13. Claude / Codex

Les agents de développement doivent :

1. lire les ADR/PRD pertinents avant modification ;
2. inspecter le code existant avant de réimplémenter ;
3. rechercher les services, routes, repositories et composants déjà présents ;
4. respecter les conventions existantes ;
5. ne pas créer une seconde implémentation d'une fonctionnalité déjà existante ;
6. écrire les tests correspondant au comportement modifié ;
7. vérifier l'API réelle et le réseau avant de conclure qu'une page est vide ;
8. ne pas considérer une réponse HTTP 404/401/403 comme une donnée vide ;
9. respecter tenant scope et RBAC ;
10. préserver l'audit ;
11. préserver la compatibilité WebSocket-ready ;
12. ne pas utiliser RACI comme autorisation ;
13. ne pas supprimer les données par défaut ;
14. préserver les modifications locales non liées.

---

## 14. Diagnostic obligatoire d'un problème frontend/API

Lorsqu'une page affiche une liste vide ou qu'un bouton ne fonctionne pas, l'agent doit diagnostiquer dans cet ordre :

```text
1. VITE_API_BASE_URL
        ↓
2. URL finale générée
        ↓
3. HTTP status
        ↓
4. authentification
        ↓
5. permissions
        ↓
6. tenant / scope
        ↓
7. réponse API
        ↓
8. mapping frontend
        ↓
9. état UI
```

Un environnement avec une API qui retourne 404 ne doit jamais être décrit comme « fonctionnel mais sans données ».

Les problèmes précédemment rencontrés avec un double slash dans `VITE_API_BASE_URL` constituent un exemple de cette règle.

---

## 15. API observability

Toutes les requêtes importantes doivent pouvoir être corrélées.

Minimum recommandé :

```text
requestId
correlationId
userId
tenantId
route
HTTP method
status
duration
```

Les logs ne doivent pas contenir de :

- mot de passe ;
- token ;
- secret ;
- credential ;
- données sensibles non nécessaires.

Les erreurs backend doivent être exploitables sans exposer l'implémentation interne au client.

---

## 16. Permissions et sécurité

Toutes les routes protégées doivent passer par l'autorisation backend.

Le modèle reste :

```text
User
 ↓
UserRole
 ↓
Role
 ↓
RolePermission
 ↓
Permission
```

Les permissions ne doivent pas être déduites uniquement du frontend.

Un bouton masqué dans le frontend n'est jamais considéré comme une protection de sécurité.

Le backend doit refuser l'action même si un utilisateur forge manuellement la requête.

---

## 17. Environnements et données

### Staging

Le staging peut contenir :

- utilisateurs QA ;
- données fictives ;
- feedbacks ;
- exécutions de tests ;
- données créées par TestSprite ;
- traces techniques nécessaires à la QA.

Ces données sont non contractuelles.

### Production

La production doit disposer :

- d'une base Neon séparée ;
- de credentials séparés ;
- de secrets séparés ;
- d'OAuth production ;
- d'un compte de service / runtime distinct ;
- d'un accès migrateur distinct ;
- d'aucun compte QA temporaire.

La production ne doit jamais dépendre du fonctionnement de l'auth locale de staging.

---

## 18. CI/CD cible

Flux recommandé :

```text
feature/*
   ↓
CI
   ├── typecheck
   ├── lint
   ├── unit tests
   ├── security checks
   └── build
   ↓
PR → main
   ↓
STAGING
   ↓
QA automatisée
   ↓
QA humaine / feedback
   ↓
validation
   ↓
PR → prod
   ↓
PRODUCTION
```

Une promotion vers production doit être traçable par commit.

---

## 19. Documentation et mémoire projet

Les décisions importantes doivent être écrites dans le repository.

Sources de contexte existantes à consulter selon le sujet :

- `docs/architecture/ADR-001-cible-architecture.md`
- `docs/architecture/architecture_echange_complet.md`
- `docs/PRD/PRD-REALTIME-WEBSOCKET-BACKEND-V1.md`
- `docs/RETEX_PRODUCTION_RENDER_NEON.md`
- `docs/RETEX_FRONTEND_PRODUCTION_RENDER_QA.md`
- documents de sécurité et de gap analysis ;
- fichiers d'agents `.claude/agents/*`.

Ce document complète ces sources. Il ne les remplace pas.

En cas de contradiction, l'agent doit **signaler la contradiction** et ne pas arbitrer silencieusement.

---

## 20. Règles de non-régression

Une modification API doit vérifier au minimum :

- contrat HTTP ;
- authentification ;
- autorisation ;
- tenant isolation ;
- audit ;
- erreurs ;
- idempotence lorsque nécessaire ;
- tests unitaires ;
- tests intégration lorsque pertinent ;
- frontend impacté ;
- compatibilité avec les événements futurs ;
- documentation si le contrat change.

Une modification frontend doit vérifier :

- API réellement appelée ;
- URL finale ;
- état de chargement ;
- état vide ;
- état erreur ;
- permission ;
- responsive ;
- feedback ;
- absence de régression des autres pages.

---

## 21. Definition of Done

Une fonctionnalité est considérée prête pour staging lorsque :

- [ ] le code est compilable ;
- [ ] les tests automatisés pertinents passent ;
- [ ] l'API est correctement autorisée ;
- [ ] le tenant scope est vérifié ;
- [ ] les erreurs sont gérées ;
- [ ] l'audit est préservé ;
- [ ] le frontend gère loading/empty/error/success ;
- [ ] le feedback utilisateur est possible lorsqu'il est pertinent ;
- [ ] la documentation est mise à jour si nécessaire.

Une fonctionnalité est considérée prête pour production uniquement après validation staging.

---

## 22. Règles absolues pour les agents IA

### Ne pas faire

- Ne pas réimplémenter une API déjà existante sans analyse.
- Ne pas créer une nouvelle table pour contourner un modèle existant.
- Ne pas contourner RBAC.
- Ne pas considérer RACI comme permission.
- Ne pas accepter un tenantId fourni par le client comme vérité.
- Ne pas exposer de secret.
- Ne pas utiliser le compte QA en production.
- Ne pas tester directement contre la production.
- Ne pas supprimer physiquement des données sans décision explicite.
- Ne pas annoncer un test automatisé comme exécuté sans preuve.
- Ne pas ignorer un 404 en disant « il n'y a simplement pas de données ».
- Ne pas casser les contrats existants sans versionnement ou migration.
- Ne pas coupler le domaine au WebSocket.
- Ne pas introduire une dépendance externe sans justification.

### Faire

- Lire le contexte existant.
- Chercher l'implémentation existante.
- Identifier les contrats.
- Tester les permissions.
- Tester les cas négatifs.
- Ajouter les tests nécessaires.
- Documenter les décisions.
- Préserver la compatibilité avec le temps réel futur.
- Utiliser staging pour les tests.
- Exploiter le feedback humain comme source d'amélioration UX.
- Corréler les erreurs avec requestId/correlationId.
- Signaler les arbitrages ouverts.

---

## 23. Priorités d'implémentation

### P0 — Environnements

1. Finaliser `main = staging`.
2. Finaliser `prod = production`.
3. Séparer Render staging / production.
4. Séparer Neon staging / production.
5. Séparer secrets et OAuth.
6. Finaliser le compte QA staging.

### P1 — API / qualité

1. Stabiliser les contrats HTTP.
2. Stabiliser erreurs et codes.
3. Stabiliser RBAC/tenant scope.
4. Renforcer observabilité.
5. Renforcer tests API.
6. Ajouter idempotence aux commandes critiques.

### P1 — Feedback

1. Stabiliser FeedbackWidget.
2. Stabiliser FeedbackAdmin.
3. Ajouter le contexte de page/ressource.
4. Améliorer filtrage et workflow.
5. Transformer le feedback en backlog produit exploitable.

### P2 — QA automatisée

1. Préparer les parcours TestSprite.
2. Tester navigation.
3. Tester CRUD.
4. Tester permissions.
5. Tester erreurs.
6. Tester régressions.
7. Tester workflows métier.

### P2 — Temps réel

Poursuivre conformément à :

`docs/PRD/PRD-REALTIME-WEBSOCKET-BACKEND-V1.md`

Le backend doit rester WebSocket-ready avant l'implémentation finale du transport.

---

## 24. Vision finale

La qualité du produit ne sera pas définie par un seul outil.

```text
                    GRC TOOLS
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ↓               ↓                ↓
    CODE / CI       AUTOMATED QA     USER FEEDBACK
       │               │                │
       ↓               ↓                ↓
    sécurité        régression         UX
    qualité         parcours           UI
    architecture    API                métier
       │               │                │
       └───────────────┼────────────────┘
                       ↓
                 BACKLOG PRODUIT
                       ↓
                 AMÉLIORATION
                       ↓
                    STAGING
                       ↓
                  VALIDATION
                       ↓
                    PROD
```

Le produit doit donc être conçu comme un système **observable, testable, feedback-driven et promouvable entre environnements**, tout en conservant les principes de sécurité, de tenant isolation, de RBAC, d'audit et de compatibilité temps réel.

---

## 25. Décision finale

> **main est le staging. prod est la production.**

> **TestSprite valide les parcours et les régressions.**

> **Claude/Codex développent, analysent et corrigent avec preuve de tests.**

> **Les utilisateurs fournissent le feedback UX, UI et métier.**

> **L'API reste la source d'autorité pour l'identité, les permissions, les scopes et les transitions métier.**

> **PostgreSQL reste la vérité métier.**

> **Le WebSocket reste un transport et ne devient jamais la source de vérité.**

> **Les données et secrets staging ne doivent jamais être promus en production.**

Ce document constitue désormais une directive de contexte pour les agents intervenant sur le projet.
