# Passage Compliance (A14) : panel de gouvernance, lot D5 et correctifs DECISION-077/078/079 (2026-10-19)

Statut : **recommandations, en attente d'arbitrage PO** pour les points marqués « arbitrage PO requis ». Revue de suivi de `docs/compliance/review-panel-d1-d4-2026-10-18.md` (constats CMP-PNL-01 à 17). Nouveaux constats : CMP-PNL2-01 à 13.

## 0. Périmètre, base et limites

- Base : tête `9a86fb8` de la branche `claude/grc-tools-orchestrator-handoff-epk0y5`, telle qu'indiquée par l'orchestrateur ; je n'ai pas Bash et n'ai pas pu la vérifier. Fichiers lus en lecture seule dans le checkout principal `/home/user/Gouvernance-Risk-Control-Tools` ; des modifications non commitées ne sont pas exclues.
- Lu : migrations 072 et 073 ; `GovernanceExceptionService`, `GovernancePrincipleAcceptanceService`, `GovernanceNotifier`, `governanceNotifications.ts` ; `ConfigService` (circuit q158, `applyPolicyChange`) ; `auditedWrite.ts` ; `PostgresAuditRepository` (`insertAuditEvent`, `runAudited`) ; `PostgresSelfValidationPolicyRequestRepository`, `PostgresGovernanceExceptionReviewRepository`, `PostgresGovernancePrincipleAcceptanceRepository`, `PostgresGovernanceQueries` (`forEntities`, `rowsForRequest`, `unreviewedExceptionCount`) ; extrait de `TreatmentDecisionService` (chemin Comité) ; câblage `server.ts` (lignes 304-310, 438-444, 543, 595) ; `notificationCatalog.ts` ; route `governanceExceptions.routes.ts` (un seul `POST /:auditLogId/reviews`).
- Non fait : tests non exécutés ni relus ; les 7 services de validation et leurs dépôts vus par recherche (`writeAudited`, `auditsInTransaction`), pas relus ligne à ligne ; `OrganizationProfileService` (q157) non relu, je m'appuie sur la migration 073, le notifieur et DECISION-078 ; migrations 072/073 jamais appliquées par moi.
- Sourcing : aucun texte réglementaire consulté, aucun article cité. Principes seulement : séparation des tâches incompatibles et contrôles de remplacement quand elle n'est pas praticable (COSO, de mémoire), proportionnalité (ISO 31000), trois lignes (la 3e ligne n'assume pas de responsabilité de gestion, de mémoire), exception = durée, échéance, revue (règle interne de mon brief). L'applicabilité des textes BCEAO à Djamo reste à confirmer par les juristes.

## 1. Synthèse

| Question | Avis | Constats |
|---|---|---|
| Q1. Constats CMP-PNL-01 à 17 | 4 fermés (01, 03, 04, 11), 2 partiels (02, 10), 2 clos par arbitrage PO avec risque accepté (08, 09), 9 ouverts (05, 06, 07, 12, 13, 14, 15, 16, 17) | §3 |
| Q1. COMPLIANCE_BLOCK de production | **Levé pour le code et pour la recette / staging. Maintenu sous une condition unique pour la production** : une voie de consultation des exceptions non revues | CMP-PNL2-01 |
| Q2. Revue par un tiers + contestation comme compensation | **Conforme avec réserve** | CMP-PNL2-01 à 04 |
| Q2. Acceptation `alone`, sans durée maximale | **Arbitrage PO requis** | CMP-PNL2-05, 13 |
| Q2. Audit : révocation sans confirmation | **Conforme avec réserve** (question au PO) | CMP-PNL2-06 |
| Q3. q160 | **Pris acte** ; risque résiduel à consigner, sans rouvrir | CMP-PNL2-11 |
| Q4. Circuit q158 | **Conforme avec réserve** ; demande sans expiration : acceptable | CMP-PNL2-07 à 09 |
| Q5. Append-only | `audit_log` **conforme** ; écarts autour | CMP-PNL2-08, 10, 12 |

## 2. Points conformes (à ne pas dégrader)

