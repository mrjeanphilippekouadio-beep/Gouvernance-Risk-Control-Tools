# CMP-b6c-sole-rm : passage Compliance sur B-6c (PR #240), régime SOLE_RM (q252 A) et déplacement de Dispositif (q257 A)

Date : 2026-11-11. Agent : A14 Compliance (deuxième ligne). Référence décision : DECISION-121 (PO, cockpit). Je ne remets pas la décision du PO en cause : je signale les écarts au texte décidé et les manques de contrôle compensatoire.

## Verdict : CONFORME SOUS CONDITIONS

L'auto-décision tracée du seul Risk Manager est une exception de séparation des tâches défendable, parce qu'elle est bornée (rattachement d'un processus seulement, effet aux évaluations suivantes, jamais ACTIVATE_VERSION ni SET_DEFAULT), qu'aucun tiers n'est disponible, qu'elle est signalée et qu'elle cesse d'elle-même. En revanche, la traçabilité seule (journal, marqueur, notification) est une contrôle détectif sans suite obligatoire : elle ne suffit pas comme contrôle compensatoire tant que la revue a posteriori, son délai et un compteur ne sont pas rendus obligatoires pour SOLE_RM. Trois conditions bloquent la clôture du passage (C1 à C3).

## Périmètre, période, preuves, limites

- Périmètre : `RiskFrameworkService.confirmSoleAssignment`, migrations 089/090, route `sole-confirm`, marqueur `riskFramework.soleRiskManager`, notification Audit/Comité, santé de la gouvernance ; q257 (`ProcessService.update`, `RiskService.update`, notification `OBJECT_FRAMEWORK_CHANGED`).
- Preuves lues : rapports `docs/security/SEC-b6c-q252-q257-2026-11-11.md` et `docs/qa/qa-b6c-q252-q257-2026-11-11.md` ; code `RiskFrameworkService.ts` (l. 670-727), migration `090_sole_rm_frozen_at_request.sql`, `GovernanceNotifier.ts`, `GovernanceHealthService.ts`, `GovernancePrincipleAcceptanceService.ts` (règle q181) ; `ACTION_ITEMS.md` (DECISION-121, SEC-B6C-04/05, B6C-NOTIF). Niveau de preuve : 2 (documentation) et 3 partiel (rapports d'exécution A08/A10 ; je n'ai rien exécuté moi-même).
- Limites : l'outil git n'étant pas disponible dans ma session, je n'ai pas pu lire `origin/feat/r1-b6c-changement-dispositif` ; j'ai lu une copie de travail (`.claude/worktrees/agent-a7b387f0ef81103da`) qui contient la migration 090 (donc postérieure aux commits testés par A10 et A08). Je n'ai pas pu confirmer qu'elle est identique à la tête de la PR : à vérifier par l'orchestrateur. Le retest A10 de 090 n'est pas encore en ma possession. Aucun texte BCEAO n'a été relu dans cette session (voir CMP-B6C-08).

## Réponse à la question posée

1. Exception de séparation des tâches acceptable ? Oui, sous conditions. Le principe de contrôle interne (COSO, activités de contrôle : séparation des fonctions incompatibles, ou à défaut contrôle alternatif ; maker-checker ; instruction 017-12-2010 telle que citée dans compliance.md : séparation des tâches incompatibles) admet une exception lorsque la séparation est impossible, à la double condition qu'elle soit (a) rare et bornée, (b) compensée par une revue indépendante a posteriori. (a) est satisfaite par la conception. (b) est seulement amorcée (voir CMP-B6C-02 et 03).
2. La traçabilité suffit-elle ? Non seule. Le journal, le marqueur et la notification sont détectifs : ils permettent de voir, ils n'obligent personne à regarder. Ce qui rend l'exception acceptable, c'est la revue indépendante (auteur exclu) avec un délai et une suite si elle n'a pas lieu.
3. Condition manquante ? Oui : revue a posteriori obligatoire avec délai, compteur de récurrence, et traitement du cas « personne à prévenir » (voir constats).

## Constats

| ID | Sujet | Gravité | Statut |
|---|---|---|---|
| CMP-B6C-01 | Nature de l'exception SOLE_RM | INFO | Acceptable (conception) |
| CMP-B6C-02 | Revue a posteriori non obligatoire / délai facultatif | MAJEURE (condition C2) | EVIDENCE_REQUIRED |
| CMP-B6C-03 | Aucun compteur ni seuil de récurrence pour SOLE_RM | MAJEURE (condition C3) | GAP_IDENTIFIED |
| CMP-B6C-04 | Situation « RM unique » sans indicateur permanent | MINEURE | GAP_IDENTIFIED |
| CMP-B6C-05 | Écart au texte « au moment de la demande » (SEC-B6C-04) | MAJEURE tant que non retesté (condition C1) | REVALIDATION_REQUIRED |
| CMP-B6C-06 | Audit et Comité vides : personne n'est prévenu | MINEURE | ACCEPTED_BY_DECISION (DECISION-046), à documenter |
| CMP-B6C-07 | q257 : trace = seul contrôle compensatoire, et elle peut être perdue (SEC-B6C-05) ; pas de marqueur d'exception | MAJEURE (condition C1) | REMEDIATION_REQUIRED |
| CMP-B6C-08 | Référence réglementaire non établie dans cette session | INFO | EVIDENCE_REQUIRED |
| CMP-B6C-09 | Écarts de forme au texte décidé (destinataires, double comptage, motif 1000/500) | MINEURE | ouvert (B6C-NOTIF, INFO 09, QA) |

### CMP-B6C-01 : nature de l'exception (INFO)
Éléments qui la rendent défendable, constatés dans les rapports et le code : permission double (`riskframework.process.assign` + `riskframework.activate`) et appartenance au groupe RM ; demandeur = confirmeur seulement s'il n'existe aucun autre décideur éligible (contrôle de service rejoué sous verrou, mutation testée par A08) ; motif obligatoire non vide ; `decidedBy` forcé à `actor.userId` ; CHECK de forme en base ; une seule confirmation sur six simultanées ; deux lignes d'audit avec `governance_exception = riskFramework.soleRiskManager` ; apparition dans la santé de la gouvernance ; effet limité aux évaluations suivantes (pas rétroactif).

### CMP-B6C-02 : revue a posteriori (condition C2)
Constat : le mécanisme de revue existe déjà (`governanceexception.review`, auteur exclu par service et trigger, notification des détenteurs du droit, retard `overdue` après le délai du tenant q168 / q180). Mais : (i) `overdue` n'est « jamais calculé quand aucun délai n'est fixé » (`GovernanceHealthService`), donc une exception SOLE_RM peut rester non revue sans limite si le tenant n'a pas fixé de délai ; (ii) rien n'oblige un revueur à exister : sans membre Audit/Comité ni détenteur du droit autre que l'auteur, l'exception reste ouverte indéfiniment ; (iii) je n'ai pas vérifié que le marqueur SOLE_RM est bien repris par `unreviewedExceptionCount` et peut recevoir une revue (à prouver par un test ou une lecture du dépôt).
Attendu : toute exception SOLE_RM a un délai de revue borné (jamais « sans délai ») et une issue (revue, contestation q157, ou escalade) si le délai est dépassé.
Preuve demandée : test montrant qu'une confirmation SOLE_RM apparaît non revue, devient `overdue`, et se ferme par une revue d'un tiers ; valeur du délai q168 (non lue ici, je ne la présume pas).
Recommandation : pour SOLE_RM, appliquer un délai maximal par défaut même si le tenant n'en a pas fixé (le plancher doit être une valeur lue dans la décision q168, pas une constante inventée), et prévenir l'Audit/Comité du dépassement.

### CMP-B6C-03 : compteur et récurrence (condition C3)
Constat : la règle de récurrence existe pour l'acceptation d'un principe (q181 : une acceptation faite seul après une acceptation faite seul exige la revue de la précédente, sinon marquage « renouvelé sans revue »). Rien d'équivalent pour SOLE_RM : un RM unique peut enchaîner N confirmations sans qu'aucune ait été revue, sans seuil ni alerte.
Attendu : même logique que q181 : une nouvelle confirmation SOLE_RM n'est pas bloquée, mais est marquée « sans revue des précédentes » et comptée ; un indicateur (KRI/KCI) donne le nombre de SOLE_RM sur la période et le nombre non revus, relié au risque « absence de séparation des tâches » (Risk Manager conserve la cotation).
Recommandation : réutiliser le pattern q181 (pas de nouveau mécanisme), plus un compteur dans la santé de la gouvernance. Seuil d'escalade vers HUMAN : décision PO (question Q1).

### CMP-B6C-04 : indicateur permanent « RM unique » (MINEURE)
La règle cesse dès qu'un 2e RM existe (bien), mais rien n'exerce de pression pour y arriver. Le panneau signale les exceptions, pas l'état structurel. Recommandation : un indicateur « tenant à Risk Manager unique depuis X jours » dans la santé de la gouvernance (la règle `riskManager.vacancy` existe déjà pour la vacance : vérifier si elle couvre le cas « un seul »). Remontée à A13 pour le risque.

### CMP-B6C-05 : écart au texte (condition C1, partie 1)
DECISION-121 : « si aucun autre RM ne peut valider [au moment de la demande] ». A10 (SEC-B6C-04) a montré que l'implémentation jugeait à la confirmation (un RM avec `role.assign` retire son collègue, confirme, le réassigne : trois appels, une seule personne). Dans la copie lue, la migration 090 fige `sole_rm_at_request` et le service refuse si `soleRmAtRequest === false` ; les demandes déjà en attente (défaut false) ne sont pas confirmables seules. C'est conforme au texte. Reste : retest A10 et test de régression (« deux RM à la demande, retrait, `sole-confirm` = 409 »), et confirmation que ma copie = tête de PR. Le service rejoue aussi la condition « aucun autre éligible » à la confirmation : bon (double garde).
Point à signaler sans le trancher : le flux (retrait du collègue pendant que la demande est ouverte) est déjà signalé par `GOVERNANCE_MEMBER_REMOVED` ; la fenêtre résiduelle est un RM seul à la demande qui crée lui-même la situation avant la demande (retrait du collègue puis demande immédiate). Cette séquence reste tracée mais n'est pas bloquée : elle relève de la revue a posteriori (C2) et de l'indicateur de CMP-B6C-04.

### CMP-B6C-06 : personne à prévenir (MINEURE)
Quand Audit et Comité sont vides, aucun tiers n'est prévenu (DECISION-046, q103 : détection a posteriori seulement, journal consultable dès le premier membre). Acceptable puisque décidé, mais alors le seul contrôle est le journal. Condition : le journal doit rester lisible et la notification « combien d'exceptions non revues » doit partir au premier membre Audit/Comité (R-6.3, q144 existe : vérifier qu'elle couvre SOLE_RM). À documenter dans le registre des risques acceptés.

### CMP-B6C-07 : q257 (condition C1, partie 2)
Constat : déplacer un risque ou un sous-processus vers un autre Dispositif sans validation est un contournement assumé du circuit q89 (PO, A). Le contrôle compensatoire est : motif obligatoire + journal ancien/nouveau + notification. Trois manques : (i) SEC-B6C-05 / QA-B6C-03 : `ProcessService.update` écrit l'audit hors transaction ; une panne d'audit laisse le sous-processus déplacé sans journal, sans motif, sans notification, et un rejeu ne voit plus de changement : la trace, qui est le seul contrôle, est perdue pour de bon ; (ii) le déplacement n'est pas marqué `governance_exception`, donc il n'apparaît ni dans la santé de la gouvernance ni dans la revue, alors que le Dispositif d'arrivée peut être plus souple (acteur avec `process.update`, non RM) ; (iii) destinataires : `OBJECT_FRAMEWORK_CHANGED` part aux détenteurs de `riskframework.activate`, pas au groupe Risk Manager (écart au texte « groupe Risk Manager prévenu »).
Attendu : trace atomique avec l'écriture (comme pour le risque) ; destinataires conformes au texte ; recommandation à étudier, sans exiger la remise en cause de la décision : marquer le déplacement vers un Dispositif plus souple comme élément revu a posteriori, ou au moins le compter.
Preuve demandée : test « panne d'audit sur Process UPDATE = parent inchangé » (demandé par A10) ; test du destinataire.

### CMP-B6C-08 : référence réglementaire (INFO)
Je n'ai pas relu dans cette session le texte de l'Instruction 017-12-2010 ni établi son applicabilité à Djamo (SFD ou EME/paiement ?) ; les mémoires précédentes notent déjà que cette applicabilité n'est pas établie. Mon avis s'appuie donc sur le principe de séparation des tâches (COSO, maker-checker) et non sur une obligation BCEAO prouvée. Si Djamo n'est pas SFD, BCEAO n'est qu'un benchmark pour cette exigence. Pas de conclusion « conforme BCEAO » ici. Le juriste doit confirmer le statut (question en attente depuis CMP-q217-q237).

### CMP-B6C-09 : écarts de forme
- Notification `OBJECT_FRAMEWORK_CHANGED` : détenteurs du droit au lieu du groupe RM (cf. CMP-B6C-07).
- Une confirmation compte deux exceptions dans la santé (A10 INFO 09) alors que le code actuel commente « une seule exception » : confirmer le comportement réel, car le compteur C3 en dépend.
- Motif de `sole-confirm` jusqu'à 1000 caractères, 500 ailleurs ; texte libre, risque de donnée nominative faible mais réel : aligner (QA).
- La table « Demandes en attente » n'identifie pas le processus : on confirme seul sans voir quoi (qualité de la décision de confirmation). Recommandation UX à A04.
- Qualité du motif : tout texte non vide passe ; accepté, car la revue a posteriori (C2) porte sur la pertinence.

## Conditions de levée (le passage est clos quand elles sont remplies)

| Condition | Action requise | Preuve | Validation |
|---|---|---|---|
| C1 | Retest A10 de 090 (SEC-B6C-04) ; audit atomique du déplacement de sous-processus (SEC-B6C-05) ; destinataires q257 conformes | Tests de régression verts, rapport A10 | A10 puis A14 |
| C2 | Revue a posteriori obligatoire pour SOLE_RM avec délai borné et suite si dépassement | Test de bout en bout + valeur q168 | A14 |
| C3 | Compteur SOLE_RM (période, non revus) et marquage « sans revue des précédentes » (pattern q181) | Test + capture du panneau | A14 / A13 pour le lien au risque |

Aucun COMPLIANCE_BLOCK n'est émis : aucune obligation réglementaire établie n'est violée en l'état (CMP-B6C-08), et la décision du PO est respectée. C1 est en revanche une condition de merge raisonnable, car la trace est le contrôle unique de q257. C2 et C3 peuvent être livrés dans le lot correctif B-6c ou au plus tard avant la mise en production à un client réel (le PO tranche, question Q1).

## Revues croisées

RISK_REVIEW_REQUIRED : oui (A13 : acceptation d'une décision sans second avis, lien au registre ; la cotation lui appartient). PRIVACY : non (motif libre : point mineur). SECURITY : retest C1. AUDIT : oui (A23 : lecture de l'exception, comptage un/deux).

## Conclusion

Conforme sous conditions, pour le périmètre évalué (régime SOLE_RM sur ASSIGN_PROCESS et déplacements q257), sur la période du 2026-11-11, selon les preuves listées, avec les limites indiquées. Pas d'extrapolation à d'autres décisions ni aux Dispositifs en dehors de ce périmètre.
