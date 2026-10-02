# Audit externe du 2026-09-30 — état de traitement

Ces 3 documents + le SARIF Semgrep sont un audit **externe** (fourni par le PO,
pas produit par les agents ACF) portant sur la branche `feature/dashboard-scope-resolver`
(PR #27) au commit `81c41db`. Ils recoupent très largement le finding HIGH déjà
trouvé par la revue interne du même jour (voir `.claude/agent-context/ACTION_ITEMS.md`),
mais vont plus loin sur plusieurs points que la revue interne n'avait pas couverts.

**Ne pas retraiter ces documents comme s'ils décrivaient l'état actuel du code** —
la plupart des constats ont déjà été corrigés depuis (le commit audité est daté
d'avant PR #28-#43/#54). Vérifié par lecture directe du code sur `main` le 2026-09-30 :

| Constat externe | Réf. cahier | Statut vérifié sur `main` (2026-09-30) |
|---|---|---|
| KRI non filtrés par le scope dans `getExecutiveView`/`getRiskCommitteeReport`/`getConsolidatedReport` | AUD-01, SEC-CAMP2-01, DASH-001/002/003 | **CORRIGÉ** — PR #55 |
| RACI : destinataire cross-tenant/inactif non validé | AUD-02, SEC-CAMP2-02, RACI-002/003 | **CORRIGÉ** — PR #29/#33 |
| `audit_log` append-only non imposé au niveau PostgreSQL | AUD-04 | **CORRIGÉ** — PR #36 (migration 038, REVOKE + triggers) |
| Semgrep non bloquant, 8 findings sur tags d'Actions mutables | AUD-05, SEC-CAMP2-03 | **CORRIGÉ** — PR #39 (SHA pinning) + Semgrep maintenant bloquant |
| Lockfile frontend supprimé et rerésolu à chaque run CI | AUD-06 | **CORRIGÉ** — PR #43 (`npm ci` avec lockfile versionné) |
| Validation de signature de fichier Evidence absente | AUD-07, EVD-003/004 | **CORRIGÉ** — PR #30 |
| Compensation Drive/DB si l'upload échoue partiellement | (lié à AUD-03) | **CORRIGÉ** — PR #32/#34/#35 |
| Rôle DB runtime trop privilégié en production | REF-08, DB-001 | **CORRIGÉ** — PR #37 (garde-fou de démarrage) |
| Séparation identifiants migration/runtime | (lié à DB-001) | **CORRIGÉ** — PR #38 |
| Écriture métier RACI sans transaction avec l'audit (`raci.create()` puis `audit.record()`, pas de compensation si l'audit échoue) | AUD-03 | **CORRIGÉ** — PR #56 (`security/raci-audit-compensation`), consolidée dans `security/raci-audit-transaction-and-http-hardening`. Compensation applicative (pattern Evidence PR #32/#35) : `raci.remove()`/`raci.restore()` si `audit.record()` échoue après la mutation ; si la compensation elle-même échoue, erreur explicite avec `AggregateError` (jamais d'échec silencieux). Retenu plutôt qu'une transaction DB partagée car `RaciAssignmentRepository`/`AuditRepository` n'ont aujourd'hui aucun mécanisme de transaction croisée — l'ajouter a minima pour ce seul appelant aurait été un changement d'architecture plus risqué qu'une compensation ciblée et testée. Testé (`RaciAssignmentService.test.ts`). |
| Durcissement HTTP (helmet, rate limiting) | SEC-CAMP2-04, WEB-008, WEB-010, AUTH-011 | **CORRIGÉ (partiellement — voir limites ci-dessous)** — `security/raci-audit-transaction-and-http-hardening`. `helmet` ajouté (CSP/COEP/CORP désactivés/assouplis pour ne pas casser le SPA + Google Identity Services, reste des en-têtes par défaut) ; rate limiting sur l'ensemble de la surface `/api/v1` pour les requêtes en échec (pas de route `/login` dédiée — chaque requête vérifie un bearer token) et un seuil plus strict sur l'upload Evidence et l'import Excel (preview/commit). Testé (`test/httpHardening.test.ts`) contre l'app réelle sur un port éphémère. |
| Reste de la matrice `cahier_des_charges_tests_securite_GRC.md` (SEC-001 à RES-010, ~130 tests) | tout le document | **NON EXÉCUTÉ** — c'est un plan de campagne complet (P0 à P3, plusieurs semaines), pas quelque chose qu'un agent a exécuté ou peut exécuter dans une session. À traiter comme une checklist de fond, pas un backlog à clôturer d'un coup. |

**Ce qui reste réellement à traiter, par priorité** :
1. **Rate limiting** : ne couvre aujourd'hui que la surface auth (échecs) et 2 endpoints coûteux (upload Evidence, import Excel) — pas d'autres opérations potentiellement coûteuses (exports/rapports, recherches). Store en mémoire (`express-rate-limit` par défaut) donc par instance, pas partagé entre réplicas Cloud Run — suffisant pour un premier durcissement, pas pour une garantie de quota globale en multi-instance (nécessiterait un store Redis/partagé).
2. **Vérification complète en staging** demandée par le cahier des charges (comportement sous charge réelle, en environnement multi-instance) — hors de portée de cette session, non exécutée.
3. **Campagne de tests de sécurité formelle** (`cahier_des_charges_tests_securite_GRC.md`) — non commencée, à prioriser (SEC-001 à SEC-012, DASH-001 à DASH-010 sont listés comme les plus prioritaires par le document lui-même). Ne pas déclarer un test "réussi" s'il n'a pas été réellement exécuté — le document lui-même l'interdit explicitement (§3, §13, §17).

Voir `.claude/agent-context/ACTION_ITEMS.md` (2026-09-30, entrée `@security` sur cet audit) pour le suivi vivant, et `RETEX_MULTI_AGENTS.md` pour la leçon tirée sur la méthodologie de revue de sécurité (la revue interne de PR #27 n'avait vérifié qu'un seul des quatre points d'appel KRI).
