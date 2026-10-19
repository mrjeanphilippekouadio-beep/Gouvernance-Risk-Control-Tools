# Retest sécurité A10 — panel de gouvernance : correctifs, arbitrages PO, D5, frontend F0–F2 (2026-10-19)

- **Escalade HUMAN : aucune.** Aucun finding n'atteint CVSS 7. Le score le plus élevé est 4,3 (SEC-PNL2-01, MEDIUM).
- Périmètre : `git diff 037314d..9a86fb8 -- backend database frontend`. Correctifs panel (`reasonText`, F-PNL-01..06, SEC-PNL-03), durcissement en place de 068–071 (SEC-PNL-06), arbitrages PO q155/q157/q158/q159 (DECISION-077/078, migration 072), DECISION-079 (effet + audit dans une transaction, `runAudited`/`writeAudited`), lot D5 (migration 073, revues, acceptations, notifications obligatoires), frontend F0/F1/F2.
- Méthode : revue statique du diff. PoC avec les **vrais services et repositories** sur un PostgreSQL 16 jetable (`/tmp/a10_pnl2`, port 5547, migrations 001 à 073 appliquées, attaques SQL sous `grc_app_runtime`). PoC Express avec le vrai `governanceNotificationsMiddleware`. Jamais Neon.
- Vérifications : `npm run typecheck` OK ; vitest 2306 verts, 204 ignorés (suites `-pg` ignorées sans base). Suites `-pg` D079, D5, PanelDbGuards, QA-panel, D4, D3, D2c sur la base jetable : 77 verts, 8 ignorés.
- **Verdict global : PASS avec réserves.** Feu vert pour staging. SEC-PNL-01, -02, -03, -05 et -06 sont fermés. SEC-PNL-04 reste ouvert : il est réduit, pas fermé. SEC-PNL2-01 doit être corrigé avant la production, parce que les notifications obligatoires sont la compensation retenue par q157, R-6.4 et SEC-PNL-04.

## Synthèse

| ID | Sévérité | CVSS 3.1 | Confiance | Titre | Porteur | Statut |
|---|---|---|---|---|---|---|
| SEC-PNL-01 | — | — | PoC rejoué | Auto-validation sans trace (NUL, audit hors transaction) | A06 | **RETEST_PASS, CLOSED** |
| SEC-PNL-02 | — | — | code + test | L'Audit approuve une baisse de taille | A06 | **RETEST_PASS, CLOSED** |
| SEC-PNL-03 | — | — | PoC rejoué | Baisse déclarée masquée par l'observé | A06 | **RETEST_PASS, CLOSED** |
| SEC-PNL-04 | LOW | 2,7 | code | Fabrication de « aucun tiers » sans notification | A06, HUMAN | **RETEST_FAIL (partiel)**, reste ouvert : la suspension n'est pas couverte |
| SEC-PNL-05 | — | — | PoC | Politique assouplie par l'administrateur seul | A06 | **RETEST_PASS, CLOSED** (résidu : SEC-PNL2-02) |
| SEC-PNL-06 | — | — | SQL runtime | Gardes en base 068–071 | A07 | **RETEST_PASS, CLOSED** |
| **SEC-PNL2-01** | **MEDIUM** | **4,3** | CONFIRMED (PoC) | Le client supprime les notifications obligatoires de gouvernance en coupant la connexion avant la réponse | A06 | REMEDIATION_REQUIRED (avant production) |
| **SEC-PNL2-02** | LOW | 2,7 | CONFIRMED (PoC) | « Tiers » fabriqué : un rôle ordinaire peut porter les permissions de décision de gouvernance. L'action passe alors sans marqueur, ou s'affiche « revue par un tiers » | HUMAN/A13, puis A06 | REVIEW_REQUIRED |
| **SEC-PNL2-03** | LOW | 2,2 | CONFIRMED (SQL runtime) | `self_validation_policy_requests` sans trigger de garde : contenu, auteur et décideur réécrits, APPLIED → PENDING | A07 | REMEDIATION_REQUIRED (non bloquant staging) |
| SEC-PNL2-I01…I11 | INFO | — | — | Voir la section INFO | divers | — |

## Les 7 points demandés

### 1. SEC-PNL-01 : **fermé.** PoC rejoué.