1. Atomicité : `insertAuditEvent` est l'unique INSERT dans `audit_log`, appelé avec le client de transaction par `runAudited` et par les dépôts de revue/acceptation ; un audit refusé annule l'acte (revue, acceptation, confirmation, rejet, révocation, demande de politique, approbation, rejet, retrait, désignations).
2. Revue : table en ajout seul (trigger INSERT-only + garde TRUNCATE + REVOKE UPDATE/DELETE/TRUNCATE), auteur ≠ relecteur en base **et** dans le service, entrée d'audit du même tenant vérifiée en base, `search_path = pg_catalog, public, pg_temp` épinglé et répété par `ALTER FUNCTION`, `reviewedBy` forcé à `actor.userId`, FK composites `(tenant_id, user)`.
3. Une contestation (`CONTESTED`) ne change aucun état et ne vaut pas revue (`forEntities` ne compte que `REVIEWED`) : l'Audit ne décide pas.
4. Acceptation : contenu immuable après INSERT (trigger), une ligne ne naît jamais confirmée, transitions bornées, maker-checker en base (`confirmed_by <> accepted_by`, rejet idem), expiration non stockée mais calculée (une acceptation échue ne reste pas active silencieusement, et ne peut plus être confirmée), permission de fin dédiée (`acceptance.revoke`), motif obligatoire à l'acceptation, au rejet et à la révocation, identités masquées sans `audit.read`.
5. q157 : l'Audit n'a ni `orgprofile.approve` ni `acceptance.confirm` ni `config.selfvalidation.approve` (072, 073). q159 : le chemin Comité des décisions de traitement n'appelle plus la porte (`TreatmentDecisionService`, ligne 179).
6. q158 : l'assouplissement attend un tiers quand il existe ; le durcissement reste immédiat ; le marqueur `config.selfvalidation.adminAlone` n'est posé que sur l'assouplissement réellement fait seul (le défaut de CMP-PNL-03 point 3 est corrigé) ; fail closed si le port ou le dépôt de demandes manque (`ValidationError`, mieux que la valeur « tiers existant » que je relevais) ; approbateur ≠ demandeur dans le service et par CHECK ; revendication conditionnelle `status = 'PENDING'` dans la transaction ; une seule demande en attente par tenant (index unique).
7. Notifications : types obligatoires au catalogue, émission après réponse de succès, jamais avant le commit, sans bloquer la réponse, messages sans nom de personne, déduplication par ligne d'audit, destinataires calculés côté serveur, auteur exclu.

## 3. Q1a. État des constats CMP-PNL-01 à 17

| Réf. | Sujet | État | Raison |
|---|---|---|---|
| 01 | Audit non atomique | **Fermé** pour le périmètre DECISION-079 | §2 point 1. Hors périmètre, audit encore après l'effet : rejets, créations et mises à jour des autres services (déclaré dans ACTION_ITEMS). Le contrôle détectif « validateur = auteur sans marqueur » reste dû (voir 05) |
| 02 | Compensation incomplète sans D5 | **Partiel** | Structure livrée (revue, contestation, 8 notifications). Efficacité non démontrée : pas de liste des non-revues avant D6 (CMP-PNL2-01), pas de délai (CMP-PNL2-02), contestation sans suite (CMP-PNL2-03) |
| 03 | Politique modifiable par l'admin seul | **Fermé** avec réserves | q158 construit (§2 point 6). Réserves CMP-PNL2-07 à 09 |
| 04 | Chemins Comité dans la porte | **Fermé** | q159 implémenté, vu dans `TreatmentDecisionService` ; `RiskEvaluationService` n'appelle la porte qu'à la ligne 522 (validation ordinaire) |
| 05 | Pool de validateurs vidé | **Ouvert** | Détecteur D6 non livré ; la même classe de manipulation existe pour q158 et l'acceptation (CMP-PNL2-10) |
| 06 | Étiquette « sans validation indépendante » | **Ouvert** | Agrégats et exports (D6/D7) |
| 07 | Périmètre non documenté, câblage non testé | **Ouvert** | Non revérifié. Aggravé par le repli silencieux de `writeAudited` (CMP-PNL2-12) |
| 08 | Vacance du dernier RM | **Clos par arbitrage PO** (q160) | Traçabilité inchangée et conforme ; alerte et délai écartés ; risque résiduel à consigner (CMP-PNL2-11) |
| 09 | Intérimaire sans fin | **Clos par arbitrage PO** (q160/q161) | Intérimaire échu non utilisé (q161) conservé ; pas d'alerte |
| 10 | `governance_designations` | **Partiel** | Audit dans la transaction (fait, `runAudited`) ; trigger d'immuabilité, REVOKE et permission de fin dédiée ouverts (ACTION_ITEMS 332, SEC-PNL-06) |
| 11 | Audit approbateur de baisse de taille | **Fermé** | q157 : droit retiré, Audit notifié (`ORGPROFILE_SIZE_LOWERED`) et relecteur/contestataire (`reviewable` couvre la soumission qui baisse la taille). `OrganizationProfileService` non relu |
| 12 | Seconde confirmation limitée au changement de classe | **Ouvert** | SEC-PNL-03 ouvert |
| 13 | D3 points mineurs | **Ouvert** | PENDING sans retrait, approbation sans motif (même schéma : CMP-PNL2-04) |
| 14 | Rattrapage de droits | **Ouvert, aggravé** | 073 ajoute `accept` et `acceptance.revoke` à tout rôle non fixe portant l'une des 14 permissions listées (CMP-PNL2-13). 072 est limité aux groupes Risk Manager et Comité : bon |
| 15 | Régime une personne, dernière connexion | **Ouvert** (info) | Privacy R3/R5/R6 |
| 16 | Structure à une personne et décision de traitement | **Ouvert** (faible) | |
| 17 | Retrait par l'auteur | **Ouvert** (faible) | |

