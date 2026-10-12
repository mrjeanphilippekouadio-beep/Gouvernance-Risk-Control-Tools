# A23 (Audit & Observability) — Revue de traçabilité DECISION-044

```text
ASSESSMENT_ID:  A23-REV-D044-2026-10-12
SYSTEM:         GRC Tools — backend
SCOPE:          git diff 37766ab 0dc6bda -- backend
                  e5b6381 feat(b6a) q87 / q90 (Dispositif)
                  2b14eb7 feat(rbac) q94 / q80 / q79 (RBAC)
                  0c4384b feat(notifications) q95 / q85 / q84 (abonnements)
BRANCH:         wt/audit-d044 (base 0dc6bda)
TESTS:          cd backend && npm test -> 97 fichiers, 1755 tests, tous verts
NATURE:         constats techniques de traçabilité. Pas de conclusion d'audit,
                pas d'avis de conformité : l'Auditeur et Compliance concluent.
                Aucune correction de code, aucune base touchée.
```

## 1. Périmètre et méthode

Lecture des fichiers source des trois lots, de leurs tests, et de la
table d'append-only (migration 038). Pour chaque mutation : acteur,
tenant, événement, ancienne/nouvelle valeur, motif, transaction, chemin
faux-repository. Les numéros de ligne renvoient au commit `0dc6bda`.

Abréviations : `RFS` = `backend/src/services/RiskFrameworkService.ts`,
`RFR` = `backend/src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts`,
`RS` = `backend/src/services/RoleService.ts`, `US` = `backend/src/services/UserService.ts`,
`NS` = `backend/src/services/NotificationService.ts`.

## 2. Points conformes (vérifiés)

| Contrôle | Résultat | Preuve |
| --- | --- | --- |
| Chaque mutation du Dispositif (create, updateIdentity, createDraft, updateDraft, discardDraft, requestActivation, approve, reject, withdraw) produit au moins un événement d'audit, avec `requestId` | Conforme | RFS:205-211, 228-231, 251-254, 281-284, 301-304, 335, 342, 377-380, 421-438 |
| Acteur et tenant forcés côté serveur (`actor.userId`, `actor.tenantId`), aucun champ client d'attribution | Conforme | RFS:608-619 (`event`), RFS:210 (`createdBy`), RFS:433 (`decidedBy`) |
| Chemin Postgres : audit écrit dans la transaction de l'action (ROLLBACK si échec) | Conforme | RFR:184 (`auditsInTransaction`) et helper `audited` de la classe, RFR:`tx`, RFS:603-606 (`inTx`) |
| Pas de double écriture sur les deux chemins (transactionnel : audit passé au repository seulement ; faux-repository : `record` une seule fois) | Conforme | RFS:340-347, 440-449 ; test `B6aQ87Q90.test.ts:80-83` |
| `insertAuditEvent` = INSERT seul ; aucun `UPDATE`/`DELETE` sur `audit_log` dans `backend/src` ; triggers BEFORE UPDATE/DELETE/TRUNCATE | Conforme | PostgresAuditRepository.ts (insertAuditEvent) ; migration 038 |
| `decide` : motif obligatoire pour REJECT et pour le repli (FALLBACK) ; `decisionRegime` tracé | Conforme | RFS:418-419, 425 |
| `withdraw` réservé au demandeur, motif obligatoire, tracé | Conforme | RFS:374-380 |
| Notifications de l'audit tracées (une ligne `Notification CREATE` par destinataire) | Conforme | NS:175-186 |
| Abonnement accepté (`enabled:true`) : `before`/`after` et `CREATE`/`UPDATE` tracés | Conforme (voir AUD-D044-11/12) | NS:85-125, 112-121 |
| Cumul admin + Comité : motif obligatoire, refus sans motif levé avant écriture | Conforme | RS:382-388 ; repli dans le callback de `assignToUser` RS:413-418 |

Point de vigilance relevé sans constat : `create` écrit deux événements
(`RiskFramework` et `RiskFrameworkVersion`) pour une seule action. Les
deux partagent le même `requestId`, ce qui permet la corrélation. Ce n'est
pas une anomalie.

## 3. Constats

