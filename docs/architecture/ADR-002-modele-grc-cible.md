# ADR-002 — Modèle GRC cible : catalogue/registre/évaluation, moteur transverse, consolidation KPI/KRI

Statut : Adopté (2026-09-28)
Contexte complet : voir `docs/architecture/GRC_Target_Domain_Model.md`,
`docs/architecture/GRC_Database_Gap_Analysis.md`,
`docs/architecture/GRC_Migration_Plan.md` (commits `54b20f0`/`96b7949`/
`89c2be0`/`b8e037b`) et `.claude/agent-context/SHARED_LOG.md`, entrées du
2026-09-28 taguées `@architect`/`@dev-db`/`@product-manager` (« Arbitrage
du Product Owner sur la consultation CDC GRC v0.1 », « Arbitrage des 4
points ouverts de la Gap Analysis », et les deux mises à jour qui en
découlent). Ce document ne duplique pas leur contenu technique — il fixe
le **pourquoi** des choix structurants pour qui arrive après coup.

## Contexte

Le Product Owner a échangé avec le client et élargi la vision produit :
GRC Tools cesse d'être un outil de scoring de risques pour devenir une
plateforme GRC/ERM interconnectée — référentiel de risques
catalogue/registre/évaluation séparés, RACI formel, commentaires et
évidences génériques, module Incidents entièrement nouveau, module Audit
avec Findings, moteur de méthodologie versionné, lignes de défense
L1/L2/L3 configurables (nouveau cahier des charges,
`docs/Cahier_des_charges_GRC_v0.1.md`).

Ce changement de portée ne peut pas se traiter comme une nouvelle
fonctionnalité isolée : il touche le cœur du modèle métier (`Risk`),
introduit des concepts absents du code actuel (`RiskCatalog`,
`Incident`, `Finding`, RACI) et en recoupe d'autres qui existent déjà
sous une forme partielle ou dupliquée (`RiskAssessment`/`RiskEvaluation`,
`Kpi`/`Kri`). 15 agents ont été consultés en parallèle sur le cahier des
charges ; la synthèse a fait remonter des contradictions internes au
document et de la dette silencieuse déjà présente dans le code
(`ActionPlanService.SOURCE_TYPES` acceptant déjà `INCIDENT`/`AUDIT` sans
entité derrière). Le Product Owner a tranché 6 principes transverses
et posé un gate — 3 artefacts de référence (Domain Model, Gap Analysis,
Migration Plan) à produire et faire converger **avant** toute
modification de schéma réelle — puis 4 arbitrages ponctuels sur des
points laissés ouverts par ces artefacts.

Lors de la consultation initiale, l'agent Documentation avait recommandé
qu'un ADR dédié fixe ces arbitrages structurants avant tout travail DB
réel. Cette recommandation n'avait pas encore été suivie d'effet — ce
document la referme, à un moment où le Lot 1 (RACI minimal, voir
`GRC_Migration_Plan.md` §2 Lot A) démarre déjà en parallèle. Les futurs
lots (B à H) doivent pouvoir s'y référer sans rouvrir le débat sur ces
5 points.

## Décision 1 — Séparation Catalogue / Registre / Évaluation

**Décision** : le triptyque `Risk Catalog → Risk → Risk Assessment` du
cahier des charges (§7.1) est matérialisé par trois objets distincts,
jamais fusionnés :

- `RiskCatalog` (**NOUVEAU**) — le dictionnaire : ce qu'*est* un type de
  risque, indépendant de toute instance organisationnelle.
- `Risk` (**EXISTANT_À_ÉTENDRE**) — le registre : le risque effectivement
  identifié dans un périmètre donné. Gagne une FK nullable
  `riskCatalogId`, sans toucher à sa structure actuelle.