### COMPLIANCE_BLOCK conditionnel de production : décision

Le blocage annoncé visait `DOUBLE_CONFIRMATION` sur un tenant de production « sans trace atomique (CMP-PNL-01) ni revue par un tiers et notifications (D5) ». Les deux conditions sont satisfaites **dans le code**. Je lève donc le blocage pour le code, la recette et le staging.

Pour la production, je ne le lève pas sans une condition, car une revue qu'on ne peut pas retrouver n'est pas un contrôle (principe 21 de ma mémoire : une notification au mieux n'est pas une preuve de prise de connaissance). La seule route d'écriture est `POST /governance-exceptions/:auditLogId/reviews` : aucune route ne liste les exceptions à revoir. Le relecteur dépend d'une notification (ou, s'il a `audit.read`, du filtre `governanceException` de `/audit-logs`, droit que le Risk Manager et le Comité n'ont pas forcément) ; D6 n'est pas livré.

```text
COMPLIANCE_BLOCK (production, DOUBLE_CONFIRMATION et acceptation ALONE)

BLOCK_ID: CMP-BLK-D5-01 (remplace le blocage conditionnel CMP-PNL-01 + 02)
TRIGGER: DOUBLE_CONFIRMATION activé, ou acceptation ALONE, sur un tenant de production
         alors que les exceptions non revues ne sont consultables par aucun relecteur autorisé.
REQUIRED_ACTION: livrer D6, ou à défaut un GET minimal « exceptions à revoir » (permission
         governanceexception.review, tenant-scopé, identités masquées sans audit.read) avec leur âge.
REQUIRED_EVIDENCE: test du GET (isolation de tenant, masquage) + démonstration sur staging
         d'un relecteur sans audit.read retrouvant une exception non notifiée.
VALIDATION_METHOD: revalidation A14 (relecture + test).
RELEASE_CONDITION: voie de consultation livrée + évidence + revalidation A14 PASS.
ESCALATION: HUMAN si le PO veut activer la production avant D6.
STATUS: BLOCKED (production uniquement)
```

Cette condition ne remet en cause aucun arbitrage du PO : D6 est déjà prévu (DECISION-079 point 3).

## 4. Constats

Échelle : Élevée (bloque la production du dispositif concerné), Moyenne, Faible, Info.

### CMP-PNL2-01 : les exceptions à revoir ne sont pas consultables avant D6
- **Gravité** : Élevée en production, Faible en staging. **Conforme avec réserve** pour la compensation, conditionnée au blocage ci-dessus.
- **Constat** : voir §3. S'y ajoute `unreviewedExceptionCount`, qui n'est utilisé que pour informer un nouvel arrivant Audit ou Comité. Le marqueur `riskManager.vacancy` est revoyable mais exclu du compte et des notifications (cohérent avec q160).
- **Recommandation** : voir le bloc ci-dessus. Prévoir aussi la relance : une exception non revue au bout d'un délai paramétrable remonte (voir 02).

### CMP-PNL2-02 : la revue est une prise de connaissance sans délai ni substance exigée
- **Gravité** : Moyenne. **Conforme avec réserve.** Question au PO (délai).
- **Constat** : `REVIEWED` = commentaire non vide (1 à 500 caractères, hors caractères de contrôle) ; un seul relecteur suffit, quel qu'il soit parmi les titulaires de `governanceexception.review` (Risk Manager, Comité, Audit) ; aucun délai de revue, aucune escalade, aucun indicateur. En niveau de preuve c'est du niveau 1-2 (déclaration + trace d'exécution), pas une revalidation indépendante. `forEntities` compte une revue de n'importe quelle ligne marquée de l'entité (`bool_or`) : si une entité porte deux événements marqués, la revue du premier couvre le second.
- **Pourquoi c'est acceptable** : c'est un contrôle détectif de 2e/3e ligne, proportionné à une TPE/PME, qui rend l'exception visible et contestable ; il ne remplace pas la séparation (même réserve qu'en D4). Le PO a déjà écarté les délais pour la vacance (q160) ; ce n'est pas la même situation, ici l'acte a déjà eu lieu sans second regard.
- **Recommandation** : (a) délai de revue paramétrable avec défaut sûr, âge affiché, relance puis remontée au gérant ; (b) lier la revue à la ligne d'audit exacte dans `forEntities` (jointure par ligne, pas par entité) ; (c) KRI : % d'exceptions revues dans le délai, âge médian des non-revues, part contestée ; (d) en structure sans tiers, la revue n'existe pas : l'exception reste affichée « sans validation indépendante », c'est la bonne issue, à ne pas maquiller.
- **Question au PO** : accepter un délai de revue paramétrable (valeur à fixer par le PO, avec relance), sans blocage ?

### CMP-PNL2-03 : la contestation n'a ni propriétaire, ni délai, ni clôture
- **Gravité** : Moyenne. **Conforme avec réserve.**
- **Constat** : `CONTESTED` prévient le Risk Manager, le Comité et le gérant (notification obligatoire) et c'est tout : pas de réponse attendue, pas de statut « traitée », pas de lien vers un constat (ISSUE), une personne ne peut pas à la fois relire puis contester (unicité `(audit_log, relecteur)`), et la contestation d'une exception ne conditionne rien.
- **Recommandation** : une contestation ouvre un constat suivi (propriétaire = Risk Manager ou gérant, échéance, clôture motivée par un tiers) ; au minimum, la lister dans le panel avec son âge. Sans cela, le droit de contester de l'Audit est un droit d'alerte, pas de suivi.

### CMP-PNL2-04 : notification après commit, au mieux, sans preuve de prise de connaissance
- **Gravité** : Moyenne. **Conforme avec réserve.**
- **Constat** : le middleware lance `processRequest` sans l'attendre à l'événement `finish` ; en cas d'échec, simple journal technique, aucune reprise ; la table `notifications` n'est pas dans la piste d'audit. Il n'existe aucune trace que le destinataire a lu ou agi (principe 21). Les résultats de décision ne sont pas notifiés : approbation ou rejet d'une demande de politique (le demandeur), confirmation, rejet ou révocation d'une acceptation (l'acceptant, le Risk Manager), suspension d'un membre Audit/Comité (déjà signalée dans ACTION_ITEMS). Les approbations de politique et d'acceptation s'écrivent sans motif du second regard : `confirm` écrit `reason: null`, `approveSelfValidationPolicy` reprend le motif **du demandeur** (même schéma que CMP-PNL-13 point 2).
- **Recommandation** : la consultation pull (CMP-PNL2-01) est le vrai filet ; la notification reste un accélérateur. Demander un motif ou commentaire au confirmateur et à l'approbateur. Notifier au moins l'acceptant de toute révocation (CMP-PNL2-06) et le demandeur de toute décision sur sa demande.

### CMP-PNL2-05 : acceptation `alone` sans durée maximale, renouvelable sans limite
- **Gravité** : Moyenne. **Arbitrage PO requis.**
- **Constat** : sans confirmateur disponible (ni autre Risk Manager ni Comité), l'acceptation est `ACTIVE`, régime `ALONE`, marqueur `principle.acceptance.alone` (revoyable). Seule contrainte : `expiresAt` dans le futur. Une acceptation échue est refermée par l'appel suivant (`create` la passe à `REVOKED` et en pose une nouvelle) : on peut donc renouveler sans fin, sans autre regard que le marqueur. Le contrat n'a pas de plafond (I-R6) et le service n'en invente pas : je prends acte de ce choix, il est cohérent avec « rien inventé ». Mais ma règle d'exception demande durée, échéance et date de revue ; ici la durée est choisie par celui qui bénéficie de la dérogation.
- **Ce qui limite le risque** : motif obligatoire, expiration lue à la lecture (le principe redevient « non respecté »), marqueur, révocation possible par Audit, administrateur et acceptant, `ALONE` seulement si personne d'autre ne peut confirmer. L'état « personne d'autre ne peut confirmer » est manipulable (CMP-PNL2-10).
- **Recommandation** : un plafond **paramétrable par le PO** (valeur à son choix, éventuellement plus court en `ALONE`), alerte avant échéance, et un renouvellement `ALONE` qui repasse par une revue (REVIEWED) avant d'être reconduit. Sans plafond, tenir l'exception visible dans le panel jusqu'à son terme.
- **Question au PO** : plafond de durée pour les acceptations, au moins pour `ALONE` ?

### CMP-PNL2-06 : l'Audit révoque sans confirmer
- **Gravité** : Faible à Moyenne. **Conforme avec réserve.** Question au PO.
- **Constat** : `acceptance.revoke` est donné à l'Audit, mais pas `acceptance.confirm`. Pour un principe, la révocation remet la situation dans le sens **restrictif** (le principe redevient « non respecté ») ; l'Audit ne prend pas une décision de gestion, il retire une dérogation. Cela reste plus qu'une contestation (q157 : « prévenu et peut contester », sans effet d'état) : la révocation change un état. Risques : (a) l'Audit audite ensuite le résultat de sa propre intervention ; (b) un Risk Manager seul peut ré-accepter aussitôt en `ALONE` (aucun délai de carence), d'où un va-et-vient tracé mais sans issue ; (c) l'acceptant n'est pas notifié (CMP-PNL2-04).
- **Avis** : acceptable, car restrictif, motivé (obligatoire), tracé et sans pouvoir de confirmer. À condition de notifier l'acceptant, le Risk Manager et le Comité, et que la ré-acceptation après révocation par un tiers demande une confirmation, ou à défaut une revue.
- **Question au PO** : garder la révocation par l'Audit comme veto restrictif documenté, ou la remplacer par une contestation qui laisse la décision au Risk Manager ou au Comité ? Je recommande de la garder avec notification.

### CMP-PNL2-07 : q158, conforme à CMP-PNL-03 ; réserves
- **Gravité** : Faible. **Conforme avec réserve.**
- **Constat** : réponse aux trois points de CMP-PNL-03 (confirmation d'un tiers pour l'assouplissement, durcissement immédiat, marqueur seulement sur l'assouplissement réel), plus fail closed sans port. Le circuit fait appel à `existsOther(..., "config.selfvalidation.approve")`, qui compte les comptes dormants (mesure de capacité) : une demande peut attendre un approbateur fantôme et l'admin ne peut alors pas assouplir seul. C'est le bon sens (jamais « seul » par défaut), mais prévoir la sortie (retrait de l'approbateur fantôme par la voie normale des rôles, tracée).
- **Limites de portée** : le circuit protège contre l'admin seul quand un approbateur est **titulaire** de `config.selfvalidation.approve` ; il ne couvre pas un tiers qui détiendrait la permission de valider l'objet sans être Risk Manager ou Comité. Les rôles personnalisés n'ont pas reçu `approve` (rattrapage limité aux deux groupes) : conforme au moindre privilège.

### CMP-PNL2-08 : table `self_validation_policy_requests` sans garde d'immuabilité
- **Gravité** : Moyenne. Corrigible par @dev-db.
- **Constat** : 072 donne `SELECT, INSERT, UPDATE` au rôle runtime et pose volontairement « aucune fonction trigger ». Une ligne reste donc modifiable par SQL direct (`requested_policy`, `reason`, `requested_by`, `status`), et `reopen()` (dépôt Postgres) peut ramener `APPLIED` ou `REJECTED` à `PENDING` ; le chemin transactionnel de production ne l'appelle pas (il n'est utilisé que dans la voie de repli des faux dépôts). Les CHECK couvrent la forme et le maker-checker, pas l'immuabilité du contenu ni l'irréversibilité des états terminaux. La preuve reste dans `audit_log` (append-only), la table n'est qu'un état de flux : d'où Moyenne et non Élevée. Écart avec 071 et 073, où un trigger de garde existe.
- **Recommandation** : trigger de garde sur le modèle de 073 (contenu immuable, transitions `PENDING` vers un état terminal seulement, `search_path` épinglé avec `pg_temp` en dernier, garde TRUNCATE) ; retirer `reopen()` du dépôt de production ou le réserver au test.

