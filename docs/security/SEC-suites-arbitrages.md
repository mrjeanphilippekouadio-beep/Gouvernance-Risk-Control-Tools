# Revue Sécurité (A10) — lot « suites des arbitrages » (DECISION-083 / 086)

- Branche : `feat/r1-suites-arbitrages`, diff `origin/staging...HEAD` (29 fichiers, migration 075).
- Méthode : revue statique du code + `npx vitest run test/D1 D2b D4 D5` (63 pass, 4 skip). Pas de rejeu sur vrai Postgres.
- Verdict : **VERT avec réserves**. Aucune escalade HUMAN (max CVSS 2,7). Deux points relèvent d'un arbitrage PO (F-SAD-01, F-SAD-02) : A10 qualifie et propose, ne tranche pas.

## Synthèse

| ID | Sévérité | CVSS 3.1 | Confiance | Titre | Porteur |
|---|---|---|---|---|---|
| F-SAD-01 | LOW | 2,7 | CONFIRMED (code) | Assouplir un délai (q169, q174) est un acte d'une seule personne, sans marqueur ni notification ; un admin peut désarmer q169 puis accepter seul | HUMAN (arbitrage), puis A06 |
| F-SAD-02 | LOW | 2,2 | CONFIRMED (code) | L'expiration q174 est recalculée avec le réglage courant : une demande échue « ressuscite » si le délai est allongé ou effacé | A06 (+ HUMAN si F-SAD-01 retenu) |
| F-SAD-03 | INFO | — | CONFIRMED (code) | Contrôle d'expiration hors transaction, non rejoué au claim | A06 |
| F-SAD-04 | INFO | — | CONFIRMED (code) | `setGovernanceDelays` exige `config.read` en plus (via `this.get`) | A06 |
| F-SAD-05 | INFO | — | CONFIRMED (code) | q169 : plafond appliqué à toute acceptation (pas seulement « seul »), non réappliqué aux acceptations existantes ; q168 stocké, consommé nulle part | A06 / A13 |

## Point 1 — `config.governancedelays.set` et rattrapage 075 : PASS

