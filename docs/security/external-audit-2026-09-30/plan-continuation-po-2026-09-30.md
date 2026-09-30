# Plan de continuation sécurité — PO, 2026-09-30 (après audit externe)

Reçu du PO en session, après lecture des 4 documents d'audit externe et le
correctif du sprint PR #28-#43/#54. Transcrit tel quel pour rester la
référence de séquencement — **c'est le PO qui pilote cet ordre**, pas une
proposition d'agent.

## Déjà couvert (constaté par le PO)

| Bloc | État |
|---|---|
| Isolation tenant / autorisations principales | ✅ |
| RACI / maker-checker | ✅ |
| Protection des preuves | ✅ |
| Audit log append-only | ✅ |
| Séparation rôle DB runtime / migration | ✅ |
| Pinning des GitHub Actions | ✅ PR #39 |
| Semgrep bloquant | ✅ PR #39 |
| Gitleaks bloquant | ✅ PR #40 |
| Trivy HIGH/CRITICAL | ✅ |
| Cloud Run / Secret Manager baseline | ⏳ PR #41 |

## Ce qu'il reste à contrôler dans GitHub

1. **Permissions GitHub Actions** — vérifier que chaque workflow n'a que les
   droits nécessaires (lecture seule si c'est tout ce dont il a besoin).
2. **Dépendances** — npm vulnérables, mises à jour auto, dépendances
   transitives, `npm ci` partout où possible, contrôle des lockfiles,
   dépendance Python Semgrep elle-même.
3. **CodeQL / analyse applicative plus profonde** — Semgrep ne couvre qu'une
   partie du SAST. Revue spécifique demandée sur : injection SQL, XSS, SSRF,
   path traversal, command injection, authorization bypass, IDOR, open
   redirect, prototype pollution, désérialisation, fuite d'informations.
4. **Protection des branches / gouvernance GitHub** — vérifier dans les
   paramètres GitHub que `main` impose réellement : PR obligatoire, CI
   obligatoire, pas de push direct, review obligatoire, CODEOWNERS, pas de
   bypass administrateur. Le PO n'a pas pu confirmer ces paramètres depuis
   le dépôt lui-même.
5. **Supply chain / provenance** — GitHub Actions → Build → SBOM → Artifact
   attestations → Image Docker immuable → Déploiement. Important vu que
   l'application manipule des données de risques/contrôles/audit.

## Ce qu'il reste dans le code applicatif (le plus gros bloc)

**HTTP/API** : CSP, HSTS, X-Content-Type-Options, protection clickjacking,
CORS strict, taille maximale des requêtes, rate limiting, timeouts, gestion
des erreurs sans fuite interne.

**Authentification** : validation complète du token Google (issuer,
audience, expiration), comportement token invalide/réutilisé, révocation/
désactivation utilisateur, séparation authentification/autorisation.

**Autorisation** : revue endpoint par endpoint, matrice route → permission →
tenant, vérification des opérations sensibles, recherche de nouveaux IDOR,
recherche de contournements RBAC.

**Données sensibles** : PII dans les logs, tokens dans les logs, secrets
dans les erreurs, données sensibles retournées par les endpoints, export
Excel/reporting.

## Production réelle (après #41)

Le code ne peut pas prouver que l'infrastructure réelle est correctement
configurée :

```
Google Cloud
   ├── Cloud Run → service account runtime
   ├── Secret Manager → DATABASE_URL
   ├── Neon → grc_runtime, grc_migration
   ├── Google Drive → droits du service account
   └── Monitoring / Logs / Alertes
```

## Séquencement voulu par le PO

```
PR #41 → GitHub Actions least privilege → Dépendances/Supply Chain
  → CodeQL + SAST approfondi → HTTP/API Security → Auth/RBAC/IDOR
  → Logging/PII/erreurs → Docker/SBOM/provenance → Google Cloud IAM
  → Secret Manager réel → Neon roles réels → Monitoring/alerting
  → Tests de sécurité finaux → REVUE DE CLÔTURE
```

**La prochaine PR après #41** : GitHub Actions least privilege +
dépendances/supply chain, avant les contrôles HTTP/API.

## Table de correspondance constats externes → état → suite (donnée par le PO)

| ID | Contrôle | État constaté sur `main` | Suite |
|---|---|---|---|
| AUD-01/AUD-08 | Filtrage KRI vues exécutives/rapports | À corriger | PR #55 (préparée, pas mergée) |
| AUD-02 | RACI utilisateur actif/même tenant | Corrigé dans le code | Vérifier CI/tests existants |
| AUD-03 | Cohérence mutation métier / audit | Partiel | Sécuriser aussi RACI (fait, PR #58) |
| AUD-04 | Protection audit_log PostgreSQL | Ajoutée | Vérifier droits effectifs en environnement réel |
| AUD-05 | Semgrep bloquant en CI | Corrigé | Examiner les résultats réels du scan |
| AUD-06 | Installation frontend reproductible | Corrigé | Confirmer que la CI passe |
| AUD-07 | Validation fichiers de preuve | Partiel | Vérifier antivirus, stockage, tests d'abus |
| RET-DAST | Tests dynamiques API en staging | Non démontré | Préparer et exécuter (autorisation requise) |
| RET-DR | Restauration PostgreSQL, RPO/RTO | Non démontré | Tester une vraie restauration |
| INFRA-DB | Séparation/privilèges compte migration | À vérifier | Contrôler config réelle Neon/Cloud Run |

## Actions immédiates listées par le PO

1. **Revue et fusion de PR #55/#56/#57** — vertes, fusionnables, pas encore
   mergées.
2. **GitHub Secret Protection à activer** — bouton "Enable" encore visible
   au moment de l'audit. Gitleaks tourne déjà en CI, mais la protection
   native GitHub (détection + blocage avant push si disponible) doit être
   activée séparément.
3. **Protection de la branche `main` à vérifier** — reviews obligatoires,
   contrôles requis, protection contre modification/suppression directe.
   Non confirmable depuis le dépôt seul.
4. **Antivirus/quarantaine des preuves** — validation de type réel + tests
   de signature existants, mais aucun contrôle antivirus dédié visible sur
   le flux Google Drive inspecté.
5. **Tests dynamiques DAST/API** — non exécutés, nécessitent un
   environnement de staging autorisé, une URL cible, des comptes de test.
6. **Restauration PostgreSQL + RPO/RTO** — non exécutés, nécessitent une
   restauration réelle avec mesure des temps de reprise et de la perte de
   données.