PoC `poc` (ControlExecutionService réel, politique `DOUBLE_CONFIRMATION`, personne d'autre ne peut valider, PG16) :

```
zod GovernanceConfirmationBody  reason "seul\u0000" -> refusé ; "​" seul -> refusé ; "a\u0085" (C1) -> refusé
service, reason "seul\u0000"     -> 409 GOVERNANCE_CONFIRMATION_REQUIRED, validated=false, audits=0
service, comment "c\u0000"       -> 22021, validated=false, audits=0   (effet + audit annulés ensemble)
service, reason "lone \ud800"    -> 22P02, validated=false, audits=0   (voir I02 : échec fermé, mais 500)
setSelfValidationPolicy("motif\u0000") -> ValidationError, policy reste REFUSE
```

- `reasonText()` (`api/validation.ts`) et `isAcceptableReason` (domaine) sont appliqués à la fois à la frontière HTTP et dans les services (`selfValidationOutcome`, `ConfigService`, D5).
- Les 7 validations restées sous double confirmation (exécution, efficacité, évaluation, clôture d'action, clôture de constat, clôture de cycle de revue, demande de mode d'évaluation) passent par `writeAudited` → `runAudited`. Chaque dépôt PostgreSQL déclare `auditsInTransaction = true` et transmet `audit` à `runAudited`, vérifié dans les 6 dépôts. La politique et ses demandes passent par `change()` dans une transaction. Les désignations aussi.
- Le seul texte client écrit tel quel dans le jsonb d'audit est le motif de la double confirmation (`newValueExtra.selfValidation.reason`). Il est désormais toujours dans la transaction de l'effet. Les chemins Comité (q159) n'en ont plus.
- Hors périmètre de DECISION-079 (déjà acté par A06/A14) : rejets, créations, mises à jour. Ces chemins n'écrivent pas de marqueur et ne sont donc pas des contournements du maker-checker.

### 2. SEC-PNL-02 / 03 / 05 / 06

- **02 fermé.** `orgprofile.approve` est retiré du groupe AUDIT et de `isAuditGroupPermission` (test D3 l. 187-188). `countOtherGovernanceMembers` ne compte plus que RM et Comité. L'Audit est prévenu de chaque baisse (`ORGPROFILE_SIZE_LOWERED`) et peut la contester (D5).
- **03 fermé.** La baisse est aussi évaluée sur le déclaré seul (`NO_OBSERVED`). Le scénario du PoC d'origine (300 déclarés et 300 observés → 15 déclarés) donne maintenant PENDING avec un tiers, et ACTIVE/ALONE avec le marqueur `orgprofile.adminAlone` sans tiers. Il n'existe pas de test de régression dédié : je recommande d'ajouter ce scénario dans D3.test (A06/A08).
- **05 fermé.** q158 est implémenté (voir point 3). Le résidu est SEC-PNL2-02.
- **06 fermé.** Rejoué sous `grc_app_runtime` :
  - profil inséré ACTIVE+CONFIRMED → 42501 ;
  - auteur d'un autre tenant → FK composite ;
  - désignation avec un utilisateur d'un autre tenant → FK ;
  - ré-armement (`valid_until`) → 42501 ;
  - `DELETE` sur les désignations → permission refusée ;
  - déclaration du régime « une personne » par le runtime → 42501 ;
  - acceptation insérée CONFIRMED → 42501 ;
  - `UPDATE` d'une revue → permission refusée ;
  - `UPDATE audit_log` → permission refusée.
  
  En revanche, 072 n'a pas reçu le même traitement : voir SEC-PNL2-03.

### 3. q158, circuit à deux personnes : **non contournable par l'auteur seul. Contournable avec un second compte choisi par l'administrateur (SEC-PNL2-02).**

| Scénario | Résultat |
|---|---|
| Auteur = approbateur | 403 au service (`getPendingRequestOrThrow`) **et** CHECK `svpr_maker_checker_check` en base. PoC : `ForbiddenError` |
| Approuver une demande remplacée | `UPDATE … WHERE status='PENDING'` atomique. PoC : `already been decided (WITHDRAWN)` |
| Assouplir sans approbateur connu | Échec fermé (`ValidationError`) si la requête d'éligibilité ou le dépôt sont absents |
| Sans tiers | Application directe, marqueur `config.selfvalidation.adminAlone` dans la même transaction, notification R-6.4 |
| Durcissement | Direct, sans marqueur (I07 de la revue précédente : corrigé) |
| **Approbateur fabriqué** | **Possible.** L'admin crée un rôle **ordinaire** avec `config.selfvalidation.approve` et l'attribue à un autre compte. `existsOther` le compte, ce compte approuve, et l'audit `APPROVE` ne porte aucun marqueur. PoC : `policy=DOUBLE_CONFIRMATION`, `configAudit=[{g:null,a:"APPROVE"}]`. Aucune notification aux groupes (le notifier ne suit que les rôles des groupes fixes). → SEC-PNL2-02 |
| Retrait / remplacement abusif | Tout appel à `PUT` retire la demande PENDING (audit `CLOSE`, motif « Replaced by a newer change »). Un **autre** administrateur peut aussi retirer la demande d'un collègue. C'est tracé, sans effet d'assouplissement : acceptable |
| Demande sans expiration | Une demande peut être approuvée des mois plus tard. Le risque est borné, car tout changement de politique la retire et l'approbateur voit le motif. INFO I04 |
| Contenu de la demande | Immuable par l'API, **réécrivable par SQL runtime** (y compris APPLIED → PENDING et l'échange `requested_by`/`decided_by`) → SEC-PNL2-03 |

