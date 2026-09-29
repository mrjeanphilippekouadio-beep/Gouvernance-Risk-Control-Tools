# ADR-003 — Conventions transverses formalisées (permissions terminales, paramètre optionnel, isolation worktree)

Statut : Adopté (2026-09-29)
Contexte complet : `.claude/agent-context/ACTION_ITEMS.md` (entrée
`@architect` du 2026-09-27) ; `.claude/agent-context/SHARED_LOG.md`,
entrée `@architect` du 2026-09-29 (« DECISION-003 », round 2 de
CHALLENGE-002) ; `CLAUDE.md` sections « Security-sensitive conventions »
et « Amorçage d'un agent ACF (onboarding) ».

## Contexte

Trois conventions transverses ont été adoptées **ad hoc** au fil des
modules livrés — chacune en réaction à un incident ou une contrainte
opérationnelle concrète, jamais actée comme décision d'architecture à
part entière. `CLAUDE.md` les documente déjà de façon informelle
(« Security-sensitive conventions », point 3 et point 2 de la section
onboarding), mais un document dispersé en notes d'usage n'a ni statut
ni conséquences explicites, et rien n'empêche un agent futur de les
relire comme de simples recommandations optionnelles plutôt que comme
des règles d'architecture.

Le round 2 de CHALLENGE-002 (DECISION-003, 2026-09-29) a durci
l'urgence de cette formalisation pour la convention n°2 : le pattern
paramètre optionnel reste le mécanisme de composition retenu pour les
~29 modules restants du backlog GRC, mais **réservé aux services
d'écriture** — une restriction nouvelle qui n'existait pas au moment où
la convention a été adoptée initialement et qui doit être actée ici
avant que d'autres agents ne l'appliquent par défaut à un futur
`*ViewService`.

Ce document ferme l'item ouvert `ACTION_ITEMS.md` (2026-09-27,
`@architect`) : il ne change aucun comportement, il fixe par écrit ce
qui est déjà pratiqué, avec sa justification et ses limites connues,
pour que tout agent futur (notamment A06/A07 dispatchés frais) puisse
s'y référer sans redécouvrir l'historique.

## Décision 1 — Permissions terminales séparées

**Règle** : toute méthode de service dont l'effet est de faire
transitionner une entité vers un état **terminal** (archivé, désactivé,
clos, retiré) doit exiger une permission dédiée **en plus** de la
permission générique `x.update`/`x.read`, même quand :
- le nom de la méthode suggère une opération de lecture ou de mise à
  jour routinière (`setThreshold`, pas `archive`) ;
- l'état terminal est un effet de bord et non l'objet principal de
  l'appel (ex. archiver la version précédente en activant la nouvelle).

Concrètement : la permission requise pour un effet terminal est
toujours `x.delete` (jamais seulement `x.update`), quelle que soit la
méthode qui déclenche cet effet. Cette règle s'applique à la fois côté
permission (le gate `requirePermission`) et côté valeur stockée — un
`update()` générique ne doit jamais accepter en entrée une valeur qui
ferait transitionner vers l'état terminal ; ce chemin est réservé à une
méthode dédiée (`archive()`, ou une méthode métier explicitement gatée
comme ici).

**Exemples réels** :
- `RatingScaleService.activateVersion` (`backend/src/services/RatingScaleService.ts:253-254`)
  — activer une nouvelle version d'un référentiel de notation archive
  la précédente comme effet de bord. La méthode exige
  `ratingscale.delete`, pas `ratingscale.update`, précisément parce que
  son effet réel est terminal pour l'ancienne version. Violé une
  première fois en production sous `ratingscale.update` (SEC-013),
  corrigé.
- `RiskAppetiteService.setThreshold` (`backend/src/services/RiskAppetiteService.ts:37-49`)
  — la méthode gère la création/mise à jour normale d'un seuil sous
  `riskappetite.update`, mais quand `input.active === false` (retrait
  du seuil), elle exige en plus `riskappetite.delete`. Violé
  indépendamment en production sous `riskappetite.update` seul
  (SEC-014), corrigé.
- Le cas générique correspondant côté valeur stockée (pas seulement
  permission) : `RiskService.update`/`ControlService.update` rejettent
  explicitement `status: "ARCHIVED"` et renvoient l'appelant vers
  `archive()` — c'est la version « DB-level » de la même règle
  (documentée dans `CLAUDE.md`, « Adding a new domain module »).

**Conséquence pour tout nouveau service** : dès qu'une méthode peut,
même comme effet secondaire, faire sortir une entité de son cycle de
vie actif normal, l'auteur doit se poser explicitement la question
« quel est l'effet réel, pas le nom de la méthode ? » et gater sur
`x.delete` si la réponse est « terminal ». `/code-review` a détecté les
deux violations connues (SEC-013/SEC-014) — ce n'est pas un filet de
sécurité à défaut de vigilance amont, la revue humaine/agent reste la
première ligne.