- `RiskEvaluation` (**EXISTANT**) — confirmée **unique** implémentation
  technique du concept métier « Risk Assessment ». `RiskAssessment`
  (l'entité technique de ce nom, table `risk_assessments`) est
  **DÉPRÉCIÉE**, pas une seconde implémentation concurrente.

**Pourquoi** : la séparation catalogue/registre/évaluation est un
standard ERM reconnu (le cahier des charges le formalise en §7.1) et
correspond à trois cycles de vie réellement différents. Côté
`RiskAssessment` vs `RiskEvaluation`, l'investigation de code menée par
Dev DB (entités + repositories + services + routes + `server.ts`, pas
seulement les entités TS) a montré que `RiskAssessment` est un
scaffolding mort depuis l'origine — posé à la migration `003`, jamais
raccordé à un service, une route ni `server.ts` — pendant que
`RiskEvaluation` est la chaîne réellement en production (9 modules
livrés, retestée en sécurité SEC-011/SEC-015) et couvre un sur-ensemble
strict du besoin de `RiskAssessment` (probabilité/impact simple **plus**
maîtrise par ligne de défense, appétence, méthodologie versionnée,
workflow de validation à quatre yeux). Fusionner les deux aurait cassé
le contrat déjà stable de `RiskEvaluation` sans gain ; réactiver
`RiskAssessment` aurait recréé un second chemin technique pour un même
concept métier. La dépréciation est migration additive pure : la table
`risk_assessments` reste en place (coût de stockage nul), aucun `DROP`
n'est inclus dans ce lot — sa suppression physique reste soumise à un
sign-off ultérieur explicite (Architecture + Product Owner), hors
périmètre de ce chantier.

Référence détaillée : `GRC_Target_Domain_Model.md` §0.1 (distinction 1),
§4.1-4.2, §5.1-5.2 ; `GRC_Database_Gap_Analysis.md` §1 ; `GRC_Migration_Plan.md`
Lot E/Lot G (`045`, optionnelle et conditionnée).

## Décision 2 — Moteur transverse polymorphe (Comments / RACI / Evidence)

**Décision** : les trois capacités transverses Comments, RACI et
Evidence (au sens « rattachement N:N à un objet GRC ») partagent un seul
patron : une table de liaison portant `objectType` (whitelist contrôlée
par `CHECK`) et `objectId`, jamais une table dédiée par type d'objet
(`risk_comments`, `control_comments`, etc.). Ce moteur est conçu **dès
maintenant**, dans le même lot que le reste du modèle, bien qu'il ne soit
exposé utilisateur qu'au Lot 6/7 du découpage fonctionnel du cahier des
charges.

Le moteur est injecté en **paramètre optionnel de constructeur** côté
services applicatifs (`users?: UserRepository`, `departments?:
DepartmentRepository`, etc.) — un patron déjà en place dans ce backend
avant même ce chantier.

**Pourquoi** : ce patron a un précédent déjà accepté et en production —
`ActionPlan.sourceType`/`sourceId` — que le Product Owner a explicitement
confirmé comme la bonne approche (SHARED_LOG, « Arbitrage du Product
Owner », point 5). Il évite une prolifération de tables par objet et
respecte le principe transverse §32.4 du cahier des charges (« fonction
transverse ≠ table par objet »). Le précédent de production le plus
ancien, `AuditEvent` (`entityType`/`entityId`, append-only strict depuis
l'origine), valide la robustesse de l'approche à l'échelle. La directive
« ordre de livraison ≠ dépendances techniques » (SHARED_LOG, point 1)
justifie de concevoir ce moteur en amont de son exposition utilisateur :
RACI est câblé au Lot A avec une whitelist `object_type` volontairement
restreinte (`RISK`/`CONTROL`/`ACTION_PLAN`), élargie non destructivement
lot après lot (Lot G, `044`) à mesure que les objets qu'elle référence
(`INCIDENT`, `FINDING`, …) existent réellement.

Référence détaillée : `GRC_Target_Domain_Model.md` §0.2, §2 (capacités
transverses) ; `GRC_Database_Gap_Analysis.md` §2.2 ; `GRC_Migration_Plan.md`
Lot A (`027`), Lot F (`043`), Lot G (`044`).

## Décision 3 — Consolidation KPI/KRI en `Indicator`/`IndicatorMeasure`

**Décision** : `Kpi`/`Kri`/`KpiMeasure`/`KriMeasure`/`kri_risks` (4
tables déjà en production) sont **consolidées** vers un modèle physique
unique : `Indicator` (table `indicators`, discriminant
`indicatorType: "KPI" | "KRI"`, immuable après création) et
`IndicatorMeasure` (table `indicator_measures`, remplace
`KpiMeasure`/`KriMeasure`). Les colonnes spécifiques à chaque type
(seuils vert/orange/rouge + `riskId` pour KRI ; valeur cible/unité pour
KPI) restent des colonnes typées et contraintes au niveau SQL dans la
même table (`CHECK` conditionné au discriminant), jamais un JSONB
fourre-tout ni une sous-table par type. Les fonctions de calcul de
statut (`computeKpiStatus`/`computeKriStatus`) restent deux fonctions
pures distinctes, sélectionnées à la lecture.

**Pourquoi** : c'est un **revirement du Product Owner** par rapport à
l'hypothèse par défaut posée par la Gap Analysis (statu quo, deux tables
séparées, recommandé par Dev DB). Le Product Owner a tranché l'inverse,
en posant explicitement que KPI et KRI restent deux types métier
fonctionnellement distincts — statuts, finalité, seuils, vocabulaire
produit inchangés côté utilisateur — mais qu'ils n'ont pas de raison de
porter deux modèles physiques de stockage séparés : « un seul modèle
physique, deux types métier distincts » (SHARED_LOG, « Arbitrage des 4
points ouverts de la Gap Analysis », point 4). C'est le point le plus
structurant des 4 arbitrages : il déplace 4 tables déjà alimentées en
production d'un statut RÉUTILISER (aucun changement) vers une nouvelle
catégorie de classification, CONSOLIDER, créée spécifiquement pour ce
cas car ni RÉUTILISER ni CRÉER ne rendaient compte honnêtement d'une
fusion non destructive de tables déjà en production.

**Stratégie de consolidation non destructive retenue** — jamais un
raccourci « `CREATE TABLE` puis `DROP TABLE` » :

1. **Expand** — création additive de `indicators`/`indicator_measures`/
   `indicator_risks` ; `kpis`/`kris`/`kpi_measures`/`kri_measures`
   restent en place et inchangées, aucune donnée n'y est touchée.
2. **Migrate (backfill)** — traitement **applicatif** (Dev Backend), pas
   un `INSERT INTO ... SELECT` SQL brut en masse, qui lit les 4 tables
   sources et écrit dans les tables neuves en préservant identifiants et
   horodatages, avec vérification post-backfill.
3. **Switch (coexistence)** — période de double-écriture ou vue de
   compatibilité en lecture, le temps que tous les lecteurs (API,
   rapports) basculent vers `indicators`/`indicator_measures`.
4. **Contract (dépréciation documentaire)** — marquage `COMMENT ON
   TABLE` des 4 anciennes tables, optionnel et conditionné à un
   sign-off Architecture + Product Owner explicite, **jamais un `DROP
   TABLE`** dans ce lot. Suppression physique éventuelle hors périmètre,
   migration séparée et dédiée, plus tard.

Cette séquence suit exactement la même gouvernance que la dépréciation
de `RiskAssessment` (Décision 1) — même principe Expand/Contract,
appliqué ici à un cas plus sensible car les tables sources sont
réellement alimentées, contrairement à `risk_assessments` qui était
vide.

Référence détaillée : `GRC_Target_Domain_Model.md` §5.5 ;
`GRC_Database_Gap_Analysis.md` §2.4bis ; `GRC_Migration_Plan.md` Lot H
(`046`-`049`).

## Décision 4 — `RiskCategory` canonique

**Décision** : la table `risk_categories` (déjà en place) est confirmée
référentiel **canonique** unique des catégories/sous-catégories de
risque. Les 3 tables qui la référencent aujourd'hui en texte libre
(`RiskCatalog.category`, `RiskAppetite.subCategory`,
`RiskEvaluation.subCategory`) gagnent chacune une FK nullable, migrée
progressivement (Expand/Contract complet : FK nullable → backfill
applicatif → contrôle → bascule applicative → dépréciation documentaire
du texte libre — jamais de `DROP` immédiat).

**Pourquoi** (résumé — détail complet dans les 3 documents de
référence) : éviter une quatrième source de vérité pour une même
taxonomie déjà modélisée et configurable (cahier des charges §34.1),
sans casser la lecture existante par texte libre tant que la bascule
applicative n'est pas validée.

Référence détaillée : `GRC_Target_Domain_Model.md` §4.5 ;
`GRC_Database_Gap_Analysis.md` §2.3, §2.5 ; `GRC_Migration_Plan.md` Lot E
(`038`, `039`).

## Décision 5 — `risk_processes` écartée (pas de table N:N)

**Décision** : pas de table de liaison N:N `Risk`↔`Process`. La relation
retenue est la FK 1:1 `risks.process_id → processes(id)` (nullable,
migration `029_risks_process_id.sql`, ajoutée par DECISION-006), en
parallèle de `Risk.process` (colonne texte libre historique, conservée
jusqu'au backfill).

**Pourquoi** : arbitrage initial du 2026-09-28, **rouvert et refait le
2026-09-29** (DECISION-007) après correction d'une prémisse fausse — la
première version de ce document et de la Gap Analysis supposaient à tort
qu'une FK 1:1 existait déjà ; en réalité `risks.process` était du texte
libre sans aucune intégrité référentielle avant la migration `029`. La
correction de la prémisse **ne change pas le verdict, elle change sa
motivation** : ce qui manquait n'était pas le N:N, c'était l'intégrité
référentielle tout court, désormais apportée par la FK 1:1. DECISION-007
apporte 8 preuves contre le N:N (aucun besoin métier exprimé — le
cahier des charges §37.A pose la question sans trancher ; données
réelles mono-valuées ; le besoin multi-processus est déjà couvert par
Catalogue → N `Risk` ; la hiérarchie `processes` couvre déjà le
rattachement transverse ; le N:N casserait DECISION-006 (mode
indécidable sans `is_primary`) ; fausserait Cartography/Dashboard ;
incohérent avec l'imputabilité N:1 déjà en place ; asymétrie de coût).
Détail complet : `GRC_Database_Gap_Analysis.md` §2.5bis.

**`risk_processes` est écartée, pas différée** : ce n'est pas une
question de temps ou de priorité, c'est l'absence de besoin métier
confirmé qui motive la décision, aujourd'hui comme le 2026-09-28.
**Critère de réouverture explicite** (à exiger, ne pas rouvrir sans) :
une expression métier explicite du Product Owner ou du Risk Manager
décrivant un cas réel où un même risque de registre doit être piloté
sur plusieurs processus **avec une seule évaluation partagée** (si les
évaluations sont distinctes, la réponse reste Catalogue → N `Risk`) —
même règle que Décision 2/DECISION-003 pour le moteur polymorphe : un
**second cas d'usage réel confirmé**, jamais un cas anticipé.

Référence détaillée : `GRC_Target_Domain_Model.md` §4.2 ;
`GRC_Database_Gap_Analysis.md` §2.1, §2.5, §2.5bis ; `.claude/agent-context/ACTION_ITEMS.md`,
entrée `@architect` DECISION-007 du 2026-09-29.

## Conséquences

**Vocabulaire à respecter par tout agent futur** :
- « Risk Assessment » (métier) = `RiskEvaluation` (technique). Ne jamais
  réintroduire `RiskAssessment` comme second chemin ni parler des deux
  comme interchangeables dans une spec, un ticket ou une revue.
- KPI et KRI restent deux types métier distincts dans tout écran, toute
  API, toute conversation produit — la fusion est **uniquement**
  physique (stockage), jamais fonctionnelle. Un agent qui conçoit un
  écran ou un rapport continue de raisonner « KPI » / « KRI », pas
  « Indicator » générique côté utilisateur.
- `RiskCatalog` (dictionnaire) ≠ `Risk` (registre) ≠ `RiskEvaluation`
  (évaluation) : trois mots différents pour trois objets différents,
  aucun raccourci lexical toléré dans la suite du projet.

**Pattern à généraliser** : le moteur transverse `objectType`/`objectId`
(whitelist `CHECK`) est désormais LE patron de référence pour toute
future capacité transverse (au-delà de Comments/RACI/Evidence) — un
agent qui a besoin de rattacher un nouvel objet à plusieurs types de
ressources GRC doit réutiliser ce patron, pas en inventer un nouveau.
De même, l'injection de dépendance en **paramètre optionnel de
constructeur** est le patron à suivre pour tout service qui a besoin
d'une validation cross-entité additionnelle sans casser les tests
existants construits positionnellement.

**Aucune refonte destructive** : les 5 décisions ci-dessus partagent
toutes la même discipline Expand/Contract — colonne/FK nullable
d'abord, contrainte finale toujours différée, `DROP` jamais inclus dans
un lot fonctionnel. Tout futur agent qui touche ce périmètre doit
supposer cette discipline comme acquise, pas la redécouvrir.

**Point de vigilance déjà identifié** : le pattern d'injection optionnelle
(`if (!this.x) return;`) documenté en Décision 2 peut **silencieusement
réintroduire un trou de validation** si un futur point d'instanciation
du service omet la dépendance — la garde ne lève aucune erreur, elle
désactive simplement la vérification. C'est exactement ce qui s'est
produit avec SEC-012 (`ActionPlanService.create()` ne recevait ni
`UserRepository` ni `DepartmentRepository`, donc `responsibleUserId`/
`departmentId` n'étaient jamais validés) : le correctif a nécessité un
ajustement du test associé (`SecurityBoundaries.test.ts`) car la
construction positionnelle d'origine laissait `this.users` à
`undefined`, ce qui aurait fait passer un test naïf sans jamais exercer
le nouveau code. **Tout nouveau point d'instanciation d'un service
utilisant ce patron doit être vérifié explicitement dans `server.ts`
(et dans les tests qui construisent le service directement) plutôt que
supposé correct par défaut.**

## Alternatives envisagées et écartées

- **Table dédiée par objet pour les commentaires** (`risk_comments`,
  `control_comments`, …) — écartée au profit du moteur générique
  `objectType`/`objectId`, conformément au principe §32.4 du cahier des
  charges et au précédent déjà validé `ActionPlan.sourceType`.
- **Statu quo `Kpi`/`Kri` séparés** — c'était la recommandation par
  défaut de la Gap Analysis (Dev DB) ; écartée par le Product Owner au
  profit de la consolidation physique (Décision 3), qui reste l'option
  la plus structurante du lot.
- **Fusion `RiskAssessment`/`RiskEvaluation` en une seule table** —
  écartée : les deux modèles ne se recouvrent pas champ à champ et une
  fusion aurait cassé le contrat déjà stable de `RiskEvaluation`
  (Décision 1).
- **Suppression physique immédiate de `RiskAssessment`/des 4 tables
  KPI/KRI legacy** — écartée dans ce lot : contraire à la directive
  Expand/Contract obligatoire du Product Owner ; reportée à un sign-off
  explicite ultérieur, hors périmètre.
- **Création de `risk_processes`** — écartée définitivement (Décision 5,
  DECISION-007) faute de besoin métier confirmé, pas différée faute de
  temps ; réouverture conditionnée à un 2e cas d'usage réel confirmé
  (jamais anticipé).
- **Moteur de workflow générique piloté par configuration** — écarté :
  les statuts par entité (transitions codées en dur côté service)
  restent la source de vérité, cohérent avec ADR-001 (« pas
  d'abstraction spéculative ») et la directive ponytail du Product
  Owner ; documenté comme écart connu et assumé dans le Domain Model
  §10.2, pas comblé par une nouvelle entité `WorkflowEngine`.