### CMP-PNL2-09 : demande d'assouplissement sans expiration
- **Gravité** : Faible. **Acceptable (conforme avec réserve).**
- **Constat** : une demande `PENDING` ne change aucune configuration : elle ne rend rien moins sûr tant qu'elle n'est pas approuvée, donc l'absence d'expiration n'ouvre pas de droit. Le risque est l'approbation tardive d'un contexte périmé (le demandeur est parti, le motif ne vaut plus), et l'approbation applique la politique demandée avec `updatedBy = demandeur`, l'approbateur n'apparaissant que dans l'audit. Un autre administrateur peut aussi retirer (`WITHDRAWN`) la demande de quelqu'un d'autre en soumettant la sienne : tracé.
- **Recommandation** : afficher l'âge, refuser l'approbation au-delà d'un âge paramétrable, ou demander à l'approbateur de confirmer le motif. Ce n'est pas un blocage ; c'est déjà posé comme point ouvert en ACTION_ITEMS (ligne 324, point 2).

### CMP-PNL2-10 : « personne d'autre ne peut… » reste un état manipulable (extension de CMP-PNL-05)
- **Gravité** : Moyenne. Détecteur D6.
- **Constat** : trois décisions reposent sur « aucun tiers » calculé à l'instant T : auto-validation (`existsOther` sur la permission de valider), assouplissement de la politique (`config.selfvalidation.approve`), acceptation `alone` (`acceptance.confirm`). Un administrateur peut retirer le rôle de l'approbateur ou du confirmateur (`role.assign`, suspension), agir seul avec le marqueur, puis remettre les rôles. SEC-PNL-04 est couvert par la notification `GOVERNANCE_MEMBER_REMOVED` pour les groupes fixes ; elle ne couvre pas la suspension d'un membre et ne relie pas le retrait aux actes suivants.
- **Recommandation** : D6 : détecteur « acte marqué dans les N jours suivant le retrait ou la suspension du dernier tiers » ; ajouter à l'audit marqué la date du dernier changement du pool. Pas de blocage supplémentaire.

