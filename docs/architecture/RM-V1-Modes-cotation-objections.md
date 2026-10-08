# RM V1 — Position du PO sur les modes de cotation : objections des rôles

**Statut** : consultation close le 2026-10-08 ; workflow cible du PO
(section 6) soumis aux mêmes rôles le même jour ; **en attente des réponses
du PO** aux questions de la section 6.5 (qui remplacent la section 3). Aucun code ni modification du contrat
`RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` avant ces réponses.

Rôles consultés (lecture seule) : Architecte, Risk Manager, Compliance, UX
Designer, Dev Frontend. Les références normatives restent paraphrasées et à
vérifier (seule la synthèse COSO ERM 2017 est disponible :
`docs/references/COSO-ERM-2017-synthese-notes.md`).

## 1. Position du PO (2026-10-08)

1. L1 = l'exécutant du contrôle (1re ligne).
2. Trois modes de cotation, enregistrés en configuration au même titre que
   les échelles (paires 4/6, impaires 3/5) et la description des
   probabilités corrélée aux impacts.
3. Le Résiduel est toujours saisi par un membre de l'équipe risque.
4. Classique : l'équipe risque fait tout (Inhérent, Maîtrise, Résiduel).
5. Participatif : Inhérent et Maîtrise par l'exécutant L1 ; Résiduel et
   Maîtrise par l'équipe risque.
6. Hybride : dans un même dispositif, le mode se choisit risque par risque.
7. Le dispositif et ses paramètres sont définis à chaque ajout de risque.

## 2. Ce que disent les cinq rôles

### Points d'accord (aucune objection)

- Trois modes en configuration, avec un instantané du mode sur chaque
  évaluation : en grande partie déjà en place (`Config.ts:46`, migrations
  `030`, `034`).
- Le Résiduel réservé à l'équipe risque, jamais au L1 ni aux contributeurs :
  cohérent avec §7 et facile à imposer par permission.
- Un mode par risque : techniquement simple (une colonne, une permission
  dédiée, une validation sur le modèle de `033`). La difficulté est la
  gouvernance, pas le stockage.
- Ce n'est **pas** trois workflows si les étapes restent les mêmes
  (Inhérent → Maîtrise → Résiduel → validation) et que seule l'attribution
  de la saisie change ; un seul écran d'évaluation avec des zones
  éditables selon le mode et le rôle (UX).
- Échelles paires/impaires et libellés de probabilité : déjà paramétrables.

### Contradictions avec le contrat (tous les rôles)

- **§5** « Le Risk Owner reste le seul décideur des cotations Inherent et
  Résiduel » : le Risk Owner disparaît de la cotation dans la position du
  PO.
- **§7** « Le contributeur ne cote jamais à la place du Risk Owner » : en
  Participatif, le L1 cote au lieu de contribuer.
- **§10** « Dispositif résolu à partir du Processus, un seul actif par
  Processus » : le point 7 en fait un choix au niveau du risque.
- Contradiction interne : le mode vit en configuration (point 2), sur le
  dispositif (points 4 et 6) ou sur le risque (points 6 et 7).

### Objections maintenues

- **Revue de l'Inhérent saisi par L1** (Risk Manager, Compliance B-2) : une
  auto-évaluation de la 1re ligne n'est acceptable que si une 2e personne
  la revoit avant qu'elle serve de base au Résiduel. En Participatif,
  l'équipe risque saisit Maîtrise et Résiduel mais pas l'Inhérent : il
  resterait sans challenge.
- **Validateur indépendant en Classique** (Risk Manager, Compliance B-3) :
  si l'équipe risque fait tout, le validateur doit être hors des
  saisissants (responsable de la fonction, Comité). Le maker-checker
  actuel ne compare qu'à un seul `evaluatorId` (`RiskEvaluationService.ts:432`,
  `:472`, `:524`) : il faudra exclure tous les auteurs de l'évaluation.
