# Passage Compliance (A14) : panel de gouvernance, lots D1 à D4 (2026-10-18)

Statut : **recommandations, en attente d'arbitrage PO** (points marqués « arbitrage PO requis »). Aucun COMPLIANCE_BLOCK de merge. Un blocage conditionnel de mise en production est annoncé (CMP-PNL-01 et 02).

## 0. Périmètre, base et limites

- Base lue : commit `037314d` (tête de la branche `claude/grc-tools-orchestrator-handoff-epk0y5`, vérifiée dans `.git/refs/heads`). Mon worktree n'était PAS à cette base (branche `worktree-agent-a3a7748c778fb59f0`, sans les fichiers D1 à D4) : j'ai lu les fichiers dans le checkout principal `/home/user/Gouvernance-Risk-Control-Tools`, en lecture seule. Sans Bash, je ne peux pas exclure des modifications non commitées dans ce checkout.
- Lu : `SelfValidationGate.ts`, `domain/governance/{selfValidation,classifyOrganization}.ts`, `ConfigService.setSelfValidationPolicy`, route `PUT /config/self-validation-policy`, les 8 services câblés sur la porte (extraits : ControlExecution, TreatmentDecision, RiskEvaluation, RoleService), `RoleService.revokeFromUser`, `PostgresRoleRepository.handOverLastRiskManager`, `GovernanceDesignationService`, `OrganizationProfileService` et son dépôt, `PostgresGovernanceQueries`, `validationIndependence.ts`, `fixedGroupPermissions.ts`, migrations 066 à 071, spécification (« Révision DECISION-074 », principes A13 v0.3).
- Non fait : tests non exécutés ni relus, `PostgresGovernanceDesignationRepository` non relu, `RiskService` non analysé en profondeur (aucun `ForbiddenError` dans le fichier), aucun test de câblage `server.ts` cherché de façon exhaustive.
- Sourcing : aucun texte réglementaire n'a été consulté. Je cite des **principes** : séparation des tâches incompatibles (le brief de l'agent la rattache à l'Instruction BCEAO 017-12-2010 pour les SFD ; applicabilité à Djamo et texte à faire confirmer par les juristes), COSO (sélection d'activités de contrôle alternatives lorsque la séparation n'est pas praticable), ISO 31000 (proportionnalité, traitement du risque), ISO/IEC 27001:2022 contrôle « séparation des tâches » (de mémoire). Aucun numéro d'article n'est avancé.

## 1. Synthèse des avis

| Question | Avis | Constats liés |
|---|---|---|
| Q1a. Double confirmation comme compensation (TPE/PME) | **Conforme avec réserve** : acceptable en principe, pas encore suffisante en production | CMP-PNL-01, 02, 04, 05, 06 |
| Q1b. Politique modifiable par l'administrateur seul | **Arbitrage PO requis** (le code s'écarte de la règle hybride DECISION-072 qu'il cite) | CMP-PNL-03 |
| Q2. Services hors double confirmation | **Pas une lacune** : conforme (rejets, RoleService, Dispositif, Risk), conforme avec réserve (décision de traitement). Deux points inverses à arbitrer (chemins Comité) | CMP-PNL-04, 07, 16, 17 |
| Q3. Départ du dernier Risk Manager, vacance | Traçabilité : **conforme**. Suffisance : **arbitrage PO requis** (alerte, délai, notification) | CMP-PNL-08, 09, 10 |
| Q4. Seconde confirmation par le groupe Audit (D3) | **Arbitrage PO requis**, recommandation : ne pas faire décider l'Audit | CMP-PNL-11, 12, 13 |
| Q5. Piste d'audit append-only | `audit_log` lui-même **conforme** ; trois écarts autour (atomicité, table des désignations, régime une personne) | CMP-PNL-01, 10, 15 |

## 2. Points conformes (à ne pas dégrader)