### 4. q155, `last_seen_at` côté Google : **pas de falsification, mémoire bornée, mais la sémantique « dernière connexion » n'est pas tenue en multi-instances (I01).**

- Falsification : `iat` vient d'un jeton dont la signature, l'audience et l'émetteur sont vérifiés par Google avant la comparaison. Le client peut seulement alterner entre deux jetons valides qu'il possède déjà, et l'écriture reste plafonnée à une par heure (en mémoire, puis condition SQL). Pas d'amplification d'écriture.
- Mémoire : `lastIat` et `lastWrite` sont indexés par des `userId` issus de la base (membership vérifiée). Le volume est donc borné par le nombre de comptes, pas par l'attaquant. Même classe que I09 précédent.
- Multi-instances / Cloud Run : la `Map` est propre à chaque processus. Chaque démarrage à froid ou nouvelle instance voit **chaque** jeton comme « nouveau » et enregistre une « connexion » (limitée par la condition SQL d'une heure). Ajouté au renouvellement silencieux (environ 1 h), un onglet resté ouvert continue de faire paraître actif un compte dormant. C'est exactement R1 (GOV-ACC-01) que q155 voulait fermer. Il n'y a pas de gain direct pour un attaquant, mais le futur contrôle détectif de comptes dormants (D6) perd en fiabilité.
- Recommandation (simple) : stocker `last_token_iat` en base et écrire `UPDATE users SET last_seen_at = now(), last_token_iat = $3 WHERE … AND last_token_iat IS DISTINCT FROM $3`. Le résultat est atomique et indépendant de l'instance.

### 5. D5

- **Revues et contestations : PASS.**
  - Ajout seul : trigger 42501 sur UPDATE/DELETE, `REVOKE UPDATE, DELETE, TRUNCATE`, garde TRUNCATE.
  - Garde de tenant et exclusion de l'auteur **en base**, sur `audit_log.user_id`.
  - `reviewedBy` vient de l'acteur, corps `.strict()`.
  - Entrée non révisable = 404 identique à une entrée inconnue.
  - Unicité par (entrée, relecteur).
  
  Réserve I03 : seul l'auteur de la ligne d'audit est exclu, pas les autres « makers » (`makerIds`). Sur une clôture de plan d'action, le responsable (ou le créateur) qui n'a pas clôturé peut « revoir » l'exception, et l'objet s'affiche alors « revu par un tiers ».
- **Acceptations sans tiers : PASS sur le mécanisme.** ALONE → `ACTIVE` + marqueur `principle.acceptance.alone`, écrit dans la même transaction. Une acceptation ne peut pas naître confirmée (trigger d'INSERT). Contenu immuable, transitions bornées, CHECK `confirmed_by <> accepted_by`, `expires_at > now()` à la confirmation. Le « tiers » reste toutefois fabricable par un rôle ordinaire portant `governanceprinciple.acceptance.confirm`. PoC : `status ACTIVE, regime CONFIRMED`, aucun marqueur, expiration à **10 ans** acceptée (choix 5, aucune durée maximale). → SEC-PNL2-02, I04.
- **`acceptance.confirm` non donné à l'Audit : cohérent avec q157 (PASS).** `isAuditGroupPermission` n'ouvre à l'Audit que `review` et `acceptance.revoke`. Le `revoke` par l'Audit d'une acceptation CONFIRMED revient à mettre fin à une décision RM/Comité. C'est un durcissement, donc acceptable du point de vue sécurité ; à confirmer par A13/A14 (I08).
- **Middleware de notifications :**
  - Fuite inter-tenant : **non.** `rowsForRequest` filtre par `tenant_id`, `request_id`, `user_id` de l'acteur et une fenêtre de 10 min. `holdersOf`, `groupMembers` et `managerId` sont filtrés par tenant. Les messages ne nomment personne et `triggeredBy` ne va que dans l'audit.
  - Notification avant commit : **non.** Les services attendent le COMMIT avant de répondre, et l'événement `finish` survient après la réponse.
  - Public : correct dans l'ensemble. L'auteur est exclu. Le RM retiré n'est pas prévenu (écart mineur à ma reco SEC-PNL-04 n° 1). La vacance RM est silencieuse, conformément à q160.
  - **Mais le déclenchement sur `finish` est supprimable par le client → SEC-PNL2-01.**
- **Masquage sans `audit.read` : PASS sur la liste** (`acceptedBy`/`confirmedBy`/`endedBy` nuls, `mine`). Réserve I05 : les réponses de `accept`/`confirm`/`reject`/`revoke` renvoient les uuid non masqués.
- **SEC-PNL-04 : réduit, pas fermé.** `GOVERNANCE_MEMBER_REMOVED` couvre le retrait de rôle, hors passation et hors vacance. Restent silencieux :
  - la **suspension** d'un membre Audit ou Comité (`user.delete`, aucune ligne `Role`) ;
  - la **réactivation**, qui ne déclenche pas R-6.3 (le message aux arrivants n'est émis que sur une attribution de rôle) ;
  - la vacance du dernier RM (q160, accepté par le PO).
  
  Chaîne silencieuse, entièrement tracée dans l'audit mais sans aucune notification : vacance RM → suspension des membres Comité et Audit → acceptation, politique ou double confirmation en ALONE (le marqueur notifie les détenteurs de `governanceexception.review`, alors tous suspendus, et le « manager ») → réactivation. Reco : notifier aussi sur `User` suspend/reactivate quand le compte est membre d'un groupe fixe, et traiter la réactivation d'un membre Audit ou Comité comme une arrivée (R-6.3).

### 6. Frontend F0/F1/F2 : **PASS.**

- Aucune règle de sécurité côté client. Le dialogue de double confirmation ne s'ouvre que sur le 409 du serveur, renvoie la même requête avec le motif, et affiche tel quel le 400 du serveur. Les raccourcis ne font que naviguer. L'ancien `AdminPage` est supprimé ; les écrans réagissent au 403.
- Aucune donnée sensible exposée : pas de `dangerouslySetInnerHTML`, de stockage navigateur, de nouvelle `VITE_*` ni de `console`. L'onglet « Historique » lit `GET /audit-logs`, gardé par `audit.read` côté serveur. Les messages du serveur sont rendus comme du texte React (échappé).
- `ApiError.code` est dérivé d'un préfixe de message (I06). Il n'y a pas d'impact sécurité : seul `GOVERNANCE_CONFIRMATION_REQUIRED` avec un statut 409 est exploité, et cela ouvre seulement un dialogue (la décision reste au serveur). Je n'ai trouvé aucun 409 dont le message commence par du texte client. À remplacer par un champ `code` structuré (besoin backend n° 4 déjà ouvert).

### 7. Nouvelles routes : **PASS, avec I10.**

| Route | Tenant | Attribution | Bornes | Permission |
|---|---|---|---|---|
| `PUT /config/self-validation-policy` (202 `pendingRequest`) | acteur | `requested_by`/`updated_by` = acteur | enum + `reasonText` | `config.selfvalidation.set` |
| `GET /config/self-validation-policy/request` | acteur | — | — | `.set` ou `.approve` |
| `POST /config/self-validation-policy/requests/:id/approve` / `reject` | `getById(tenant, id)` | `decided_by` = acteur | `reasonText` ; `:id` non validé en uuid (I10) | `config.selfvalidation.approve` (dédiée, différente de `.set`) |
| `POST /governance-exceptions/:auditLogId/reviews` | service + trigger | `reviewed_by` = acteur, `.strict()` | `z.guid()`, `reasonText(500)`, limitation de débit par utilisateur | `governanceexception.review` |
| `GET/POST /governance-principle-acceptances[/:id/confirm|reject|revoke]` | acteur | `accepted_by`/`confirmed_by`/`ended_by` = acteur, `.strict()` | `z.guid()`, regex `principleId` ≤ 40, `reasonText(500)`, limitation de débit par utilisateur | `accept` / `acceptance.confirm` / **`acceptance.revoke` dédiée à l'effet terminal** |
| Rôles, utilisateurs, désignations, profil (motifs) | inchangé | inchangé | `reasonText` | inchangé |

Aucun `z.array` nu ajouté dans `api/v1` (garde `boundedArray` verte). Aucun champ `…By` acceptable depuis le client.

---

## Findings détaillés

### SEC-PNL2-01 — Notifications obligatoires de gouvernance supprimables en coupant la connexion

- **ASSET / COMPONENT** : notifications obligatoires D5 (R-6.4 `GOVERNANCE_EXCEPTION_RECORDED`, q157 `ORGPROFILE_SIZE_LOWERED`, q158 `SELF_VALIDATION_POLICY_REQUEST_PENDING`, SEC-PNL-04 `GOVERNANCE_MEMBER_REMOVED`, R-6.3). Fichiers : `backend/src/api/middleware/governanceNotifications.ts` et `GovernanceNotifier`.
- **PRECONDITION** : n'importe quelle mutation qui écrit une ligne d'audit marquée ou suivie. Exemple : un validateur sous `DOUBLE_CONFIRMATION` qui confirme sa propre saisie (PR:L), ou un administrateur qui assouplit seul, accepte seul, ou retire un membre.
- **CAUSE RACINE** : le notifier n'est déclenché que sur `res.on("finish")` avec `statusCode < 300`. Si le client ferme la socket après l'envoi de la requête, Express poursuit le traitement : le service committe l'effet et l'audit, mais `finish` n'est jamais émis (seul `close` l'est). Même effet pour toute erreur après le commit (5xx dans la mise en forme de la réponse, crash, arrêt d'instance entre COMMIT et réponse).
- **OBSERVED** (PoC, vrai middleware, Express du dépôt) : `committed=["normal","aborted"] notified=["normal"]`. La requête coupée à 20 ms est appliquée mais jamais notifiée.
- **IMPACT** : la compensation retenue par le PO pour q157, R-6.4 et SEC-PNL-04 (« les tiers sont prévenus ») est contournable à volonté par l'auteur. Le marqueur reste dans l'audit et le compteur du panel, donc ce n'est pas une suppression de trace (contrairement à SEC-PNL-01) : c'est la perte du contrôle détectif « poussé ».
- **CVSS 3.1** : AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N = **4,3 MEDIUM**. 2,7 si l'on retient l'administrateur (PR:H).
- **RECOMMANDATION** (la plus simple d'abord) :
  1. écrire les notifications dues **dans la transaction de l'effet** (table « boîte d'envoi » alimentée par le même `TransactionalAudit`, ou insertion directe des notifications, puisque `runAudited` dispose déjà du client) ;
  2. à défaut, un balayage périodique des lignes d'audit marquées ou suivies sans notification correspondante (rattrapage) ;
  3. palliatif minimal : déclencher sur `close` **et** `finish` en vérifiant que le gestionnaire a fini (encapsuler `res.end`), et non sur la seule remise de la réponse au socket.
- **REGRESSION_TEST** : client qui coupe la connexion avant la réponse sur une validation marquée → au moins une notification `GOVERNANCE_EXCEPTION_RECORDED` existe après la fin du traitement.
- **STATUS** : REMEDIATION_REQUIRED (A06), avant production. Non bloquant pour staging.

### SEC-PNL2-02 — « Tiers » fabriqué par un rôle ordinaire portant une permission de décision de gouvernance

- **COMPONENT** : `RoleService.create`/`update` (`assertRolePermissionRules(null, …)` n'interdit rien de ce périmètre), `PostgresGovernanceQueries.existsOther` (compte toute détention de la permission, y compris par un rôle ordinaire), `ConfigService` (q158), `GovernancePrincipleAcceptanceService` (q138), `GovernanceExceptionService` (R-1), `OrganizationProfileService.approve`.
- **SCÉNARIO** (PoC, services réels, PG16) : l'admin A crée le rôle ordinaire « Assistant » avec `config.selfvalidation.approve`, `governanceprinciple.acceptance.confirm` et `governanceexception.review`, puis l'attribue au compte B (n'importe quel autre compte du tenant, maker-checker « pas à soi-même » respecté). Résultats :
  - assouplissement → PENDING, B approuve, politique `DOUBLE_CONFIRMATION`, audit `APPROVE` **sans marqueur** ;
  - acceptation → PENDING, B confirme, `ACTIVE/CONFIRMED`, **aucun marqueur**, expiration à 10 ans ;
  - action marquée → B la « revoit », `WITHOUT_INDEPENDENT_REVIEW` → **`REVIEWED_BY_THIRD_PARTY`**.
  
  L'attribution d'un rôle ordinaire ne notifie personne.
- **IMPACT** : le « second » est choisi par l'auteur hors des groupes RM et Comité que q157, q158 et R-1 désignent. Les marqueurs « sans tiers » disparaissent et le panel affiche un contrôle indépendant qui n'en est pas un. Il faut un second compte complice ou contrôlé ; tout est tracé dans l'audit (`Role CREATE`, `ROLE_CHANGE`).
- **CVSS 3.1** : AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N = **2,7 LOW**.
- **RECOMMANDATION** (à arbitrer par HUMAN/A13, car cela touche au modèle RBAC) :
  1. la plus simple : réserver `config.selfvalidation.approve`, `governanceprinciple.acceptance.confirm`, `governanceexception.review` et `orgprofile.approve` aux groupes fixes, dans `assertRolePermissionRules` (même modèle que `rolegroupAuditPermissionAllowedOn`), avec le rattrapage SQL des rôles existants ;
  2. complément : refuser une approbation ou confirmation par un compte dont le rôle porteur a été attribué **par l'auteur** de la demande (`user_roles.assigned_by`) ;
  3. notifier les groupes fixes de toute attribution d'une permission de décision de gouvernance.
- **REGRESSION_TEST** : création ou mise à jour d'un rôle ordinaire avec l'une de ces 4 permissions → 400 ; `existsOther` ne compte pas un tel rôle.
- **STATUS** : REVIEW_REQUIRED (HUMAN/A13), puis A06.

### SEC-PNL2-03 — `self_validation_policy_requests` sans garde en base (072)

- **OBSERVED** (SQL sous `grc_app_runtime`) :
  - après APPLIED, `UPDATE … SET reason='rewritten', requested_by=<B>, decided_by=<A>` est accepté (le CHECK maker-checker reste vrai pour la nouvelle paire) ;
  - `UPDATE … SET status='PENDING', decided_by=NULL, decided_at=NULL` est accepté : la demande appliquée est rouverte.
- **IMPACT** : la demande, qui sert de preuve du circuit à deux personnes, est réécrivable (auteur, approbateur, motif) et rouvrable. Ce n'est atteignable que par SQL direct ; c'est la même classe que SEC-PNL-06, dont 072 n'a pas profité. L'audit `audit_log` reste intact (UPDATE refusé au runtime).
- **CVSS 3.1** : AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N = **2,2 LOW**.
- **RECOMMANDATION** (A07, nouvelle migration 074+ puisque 072 a pu être appliquée sur des bases de recette locales ; `SET search_path = pg_catalog, public, pg_temp` à chaque définition) :
  - trigger BEFORE INSERT : PENDING uniquement, aucune colonne de décision ;
  - BEFORE UPDATE : contenu immuable (`requested_policy`, `reason`, `requested_by`, `requested_at`, `tenant_id`) ; une seule transition PENDING → APPLIED, REJECTED ou WITHDRAWN, jamais de retour ;
  - BEFORE DELETE/TRUNCATE : refus.
  
  `reopen()` (chemin des faux de test) deviendra alors impossible sur PostgreSQL. Ce n'est pas un problème, car le chemin transactionnel ne l'utilise pas.
- **STATUS** : REMEDIATION_REQUIRED (A07), non bloquant pour staging.

---

## INFO

- **I01 — q155 multi-instances** (point 4) : `iat` suivi en mémoire par processus, donc chaque nouvelle instance ou démarrage à froid enregistre une « connexion ». Reco : persister `last_token_iat` et faire la comparaison en SQL (A06, avant D6).
- **I02 — `reasonText` accepte les surrogates isolés** (`\p{Cs}`). PostgreSQL refuse `\ud800` en jsonb (22P02). Sur les chemins transactionnels, l'échec est fermé mais renvoie un 500 au lieu d'un 400. Reco : ajouter `\p{Cs}` à la classe refusée (ou `String.prototype.isWellFormed()`), et l'ajouter au test `reasonText.test.ts`.
- **I03 — Revue par un autre « maker »** : la garde (service et trigger) n'exclut que l'auteur de la ligne d'audit. Pour `ActionPlan.close` (makers = créateur + responsable), l'autre maker peut « revoir ». Reco : écrire `makerIds` dans `newValue.selfValidation` et les exclure dans le service (et, si possible, dans le trigger via `new_value`).
- **I04 — Durées** : une demande d'assouplissement PENDING n'expire jamais (point 2 de la ligne « Lot arbitrages PO »). Les acceptations n'ont aucune durée maximale (choix 5 du lot D5 ; 10 ans acceptés dans le PoC). Ce sont des choix PO, mais ils fragilisent q138 (« pour un temps limité »). Reco A13 : plafond (par exemple 12 mois) et expiration des demandes (par exemple 30 jours).
- **I05 — Masquage incomplet** : `accept`/`confirm`/`reject`/`revoke` renvoient `acceptedBy`/`confirmedBy`/`endedBy` (uuid) à un acteur sans `audit.read`. Seule la liste applique R-6.1. À aligner (A15, avec D6).
- **I06 — `ApiError.code` par préfixe de message** : voir le point 6. Remplacer par un `code` structuré côté backend (besoin n° 4 de F1).
- **I07 — 068 à 071 modifiées en place** : c'est acceptable seulement si ces migrations n'ont jamais été appliquées sur une base partagée (Neon staging ou prod). Sinon `schema_migrations` les sauterait et les gardes SEC-PNL-06 seraient absentes. À confirmer par A09/HUMAN avant la PR staging.
- **I08 — `acceptance.revoke` à l'Audit** : mettre fin à une acceptation CONFIRMED revient à annuler une décision RM/Comité. C'est un durcissement, donc acceptable en sécurité ; la cohérence avec « l'Audit ne décide jamais » est à confirmer (A13/A14).
- **I09 — `X-Request-Id` fourni par le client** et réutilisé comme clé de lecture du notifier : filtré par acteur et tenant, dédoublonné en mémoire et par `skipIfUnread`. Négligeable.
- **I10 — `:id` non validé en uuid** sur `/config/self-validation-policy/requests/:id/approve|reject` : un id mal formé donne probablement un 22P02, donc un 500. Utiliser `z.guid()` comme dans les routes D5.
- **I11 — `ValidateCommitteeBody`** (`treatmentDecisions.routes.ts`) accepte encore `governanceConfirmation`, ignoré par le service (q159). Sans effet ; à nettoyer.

## Outillage et reproduction

- Cluster jetable : `initdb`/`pg_ctl` via `setpriv --reuid=postgres`, socket `/tmp/a10_pnl2/sock`, port 5547, base `grc_a10_pnl2`, rôles `grc_owner` (SUPERUSER) et `grc_app_runtime`. La table `schema_migrations` doit être créée avant 043. Les `.sql` hors `.down` sont appliqués avec `--single-transaction`.
- Suites `-pg` : `QA_SWP_PGHOST=/tmp/a10_pnl2/sock QA_SWP_PGPORT=5547 QA_SWP_PGDB=grc_a10_pnl2 QA_D2C_PGDB=grc_a10_pnl2`.
- Les scripts PoC (fichiers de test temporaires, SQL runtime) n'ont pas été commités. Aucun code de production n'a été modifié.