- **Choix du mode gouverné et tracé** (Compliance B-4, UX, Architecte) :
  qui choisit, avec quelle justification, quel approbateur, changement
  seulement au démarrage d'un nouveau cycle ; risque de « choisir le mode
  qui donne la note souhaitée ».
- **Le mode effectif d'une évaluation n'est jamais HYBRIDE** (Risk Manager,
  Architecte) : HYBRIDE est une politique qui autorise le choix risque par
  risque ; l'évaluation fige CLASSIQUE ou PARTICIPATIF. La migration 047
  prévue (HYBRIDE dans `risk_evaluations`) est à revoir.
- **Le dispositif ne se redéfinit pas risque par risque** (Risk Manager) :
  des risques cotés sur des échelles différentes ne se comparent plus dans
  la Cartographie ; il peut en revanche être résolu et affiché à l'ajout.
- **Le L1 n'existe pas dans les données** (Architecte) : `Control.executor`
  est du texte libre (`Control.ts:31`) ; un risque a souvent plusieurs
  contrôles, donc plusieurs exécutants.
- **Plusieurs auteurs par évaluation** (Architecte, Frontend) : un seul
  `evaluatorId` aujourd'hui (`RiskEvaluation.ts:74`), et
  `recordMasteryAssessment` écrase la Maîtrise précédente
  (`RiskEvaluationService.ts:318-321`) ; il faut un auteur par étape et
  deux jeux de valeurs si deux acteurs notent la Maîtrise.
- **Le frontend ne peut pas décider seul qui a la main** (Frontend, §16) : il
  faut un contrat backend qui renvoie, pour chaque évaluation, ce que
  l'utilisateur courant peut saisir et la raison d'un refus ; les libellés
  « Cotation retenue par le Risk Owner » de `EvaluationPage.tsx`
  (l. 364-366, 573, 594) deviennent faux.