1. Défaut sûr : `REFUSE` par défaut (colonne `NOT NULL DEFAULT 'REFUSE'` + CHECK), et sans porte câblée ou sans port, l'auto-validation est refusée (`checkSelfValidation`, fail closed).
2. Test de nécessité calculé côté serveur (`existsOther`) : la double confirmation n'est proposée que si personne d'autre ne détient la permission de validation ; un compte dormant compte comme validateur (on mesure la capacité).
3. Le marqueur `noSelfValidation` et le motif (1 à 500 caractères) sont dans l'audit (`governance_exception`, `newValue.selfValidation`) ; le statut métier n'est pas modifié, le libellé distinct « sans validation indépendante » est calculé depuis le journal (q142).
4. `audit_log` : migration 066 n'ajoute qu'une colonne nullable et deux index partiels ; le garde append-only 038 (triggers UPDATE/DELETE/TRUNCATE + REVOKE) est intact ; aucun `UPDATE` ni `DELETE` ajouté.
5. Attribution forcée côté serveur partout où je l'ai lue (`designatedBy`, `submittedBy`, `decidedBy`, `grantedBy`, `executedBy`) ; `tenant_id` dans toutes les requêtes lues ; aucune suppression physique.
6. Permissions dédiées et non héritées d'un `*.update` : `config.selfvalidation.set`, `designation.manage` (administrateur seulement, jamais un groupe fixe), `orgprofile.*`.
7. Passation à l'intérimaire (`handOverLastRiskManager`) : une seule transaction, ordre de verrous documenté, retrait puis attribution (évite la fin d'amorçage à tort), règles de cumul rejouées sous verrou, intérimaire ni Audit, ni l'acteur, ni le partant, date de fin obligatoire, deux entrées d'audit dans la transaction.
8. Migration 071 : contenu des versions immuable (trigger), transitions bornées, maker-checker en base (`decided_by <> submitted_by`), `search_path` épinglé, REVOKE DELETE/TRUNCATE, audit dans la transaction. Modèle à reprendre pour 070.
9. La taille n'est jamais stockée (recalculée à chaque lecture, le plus exigeant de déclaré et observé) : pas de valeur périmée, repli prudent sur « je ne sais pas ».

## 3. Constats

Échelle : Élevée (bloque la mise en production du dispositif concerné), Moyenne (à traiter avant production ou à arbitrer), Faible, Info.

### CMP-PNL-01 : le marqueur n'est pas écrit atomiquement avec l'acte d'auto-validation
- **Gravité** : Élevée en production, Moyenne en staging.
- **Constat** : dans les 8 services câblés, l'écriture métier (`recordValidation`, `recordCommitteeValidation`, etc.) précède `audit.record`, hors transaction (même schéma que q90). `ConfigService.setSelfValidationPolicy` fait de même (`upsertConfig` puis `audit.record`). Si l'écriture d'audit échoue, l'acte reste appliqué sans marqueur et sans motif, et `withIndependence` l'affiche « INDEPENDENT ». Le contrôle compensatoire disparaît exactement quand on en a besoin ; il échoue en ouverture.
- **Principe** : la compensation d'une séparation des tâches n'a de valeur que si la trace est inséparable de l'acte (COSO : information et communication fiables ; piste d'audit).
- **Recommandation** : pour le chemin d'auto-validation au minimum, écrire l'audit marqué dans la même transaction que l'écriture métier (modèle `insertAuditEvent(client, …)` déjà utilisé par 071 et par la passation). Condition de production, comme B-6a. Compléter par un contrôle détectif : requête périodique « validateur = auteur sans marqueur » (indicateur de contrôle, voir CMP-PNL-05).
- **Qui** : A06 ; revalidation A14.

### CMP-PNL-02 : la compensation est incomplète tant que D5 n'est pas livré
- **Gravité** : Élevée (condition de mise en production).
- **Constat** : la compensation décrite par la spécification est un ensemble : motif, marqueur, statut distinct, revue par un tiers (`governance_exception_reviews`), notification du gérant (R-6.4), notification à l'arrivée d'un membre Audit ou Comité (R-6.3). D1 à D4 n'apportent que les trois premiers éléments. Sans revue ni notification, l'auto-validation est tracée mais personne n'est tenu de la regarder : c'est une trace, pas un contrôle.
- **Recommandation** : règle de livraison, comme « B-6b jamais sans B-6d » : **`DOUBLE_CONFIRMATION` ne doit pas être activable sur un tenant de production avant D5** (revue par un tiers + notification). Le défaut `REFUSE` limite le risque actuel à un choix explicite de l'administrateur. **COMPLIANCE_BLOCK conditionnel** : annoncé si un tenant de production passe en `DOUBLE_CONFIRMATION` sans D5.
- **Qui** : orchestrateur (règle de livraison), A06 (D5).