Sévérités : **HIGH** = trou de preuve sur une action gouvernance,
**MEDIUM** = preuve présente mais inexploitable ou incomplète sans
recoupement, **LOW** = écart de convention ou de test.

### AUD-D044-01 — MEDIUM — Transitions d'état de version non journalisées sur leur propre entité

- Preuve :
  - DRAFT → PENDING_APPROVAL : `RFR:404` (`createActivationRequest`). Seul l'événement `SUBMIT` sur la demande est écrit (`RFS:335`).
  - PENDING_APPROVAL → DRAFT sur rejet : `RFR:534-535`. Seul `REJECT` sur la demande (`RFS:428`).
  - PENDING_APPROVAL → DRAFT sur retrait : `RFR:593-594`. Seul `STATUS_CHANGE` sur la demande (`RFS:377-378`).
  - ACTIVE → ARCHIVED de la version précédente : `RFR:556-558`. Aucun événement propre ; elle n'apparaît que dans `oldValue` de l'événement de la nouvelle version (`RFS:424`).
  - Scales de notation : `RFR:495` (ACTIVE) et `RFR:500` (ARCHIVED automatique) ; `risk_frameworks.is_default` : `RFR:574`. Aucun événement.
- Impact : un auditeur qui interroge l'historique de la version V1 ne voit pas qu'elle a été archivée ni par qui. Il faut recouper la demande, puis la nouvelle version. La chaîne est reconstructible, mais pas directement.
- Correctif proposé : écrire un événement `STATUS_CHANGE` par entité dont le statut change (version précédente, scale, Dispositif par défaut), dans la même transaction (`audit` passé à `recordDecision`, `createActivationRequest`, `withdraw`).
- Propriétaire : A06 (Dev Backend), revue A13 pour le périmètre.

### AUD-D044-02 — MEDIUM — Sémantique incohérente de `oldValue` sur l'approbation

- Preuve : `RFS:424-425` : l'événement `STATUS_CHANGE` de la version approuvée prend `oldValue = result.previousActive`, c'est-à-dire l'ancienne version ACTIVE, et non l'état pré-décision de la version (PENDING_APPROVAL).
- Impact : pour un événement sur `RiskFrameworkVersion` / `entityId = version approuvée`, `oldValue` ne décrit pas la même entité que `newValue`. Un outil d'analyse qui compare `old`/`new` par entité produit un résultat faux.
- Correctif proposé : `oldValue` = version avant décision (statut PENDING_APPROVAL) ; mettre `previousActive` dans `newValue` (champ `replacedVersion`) ou émettre l'événement de AUD-D044-01 pour la version remplacée.

### AUD-D044-03 — MEDIUM — `oldValue` lu hors transaction et hors verrou

- Preuve :
  - `updateDraft` : pré-lecture `RFS:267` sans verrou ; `UPDATE` sans `FOR UPDATE` `RFR:361`. Sous édition concurrente, `oldValue` peut ne pas être la valeur réellement écrasée.
  - `updateIdentity` : pré-lecture `RFS:223`, `UPDATE` sans verrou `RFR:300`.
  - `discardDraft` : pré-lecture `RFS:299`, verrouillage absent avant l'UPDATE `RFR` (discardDraft).
  - `withdraw` : `RFS:373` (lecture), le verrou n'est pris qu'en `lockPending` (RFR:440).
- Impact : l'« ancienne valeur » est un instantané, pas l'état réellement remplacé. Cela fragilise la preuve sur les modifications concurrentes.
- Correctif proposé : relire l'ancienne ligne dans la même transaction avec `SELECT ... FOR UPDATE`, ou `UPDATE ... RETURNING` avec un CTE sur l'ancienne ligne, et passer cette ligne au callback d'audit.

### AUD-D044-04 — MEDIUM — Refus significatifs du Dispositif non tracés

- Preuve :
  - Maker-checker décideur = demandeur : `RFS:398-400` (ForbiddenError, sans audit).
  - Décideur auteur de la version : `RFS:405-407`.
  - Demande en vote (B-12) : `RFS:414-417` (ConflictError).
  - Retrait par un non-demandeur : `RFS:374`.
  - Accès refusé hors Risk Manager : `RFS:528-531` (`assertRiskManager`, appelé par toutes les mutations).