### CMP-PNL2-11 : q160, risque résiduel à consigner (sans rouvrir l'arbitrage)
- **Gravité** : Moyenne (information). **Pris acte.**
- Décision PO (DECISION-078) : départ du dernier Risk Manager sans intérimaire = trace seule ; alertes et délai maximal de CMP-PNL-08/09 écartés. Je ne la conteste pas et ne la rouvre pas.
- **Ce qui demeure vrai, à consigner** comme risque accepté par le PO (propriétaire HUMAN, pas de cotation de ma part, la cotation revient au Risk Manager ou, tant qu'il n'y en a pas, au PO) : (1) la fonction de contrôle de 2e ligne peut être vacante sans que personne ne soit prévenu (le marqueur `riskManager.vacancy` est exclu des notifications R-6.4 et du compte des non-revues, GovernanceNotifier ligne 107, requête `unreviewedExceptionCount`) ; (2) pendant la vacance, les trois voies « sans tiers » se renforcent : plus d'auto-validations par double confirmation, plus d'assouplissements de politique par l'admin seul, plus d'acceptations `alone` ; chacune est marquée, mais le relecteur qui les voit peut être le seul à l'être ; (3) la visibilité repose sur le panel D6 (vacance déclarée) non livré ; (4) un compte Risk Manager fantôme masque la vacance (le comptage ne regarde pas l'inactivité).
- **Compensations existantes** : traçabilité complète (retrait, marqueur, motif, `riskManagerGroupEmpty`), q161 (suspension du dernier RM refusée, intérimaire échu inutilisable), marqueurs sur chaque acte `alone`.
- **Consignation proposée** : une entrée au registre des risques acceptés (RISK ACCEPTÉ, DECISION-078 q160, propriétaire HUMAN), avec revue à la livraison de D6 et au premier tenant de production. Cela ne contredit rien : c'est la preuve que l'écart a été accepté en connaissance de cause.