### CMP-PNL-03 : politique d'auto-validation modifiable par l'administrateur seul
- **Gravité** : Moyenne. **Avis : arbitrage PO requis.**
- **Constat** : `setSelfValidationPolicy` exige la permission dédiée, un motif obligatoire, audite les deux sens, et pose `config.selfvalidation.adminAlone` ou `.direct` selon qu'un tiers existe. Le circuit à deux personnes n'est pas construit. Or la règle hybride DECISION-072, rappelée par la spécification (R-2, R-5), est : sans tiers, effet immédiat marqué ; **avec tiers, en attente de confirmation**. Le code applique donc « direct » là où la règle du PO demande une confirmation. L'administrateur qui assouplit le contrôle peut être celui qui en bénéficie (cumul administrateur + Risk Manager, fréquent en petite structure).
- **Atténuant réel** : l'assouplissement est auto-limité : si un autre validateur existe, la double confirmation est refusée acte par acte. L'exposition vise donc le cas où des tiers existent (Audit, Comité) mais ne détiennent pas la permission de valider l'objet.
- **Recommandation** :
  1. Sans tiers : acceptable tel quel (`adminAlone`, motif, trace), à condition de CMP-PNL-01.
  2. Avec tiers : l'assouplissement (`REFUSE` vers `DOUBLE_CONFIRMATION`) doit attendre la confirmation d'un tiers autre que l'auteur ; le retour vers `REFUSE` (durcissement) reste immédiat. Construire ce circuit avant la mise en production (même mécanisme que `orgprofile`).
  3. Ne marquer comme exception que l'assouplissement : le marqueur est aujourd'hui posé aussi sur un durcissement ou un changement sans effet, ce qui dilue l'indicateur. Notifier les tiers existants de tout assouplissement.
  4. `ConfigService` suppose « tiers existant » quand le port n'est pas câblé (`: true`) : sens prudent pour le marqueur, mais à couvrir par un test de câblage.
- **Question au PO** : accepter « direct » comme régime transitoire jusqu'à la mise en production (recommandation A14), ou imposer le circuit avant toute recette client ?

### CMP-PNL-04 : les chemins Comité sont couverts par la double confirmation
- **Gravité** : Moyenne. **Arbitrage PO requis.**
- **Constat** : `TreatmentDecisionService.validateByCommittee` et la validation Comité d'une évaluation (`RiskEvaluationService`, ligne ~609) passent par `checkSelfValidation`. Un proposeur, seul porteur de la permission Comité, peut donc valider sans collège. Cela entre en tension avec la règle fixe « jamais un seul membre » (DECISION-026, mémoire A14) et avec le principe GOV-COM-02. Avant B-12 le Comité est déjà un validateur unique par permission, mais l'étendre au proposeur retire la dernière séparation.
- **Recommandation** : exclure les chemins Comité de la double confirmation (refus maintenu, escalade vers le Comité réel) ; à défaut, les marquer d'un niveau de gravité supérieur et exiger la revue D5 sous un délai court. Les décisions soumises au Comité sont celles dont le score dépasse le seuil : ce sont les moins adaptées à une compensation par simple motif.

### CMP-PNL-05 : la condition « personne d'autre ne peut valider » est manipulable
- **Gravité** : Moyenne.
- **Constat** : `existsOther` lit l'état courant des droits. Un administrateur (`role.assign`, suspension d'utilisateur) peut retirer le droit de validation aux autres porteurs, puis laisser le bénéficiaire s'auto-valider. Chaque étape est tracée (`ROLE_CHANGE`), mais rien ne relie la vidange du pool de validateurs aux auto-validations qui suivent. C'est le contournement classique d'une dérogation qui dépend d'un état modifiable.
- **Recommandation** : contrôle détectif dans le panel (D6) : auto-validation marquée dans les N jours suivant le retrait ou la suspension du dernier autre validateur de cette permission ; ajouter à l'audit marqué la date du dernier changement du pool. Aucun blocage supplémentaire.