- Impact : une tentative d'auto-approbation (maker-checker) ne laisse aucune trace. La section 10 de l'ACF demande explicitement « accès refusé » comme événement de sécurité. Sans ce signal, l'Auditeur ne peut pas démontrer que le contrôle a fonctionné ni détecter une tentative répétée.
- Correctif proposé : événement `REFUSED` (ou un `action` dédié) avec `reason` = code de refus, `oldValue`/`newValue` = null, écrit en dehors de la transaction annulée (une seconde écriture après le throw). Priorité : auto-approbation et décision en vote. Ne pas journaliser le contenu de la demande refusée au-delà de l'identifiant.
- Propriétaire : A06 ; A10 (Security) à consulter sur le périmètre des refus à journaliser.

### AUD-D044-05 — LOW — Chemin faux-repository : trace d'une modification non effectuée

- Preuve : `RFS:284` écrit l'événement `UPDATE` avant `frameworks.updateDraft` (`RFS:285`). Si la mise à jour échoue (version passée en PENDING entre-temps), une ligne d'audit décrit une modification qui n'a pas eu lieu. Le commentaire `RFS:277-279` l'assume (« over-excludes, never under-excludes »).
- Impact : limité au chemin non transactionnel (fakes de test) ; en production le repository Postgres est transactionnel. Mais une trace d'un fait non survenu, même acceptée, reste une fausse preuve.
- Correctif proposé : supprimer le chemin non transactionnel de `updateDraft` (faire de l'implémentation de test un faux qui respecte `auditsInTransaction`), ou écrire l'audit après l'UPDATE comme les autres chemins.

### AUD-D044-06 — MEDIUM — RBAC : marquage admin + Comité non exploitable

- Preuve :
  - Événement d'affectation : `RS:420-430` : `newValue = { ...assignment, roleName }`, `reason = cleanReason`. Le fait que l'utilisateur soit devenu administrateur + Comité n'est pas écrit.
  - Notification : même `eventType` `ADMIN_RISK_MANAGER_CUMUL` pour RM et pour Comité (`RS:292-299`, `RS:437-441`). Seul le texte du message diffère.
  - Marquage dérivé à la lecture, non persisté : `US:165-166`, `RS:548-556` (`isAdminAndCommittee`). `isAdministrator` dépend de `ADMIN_PERMISSIONS` (code, `RS:35-43`).
  - Le « tiers prévenu » dépend de `notifyMembers` (`RS:646-668`), best effort : un échec est seulement journalisé en console, sans trace d'audit.
- Impact : un auditeur ne peut pas filtrer les cumuls Comité par type d'événement, ni reconstruire à une date donnée qui était marqué. La preuve du « tiers prévenu » n'existe pas si la notification échoue.
- Correctif proposé : ajouter `cumulFlags: ["ADMIN_RISK_MANAGER"|"ADMIN_COMMITTEE"]` dans `newValue` de `RS:426` ; distinguer `eventType` (ajout au catalogue de notification, `ADMIN_COMMITTEE_CUMUL`) ; en cas d'échec de `notifyMembers`, écrire une ligne d'audit d'échec.

### AUD-D044-07 — MEDIUM — Refus de cumul (q94) et refus de réactivation non tracés

- Preuve :
  - `assertNoCumul` lève une `ValidationError` : `RS:75-79`. Appelé depuis `assignToUser` (callback `RS:413-418`), `update` (recheck `RS:256-266`) et `assertReactivable` (`RS:563-566`).
  - Réactivation refusée : `US:258` appelle `assertReactivable` ; le refus remonte sans audit. L'audit de réactivation `US:268-278` n'est écrit que si la réactivation réussit.
  - Pour `assignToUser` et `update`, le refus intervient dans le verrou du repository : la transaction est annulée et aucune trace ne subsiste.
- Impact : la règle q94 est un contrôle. Sa preuve d'exécution est le refus lui-même. Sans trace, l'Auditeur ne voit ni la tentative, ni son auteur, ni le moment. Le cas « réactiver un utilisateur qui porte un cumul interdit » est un signal de risque d'accès.
- Correctif proposé : écrire `REFUSED` (ou `CUMUL_REFUSED` / `REACTIVATION_REFUSED`) après le throw, avec l'identifiant de l'utilisateur ciblé, le rôle, et le code de règle (q94). Documenter la liste des refus journalisés.

### AUD-D044-08 — MEDIUM — RBAC : audit écrit après la mutation, hors transaction

- Preuve : `RS:413` (`roles.assignToUser`) puis `RS:420` (`audit.record`) ; `RS:278` puis `RS:280` (`update`) ; `US:226` puis `US:228` (`suspend`) ; `US:260` puis `US:268` (`reactivate`). Aucun de ces chemins n'est transactionnel au sens du Dispositif (q90 couvre le seul Dispositif).
- Impact : si l'écriture d'audit échoue, la mutation est appliquée, l'erreur remonte au client, et une nouvelle tentative risque de dupliquer l'action. Le lot ajoute du code sur ce chemin (cumul admin + Comité). Problème antérieur au lot, signalé car le lot l'étend.
- Correctif proposé : étendre le mécanisme `auditsInTransaction` à `RoleRepository.assignToUser` et `RoleRepository.update` (même pattern que `RFR:audited`).

### AUD-D044-09 — LOW — Tests : traçabilité peu assertée

- Preuve :
  - `Rbac044.test.ts:48` : `audit = { async record() {} }`. Aucun test ne vérifie la ligne d'audit du cumul admin + Comité, ni le motif, ni le refus.
  - `B6aQ87Q90.test.ts` : contrôle l'audit transactionnel de `updateIdentity` et de `updateDraft` seulement (lignes 30-83). Pas de test « un événement par mutation » sur `createDraft`, `discardDraft`, `requestActivation`, `decide`, `withdraw`.
- Impact : une régression sur la trace (ex. suppression d'un `audit` passé au repository) ne ferait échouer aucun test.
- Correctif proposé : tests d'assertion sur le contenu (`action`, `entityType`, `userId`, `tenantId`, `reason`) pour chaque mutation, et sur les refus une fois AUD-D044-04/07 traités. Niveau 1 pour A06, niveau 2 pour A08 (QA).

### AUD-D044-10 — LOW — Abonnements : le refus d'opt-out n'est pas tracé

- Preuve : `NS:100-101` : `enabled:false` sur un type obligatoire est refusé. Le catalogue ne contient plus aucune entrée `mandatory: false` (contrôle par grep : 0 occurrence), donc tout opt-out est refusé.
- Impact : la seule trace possible d'une demande de désabonnement est absente. Un désabonnement tenté ne laisse aucune preuve, alors que l'Auditeur pourrait vouloir le voir (q85 : « plus de désabonnement »).
- Correctif proposé : événement `REFUSED` sur `NotificationSubscription` (voir AUD-D044-04), avec le type concerné et `triggeredBy` = acteur.

### AUD-D044-11 — LOW — Abonnements : écriture et audit non atomiques, pré-lecture hors transaction

- Preuve : `NS:104` (`getByKey`, lecture) ; `NS:106` (`upsert`) ; `NS:112` (`audit.record`). Trois opérations séparées.
- Impact : sous concurrence, `action` (CREATE/UPDATE) et `oldValue` peuvent être faux. Si l'audit échoue, l'abonnement est modifié sans trace, et le client reçoit une erreur.
- Correctif proposé : upsert et audit dans une transaction, `oldValue` lu avec verrou (même correctif que AUD-D044-03).

### AUD-D044-12 — MEDIUM — Opt-outs historiques neutralisés sans trace

- Preuve : `NS:203` : `emit` ignore les abonnements `enabled:false` pour les types obligatoires. Aucune migration ne touche les lignes existantes (`notification_subscriptions` référencée seulement par les migrations 025 et 051). `US`/`NS:listSubscriptions` continuent de renvoyer `enabled:false`.
- Impact : l'état effectif a changé à la date de q85 (les alertes KRI et retards sont désormais envoyées), sans écriture d'audit. Le système affiche « désactivé » et envoie quand même. Cet écart entre état affiché et état effectif est un constat direct pour l'Auditeur et Privacy (une notification envoyée contre un choix affiché).
- Correctif proposé : soit une migration one-shot qui force `enabled=true` avec une ligne d'audit par abonnement neutralisé (`reason = 'DECISION-044 q85'`), soit une vue lecture qui expose `effectiveEnabled` et le motif. Décision de gouvernance à confirmer par Compliance (A14) et Privacy (A15) avant implémentation.

### AUD-D044-13 — LOW — Définition de « administrateur » non versionnée

- Preuve : `RS:35-43` : `ADMIN_PERMISSIONS` inclut désormais `config.manage` (q79). Le marquage admin dépend donc du code, non de l'état enregistré.
- Impact : un changement de définition modifie rétroactivement l'ensemble des utilisateurs marqués, sans événement de changement de politique. Reconstituer la population à une date donnée exige la version du code.
- Correctif proposé : consigner tout changement de `ADMIN_PERMISSIONS` dans le journal de décisions (référence DECISION-044) et, si la preuve doit être reproductible, stocker la liste active avec un identifiant de version.

### AUD-D044-14 — LOW — Garde d'append-only sans `SET search_path`

- Preuve : `database/postgresql/migrations/038_audit_log_append_only.sql:19` : `audit_log_append_only_guard()` n'a pas de `SET search_path`. La convention du CLAUDE.md impose ce réglage sur toute fonction de garde. La migration 058 ne couvre que les six fonctions Dispositif, et `QA-B6a11.test.ts` ne contrôle que celles-là.
- Impact : la fonction ne fait que `RAISE EXCEPTION`, donc l'exploitation est peu probable. Le constat porte sur la conformité à la convention et sur l'absence de test de garde pour `audit_log`.
- Correctif proposé : nouvelle migration (prochain numéro disponible : **059**, la dernière présente est 058) avec `ALTER FUNCTION audit_log_append_only_guard() SET search_path = pg_catalog, public, pg_temp;` et une extension de `QA-B6a11.test.ts` ou un test dédié.

## 4. Synthèse par question du brief

1. **Dispositif (e5b6381)** : chaque mutation produit au moins un événement, dans la transaction sur le chemin Postgres, avec acteur, tenant et `requestId` corrects. Pas de double écriture. `insertAuditEvent` est append-only. Constats : AUD-D044-01 à 05, 09.
2. **RBAC (2b14eb7)** : le motif du cumul admin + Comité est obligatoire et tracé. Le marquage n'est pas exploitable par type (AUD-D044-06). Les refus de cumul (q94) et de réactivation ne sont pas tracés (AUD-D044-07). L'audit RBAC n'est pas atomique avec la mutation (AUD-D044-08).
3. **Notifications (0c4384b)** : l'abonnement accepté (`enabled:true`) reste audité. Le refus d'opt-out ne l'est pas (AUD-D044-10). L'écriture n'est pas atomique (AUD-D044-11). Les opt-outs historiques neutralisés ne laissent aucune trace (AUD-D044-12).

## 5. Limites

- Revue statique et tests unitaires. Aucune base, aucun environnement déployé, aucun parcours bout en bout n'ont été exécutés.
- Les tests `npm test` sont verts : ils ne prouvent pas l'absence des trous ci-dessus.
- Les constats sur les notifications `notifyMembers` supposent la configuration `users.listWithPermission` disponible en production.
- Pas d'avis de conformité : la décision sur la rétention, sur le caractère obligatoire des refus à journaliser et sur AUD-D044-12 appartient à A13/A14/A15 et à HUMAN.

## 6. Statut

```text
STATUS: GAP_IDENTIFIED
Constats : 14 (0 HIGH, 8 MEDIUM, 6 LOW — voir détail ci-dessus)
Owner des corrections : A06 (Dev Backend), A07 (Dev DB, AUD-D044-14 migration),
                        A08 (QA, AUD-D044-09), A13/A14/A15 (AUD-D044-12, gouvernance)
Escalade : aucune escalade HUMAN requise à ce stade. AUD-D044-12 est une
           décision de gouvernance à confirmer (A14/A15), donc à remonter à
           l'orchestrateur (A02) avant implémentation.
```