### CMP-PNL2-12 : repli silencieux vers l'audit non atomique, et dépendance optionnelle
- **Gravité** : Faible. À couvrir par QA.
- **Constat** : `writeAudited` et `ConfigService.applyPolicyChange` retombent sur l'ancien enchaînement (effet puis `audit.record`) si le dépôt ne déclare pas `auditsInTransaction`. C'est voulu pour les faux dépôts, mais un nouveau dépôt de production oublié repasse en audit hors transaction sans erreur. Le dépôt de demandes et le notifieur sont des paramètres de constructeur optionnels (`ConfigService`, `GovernanceNotifier`). Le câblage de `server.ts` est correct (lignes 304-310, 438-444, 543) mais rien ne l'impose (principe 19). Les services de revue et d'acceptation reçoivent un `AuditRepository` qu'ils n'utilisent pas : inoffensif, mais source de confusion sur qui écrit l'audit.
- **Recommandation** : test de câblage de `server.ts` (dépôts de production déclarent `auditsInTransaction === true`, la politique refuse l'assouplissement sans dépôt de demandes, le middleware est monté avant les routeurs).

### CMP-PNL2-13 : acceptation sans périmètre prouvé ; droits rattrapés par 073
- **Gravité** : Moyenne.
- **Constat (périmètre)** : `offenders_snapshot` est vide tant que D6 n'existe pas et `principleId` n'est validé que par un motif (`^[A-Z]+(-[A-Z0-9]+)+$`, 40 caractères), le catalogue n'étant pas en code : on peut accepter un principe inexistant, et aucune acceptation ne démontre ce qu'elle couvre. Elle accepte donc un périmètre indéfini. La fin d'une acceptation échue (fermée par `create`) est imputée à l'utilisateur qui accepte à nouveau, avec le motif « Expired; replaced by a new acceptance » : à documenter comme clôture système.
- **Constat (droits)** : 073 accorde `governanceprinciple.accept` et `governanceprinciple.acceptance.revoke` à tout rôle non fixe portant une des 14 permissions listées (dont `user.update`, `config.manage`) et aux comptes à attribution directe historique. Un rôle ayant `user.update` peut donc accepter un principe non respecté et mettre fin à une acceptation, y compris une acceptation confirmée par un tiers. Même défaut que CMP-PNL-14 (qui reste ouvert). Le rattrapage 072 (groupes Risk Manager et Comité) est conforme.
- **Recommandation** : (a) refuser l'acceptation tant que le catalogue n'est pas chargé (D6), ou accepter uniquement les identifiants du catalogue v0.3 ; (b) liste nominative des rôles et comptes bénéficiaires de 073 confirmée par HUMAN avant application hors dev (principe 27) ; (c) 073 avant le code, comme indiqué dans ACTION_ITEMS.

## 5. Q2. Réponses

1. **Revue par un tiers + contestation comme contrôle compensatoire de l'auto-validation : conforme avec réserve.** C'est la bonne forme d'un contrôle de remplacement (détectif, après coup, par quelqu'un d'autre que l'auteur, avec droit d'objection), proportionné à une TPE/PME, et c'est ce que je demandais en CMP-PNL-02. Il reste détectif : il ne remplace pas la séparation, et tient à trois conditions : voie de consultation (CMP-PNL2-01), délai et relance (02), suite donnée à la contestation (03). Sans tiers, il n'y a pas de revue : l'étiquette « sans validation indépendante » reste, et c'est correct.
2. **Acceptation `alone` sans tiers : arbitrage PO requis** (CMP-PNL2-05). Le marqueur, le motif et l'expiration lue sont conformes ; l'absence de durée maximale ne l'est pas tant que le PO n'a pas décidé en connaissance de cause. Ce n'est pas un manquement réglementaire que je puisse affirmer (aucun texte consulté) : c'est un risque de dérogation perpétuelle auto-accordée.
3. **Audit sans confirmation mais avec révocation : conforme avec réserve** (CMP-PNL2-06). Cohérent avec q157 tant que la révocation reste restrictive, motivée et notifiée.

## 6. Q4. Circuit q158 et demande sans expiration

Le circuit à deux personnes répond à CMP-PNL-03 (CMP-PNL2-07). La demande sans expiration est **acceptable** (CMP-PNL2-09) parce qu'une demande en attente n'a aucun effet ; je recommande l'affichage de l'âge et un motif de l'approbateur, sans en faire une condition. La seule correction à demander est la garde de la table (CMP-PNL2-08).

## 7. Q5. Piste d'audit append-only

- `audit_log` : **conforme**. 072 et 073 ne le modifient pas ; aucun `UPDATE` ni `DELETE` d'audit dans le code revu ; toutes les écritures d'audit passent par l'unique `INSERT` de `insertAuditEvent`.
- `governance_exception_reviews` : conforme (ajout seul, garde en base).
- `governance_principle_acceptances` : transitions gardées, contenu immuable, aucune suppression. La table autorise `UPDATE` pour les seules transitions bornées : acceptable.
- Écarts : (1) `self_validation_policy_requests` modifiable et `reopen()` (CMP-PNL2-08) ; (2) `governance_designations` sans garde (CMP-PNL-10, ouvert) ; (3) retour à l'audit hors transaction si le dépôt oublie `auditsInTransaction` (CMP-PNL2-12) ; (4) les notifications ne sont pas tracées (CMP-PNL2-04) ; (5) services hors périmètre DECISION-079 (rejets, créations) écrivent encore l'audit après l'effet, déclaré ; (6) la clôture d'une acceptation échue est attribuée à un utilisateur (CMP-PNL2-13).

## 8. Plan d'actions proposé (non exécuté)

| Réf. | Action | Responsable | Condition |
|---|---|---|---|
| ACT-A14-12 | `GET` minimal « exceptions à revoir » (ou D6), avec âge | @dev-backend | Levée du blocage de production (CMP-PNL2-01) |
| ACT-A14-13 | Délai de revue paramétrable, relance, KRI ; jointure revue par ligne d'audit | @dev-backend, HUMAN (valeur) | CMP-PNL2-02 |
| ACT-A14-14 | Contestation : constat suivi (propriétaire, échéance, clôture) | @dev-backend, @architect | CMP-PNL2-03 |
| ACT-A14-15 | Notifier les décisions (acceptant, demandeur), motif du confirmateur et de l'approbateur | @dev-backend | CMP-PNL2-04, 06 |
| ACT-A14-16 | Plafond de durée des acceptations, au moins `ALONE`, et revue au renouvellement | HUMAN (arbitrage), @dev-backend | CMP-PNL2-05 |
| ACT-A14-17 | Trigger de garde sur `self_validation_policy_requests`, retirer `reopen()` de la production | @dev-db | CMP-PNL2-08 |
| ACT-A14-18 | Détecteur « acte marqué après retrait ou suspension du dernier tiers » | @dev-backend (D6) | CMP-PNL2-10, CMP-PNL-05 |
| ACT-A14-19 | Consigner q160 au registre des risques acceptés, revue à D6 et au 1er tenant de production | HUMAN, @risk-manager (cotation) | CMP-PNL2-11 |
| ACT-A14-20 | Test de câblage `server.ts` et de `auditsInTransaction` | @qa-engineer | CMP-PNL2-12, CMP-PNL-07 |
| ACT-A14-21 | Acceptation limitée au catalogue ; liste nominative des droits de 073 confirmée par HUMAN | @dev-backend, @dev-db, HUMAN | CMP-PNL2-13, CMP-PNL-14 |

Questions à poser au PO (cockpit) : (1) délai de revue d'une exception (CMP-PNL2-02) ; (2) plafond de durée d'une acceptation, au moins `ALONE` (CMP-PNL2-05) ; (3) révocation par l'Audit, garder comme veto restrictif notifié (CMP-PNL2-06) ; (4) feu vert pour consigner q160 comme risque accepté (CMP-PNL2-11) ; (5) activation de la production avant D6 : oui avec le `GET` minimal, ou attendre D6 (CMP-BLK-D5-01).

## 9. Revalidation

Revalidation A14 requise après : le `GET` des exceptions à revoir (levée du blocage), la garde de 072, la liste nominative des droits de 073, D6 (détecteurs, vacance, intérim, étiquettes). Conclusion limitée au périmètre et à la base indiqués (§0) : aucun texte réglementaire consulté, tests non exécutés, migrations non appliquées.