### CMP-PNL-06 : « appliqué » compte comme « validé » (I-R5) et l'étiquette n'est pas partout
- **Gravité** : Moyenne.
- **Constat** : par I-R5/q153, un acte appliqué sans validation indépendante entre dans les calculs comme un acte validé. `withIndependence` n'est appliqué qu'aux routeurs de 8 modules ; tableaux de bord, cartographie, exports et rapports ne portent pas l'étiquette (la spécification R-4.2 prévoit le même assistant pour les exports). En cas d'absence d'identifiant ou de port, la valeur par défaut est « INDEPENDENT » (ouverture). Un rapport à un superviseur ou à la direction peut donc surestimer l'efficacité des contrôles ou la part des risques validés.
- **Recommandation** : tout agrégat qui compte des actes validés expose la part « sans validation indépendante » (indicateur : % d'actes validés sans validation indépendante, par module et par période) ; l'étiquette est obligatoire dans les exports. Pour le défaut, préférer une valeur « inconnue » à « INDEPENDENT » quand l'identifiant manque. Vérifier aussi que le marqueur sur une entité ne provient pas d'un autre événement (la recherche par `entity_id` prend toute ligne marquée de l'entité).

### CMP-PNL-07 : périmètre d'application non documenté et câblage non garanti
- **Gravité** : Faible.
- **Constat** : la porte arrive par un paramètre de constructeur optionnel (cohérent avec la règle CLAUDE.md, défaut = refus). `server.ts` câble bien les 8 services (lignes 257 à 428), mais je n'ai pas trouvé de test qui l'impose. La liste des actions couvertes et exclues n'est écrite nulle part en dehors du code.
- **Recommandation** : (1) test de câblage de `server.ts` (mémoire A14, principe 19) ; (2) une table « action couverte / exclue / pourquoi » dans la spécification, lue par GOV-SOD-01. Sinon une exclusion silencieuse devient une lacune.

### CMP-PNL-08 : vacance du dernier Risk Manager : traçabilité suffisante, alerte et délai absents
- **Gravité** : Moyenne. **Avis : traçabilité conforme ; suffisance à arbitrer.**
- **Constat** :
  1. Traçabilité : retrait, marqueur `riskManager.vacancy`, motif obligatoire (`groupReason`) et `newValue { riskManagerGroupEmpty, confirmed }` sont écrits dans la même transaction que le retrait. L'état « groupe vide depuis » se déduit de `user_roles.revoked_at`. C'est suffisant pour reconstituer l'événement.
  2. La « seconde confirmation » (`confirmEmptyGroup`) est un booléen de la **même** personne que l'acteur. Cohérent avec la double confirmation de q141, mais ce n'est pas un second regard.
  3. Personne n'est prévenu au moment de la vacance (ni Audit, ni Comité, ni gérant) ; le panel (D6, non livré) est le seul signal prévu. Aucun délai maximal, aucun indicateur, aucune échéance : la vacance déclarée (D05) et le paramètre « vacance 60 j » (D18) sont spécifiés, pas construits.
  4. Un compte RM fantôme (personne partie, compte non suspendu) cache la vacance : le comptage ignore l'inactivité (détecteur « inactivité 90 j » prévu en D6).
  5. Effet de cascade avec D4 : sans Risk Manager, davantage d'actes réservés au RM n'ont plus d'autre validateur, donc plus d'auto-validations par double confirmation. La vacance et l'auto-validation se renforcent.
- **Recommandation** : sans bloquer (principe PO « ne jamais bloquer »), (a) notification à la vacance à l'Audit, au Comité et au gérant, avec trace de prise de connaissance (pas seulement un envoi au mieux) ; (b) échéance de vacance paramétrable (60 jours proposés par A13) qui fait remonter l'alerte en tête du panel puis escalade vers le gérant et HUMAN ; (c) KRI : durée de vacance, nombre d'actes auto-validés pendant la vacance ; (d) vérifier que le panel traite le compte inactif.
- **Question au PO** : la seconde confirmation de la vacance doit-elle rester celle de l'acteur, ou venir d'une autre personne lorsqu'il en existe une (symétrie avec CMP-PNL-03) ?

### CMP-PNL-09 : cycle de vie de l'intérimaire
- **Gravité** : Moyenne.
- **Constat** : `valid_until` empêche d'utiliser un intérim périmé pour la passation, mais une fois activé l'intérimaire garde le rôle Risk Manager sans limite ; l'échéance n'est qu'un affichage (« jamais de retrait automatique », voulu car il viderait le groupe). La désignation est faite par l'administrateur seul, sans confirmation d'un tiers (la donnée D04 prévoit « confirmation par un tiers »), sans marqueur, sans notification. L'intérimaire reçoit des droits de Risk Manager complets (validation incluse).
- **Atténuant** : l'administrateur peut déjà attribuer ce rôle à quiconque par `role.assign` (cumuls rejoués) ; la passation n'ajoute pas de pouvoir, elle en ajoute la trace.
- **Recommandation** : (1) alerte à l'échéance et après dépassement, vers administrateur, Audit, Comité (le panel D6 doit signaler un intérimaire en poste après `valid_until`) ; (2) fin d'intérim documentée (nouveau RM nommé ou prolongation motivée par une nouvelle désignation) ; (3) confirmation d'un tiers quand il en existe, comme prévu par D04 ; (4) marquer l'activation d'un intérimaire dans l'audit comme événement de gouvernance consultable.

### CMP-PNL-10 : table `governance_designations` et audit des désignations
- **Gravité** : Moyenne.
- **Constat** : (1) contrairement à `organization_profiles` (071), la table 070 n'a ni trigger d'immuabilité ni REVOKE : `user_id`, `reason`, `valid_until`, `designated_by` sont modifiables en base ; seules les colonnes `ended_*` / `activated_*` devraient changer. (2) `designate` et `end` écrivent l'audit après l'écriture, hors transaction (CMP-PNL-01). (3) `end` (état terminal) et `designate` partagent `designation.manage`, ce que la règle CLAUDE.md sur les transitions terminales demande de séparer (mitigé : administrateur seul). (4) Une désignation terminée après activation laisse le rôle en place (voulu, documenté).
- **Recommandation** : trigger de garde sur le modèle de 071 (contenu immuable, transitions bornées, `search_path` épinglé, REVOKE DELETE/TRUNCATE) ; audit dans la transaction ; permission de fin dédiée si le PO suit la règle CLAUDE.md à la lettre.

### CMP-PNL-11 : confirmation d'une baisse de taille par le groupe Audit
- **Gravité** : Moyenne. **Avis : arbitrage PO requis. Recommandation A14 : ne pas faire décider l'Audit.**
- **Constat** : `orgprofile.approve` est donnée à Risk Manager, Comité **et Audit**, et `isAuditGroupPermission` a été étendu pour l'accepter (comme `rolegroup.audit.validate`). Confirmer une baisse de taille, c'est décider du niveau d'exigence appliqué à l'organisation, donc de l'étalon sur lequel la 3e ligne rendra ses conclusions. Une troisième ligne qui approuve cet étalon s'expose à l'auto-révision et assume une responsabilité de direction (modèle des trois lignes de l'IIA, de mémoire : l'assurance ne prend pas de responsabilité de gestion ; GOV-AUD-01 « Audit informé, jamais décideur »). Le précédent `rolegroup.audit.validate` protège l'Audit contre la 2e ligne ; il ne justifie pas que l'Audit valide la méthodologie des autres.
- **Contre-argument à noter** : dans une petite structure l'Audit est parfois le seul tiers ; sans lui, la baisse est appliquée « seule ».
- **Recommandation** : approbateurs = Risk Manager autre que le soumetteur, ou Comité. L'Audit n'approuve pas ; s'il est le seul tiers, la baisse s'applique en `ALONE` (marqueur `orgprofile.adminAlone`) et l'Audit est **informé** et peut la contester via la revue D5. Option de repli, cohérente avec DECISION-040 (mémoire A14, principes 14 et 15) : confirmation par l'Audit seulement faute de RM ou de Comité tiers, marquée « repli », notifiée, ratifiée a posteriori dès qu'un RM ou un Comité existe. **Quel que soit le choix, l'ensemble des « tiers » qui décide si la confirmation est requise doit être le même que l'ensemble des approbateurs** : aujourd'hui `countOtherGovernanceMembers` compte l'Audit, donc une baisse peut devenir `PENDING` avec un seul tiers, et ce tiers est l'Audit.

### CMP-PNL-12 : la seconde confirmation ne couvre qu'un changement de classe
- **Gravité** : Moyenne.
- **Constat** : `lowers` compare la classe avant/après. Restent sans second regard : (a) la **première** version du profil (aucun marqueur, activation immédiate par l'administrateur seul) ; (b) toute baisse de réponse qui ne change pas la classe (Q2, Q5, Q7, Q8, Q11) ; (c) une baisse **par les données observées** : la taille est recalculée, donc suspendre des comptes ou retirer des rôles fait baisser le « observé » et peut abaisser la classe sans aucune soumission ni marqueur. Q7 (organe de contrôle) et Q11 (activité supervisée) ne sont pas observables : un « Q11 = non » déclaré par l'administrateur seul est le levier principal vers « TPE », la classe la moins exigeante. Le repli « je ne sais pas » empêche la TPE, bon point.
- **Recommandation** : (1) traiter la première version comme une baisse depuis la classe la plus exigeante (marqueur `adminAlone` sans tiers, confirmation avec tiers) ; (2) tenir compte des réponses (Q11 et Q7 en particulier), pas seulement de la classe ; (3) tracer dans le panel (D6) tout changement de classe calculée, quelle qu'en soit la cause ; (4) faire vérifier Q11 contre l'agrément réel de Djamo par la conformité (fait externe, hors outil).

### CMP-PNL-13 : D3, points mineurs
- **Gravité** : Faible.
- (1) Une version `PENDING` bloque toute nouvelle soumission (index unique) et l'auteur ne peut pas la retirer ; si les tiers disparaissent ou n'agissent pas, le profil est gelé : prévoir un retrait par l'auteur (statut dédié, motif) ou une expiration visible. (2) L'approbation s'écrit avec `reason: null` : exiger un motif de confirmation, comme pour le rejet. (3) La vérification « tiers » est faite à la soumission, pas à la décision. (4) Deux comptes d'une même personne comptent pour deux tiers (R-Q2, ouvert).

### CMP-PNL-14 : rattrapage de droits par migration
- **Gravité** : Moyenne.
- **Constat** : 066, 069, 070 et 071 accordent `config.selfvalidation.set`, `designation.manage`, `process.responsibility.assign` et `orgprofile.submit` à **tout** rôle non fixe portant l'une des permissions de ADMIN_PERMISSIONS, et à tout compte avec attribution directe historique (`users.roles`). Un rôle avec seulement `user.update` reçoit donc le pouvoir d'assouplir la séparation des tâches. La définition d'« administrateur » est celle de DECISION-042 q63, mais le rattrapage élargit des droits sensibles de façon silencieuse.
- **Recommandation** : avant toute application hors dev, lister rôles et comptes qui reçoivent chaque permission (requête de contrôle jointe à la migration) et faire confirmer par HUMAN ; sinon réduire le rattrapage au rôle réellement administrateur du client.

### CMP-PNL-15 : régime « structure à une personne » (068) et dernière connexion (067)
- **Gravité** : Faible (information).
- **Constat** : 068 : schéma et gardes set-once, levée mémorisée par trigger, fonctions à `search_path` épinglé, défaut sûr (non déclaré). Le mécanisme de déclaration par l'éditeur n'existe pas ; une fois défini, il touchera `tenants` hors API : il devra écrire une entrée d'audit (acteur d'exploitation, motif) et recevoir un avis A14, car c'est un régime de dérogation. La levée par trigger n'écrit pas dans `audit_log` (la preuve est dans les colonnes set-once). `single_person_regime_lift_threshold` reste modifiable avant levée : toute modification doit être tracée. 067 : `last_seen_at` est une donnée d'activité sur une personne ; avis Privacy (A15) requis, non évalué ici.

### CMP-PNL-16 : décision de traitement, validateur N+1 fixe
- **Gravité** : Faible. **Conforme avec réserve.**
- **Constat** : le validateur est l'`superiorOwnerId` figé (instantané) et le proposeur ne peut pas l'être (G4). Hors double confirmation, c'est le choix le plus strict, adapté à une décision d'acceptation du risque. Effet de bord : une structure où personne d'autre ne peut être N+1 ne peut pas enregistrer de décision de traitement ; le risque est un contournement hors outil (tableur), donc un défaut de traçabilité.
- **Recommandation** : ne pas ouvrir la double confirmation à cette décision ; définir avec le PO le repli de structure à une personne (par exemple le gérant désigné comme N+1 de repli, avec marquage et notification) plutôt qu'une auto-validation.

### CMP-PNL-17 : pas de voie de retrait pour l'auteur
- **Gravité** : Faible.
- **Constat** : l'auteur ne peut pas rejeter sa propre évaluation (refus sans dérogation) et rien n'est prévu pour qu'il la retire. En structure à une personne, un brouillon peut rester bloqué. Le refus est conforme (le rejet n'a pas à être assoupli), mais un retrait explicite par l'auteur (statut dédié, motif, audit) éviterait un blocage et des contournements.

## 4. Réponses détaillées

### Q1. D4 : l'auto-validation par double confirmation compense-t-elle la séparation des tâches ?

**a) Avis : conforme avec réserve.**
- **Principe** : quand la séparation n'est pas praticable (une personne, deux au plus), le cadre de contrôle interne attend des contrôles de remplacement (revue indépendante après coup, supervision de la direction, journalisation), proportionnés au risque (COSO, ISO 31000). La double confirmation n'est **pas** une séparation : c'est la même personne qui confirme deux fois. Sa valeur est de faire de l'exception un acte conscient, motivé et visible, pas de la remplacer.
- **Ce qui la rend acceptable** : défaut `REFUSE`, test de nécessité serveur, motif, marqueur, libellé distinct, statut non maquillé, politique choisie par le client (CMP-PNL du § 2).
- **Ce qui manque avant la production** : trace atomique (CMP-PNL-01), revue par un tiers et notifications (CMP-PNL-02), exclusion des chemins Comité (CMP-PNL-04), détection de la vidange du pool (CMP-PNL-05), transparence dans les agrégats (CMP-PNL-06).
- **Proportionnalité** : acceptable pour TPE et PME ; à déconseiller par défaut au-delà (la grande entreprise a les moyens de la séparation). Le niveau d'exigence par taille du catalogue A13 doit refléter cela.