- **Lisibilité** (UX) : en Hybride, le mode et la provenance de chaque
  cotation (saisie par L1 ou par l'équipe risque) doivent apparaître dans
  la liste des risques, la fiche, la Cartographie et Risk 360.

### Impact sur les lots du passage Architecte

- **B-1 (E-10, évaluateur = Risk Owner) : suspendu** tel que conçu ; à
  redéfinir en « acteur autorisé pour cette étape selon le mode ». La
  clause de DECISION-013 « owner obligatoirement détenteur de
  `riskevaluation.create` » est à revoir.
- **B-2 (HYBRIDE)** et **B-3 (Contribution)** : à reformuler ; la matrice
  OD-1 du Risk Manager devient caduque.
- **B-0 (désignation du Risk Owner, DECISION-013)** et **B-4 (Signalement,
  DECISION-012)** : non touchés.

## 3. Questions à trancher par le PO (dédoublonnées)

| # | Question | Options principales | Bloque |
|---|---|---|---|
| Q1 | **Qui est le Risk Owner** dans ce schéma ? | (A) un membre de l'équipe risque ; (B) le responsable métier, qui ne cote pas mais décide du traitement — recommandé par le Risk Manager ; (C) il garde un droit d'endossement sur les cotations — déconseillé | Amendement §5, B-1, Treatment Decision |
| Q2 | La saisie Inhérent du **L1** est-elle la cotation officielle, ou une proposition que l'équipe risque retient ou amende ? | Officielle mais revue par une 2e personne avant le Résiduel ; ou proposition retenue/amendée | Amendement §5/§7, B-3 |
| Q3 | **Maîtrise saisie par L1 et par l'équipe risque** : comment ? | (a) chacun note sa ligne de défense (L1 la ligne L1, l'équipe risque L2, L3 réservée à l'audit) ; (b) les deux notent les mêmes cellules, l'équipe risque fait foi avec commentaire obligatoire en cas d'écart (Risk Manager) ; (c) la plus basse des deux | Modèle de données |
| Q4 | **Qui est « le L1 » d'un risque** ? | Une personne désignée sur le risque ; ou les exécutants des contrôles qui le couvrent (il faut alors relier `Control.executor` à un utilisateur) ; un seul L1 ou plusieurs | Modèle de données |
| Q5 | **Qui valide** ? | Validateur différent de tous les auteurs de l'évaluation ; en Classique : responsable de la fonction risque ou Comité | Maker-checker |
| Q6 | **Où vit le mode et qui le choisit** ? | Défaut au niveau du tenant ; HYBRIDE autorise un choix par risque, posé par une personne avec permission dédiée et justification, changeable seulement à un nouveau cycle ; sort du mode par processus déjà livré (DECISION-006) | B-2, migration 047 |
| Q7 | « **Dispositif et paramètres définis à chaque ajout de risque** » ? | Résolu et affiché à l'ajout (compatible §10) ; ou choisi ou créé risque par risque (perte de comparabilité) | §10, RiskFramework |
| Q8 | **Quelles contributions restent** (Signalement, Identification, Analyse) et dans quels modes ? | — | B-3 |
| Q9 | **Qui propose la Décision de traitement** (aujourd'hui l'évaluateur) ? | Le Risk Owner ; ou l'équipe risque | Treatment Decision |
| Q10 | **« Équipe risque »** = un rôle portant des permissions dédiées par étape ? N'importe quel membre sur n'importe quel risque, ou un membre désigné par risque ? | — | Permissions |
| Q11 | **« Description des probabilités corrélée aux impacts »** ? | Une description de probabilité par niveau d'impact ; ou des descriptions par axe | Échelles |

Questions bloquantes pour toute maquette (UX) : Q1, Q2, Q3, Q7. Pour tout
code de saisie (Frontend) : Q1, Q2, Q3.

## 4. Formulation proposée par le Risk Manager (si le PO retient Q1 = B)

- §5 : « La saisie de l'Inhérent, de la Maîtrise et du Résiduel est
  attribuée par mode (§7). L'équipe risque saisit le Résiduel dans tous
  les modes. Le Risk Owner décide du traitement. Un acteur ne valide
  jamais ce qu'il a saisi. »
- §7 : « Les modes ne créent pas trois workflows : les étapes sont
  identiques, seule l'attribution de la saisie change. HYBRIDE signifie
  que le Dispositif permet CLASSIQUE ou PARTICIPATIF risque par risque ; le
  mode effectif est figé sur chaque évaluation. »

## 5. Conditions Compliance (rappel)

Rôles et permissions séparés par étape ; validation par un tiers de toute
cotation qui fait foi ; piste d'audit du mode (auteur, motif, approbateur,
valeur précédente) ; critères écrits de choix du mode ; revue périodique ;
échantillonnage par l'audit interne ; KRI (part des risques par mode, écart
moyen entre saisie L1 et valeur retenue) ; confirmation par les juristes
internes de ce que la BCEAO exige sur l'indépendance des fonctions de
contrôle pour l'agrément de Djamo.

## 6. Workflow cible du PO : RO / DEL / EXEC (2026-10-08, second tour)

### 6.1 Position du PO (texte reçu, résumé fidèle)

Avant de créer un risque, on définit dans l'ordre :

1. le fonctionnement du dispositif : Classique, Participatif ou Hybride ;
2. les processus, assignés à des Risk Owners, avec systématiquement un
   délégué si l'effectif du département le permet ;
3. l'exécuteur de chaque contrôle, qui peut être l'une des trois personnes.

Le Risk Owner est en pratique un chef de projet, un directeur de
département ou un manager.

| Config | Organisation | User A (Manager) | User B (Adjoint) | User C (Opérateur) |
|---|---|---|---|---|
| 1 | Petite structure / PME (cumul total) | RO + EXEC | — | — |
| 2 | Structure agile (supervision directe) | RO | — | EXEC |
| 3 | Grande entreprise (séparation stricte) | RO | DEL | EXEC |
| 4 | Sensible / confidentiel (contrôle top management) | RO + EXEC | DEL | — |
| 5 | Délégation complète (adjoint terrain) | RO | DEL + EXEC | — |