## Décision 2 — Pattern paramètre optionnel constructeur

**Règle précise** : quand un service déjà consommé par des tests
existants gagne une nouvelle dépendance (repository de validation
cross-entité, notifier, etc.), cette dépendance est ajoutée comme
**dernier paramètre optionnel du constructeur**, jamais comme paramètre
requis :

```ts
constructor(
  private readonly primary: PrimaryRepository,
  private readonly audit: AuditRepository,
  /** Optional so existing callers/tests built before this existed don't need to change. */
  private readonly newDep?: NewRepository,
) {}
```

Chaque usage interne est gardé (`this.newDep?.method()` ou
`if (!this.newDep) return;`), jamais appelé sans garde. La règle
existe pour ne **jamais casser un test existant construit
positionnellement** — le backend n'utilise pas d'injection de
dépendances par nom, donc tout paramètre requis ajouté au milieu ou à
la fin d'un constructeur déjà utilisé casse la compilation de chaque
site d'instanciation existant, tests inclus.

**Exemples réels** :
- `FeedbackService` (`backend/src/services/FeedbackService.ts:18-23`)
  — `notifier?: Notifier` ajouté en dernier paramètre optionnel,
  commentaire explicite « Optional so existing callers/tests built
  before this existed don't need to change ».
- `RiskService` (`backend/src/services/RiskService.ts:20-32`) — 
  `departments?: DepartmentRepository` (SEC-004) puis
  `users?: UserRepository` (ACT-120/122) ajoutés successivement en fin
  de constructeur, chacun avec sa propre garde et son propre
  commentaire de justification.
- `ActionPlanService` (`backend/src/services/ActionPlanService.ts:69-84`)
  — 5 dépendances optionnelles accumulées
  (`risks?`, `controls?`, `kris?`, `anomalies?`, `evidences?`), plus un
  notifier « best-effort only » — l'exemple le plus chargé aujourd'hui
  du pattern en production.

**Limite déjà identifiée, matérialisée deux fois** : la garde
`this.x?.y()` ne lève aucune erreur quand la dépendance est omise —
elle désactive silencieusement la validation qu'elle est censée
apporter. Ce trou s'est matérialisé deux fois indépendamment en
production :
- **SEC-001** (`ControlExecutionService`) puis **SEC-009**
  (`KpiMeasureService`, `KriMeasureService`) — un champ d'attribution
  client-fourni (`recordedBy`/`evaluatorId`/…) non forcé côté serveur,
  réintroduit indépendamment dans deux modules ultérieurs précisément
  parce que la règle ne vivait que dans le commentaire d'un test, pas
  dans un document de référence (voir `CLAUDE.md`, « Never trust a
  client-supplied attribution field »).
- **SEC-012** (`ActionPlanService.create()`) — le service était
  instancié sans `UserRepository` ni `DepartmentRepository` à un point
  d'appel, donc `responsibleUserId`/`departmentId` n'étaient jamais
  validés ; la garde n'a rien signalé. Le correctif a nécessité un
  ajustement du test associé (`SecurityBoundaries.test.ts`), la
  construction positionnelle d'origine laissant `this.users` à
  `undefined` sans jamais exercer le nouveau code (documenté en détail
  dans ADR-002, section « Point de vigilance déjà identifié »).

**Conséquence directe de cette limite** : tout nouveau point
d'instanciation d'un service utilisant ce pattern doit être vérifié
explicitement — dans `server.ts` et dans tout test qui construit le
service directement — plutôt que supposé correct par défaut. Ce n'est
pas une vérification optionnelle de bonne pratique, c'est la
contrepartie obligatoire du choix d'ADR-003 : le pattern déplace le
risque de « constructeur cassé à la compilation » (visible
immédiatement) vers « dépendance manquante silencieuse » (visible
seulement par revue ou par un trou de validation en production), et
cette contrepartie doit être payée à chaque site d'instanciation, pas
une fois pour toutes.