**b) Politique modifiable par l'administrateur seul : arbitrage PO requis.** Voir CMP-PNL-03. Recommandation : acceptable sans tiers (marqueur `adminAlone`, motif, trace atomique) ; avec tiers, confirmation d'un tiers pour l'assouplissement, avant la production.

### Q2. Services hors double confirmation : lacune ?

**Avis : non, le périmètre actuel est cohérent, sous réserve de le documenter (CMP-PNL-07).** L'assouplissement n'a de sens que pour la direction permissive.

| Service ou action | Verdict | Raison |
|---|---|---|
| Actions de rejet | Conforme | Le rejet est la direction restrictive. L'auteur ne peut pas rejeter sa propre saisie : strict. Prévoir un retrait explicite par l'auteur (CMP-PNL-17). |
| Proposition de décision de traitement (N+1 fixe) | Conforme avec réserve | Ne pas assouplir une acceptation de risque ; combler l'impasse de structure par un repli de gouvernance (CMP-PNL-16). |
| `RoleService` | Conforme | L'attribution de droits ne doit jamais être auto-validable (aucune dérogation à `noSelfRoleAssign`). La seule exception de ce service est la vacance du dernier RM (CMP-PNL-08). |
| `RiskFrameworkService` | Conforme avec réserve | Régime BOOTSTRAP propre, déjà revu (B-6d : marquage, repli jamais NORMAL). Ne pas le doubler d'un second mécanisme. |
| `RiskService` | Sans objet (non approfondi) | Pas d'étape de validation par un tiers dans le fichier (aucune garde `ForbiddenError`). À reprendre si une validation y est ajoutée. |
| Chemins Comité (inclus dans la porte) | **À arbitrer** | Voir CMP-PNL-04 : ici l'inclusion est le risque. |