Règle d'or du PO : RO + EXEC autorisé ; DEL + EXEC autorisé ; **RO + DEL
interdit** (on ne se délègue pas à soi-même).

### 6.2 Questions de la section 3 tranchées

- **Q1** — le Risk Owner est un responsable métier (lecture B). Reste à
  confirmer qu'il ne cote pas et décide du traitement.
- **Q7** — le dispositif est posé avant le risque, pas redéfini risque par
  risque : compatible §10 (résolu et affiché à l'ajout).
- **Q4** en partie — L1 = l'exécuteur du contrôle, désigné parmi RO, DEL ou
  un opérateur ; un risque couvert par plusieurs contrôles a plusieurs
  exécuteurs.
- **Q6** en partie — le mode vient du dispositif, fixé en premier.
- Non touchées : Q2, Q3, Q5, Q8, Q9, Q10, Q11.

### 6.3 Ce que disent les cinq rôles

**Accord** : l'ordre de configuration est cohérent ; la matrice est
réalisable sans complexité particulière ; le délégué est recommandé, jamais
bloquant (UX : « Non désigné (équipe trop réduite) », visible dans la liste
des processus).

**Modèle de données (Architecte, Risk Manager, Frontend convergents)** :

- Aujourd'hui `Process.owner` (`Process.ts:24`), `Department.riskOwner`
  (`Department.ts:12-13`) et `Control.executor` (`Control.ts:31`) sont du
  texte libre ; seul `Risk.ownerId` est relié à un utilisateur
  (`Risk.ts:31`) ; aucun délégué n'existe ; `superiorOwnerId` est le N+1
  d'escalade, pas un délégué. La RACI (`027`) n'est pas réutilisable.
- Recommandé : **RO et DEL portés par le Processus**, hérités par ses
  risques, surcharge possible sur le risque **par paire** (RO et DEL
  ensemble) ; **EXEC porté par le Contrôle** et relié à un utilisateur,
  à côté du texte libre existant, sans reprise automatique des données.
- RO/DEL/EXEC (rôles d'organisation) et L1/L2/L3 (lignes de défense) sont
  deux axes distincts à ne pas fusionner (Risk Manager).

**La règle d'or ne suffit pas (Risk Manager, Compliance, Architecte)** :

- Aucun acteur ne valide ce qu'il a saisi ou exécuté ; le validateur est
  différent de **tous** les auteurs de l'évaluation (le code ne compare
  qu'un seul `evaluatorId`, `RiskEvaluationService.ts:432`, `:472`, `:524`).
- Pas de DEL sans RO ; personne ne se désigne lui-même ; toute désignation
  RO/DEL/EXEC est permissionnée, motivée et auditée.
- Les pouvoirs du délégué ne sont pas définis (remplace le RO en son
  absence ? agit en permanence ? valide ?).

**Séparation des tâches (Compliance, nouvelle objection n° 5 ; Risk
Manager)** :

- Configs 1 et 4 (RO + EXEC) : auto-évaluation de la Maîtrise par le
  responsable du risque. Acceptables seulement avec compensation : Maîtrise
  revue par l'équipe risque, cumul marqué visiblement, justifié, approuvé et
  revu à chaque cycle, KRI de suivi.
- Config 1 (cumul total) : personne n'est disponible pour valider dans la
  matrice ; validateur extérieur nécessaire (responsable de la fonction
  risque ou Comité). Compliance la déconseille comme configuration par
  défaut et propose de la réserver aux risques faibles.
- Config 4 « Sensible » : le Risk Manager relève qu'elle autorise le cumul
  là où la sensibilité appellerait le plus de séparation.
- Config 5 (DEL + EXEC) : acceptable si le DEL ne valide pas sa propre
  exécution.
- COMPLIANCE_BLOCK annoncé en production si un cumul est autorisé sans
  marquage ni validation tierce, ou si les désignations ne sont pas tracées.

**Interface (UX, Frontend)** : RO / DEL en choix exclusif par personne
(l'interdit devient impossible à saisir), EXEC indépendant, badges neutres
« RO + EXEC » / « DEL + EXEC » ; checklist « Prêt à créer des risques ? »
plutôt qu'un assistant ; la règle vit dans le service, le front la reflète
seulement, avec un code d'erreur stable et une liste d'éligibles fournie par
le backend. Pour DECISION-011, RO et DEL sont les bons interlocuteurs pour
un refus sur le périmètre métier, l'équipe risque pour un refus de saisie.

### 6.4 Impact sur les lots

- **Nouveau lot B-5 « Attribution RO / DEL / EXEC »** (Architecte, taille
  M) : migration (`processes.owner_user_id`, `processes.delegate_user_id`,
  `risks.delegate_id`, `controls.executor_user_id`), désignations,
  règle d'or dans le service et en contrainte DB, résolution de l'héritage.
  Prérequis de B-1. Peut partir après les réponses aux questions A à C
  ci-dessous.
- **B-0 / DECISION-013** : à reformuler — la désignation du RO se fait au
  niveau du Processus ; la clause « owner détenteur de
  `riskevaluation.create` » devient caduque si le RO ne cote pas. Le
  correctif F-1 (`assignOwner` sous `risk.update`) reste nécessaire.
- **B-1** : caduc tel que conçu ; devient « acteur autorisé pour l'étape
  selon le mode » (Participatif : un EXEC d'un contrôle couvrant le risque ;
  Résiduel : l'équipe risque).
- **B-2, B-3, B-4** : inchangés par rapport à la section 2.

### 6.5 Questions au PO (remplacent la section 3)

| # | Question | Recommandation des rôles |
|---|---|---|
| A | RO et DEL portés par le **Processus**, avec surcharge possible sur un risque ? | Oui, surcharge par paire seulement (Architecte, Risk Manager) |
| B | **Le RO cote-t-il**, ou décide-t-il seulement du traitement (ex-Q1) ? | Il décide du traitement ; l'équipe risque cote (tous) |
| C | **Pouvoirs du délégué** : remplace le RO en son absence, agit en permanence, ou valide ? | Remplace le RO (absence ou délégation datée), ne valide jamais ses propres actes ; la responsabilité reste au RO (Risk Manager) |
| D | **Cumul RO + EXEC** (configs 1 et 4) : autorisé pour tout risque, ou plafonné par criticité avec exception approuvée ? Config 4 « Sensible » maintenue ? | Plafonné ; Maîtrise revue par l'équipe risque ; cumul marqué et approuvé ; config 4 à revoir (Compliance, Risk Manager) |
| E | **Qui valide** (ex-Q5), notamment en config 1 et en Classique ? | Une personne hors de tous les auteurs : responsable de la fonction risque, ou Comité au-delà du seuil (tous) |
| F | **Qui désigne** RO, DEL et EXEC, et qui approuve un changement ? | Direction du département, approbation par l'équipe risque, trace complète (Compliance) |
| G | Le DEL peut-il être aussi le **N+1 d'escalade** ? | Non (Architecte, Frontend) |
| H | Les champs texte libres existants (`Control.executor`, `Process.owner`) sont-ils conservés à côté des nouveaux liens ? | Oui, sans reprise automatique ; un contrôle sans exécuteur relié ne permet pas la cotation Participative (Architecte) |

Restent ouvertes de la section 3 : Q2 (saisie L1 officielle ou retenue),
Q3 (Maîtrise à deux acteurs — Risk Manager : mêmes cellules, la valeur de
l'équipe risque fait foi avec commentaire sur écart), Q8, Q9, Q10, Q11.
Les échelles et l'appétence doivent être posées avec le dispositif, avant
les processus (Risk Manager).
