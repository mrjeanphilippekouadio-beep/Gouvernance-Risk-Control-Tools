# Revue Compliance (A14) de DECISION-040

Date : 2026-10-11. Lecture seule, revue de conception (aucun code relu). Statut : recommandations au PO, qui tranche. Sources lues : DECISION-039 et 040, `compliance-B8.md`, `RM-V1-Contrat-etape2-PROJET.md` (règles fixes DECISION-026, §13). Aucun texte BCEAO consulté pour cette revue : les renvois BCEAO sont de principe (Instruction 017-12-2010 : séparation des tâches incompatibles, indépendance fonctionnelle de la fonction de contrôle, fiabilité de l'information) et sont à confirmer par les juristes de Djamo, après qualification de l'agrément. COSO ERM et le Modèle des trois lignes de l'IIA (2020) sont des benchmarks, pas des obligations.

## Verdict global : CONFORME AVEC RÉSERVES, aucun bloquant

Pas de COMPLIANCE_BLOCK : ce sont des décisions de conception, pas de code livré. La remarque de Gitar est fondée sur un point précis (Audit, 3e ligne, qui décide en repli) et pas sur la souplesse elle-même. Trois réserves (R1 à R3 ci-dessous) doivent être traitées avant la mise en production des lots B-8 bis, B-9 bis et B-12.

## Revue par point

| Point | Verdict | Référence | Garde-fou minimal proposé (compatible avec la souplesse voulue) |
|---|---|---|---|
| §2 cumuls (q43) | Conforme avec réserves | IIA : 2e et 3e ligne séparées ; BCEAO : séparation des tâches incompatibles (principe) ; COSO : Governance & Culture | Interdit RM+Audit : conforme. Réserve : l'interdiction étant configurable, sa levée est un événement sensible (permission dédiée, motif, trace, affichage au tableau de bord). Défaut = interdit. Remettre l'interdiction ne révoque rien en silence : les cumuls existants sont signalés. RM+Comité autorisé : conforme si cumul affiché, exclusion du vote sur ce qu'on a saisi conservée, et indicateur « part des décisions où un membre RM siège aussi au Comité ». Voir q58. |
| §4 droits d'Audit (q42, q45) | Conforme avec réserves | IIA : 3e ligne lecture et assurance, pas de gestion ; BCEAO : indépendance de la fonction de contrôle | Audit en lecture seule, groupe Audit remplaçant « Auditeur » : conforme (vérifier que les membres de l'ancien rôle sont migrés, sans élargissement). Seul l'administrateur modifie les droits d'Audit : conforme (autorité distincte de l'équipe risque). Réserve maker-checker (administrateur = responsable risque) : validé par Audit ou Comité. Cas à définir : si Audit et Comité sont vides, le changement est refusé (jamais d'auto-validation) ; le validateur ne peut pas être l'auteur du changement ; Audit validant ses propres droits est acceptable seulement tant que ces droits restent en lecture, toute extension d'écriture à Audit exigeant le Comité. Motif obligatoire. |
| §7 noms dans la fenêtre « droits perdus » (q48) | Conforme avec réserves | Minimisation (avis Privacy A15 requis) ; principe 1 de ma mémoire (confidentialité) | Exception à q02 explicite et bornée : accepter. Limiter à nom d'affichage (ni e-mail ni identifiant), aux seuls détenteurs de la permission qui peut rétablir le droit précis perdu, déclenché seulement par une action refusée de l'utilisateur réactivé (pas d'endpoint de liste libre), côté service et non côté frontend, un événement d'audit par affichage, plafond de fréquence. Pas de précédent pour d'autres écrans. |
| §10 premier Dispositif (q51) | Conforme avec réserves | COSO : contrôle de l'environnement ; amorçage déjà vu en C-3 de B-8 | Retrait de l'administrateur : conforme. Réserve : si l'administrateur crée le premier utilisateur et se désigne lui-même RM, une seule personne crée, active et configure. Le cas est permis par le PO : le marquer « cumul administrateur + RM », motif, événement d'audit, et notifier une personne désignée au moment de la création du tenant (direction générale ou contact du client), sans bloquer. Le garde « jamais vide » (suspension du dernier RM) doit être livré avant ce flux. |
| §11 circuit unique (q54) | Conforme avec réserves (R2) | IIA : l'audit interne ne prend pas de décisions de gestion du risque, sinon il perd objectivité et indépendance ; COSO : Review & Revision | Circuit unique et lisible : bon. Point sensible : Audit décide en repli, puis aura à auditer ses propres décisions. Garde-fous : décision « prise en repli » marquée en tant que telle ; indicateur « décisions en repli, par groupe décideur » ; ratification a posteriori (non bloquante) par le Comité dès qu'il est constitué ; les décisions où Audit a décidé sont signalées au dossier de la mission d'audit (Audit ne les revoit pas seul). Un groupe est « vide » s'il n'a aucun membre actif (suspendus exclus). |
| §12 co-signature (q52) | Conforme avec réserves | Principe des quatre yeux ; COSO : Control Activities | La co-signature est un acte distinct (horodaté, motivé, pas de pré-approbation). Le co-signataire est soumis aux mêmes exclusions que le décideur (demandeur, auteur, RO, Délégué, Exécuteur). Une co-signature entre pairs de la 2e ligne est une revue, pas un contrôle indépendant : la vue Comité/Audit et l'indicateur la rendent visible. Sans autre RM disponible : voir q60. |
| §13 exclusion du responsable (q53) | Conforme | Invariant 1 (jamais approuver ce qu'on a saisi) | « Responsable de la fonction risque » doit être un attribut ou une permission distincte, pas une déduction (recommandation déjà faite en C-4 de B-8) ; sinon, plusieurs membres RM rendent le rôle ambigu. |
| §14 pas de quorum par défaut (q55) | Conforme avec réserves (R1) | BCEAO : principe de non-décision par une seule personne à vérifier ; DECISION-026 règles fixes | Souplesse acceptée sous conditions : (a) préciser que « aucun quorum forcé » vise les décisions de repli, jamais les votes du Comité (DECISION-026 : « jamais un seul membre » est une règle fixe, et q55 la contredirait sinon) ; (b) paramètre « décideurs minimum » présent, défaut 1 pour le repli, relevable ; (c) toute modification du paramètre est un événement sensible (motif, trace) ; (d) alerte et indicateur : nombre et part de décisions prises par une seule personne, par période. Le silence ne vaut jamais accord. |
| §15 motif (q56) | Conforme | Piste d'audit (BCEAO, 10 ans, principe) ; invariant 5 | Motif obligatoire, non vide et non modifiable après coup ; stocké dans `reason` de l'audit (le `reason: null` constaté en B-8 ne doit pas se reproduire). |
| §16 notification d'Audit (q56) | Conforme avec réserves | IIA : information de l'organe de gouvernance et de l'audit | Notification persistante avec statut de lecture, pas seulement un e-mail. Trou : quand Audit est lui-même le décideur, personne n'est prévenu. Proposer un destinataire de dernier recours facultatif (direction générale, jamais l'administrateur) et la vue dédiée comme repli. Journal append-only, tenant-scopé, sans écriture admin. |
| §16 bis votes à l'échéance (q57) | Conforme | Piste d'audit | Votes conservés, non comptés, visibles du décideur : correct. |

## Réserves à lever avant production

- **R1. Périmètre du « sans quorum »** : conflit apparent avec les règles fixes de DECISION-026. À clarifier dans le contrat (A13).
- **R2. Audit décideur en repli** : seul point où la 3e ligne exerce une décision de gestion. Garde-fous : marquage, indicateur, ratification a posteriori par le Comité.
- **R3. Amorçage et cumuls auto-attribués** (administrateur = RM, premier Dispositif) : marquage, motif, notification d'une tierce personne.

## Avis sur les questions ouvertes

**q58 — portée du réglage de cumul.** Recommander un réglage par paire de groupes, au niveau du tenant, défaut interdit pour RM+Audit. Le réglage ne s'applique jamais à l'auto-validation (invariant 1) ni à RM+Comité (autorisé de toute façon). Changer le réglage : permission dédiée, motif, trace, visible dans la vue Comité/Audit. Les cumuls déjà présents ne sont pas révoqués automatiquement mais signalés. À préciser : Audit+Comité, aujourd'hui non traité par DECISION-040, devrait au moins être affiché comme cumul.

**q59 — taille de matrice vs page Cartographie.** Le sujet touche à la fiabilité de l'information : avec un plafond 25 et des bandes « Critique 16-25», une matrice 3×3, 4×4 ou 6×6 serait mal classée dans les rapports. Recommander de séparer disposition et données : la règle « ne pas toucher la page » reste valable pour la mise en page, mais les bandes et plafonds (backend) doivent s'aligner sur la taille. Tant que ce n'est pas fait, seule la 5×5 est activable. Décision du PO.

**q60 — refus de co-signer.** Le refus est enregistré avec motif, ne compte pas comme co-signature, n'est pas un veto, et est visible d'Audit et du Comité (c'est un signal de désaccord). Le décideur peut solliciter un autre RM. Si aucun ne co-signe, la décision n'est pas prise en silence : elle reste en attente avec alerte, et, si le PO veut une issue souple, une « décision sans co-signature » reste possible comme exception marquée (motif, notification d'Audit, entrée dans l'indicateur de §14).

**q61 — règle de décision par défaut sans quorum (révise q27).** Distinguer le vote du Comité (règles A/B/C et règles fixes inchangées) de la décision de repli, qui est une décision nominative et motivée, pas un vote. Défaut proposé : un décideur désigné, motif, journal, notification, ratification a posteriori ; paramètre « décideurs minimum » relevable (y compris à 2). q27 (Audit vote avec les règles du Comité) vaut pour Audit approbateur choisi du Dispositif, pas pour le repli : le préciser pour éviter deux lectures.

## Recommandations par priorité

1. Clarifier R1 (portée du « sans quorum ») dans le contrat, avec le paramètre « décideurs minimum ».
2. Marquer et suivre les décisions de repli, surtout quand Audit décide (R2) : indicateur et ratification a posteriori.
3. Suspendus exclus du comptage « groupe vide » et du circuit (suite de F-B8-01).
4. Marquer les cumuls auto-attribués (administrateur = RM) et notifier un tiers à l'amorçage (R3).
5. Rendre sensible toute modification des réglages (cumuls, quorum, circuit) : permission dédiée, motif, trace.
6. Fenêtre « droits perdus » : minimisation et avis Privacy (A15).
7. Aligner bandes et plafonds sur la taille de matrice avant d'autoriser une autre taille que 5×5 (q59).
8. Définir le comportement de q60 (refus de co-signer).

## Limites

Aucun code relu ; aucun texte réglementaire consulté ; conclusions limitées à la conception décrite dans DECISION-039/040 et le contrat projet. Validation juridique par les juristes internes de Djamo requise pour toute affirmation de conformité BCEAO.