### Q3. D2c : départ du dernier Risk Manager, groupe vide, intérimaire

- **Traçabilité : suffisante** pour reconstituer l'événement (CMP-PNL-08 points 1 et 2).
- **Alerte et délai maximal : oui, il en faut**, sans blocage (CMP-PNL-08, a à d). Une fonction de contrôle de 2e ligne vacante est un risque en soi ; ISO 31000 demande suivi et communication, COSO demande que les responsabilités soient assignées en continu. L'échéance doit être un paramètre (60 jours proposés, D18) avec escalade, jamais un retrait automatique.
- **Choix à confirmer de l'ACTION_ITEMS** : (1) suspension du dernier RM toujours refusée : cohérent et prudent, mais crée une asymétrie avec le retrait de rôle ; à documenter dans le message d'erreur (retirer le rôle avec confirmation, puis suspendre) ; (2) intérimaire périmé non utilisé, retour à la confirmation : correct et fail-closed ; (3) marqueur `riskManager.vacancy` : correct, à exposer dans le panel et le calendrier de suivi.

### Q4. D3 : seconde confirmation par le groupe Audit

**Arbitrage PO requis**, recommandation : ne pas faire décider l'Audit (CMP-PNL-11). Compatible seulement comme repli marqué et ratifié, ou comme droit de contestation et d'information.