- Liste du rattrapage (`075_governance_delays.sql:15-32`) = `ADMIN_PERMISSIONS` avant ajout, à l'identique des rattrapages 069/071/073 (vérifié aussi par `D1.test.ts:53`, `D2b.test.ts:232`). Rien de deviné.
- Seuls des porteurs déjà « administrateur » q63 reçoivent la permission : **aucun nouvel administrateur créé**, aucune règle de cumul q63 nouvellement déclenchée par la migration.
- `system_group IS NULL AND deleted_at IS NULL` : les groupes fixes ne la reçoivent pas (un rôle de groupe RM portant des droits admin, cas F-B8t-01, n'est pas étendu : choix conservateur, fail-closed). `isAuditGroupPermission` ne l'admet pas pour l'Audit.
- `users.roles` (legacy, admin d'amorçage) : pas de filtre sur les comptes suspendus, comme en 073 ; sans effet tant que le compte est suspendu.
- Effet futur sur q63 : la permission est dans `ADMIN_PERMISSIONS` (`fixedGroupPermissions.ts:96-97`), donc l'accorder **seule** à un rôle fait de son porteur un administrateur, avec les règles de cumul q63. C'est cohérent avec la nature du réglage (il assouplit des contrôles, cf. point 2) ; à confirmer si le PO voulait un réglage délégable hors « administrateur ».
- Down : retire la permission et les colonnes en une transaction. RAS.

## Point 2 — assouplir un délai par une seule personne : F-SAD-01 (LOW 2,7)

FINDING_ID: F-SAD-01
ASSET: contrôles de gouvernance q169 (durée maximale d'une acceptation faite seul) et q174 (expiration d'une demande d'assouplissement)
COMPONENT: `backend/src/services/ConfigService.ts:283-307` (`setGovernanceDelays`), `backend/src/services/GovernancePrincipleAcceptanceService.ts:78-81`
ENDPOINT: `PUT /api/v1/config/governance-delays`
PRECONDITION: porteur de `config.governancedelays.set` (tous les admins après 075).
DESCRIPTION: allonger un délai ou le passer à `null` (« non configuré ») s'applique immédiatement, avec motif et audit, mais sans seconde personne, sans marqueur `governanceException` et donc sans notification (le `GovernanceNotifier` ne réagit qu'aux lignes marquées). Durcir et assouplir suivent le même chemin.
ATTACK_SCENARIO: un administrateur porte aussi `governanceprinciple.accept` (accordé aux admins par `073_governance_reviews_acceptances.sql:225-233`). Il (1) efface `acceptanceMaxDays` (motif libre), (2) accepte un principe non respecté avec `expiresAt` à dix ans ; sans tiers éligible, l'acceptation est ACTIVE `regime=ALONE`. Le cas précis que q169 visait (« acceptation faite seul ») est désarmé par la même personne en deux requêtes. Variante q174 : voir F-SAD-02.
EXPECTED: cohérence avec q158 / DECISION-078 (« tout assouplissement… confirmé par une seconde personne quand elle existe ; l'admin seul uniquement sans tiers, marqueur `adminAlone` ») et la position A10 DECISION-055 (un assouplissement se gouverne comme une attribution de rôle).
OBSERVED: aucun circuit, aucun marqueur. Trace : ligne d'audit `Config UPDATE` avec avant/après et motif (reconstructible a posteriori, non détecté en temps réel).
IMPACT: intégrité d'un contrôle de gouvernance ; pas de fuite, pas d'élévation de privilège.
EXPLOITABILITY: PR:H, deux requêtes, traçable. CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N = 2,7.
QUALIFICATION (pour le PO, A10 ne tranche pas) : q158 porte formellement sur la seule politique d'auto-validation ; DECISION-083 dit « paramétrable, valeur fixée par le PO » sans préciser qui modifie ensuite ni comment. L'écart n'est donc pas une violation d'une décision écrite, mais il recrée, sur les délais, exactement la situation que q158 a fermée sur la politique.
RECOMMENDATION (options, de la plus légère à la plus forte) :
- (a) Minimum : marquer d'un `governanceException` (ex. `config.governancedelays.relaxed`) tout allongement ou effacement ; le notifier existant prévient alors le gérant et les porteurs de `governanceexception.review`, et l'acte entre dans la file de revue q168. Durcissement : direct, non marqué (même règle que la politique).
- (b) Aligné sur q158 : allongement/effacement en demande PENDING confirmée par un tiers quand il existe (`config.selfvalidation.approve` ou permission dédiée), seul + marqueur `adminAlone` sinon. Réutilise le circuit 072.
- (c) Indépendamment : interdire à une même personne d'accepter seule un principe dans les N jours suivant son propre assouplissement de `acceptanceMaxDays` (ou tracer ce lien dans l'audit de l'acceptation). Plus coûteux, à n'envisager que si (a)/(b) sont refusés.
REGRESSION_TEST: un allongement/effacement produit soit un PENDING (b), soit une ligne marquée + notification (a) ; un durcissement reste direct et non marqué.
CONFIDENCE: CONFIRMED (lecture de code). SEVERITY: LOW. STATUS: REVIEW_REQUIRED (HUMAN).

## Point 3 — q174 : F-SAD-02 (LOW 2,2), F-SAD-03 (INFO)

- Calcul sur `requestedAt` : correct (`ConfigService.ts:501-503`, test `D4.test.ts` « q174 »). Une demande échue reste rejetable (`rejectSelfValidationPolicy` ne contrôle pas l'expiration : un rejet est un durcissement, normal) et remplaçable (`setSelfValidationPolicy` la passe WITHDRAWN). Elle reste en base au statut PENDING indéfiniment ; l'écran l'affiche « en attente » avec sa date d'expiration. Acceptable.

FINDING_ID: F-SAD-02
COMPONENT: `ConfigService.ts:423` (vue), `:435` (approbation), `:501` (`requestExpiry`)
DESCRIPTION: l'échéance n'est pas figée à la soumission ; elle est recalculée à chaque lecture avec la valeur **courante** de `policyRequestExpiryDays`.
ATTACK_SCENARIO: demande soumise avec un délai de 7 j, échue au jour 8. Un admin (l'auteur lui-même s'il porte `config.governancedelays.set`, ce que 075 donne à tout porteur de `config.selfvalidation.set`) passe le délai à `null` ou 3650 : la demande redevient approuvable. Le maker-checker tient (un tiers doit encore approuver), seule la règle « une demande échue ne peut plus être approuvée » (q174) est contournée. Inversement, raccourcir le délai fait échoir rétroactivement les demandes en cours (durcissement, sans risque).
CVSS: AV:N/AC:L/PR:H/UI:R/S:U/C:N/I:L/A:N = 2,2.
RECOMMENDATION: figer `expires_at` sur la demande à la soumission (colonne sur la table des demandes, A07), ou au minimum calculer avec `min(délai à la soumission, délai courant)`. Si F-SAD-01 option (a)/(b) est retenue, l'allongement serait de toute façon tracé/confirmé.
REGRESSION_TEST: soumettre à 7 j, avancer à 8 j, passer le délai à `null` : l'approbation reste refusée (409).
STATUS: REMEDIATION_REQUIRED (A06/A07).

FINDING_ID: F-SAD-03 (INFO)
`ConfigService.ts:433-438` : la configuration et l'expiration sont lues hors transaction ; le claim (`applyPolicyChange` -> `repo.change`) ne revérifie que `status = 'PENDING'`. Fenêtre de quelques millisecondes à l'instant d'échéance, ou face à un raccourcissement concurrent du délai. Pas exploitable de façon utile. Si l'échéance est figée (F-SAD-02), ajouter `AND (expires_at IS NULL OR expires_at > now())` au claim ferme les deux d'un coup.

## Point 4 — q170 notification : PASS

- `GovernanceNotifier.ts:140-152` : destinataire = `newValue.acceptedBy` d'une ligne d'audit écrite par le serveur (`revoke`, `GovernancePrincipleAcceptanceService.ts:170-191`) ; `acceptedBy` n'a jamais été fourni par le client. Les lignes sont lues par `rowsForRequest(tenant, requestId, actorId)` : tenant-scopé, même acteur, même requête.
- Message fixe, sans nom ni motif de révocation (le motif peut citer des personnes : bon choix de ne pas le recopier). `triggeredBy` = acteur, comme toutes les notifications de gouvernance existantes (non nouveau).
- Auto-révocation : l'acteur est dans `told`, donc pas de notification à soi-même. La fermeture « échue, remplacée » (oldValue sans `status`) est exclue par la condition. Type ajouté au catalogue en `mandatory`.

## Point 5 — `getPendingSelfValidationPolicyRequest` sans `config.read` : PASS (INFO)

- `ConfigService.ts:416-424` : la lecture directe est tenant-scopée (`actor.tenantId`) et n'expose qu'une date dérivée (`expiresAt`), à des personnes déjà autorisées à voir la demande (`config.selfvalidation.set` ou `.approve`). Aucun autre champ de configuration n'est renvoyé. Pas de fuite.
- Remarque : `approveSelfValidationPolicy` appelle `this.get(actor)` (`:433`) qui, lui, exige `config.read` : un approbateur sans `config.read` voit la demande mais ne peut pas l'approuver (pré-existant, fail-closed).

## Autres INFO

- **F-SAD-04** : `setGovernanceDelays` appelle `this.get(actor)` (`ConfigService.ts:301`), donc exige `config.read` après `config.governancedelays.set`. Un rôle admin rattrapé par 075 sans `config.read` reçoit 403. Fail-closed ; à aligner (lire via `getByTenant` comme au point 5) ou documenter.
- **F-SAD-05** : (i) q169 vise « une acceptation faite seul », le plafond s'applique à toutes (`GovernancePrincipleAcceptanceService.ts:78-81`, avant le calcul de `alone`) : plus strict que décidé, à confirmer A13 ; (ii) raccourcir `acceptanceMaxDays` ne touche pas les acceptations ACTIVE existantes (même leçon que F-B9b-01 : un plafond de configuration mutable protège l'écriture, pas le stock) ; (iii) `exceptionReviewDelayDays` est stocké et affiché mais consommé nulle part (relances q180 en attente) : à ne pas présenter comme un contrôle actif.
- Entrée : `GovernanceDelaysBody` est `.strict()`, entiers 1..3650 ou `null`, revalidé côté service et par CHECK SQL ; motif obligatoire ; audit avant/après dans la même transaction (`writeAudited`). Pas de mass assignment.

## Hors périmètre / limites

- Pas de rejeu sur Postgres réel (migration 075 non jouée). Frontend : lecture seule, aucun sink HTML, valeurs numériques rendues en texte.
