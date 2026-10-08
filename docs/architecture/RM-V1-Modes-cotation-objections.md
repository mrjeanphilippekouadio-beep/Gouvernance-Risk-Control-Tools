# RM V1 — Position du PO sur les modes de cotation : objections des rôles

**Statut** : consultation close le 2026-10-08, **en attente des réponses du
PO** aux questions de la section 3. Aucun code ni modification du contrat
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