### Q5. Piste d'audit append-only : autres écarts

- `audit_log` : conforme (trigger + REVOKE, aucune modification par 066).
- Écarts hors `audit_log` : (1) audit non atomique avec l'acte, pour la porte, la politique et les désignations (CMP-PNL-01, 10) ; (2) table `governance_designations` modifiable en base (CMP-PNL-10) ; (3) régime une personne : déclaration hors API sans entrée d'audit, levée sans entrée d'audit (CMP-PNL-15) ; (4) le marqueur est posé à l'appel par chaque service : aucune contrainte ne lie « validateur = auteur » à un marqueur, d'où le contrôle détectif de CMP-PNL-01 ; (5) approbation de profil sans motif (CMP-PNL-13).
- Positif : 071 et la passation écrivent l'audit dans la transaction ; il n'existe ni `UPDATE` ni `DELETE` d'audit dans le code revu.

## 5. Plan d'actions proposé (non exécuté)

| Réf. | Action | Responsable | Condition |
|---|---|---|---|
| ACT-A14-1 | Audit marqué dans la transaction de l'acte (porte, politique, désignations) | @dev-backend | Avant production (CMP-PNL-01) |
| ACT-A14-2 | `DOUBLE_CONFIRMATION` non activable en production avant D5 | orchestrateur | Règle de livraison (CMP-PNL-02) |
| ACT-A14-3 | Circuit de confirmation de l'assouplissement de la politique quand un tiers existe | @dev-backend, arbitrage PO | Avant production (CMP-PNL-03) |
| ACT-A14-4 | Décision PO : chemins Comité dans ou hors de la porte | HUMAN | CMP-PNL-04 |
| ACT-A14-5 | Alerte de vacance et échéance, alerte d'intérim dépassé, KRI associés | @dev-backend, @risk-manager (D18) | Avec D6 (CMP-PNL-08, 09) |
| ACT-A14-6 | Décision PO : Audit approbateur de profil ou informé seulement ; aligner l'ensemble « tiers » et l'ensemble des approbateurs | HUMAN | CMP-PNL-11 |
| ACT-A14-7 | Première version du profil et baisses sans changement de classe sous second regard | @dev-backend | CMP-PNL-12 |
| ACT-A14-8 | Trigger de garde sur `governance_designations` | @dev-db | CMP-PNL-10 |
| ACT-A14-9 | Requête de contrôle des droits accordés par 066/069/070/071 avant application hors dev | @dev-db, HUMAN | CMP-PNL-14 |
| ACT-A14-10 | Test de câblage `server.ts` de la porte, table des actions couvertes et exclues | @qa-engineer, @architect | CMP-PNL-07 |
| ACT-A14-11 | Étiquette « sans validation indépendante » dans agrégats et exports, part exposée | @dev-backend | Avant D6/D7 (CMP-PNL-06) |

Questions à poser au PO (cockpit) : CMP-PNL-03 (régime transitoire « direct »), CMP-PNL-04 (chemins Comité), CMP-PNL-08 (seconde confirmation de la vacance et paramètres d'alerte), CMP-PNL-11 (rôle de l'Audit).

## 6. Revalidation

Revalidation A14 requise après : ACT-A14-1 à 3 et 6 (relecture du code et des transactions), D5 (revue par un tiers, notifications), D6 (détecteurs de vacance, d'intérim, de baisse de classe, masquage). Conclusion limitée au périmètre et à la base indiqués (§ 0) ; aucun texte réglementaire consulté.