**Restriction DECISION-003 (2026-09-29)** : le pattern reste le
mécanisme de composition retenu pour les ~29 modules restants, mais
**réservé aux services d'écriture** — ceux qui portent des règles
métier, des transitions d'état et de l'audit d'écriture
(`services/*Service.ts` au sens strict de `CLAUDE.md`). Il n'est
**pas** applicable aux futurs services de lecture agrégée
(`*ViewService`/`*DashboardService`, ex. `RiskDeviceViewService`
projeté pour « Dispositif de risque », Risk 360, Dashboards) : ces
services composeront les mêmes repositories que les services
d'écriture mais ne portent aucune transition d'état ni audit
d'écriture, et sont attendus avec 10 à 15 dépendances — un volume où
le pattern paramètre optionnel constructeur cesserait d'être lisible
et multiplierait le risque de trou de validation silencieux déjà
documenté ci-dessus. Le précédent existe déjà à petite échelle
(`ActionPlanService.dashboard()`), et sert de gabarit à généraliser
sous convention de nommage `*ViewService`/`*DashboardService`, pas sous
une nouvelle couche d'architecture.

## Décision 3 — Isolation worktree par défaut

**Règle** : dès que plus d'un agent A06 (Dev Backend) travaille en
parallèle sur ce dépôt, chaque agent est dispatché avec
`isolation: "worktree"` — jamais deux agents éditant les mêmes fichiers
partagés à haut risque de conflit (`backend/src/server.ts`,
`backend/src/domain/permissions.ts`) dans le même répertoire de travail
en même temps. C'est le mode par défaut depuis le batch 2 du backlog
GRC.

**Quand l'utiliser** : chaque fois qu'un dispatch parallèle de
plusieurs modules du backlog (`grc-actions.yaml`) est décidé par
l'orchestrateur — la quasi-totalité des nouveaux modules de domaine
touchent `server.ts` (wiring) et `permissions.ts` (nouvelles chaînes de
permission), ce qui rend le conflit non hypothétique mais systématique
dès deux agents simultanés.

**Mécanisme de fusion déjà pratiqué** : l'orchestrateur fusionne les
worktrees un par un après coup, pas en une seule opération groupée. Le
conflit attendu sur `permissions.ts` est trivial par construction —
deux blocs de nouvelles lignes en fin d'union de types et de tableau,
jamais une modification qui se chevauche ligne à ligne — parce que
chaque agent n'ajoute que ses propres nouvelles permissions en
append, sans jamais réordonner ou reformater les entrées existantes.

Référence : `CLAUDE.md`, section « Amorçage d'un agent ACF
(onboarding) », point 2.

## Conséquences

- Ces trois conventions sont désormais des **décisions d'architecture
  actées**, pas des recommandations informelles : tout agent qui les
  contourne (permission générique sur un effet terminal, paramètre
  requis cassant des tests positionnels, deux agents A06 hors
  isolation worktree sur ce dépôt) introduit une régression au sens de
  cet ADR, pas seulement un écart de style.
- `CLAUDE.md` continue de porter la version opérationnelle courte de
  ces règles (ce que lit un agent frais avant de dispatcher/exécuter) ;
  ce document en est la version justifiée et référencée, à consulter
  quand la question « pourquoi cette règle ? » ou « quelles sont ses
  limites connues ? » se pose.
- La restriction DECISION-003 (paramètre optionnel réservé aux services
  d'écriture) doit être relue avant la création de tout premier
  `*ViewService`/`*DashboardService` — ce document en est la référence
  normative, `ACTION_ITEMS.md` peut être fermé sur ce point une fois ce
  fichier publié.
- Point de vigilance non résolu par cet ADR (hors périmètre, signalé
  pour mémoire) : la vérification systématique des sites
  d'instanciation d'un service à dépendances optionnelles
  (Décision 2) reste manuelle aujourd'hui — aucun lint ni test
  automatisé ne la garantit. Un futur ADR pourrait évaluer un
  mécanisme de vérification statique si de nouvelles occurrences du
  trou SEC-001/SEC-009/SEC-012 apparaissent.

## Alternatives envisagées et écartées

- **Permission terminale implicite via la valeur stockée uniquement**
  (pas de permission dédiée, seulement un rejet de `status: "ARCHIVED"`
  dans `update()`) — écartée : c'est la version déjà en place avant
  SEC-013/SEC-014 et elle n'a pas empêché le contournement par une
  méthode dédiée gatée sur la mauvaise permission. La permission dédiée
  est nécessaire en plus, pas à la place.
- **Injection de dépendances par nom/conteneur DI** au lieu du pattern
  paramètre optionnel positionnel — écartée pour rester alignée avec
  ADR-001 (pas d'abstraction spéculative, pas de dépendance non
  nécessaire) ; le coût du pattern actuel (trou de validation
  silencieux) est documenté et géré par vérification explicite plutôt
  que par une nouvelle couche d'infrastructure.
- **Fusion groupée de tous les worktrees en une seule opération** —
  écartée : la fusion un par un rend chaque conflit trivial et
  attribuable à un agent précis ; une fusion groupée masquerait
  l'origine d'un conflit non trivial si `server.ts` divergeait plus
  que prévu.
