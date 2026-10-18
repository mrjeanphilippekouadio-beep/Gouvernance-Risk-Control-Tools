# Items en attente d'action — GRC Tools

Table vivante. Ne pas supprimer une ligne résolue — passer son statut à
`Résolu` avec la date et le lien commit/PR. Voir README.md de ce dossier
pour l'usage.

| Agent | Item | Depuis | Statut |
|---|---|---|---|
| @product-manager @ux-designer @architect | **Brief PO — Restructuration UX/UI plateforme (29 modules + sidebar + panneau latéral Comments/RACI/Evidence), reçu du PO le 2026-09-28.** Document intégral : `docs/UX_Brief_Restructuration_Plateforme_v1.md`. Analyse d'impact §15 produite : `docs/UX_Impact_Analysis_v1.md` (bloquants transverses identifiés : sidebar de navigation, panneau latéral générique, composants `Card`/`Modal`/`Filtres`, dashboards par rôle, IAM). Trois chantiers backend non couverts par ce brief UX seul, à faire trancher avant code : (1) fiche de contrôle structurée (~22 champs, `Control` actuel n'en a pas assez), (2) module Audit **inexistant côté backend**, modélisation elle-même en contradiction non résolue du CDC v0.1, (3) migration d'enums codés en dur vers des référentiels configurables (§13 du brief). **Réponse au §14 (blocage Figma) : voir entrée `@orchestrator` `SHARED_LOG.md` du 2026-09-28** — contrainte technique confirmée, pas un manque de composants. | 2026-09-28 | **Résolu (arbitrage PO) — voir DECISION-002 ci-dessous et entrée `@tous` `SHARED_LOG.md` du 2026-09-28 (consultation 9 agents).** |
| @tous | **DECISION-002 — 5 décisions PO sur la restructuration, consultation de 9 agents (@ux-designer, @architect, @product-manager, @risk-manager, @compliance, @privacy, @security, @qa-engineer, @dev-backend).** (1) Figma option B — HTML/CSS commentable = référentiel vivant. (2) Composantes atomiques d'abord, écrans = emboîtement. (3) Panneau latéral générique Comments/RACI/Evidence construit en premier, dans l'artefact. (4) Risk 360 = registre enrichi, pas un objet séparé (allège l'hypothèse de modélisation). (5) Un seul dashboard consolidé — contenu arbitré par UX + Risk Manager + Compliance + Privacy ensemble, jamais décidé par le design seul. Rythme : un écran statué avant le suivant. Détail complet + retours des 9 agents : `SHARED_LOG.md`, entrée `@tous` du 2026-09-28. Points de vigilance signalés à surveiller au fil des écrans (pas des blocages) : inventaire écrit des atomes (@ux-designer), ADR sur le modèle de composition du dashboard avant le premier widget codé (@architect), définition explicite de "statué" par écran — PO seul ou PO+Risk/Compliance/Privacy selon le contenu (@product-manager), pas de score dérivé affiché comme définitif sur Risk 360 avant revue méthodologie (@risk-manager, rejoint le point déjà ouvert du 2026-09-27), ne pas sauter la revue Compliance sur Audit sous prétexte qu'il arrive tard dans la séquence (@compliance), définir la visibilité par widget avant de mocker richement le dashboard (@privacy, risque concret de reproduire le type de fuite déjà notée sur `RiskOwnershipService`), documenter les états de chaque atome dès sa 1ère version (@qa-engineer), ne pas coder un module tant que son backend n'existe pas même si son écran est statué (@dev-backend). | 2026-09-28 | **Résolu — décision appliquée, construction des atomes démarrée dans l'artefact `9kExAKw22AmH71rh59bdq4`.** |
| @architect | **Consultation réelle du 2026-09-28 (4 agents dispatchés indépendamment : Risk Manager, Privacy, Compliance, Architect — pas un résumé orchestrateur) sur DECISION-002.** Risk 360 : pas de nouvel agrégat de domaine, mais **vrai risque N+1** confirmé par lecture des repos réels (Control/RiskEvaluation/Kri/KriMeasure/ActionPlan — ActionPlan n'a même pas de `listForRisk`, passe par `sourceId` + `ActionLink` séparément) — recommande une méthode d'orchestration dédiée (`RiskService.getRisk360`/`Risk360Service` fin, `Promise.all` sur les branches indépendantes) à spécifier explicitement au Dev Backend, pas laissé à l'implicite. Pattern paramètre optionnel constructeur : suffisant pour Risk 360, insuffisant seul pour le Dashboard (6-8 dépendances) — risque de friction sur `server.ts` si plusieurs widgets développés en parallèle sans figer d'abord "qui appelle quoi". **ADR dashboard maintenu mais resserré** : court (1-2 pages), requis avant le premier widget **backend** (pas avant la maquette HTML/CSS), et seulement après l'arbitrage UX/Risk/Compliance/Privacy du contenu. 3 questions structurantes : (1) `DashboardService` fin délégant aux services de domaine existants, jamais de SQL direct pour le dashboard ; (2) permission vérifiée au niveau widget via `requirePermission` existant, jamais un filtre après coup sur une réponse déjà assemblée (répond directement à PRIV-CH-DASH-001) ; (3) calcul à la lecture, pas de vue matérialisée (le backend n'a aucun scheduler/cron). Point de vigilance signalé : la consolidation KRI/KPI→`Indicator` est déjà actée (ADR-002 Décision 3) mais pas implémentée — ne pas coder l'agrégation Risk 360/Dashboard d'une façon qui suppose les tables `kris`/`kpis` permanentes (passer par les repositories, jamais de SQL brut). Ordre Cartographie/Évaluation : Cartographie dépend techniquement d'Évaluation (heatmap agrège des scores produits par RiskEvaluation) — Évaluation doit être prête à coder avant que Cartographie passe "statué → prêt à coder" (la maquetter en HTML/CSS avant, en revanche, ne pose pas de problème). Risk 360 dépend de modules qui n'existent même pas en tant qu'entités de domaine (Incident, Audit) — le maquetter tôt est cohérent avec composant-first, mais ne doit jamais glisser vers "prêt à coder" avant que la modélisation Audit soit tranchée, sous peine de reproduire l'anti-pattern déjà corrigé par `CLAUDE.md` §7bis (décision en attente jamais trackée). Détail complet des 4 avis : `SHARED_LOG.md`. | 2026-09-28 | **Résolu — avis intégrés, aucun blocage sur le travail de maquette en cours ; conditions posées avant le passage au code de Risk 360/Dashboard.** |
| @architect | **CHALLENGE-002 — 2026-09-29, dispatch réel avec instruction explicite de challenger, pas de valider.** Le PO a proposé d'étendre la logique "composant UI atomique réutilisable" au backend : des objets de domaine "emboîtables" par référence (son exemple : un "Dispositif de risque" composé de RatingScale + mécanisme d'impact + Risques + Contrôles). **Verdict : accepté avec conditions, pas rejeté ni validé tel quel.** L'analogie est juste pour les référentiels stables (RatingScale, RiskCategory — déjà la doctrine actée dans ADR-002) mais trompeuse pour les objets à invariants métier/cycle de vie (Risk, Control, ActionPlan) : un Bouton n'a pas de transitions d'état à préserver, un Risque si. Le code montre que le principe est déjà appliqué **sélectivement**, pas dogmatiquement — avec des entorses documentées et délibérées (`RiskEvaluation.subCategory`/`entity` capturés en instantané, pas référencés, pour préserver l'immuabilité d'une évaluation validée ; consolidation KRI/KPI→`Indicator` = fusion physique mais 2 concepts métier distincts maintenus, l'inverse d'une composition pure). **Recommandation retenue** : (1) le mécanisme de composition à généraliser n'est PAS "toute entité référence toute autre", c'est le pattern déjà validé et testé — paramètre optionnel de constructeur au niveau service (9 modules dessus) + moteur polymorphe `objectType`/`objectId` réservé aux capacités ayant un **2e cas d'usage réel confirmé** (pas anticipé) ; (2) pour un écran type "Dispositif de risque", construire un **service de lecture composée** (assemble les repositories existants, comme `ActionPlanService` le fait déjà) plutôt qu'une nouvelle entité persistée "Dispositif" — sauf besoin confirmé de persister l'assemblage lui-même ; (3) la duplication/instantané reste légitime quand l'audit l'exige, ne pas la supprimer au nom du principe ; (4) aucune whitelist polymorphe étendue par anticipation sur un module sans backend (Audit). Risque concret si imposé rigidement cité avec preuve : la Décision 3 d'ADR-002 (Indicator) est elle-même la preuve vivante que "composer par référence" n'est pas toujours la bonne architecture — le PO a déjà tranché l'inverse une fois. Détail complet (5 sections, preuves code par preuves code) : `SHARED_LOG.md`. | 2026-09-29 | **Résolu — Architecture a tranché (round 2, voir DECISION-003 ci-dessous), plus une réserve.** |
| @architect | **DECISION-003 — Recommandation d'architecture cible assumée pour les 29 modules restants, 2026-09-29 (même agent, round 2, contexte déjà chargé).** Deux frictions réelles identifiées avec preuve dans le code, pas hypothétiques : (1) **5 whitelists polymorphes divergentes** décrivent chacune "quels objets GRC existent" (`ActionPlanSourceType`, `ActionLinkResourceType`, RACI `objectType`, Comments `objectType`, Evidence-links `objectType`, Finding `relatedObjectType`) — déjà incohérentes entre elles sur 2 whitelists/9 modules livrés (`ANOMALY` absent de l'une, `AUDIT`/`INCIDENT`/`MANAGEMENT` absents de l'autre), vont diverger linéairement avec 29 modules de plus si rien ne change. **Correctif proposé, peu coûteux maintenant, cher dans 12 mois** : un `GrcObjectType` canonique unique (un seul fichier `domain/GrcObjectType.ts`), adopté **avant** l'exposition de RACI/Comments/Evidence-links/Finding (encore temps, "conçus maintenant, exposés plus tard"). (2) **Les vues agrégées transverses (Risk 360, Dashboards) vont pousser le pattern "paramètre optionnel constructeur" jusqu'à son point de rupture** — un service qui doit lire 10-15 repositories pour une seule fiche produirait un constructeur illisible et multiplie le risque de trou de validation silencieux déjà matérialisé deux fois en prod (SEC-001, SEC-009). **Correctif proposé, pas une nouvelle couche architecturale** : séparer par convention de nommage les services d'écriture (règles métier, permissions — rôle actuel de `RiskService`/`ControlService`) des services de lecture agrégée (`*ViewService`/`*DashboardService`), qui composent les mêmes repositories mais ne portent ni transition d'état ni audit d'écriture — sur le modèle déjà démontré à petite échelle par `ActionPlanService.dashboard()`. **"Dispositif de risque" — tranché sans réserve cette fois** : service de lecture composée, point final, pas d'entité persistée. Raison assumée : persister l'assemblage recréerait exactement la friction n°1 (synchronisation à maintenir à chaque changement d'un Risk/Control/Indicator source) — l'inverse de "code stable dans la durée". Le patron proposé (`RiskDeviceViewService`, injection des repositories existants, zéro nouvelle table/migration/permission) sert directement de gabarit pour Risk 360 et Dashboards quand leur tour viendra — généraliser l'entité persistée au lieu de ça coûterait, sur 29 modules, l'écart entre "ajouter une vue = un service + une méthode" et "ajouter une vue = migration + entité + repository + service + route" à chaque fois. Seule réserve non provisionnée : si le besoin devient un jour "figer un dispositif à un instant T pour l'opposer plus tard" (même logique que `RiskEvaluation.subCategory` en instantané), ce serait un nouvel objet métier à part entière avec sa propre justification d'audit — pas exprimé aujourd'hui, donc pas anticipé. Détail complet : `SHARED_LOG.md`. | 2026-09-29 | **Résolu — décision d'architecture assumée. Reste à planifier (non bloquant pour le travail en cours) : créer `GrcObjectType` avant le Lot RACI/Comments/Evidence, et nommer/adopter la convention `*ViewService` avant le premier écran d'agrégation (Risk 360, Dashboards, ou "Dispositif de risque").** |
| @qa-engineer | Revue QA indépendante des 9 modules livrés (batches 1-3). | 2026-09-27 | Résolu — 10 findings (branche `qa/batches-1-3-review`, commit `f045e3a`), 6 corrigés directement (nouveaux tests), le reste (RiskService.escalate sans maker-checker, etc.) reste à trier — voir `backend/QA_REVIEW_BATCHES_1_3.md`. |
| @security | Repasser une revue sécurité sur les 9 modules livrés. | 2026-09-27 | Résolu (revue faite) — 6 findings, tous corrigés puis **retestés indépendamment**, voir ligne @security du 2026-09-28 ci-dessous pour le verdict détaillé par finding. |
| @dev-backend | SEC-013 (Low) corrigé : `RatingScaleService.activateVersion` exige désormais `ratingscale.delete` (au lieu de `ratingscale.update`) avant d'appeler `activateAndArchivePrevious`, qui archive irréversiblement l'ancienne version ACTIVE — même règle que `disable()` (permission dédiée pour toute transition vers un état terminal/archivé). Fix d'une ligne. Test `SEC-013` de `SecurityBoundaries.test.ts` passé de `it.fails` à `it`. Aucun ajustement nécessaire dans `RatingScaleService.test.ts` (l'acteur de test avait déjà `ratingscale.delete`). Grep frontend (`frontend/src`) sur `ratingscale.update`/`activateVersion` : aucune correspondance, pas de logique de gating à corriger côté UI pour le moment. `npm run typecheck` + `npm test` verts (366 tests, 34 fichiers). Commit `88a5ede`. | 2026-09-28 | Résolu — **retest @security du 2026-09-28 : CONFIRMED_FIXED** (voir ligne @security ci-dessous pour le détail). |
| @dev-backend | Batch 4 : Dashboard+Reporting ✅ (278 tests), Notification+Governance ✅ (308 tests), Config en cours. | 2026-09-27 | Presque résolu — reste à fusionner + câbler `server.ts` une fois Config terminé. |
| @privacy | Nouveau finding sécurité (informationnel) : `RiskOwnershipService.listOwners` expose le nom/email d'un utilisateur **suspendu** à tout détenteur de `risk.read` (via `PostgresUserRepository.getById` qui ne filtre pas `deleted_at`, correct pour son usage principal mais pas ici). **Reconfirmé indépendamment le 2026-09-28 (consultation dashboard consolidé, agent dispatché réellement, pas résumé orchestrateur)** : `PostgresUserRepository.getById` (L37-43) reste la seule méthode du repository sans filtre `deleted_at` (contrairement à `getByEmail`/`list`/`count`) — anomalie structurelle au niveau du repository, pas seulement de `RiskOwnershipService` : tout futur widget qui résout un utilisateur via `getById` hérite silencieusement de la même fuite. **PRIV-CH-DASH-001 émis** : avant tout code de production sur le dashboard consolidé (DECISION-002 point 5), une matrice widget × donnée × permission requise doit être produite et revue conjointement UX/Risk/Compliance/Privacy, ET `getById`/son usage dans `RiskOwnershipService` doit être corrigé (filtrer `deleted_at`, comme les autres méthodes). Non bloquant pour la phase maquette actuelle (pas de données réelles), bloquant pour le passage au code. | 2026-09-27 | **Ouvert — correctif `@dev-backend` toujours dû + PRIV-CH-DASH-001 à lever avant code du dashboard.** |
| @risk-manager | **Méthodologie de scoring challengée le 2026-09-28 (agent dispatché réellement, lecture directe de `RatingScaleService.ts`/`RiskEvaluationService.ts`/`RiskEvaluation.ts`).** Correction d'une hypothèse erronée de l'orchestrateur : le score résiduel **n'est pas une dérivation mécanique** de l'inhérent — c'est une recotation humaine indépendante avec justification obligatoire (bonne conception, conforme au mandat Risk Manager). **CHALLENGE-001** (non bloquant) : la maîtrise globale est agrégée par simple moyenne (`aggregation: "AVERAGE"`, ACT-175, fixée en dur), jamais validée par un référentiel métier écrit — peut masquer une ligne de défense structurellement défaillante ; à trancher (référentiel écrit ou confirmation PO que la moyenne est assumée) avant que Risk 360 n'affiche la maîtrise comme un chiffre unique sans détail par ligne. **RISK_BLOCK réel identifié** (bloquant, mais seulement pour Risk 360, pas pour le Lot 1 RACI en cours) : `RiskEvaluation.status` (BROUILLON/VALIDATED/REJECTED/VALIDE_COMITE) n'est filtré nulle part côté backend — Risk 360 ne doit jamais afficher un `residualScore` sans exposer le statut de l'évaluation source, sinon un score encore en brouillon ou rejeté pourrait apparaître avec la même autorité qu'un score validé (viderait de son sens le maker-checker SEC-011). Owner : `@ux-designer` (maquette) + `@dev-backend` (endpoint agrégé). | 2026-09-27 | **Challengé — CHALLENGE-001 ouvert (référentiel à produire), RISK_BLOCK à satisfaire avant le développement de l'écran Risk 360. Pas encore Résolu.** |
| @architect | Formaliser/valider a posteriori les 3 conventions transverses adoptées ad hoc (permissions terminales séparées, pattern paramètre optionnel, isolation worktree par défaut). | 2026-09-27 | **Résolu — `docs/architecture/ADR-003-conventions-transverses.md` rédigé le 2026-09-29** (permissions terminales : SEC-013/SEC-014 comme exemples ; paramètre optionnel : limites documentées SEC-001/009/012, restreint aux services d'écriture par DECISION-003 ; isolation worktree : quand/comment fusionner). |
| @dev-db | Cross-review des 9 migrations déjà écrites par A06 sans spawn (016 à 022), pour constituer le track record avant de figer la règle "pas de spawn pour les cas simples". | 2026-09-27 | **Résolu (2026-09-29)** — les 7 migrations sont conformes (`tenant_id` partout, aucun `DELETE` physique hors exception documentée, index cohérents avec les patterns de requête réels). Règle "pas de spawn pour cas simples" validée comme sûre à figer, avec réserve explicite pour les cas destructifs (`ALTER` destructif, `DROP`, changement de type) ou touchant une politique de rétention légale — pas rencontrés dans 016-022. |
| @audit | Vérifier la conformité append-only/soft-delete/tenant_id sur les 9 modules livrés, en complément de la revue sécurité. | 2026-09-27 | **Résolu (2026-09-29)** — conforme sur les 9 modules (Risk, Evidence, Control, ControlExecution, ControlEffectivenessAssessment, Anomaly, Department, Process, RACI). Chaque module respecte son propre pattern d'écriture déclaré, aucun `DELETE FROM` physique hors exception documentée, `tenant_id` systématiquement scopé sur `actor.tenantId`. |
| @compliance | Cadrer réellement l'exigence de purge RGPD de l'audit trail (ACT-072), actuellement "Post-MVP" sans étude. **Lien établi le 2026-09-28 (agent dispatché réellement) avec le module Audit UX** : ne pas mocker un bouton "purger" ou une politique de rétention explicite sur le premier écran Audit tant qu'ACT-072 n'a pas au moins statué sur l'hypothèse par défaut (conservation stricte 10 ans BCEAO, purge différée hors périmètre RGPD applicable, ou anonymisation) — pas besoin de résoudre tout ACT-072 avant, juste ce cadrage minimal, au moment où Audit arrivera dans la séquence des 29 écrans. Proposition livrée (2026-09-29) — `docs/architecture/ACT-072-cadrage-propose.md` : 3 options rédigées, recommandation assumée = Option C (restriction de visibilité par masquage, pas de purge automatisée — évite de construire un mécanisme de suppression sur une base légale RGPD non vérifiée pour ce SFD ivoirien). Confirmation PO (2026-09-29) : go donné pour adopter l'Option C comme hypothèse de travail par défaut. **Confirmation finale PO (2026-09-30)** : "mon go suffit" — le PO assume explicitement sa décision comme l'arbitrage définitif, pas seulement une hypothèse de travail en attendant un avis juridique séparé. Statut ACT-072 passé de `EVIDENCE_REQUIRED` à `RESOLVED` (Option C, décision PO assumée) — reste néanmoins : aucun bouton de suppression physique à maquetter/coder (l'Option C elle-même l'exclut, ce n'est pas une réserve en attente). Voir addendum dans `docs/architecture/ACT-072-cadrage-propose.md`. | 2026-09-27 | **CLOSED — Option C actée comme décision finale du PO, pas une hypothèse provisoire.** |
| @compliance | **Consultation dashboard/rythme UX du 2026-09-28 (agent dispatché réellement).** Gap process trouvé : `CLAUDE.md` point 8 ("QA/Security après chaque batch") ne nomme pas Compliance — recommande d'ajouter Compliance à ce point, avec une règle explicite de gating liée à la GRC Trigger Matrix (`product-manager.md` §64), plutôt que de compter sur une déduction implicite. Rejoint le point déjà ouvert `@product-manager` sur la définition de "statué". **Module Audit** : déclenche 2 lignes fermes/probables de la matrice §64 ("Nouveau traitement de données" = Oui sans condition ; "Nouvelle API" = Selon impact, jugé réel ici — conservation ≥10 ans BCEAO, piste d'audit nominative, périmètre LBC/FT potentiel déjà signalé silencieux dans le CDC v0.1). **Pas de blocage positionnel** sur l'ordre des 29 modules — Audit peut rester en dernier — mais deux conditions avant que son premier écran passe de "en maquettage" à "statué" : (1) trancher la contradiction de modélisation du CDC v0.1 (Finding→ActionPlan vs Constats→Recommandations) avant le début du maquettage spécifiquement de ce module (le choix Figma option B — maquette = référentiel vivant — signifie que la maquette fige le modèle que le code héritera ensuite), (2) une première revue Compliance légère dès le premier écran maquetté, avant qu'il soit déclaré statué. | 2026-09-28 | **Condition 1 résolue (2026-09-29)** — la contradiction Finding→ActionPlan est déjà tranchée dans `GRC_Target_Domain_Model.md` §9.2 (confirmé par `@audit` lors du balayage). **Condition 2 EN RETARD** : Aucune revue Compliance n'a eu lieu avant le merge des PR #71 (`baaeae1`, 2026-09-30) et #72 (`0fde9ec`, 2026-09-30) sur `main`. Les deux écrans Audit (Exécutions & Efficacité + Constats & Recommandations) sont mergés sans trace d'entrée `@compliance` dans `SHARED_LOG.md` après le 2026-09-28. Condition 2 stipulait "revue Compliance légère dès le premier écran maquetté, avant qu'il soit déclaré statué" — ce n'est désormais plus un blocage à lever avant le code, mais une revue à rattraper rétroactivement sur les deux PR déjà en production. |
| @privacy | Première revue : UserManagement et RiskOwnership manipulent désormais de vraies données utilisateur (email, nom, qui possède quel risque). | 2026-09-27 | **Résolu par absorption (confirmé par l'agent lui-même, balayage du 2026-09-29)** — remplacé par PRIV-CH-DASH-001, plus précis et actionnable. |
| @ux-designer | Maquette V3 publiée au même lien après retour explicite du Product Owner : « inspire-toi du site public réel du client » (djamo.com/en-ci). Bleu de marque réel `#2A3FFF` remplace l'argile placeholder `#B5533A` de la V2 comme unique accent de marque/action ; surfaces de carte/panneau teintées lavande pâle au lieu de blanc/crème plat (écho dilué aux blocs périwinkle du site) ; boutons pilule à padding généreux ; titres en Plus Jakarta Sans (équivalent Google Fonts de GT Walsheim Pro, police de marque payante non chargeable) à la place de Source Serif 4, IBM Plex Sans/Mono inchangés. Palette sémantique de statut (danger/warning/success/neutral) **inchangée** — ne doit jamais se confondre avec l'accent de marque. Délibérément écarté : photo lifestyle, accent vert « épargne »/touches jaune-orangé décoratives, sections à fond noir quasi-pur, traits serpentins décoratifs — détail et justification complets dans l'entrée `@ux-designer` du 2026-09-28 (V3) de `SHARED_LOG.md` et dans le changelog de l'artefact lui-même. Artefact : **https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57** (Version 3, puis **V4** — voir addendum ci-dessous). Structure/navigation/sélecteur d'échelle de la V2 **inchangés**. **Figma reste bloqué, statut inchangé** : outils MCP `mcp__figma__get_figma_data`/`download_figma_images` disponibles en lecture seule, mais **aucun fileKey/URL fourni ni trouvé** — reste sur le Product Owner de transmettre un lien de fichier existant ; aucun fileKey n'a été inventé pour contourner ce blocage. Portage de la palette/typo V3 dans `frontend/src/design-system/tokens.css` **non fait** — hors du périmètre de ce retour, à valider explicitement avant tout patch de `frontend/`. **Addendum V4 (2026-09-28)** — retour PO sur V3 : « je m'attendais à être bluffé, je ne l'ai pas été ». 4 corrections précises livrées au même lien (Version 4) : libellés de champ passés de Plex Mono à Plex Sans (mono réservée aux valeurs numériques) ; nav latérale en noir plein gras + pictogramme SVG par entrée ; heatmap Cartography à bandes de criticité nettement plus contrastées et points de risque en couleur unique (accent de marque, résiduel distingué par un anneau, pas une teinte) ; animations GSAP réellement présentes sur scores/barre d'appétence/points de heatmap/sélecteur d'échelle/tableau — demande faite en V2/V3 et enfin honorée. Détail complet dans l'entrée `@ux-designer` du 2026-09-28 (V4) de `SHARED_LOG.md`. | 2026-09-27 | **Résolu (portage) le 2026-09-28** — charte itérée jusqu'à V6 dans l'artefact (au-delà de V4 : V5 polish élévation/typo, V6 purge Plex Mono + preview heatmap/dérivation score/tendance, voir `SHARED_LOG.md`) ; **DECISION-001 ci-dessous** : le PO a donné le go explicite, port effectué dans `frontend/src/design-system/tokens.css` (valeurs de tokens uniquement, aucun composant `.tsx` modifié — palette `#2A3FFF`, Plus Jakarta Sans/IBM Plex Sans/Mono, radius 8px). **Figma abandonné définitivement (décision PO, 2026-09-30)** : "laisse tomber Figma on reste sur l'artefact" — l'Option B (HTML/CSS commentable = référentiel vivant) est actée comme choix final, pas provisoire en attendant un lien. Nouvelle exigence associée : chaque nouvel écran doit être ajouté clairement dans l'artefact `grc-review.html`, pas seulement maquetté ailleurs. |
| @product-manager | Valider a posteriori la priorisation des 3 batches déjà livrés, ou ajuster la suite du backlog (Dashboard, Config, Reporting, Notification, JournalGlobal, Governance restent à 0 %). | 2026-09-27 | **Résolu par absorption (confirmé par l'agent lui-même, balayage du 2026-09-29)** — remplacé par la ligne 37 (CDC v0.1), elle-même désormais réduite à un seul point non-actionnable (voir ligne 37). |
| @documentation | Reprendre la main sur `RETEX_MULTI_AGENTS.md` à partir de maintenant — l'orchestrateur ne l'édite plus directement. | 2026-09-27 | **Résolu — section "Mise à jour 2026-09-29" ajoutée (Lot A, DECISION-005).** |
| @dev-backend | SEC-009 (High) corrigé : `KpiMeasureService.record`/`KriMeasureService.record` forcent désormais `recordedBy: actor.userId` (signature `Omit<..., "tenantId" \| "recordedBy">`), champ retiré des schémas Zod des routes KPI/KRI measures. Les 2 tests SEC-009 de `SecurityBoundaries.test.ts` sont passés de `it.fails` à `it` (regression lock actif). `npm run typecheck` + `npm test` verts (366 tests). Commit `11b236a`. | 2026-09-28 | Résolu — **retest @security du 2026-09-28 : CONFIRMED_FIXED** (voir ligne @security ci-dessous pour le détail). |
| @dev-backend | SEC-010 (High) corrigé : `UserService.create()` vérifie désormais `requirePermission(actor, "role.assign")` explicitement avant l'insert de la ligne `users` (en plus de la vérification déjà existante, inchangée, dans `RoleService.assignToUser` — qui reste seule source de vérité sur cette permission). Avant le correctif, un acteur avec `user.create` mais sans `role.assign` recevait un 403 après que la ligne `users` ait déjà été insérée (aucune transaction cross-repository disponible dans ce repo pour un rollback, même limite que `DepartmentService.create`) — un compte capable de se connecter (`server.ts` résout l'identité par email sans vérifier de rôle) survivait au refus. Le test `SEC-010` de `SecurityBoundaries.test.ts` (describe "SEC-010 user provisioning bypasses the role.assign gate") est passé de `it.fails` à `it` sans modification du corps du test — son assertion (ForbiddenError levé, aucun insert) correspondait déjà au comportement sécurisé attendu. Aucune régression : tous les acteurs `admin` des tests `UserService.test.ts` existants possédaient déjà `role.assign`. `npm run typecheck` + `npm test` verts (366 tests, 23 dans `SecurityBoundaries.test.ts`). Commit `f0f7fdf`. | 2026-09-28 | Résolu — **retest @security du 2026-09-28 : CONFIRMED_FIXED** (voir ligne @security ci-dessous pour le détail). |
| @dev-backend | SEC-012 (Medium) corrigé : `ActionPlanService` gagne deux paramètres de constructeur optionnels `users?: UserRepository`/`departments?: DepartmentRepository` (ajoutés après `notifier`, pas avant, pour ne pas décaler positionnellement les tests existants qui passent déjà `notifier`), et deux méthodes privées `assertActiveUser`/`assertDepartmentExists` appelées dans `create()` pour valider `responsibleUserId`/`departmentId` dans le tenant de l'acteur (même pattern que `RiskService`). `server.ts` câble les instances `userRepository`/`departmentRepository` déjà existantes (réutilisées, pas recréées). Test SEC-012 de `SecurityBoundaries.test.ts` passé de `it.fails` à `it`, avec ajout d'un faux `UserRepository` (`getById` → `null`) à la construction du service, sinon `this.users` restait `undefined` et la garde `if (!this.users) return;` aurait laissé le test passer sans exercer le correctif. `npm run typecheck` + `npm test` verts (366 tests). Commit `e623ec6`. | 2026-09-28 | Résolu — **retest @security du 2026-09-28 : CONFIRMED_FIXED** (voir ligne @security ci-dessous pour le détail). |
| @dev-backend | SEC-014 (Low, dernier de la série SEC-009..SEC-014) corrigé : `RiskAppetiteService.setThreshold` exige désormais, en plus de `riskappetite.update` (inchangé, toujours requis pour créer/modifier un seuil actif), la permission `riskappetite.delete` lorsque `input.active === false` — même logique que `archive()`/SEC-013 : une désactivation est une transition terminale et doit être gatée comme telle, jamais par la seule permission générique `.update`. Garde d'une ligne (`if (input.active === false) requirePermission(actor, "riskappetite.delete")`), aucune nouvelle permission créée, pas d'exigence de "reason" ajoutée (hors scope du finding). Test `SEC-014` de `SecurityBoundaries.test.ts` passé de `it.fails` à `it` sans modification du corps — plus aucun `it.fails` dans tout le fichier. Grep de `setThreshold` dans `RiskAppetiteService.test.ts` : l'acteur de test (`actor`, utilisé pour le test `active: false` "lists active thresholds...") avait déjà `riskappetite.delete` dans ses rôles — aucune régression, aucun ajustement nécessaire. `npm run typecheck` + `npm test` verts (366 tests, 34 fichiers). Commit `1918b82`. Point signalé à part (hors scope de ce fix) : `list()` filtre `active = true` alors que `getBySubCategory()` (utilisé par la future comparaison RiskEvaluation) ignore `active` et continuerait d'appliquer un seuil désactivé — à trancher par @security/@architect. | 2026-09-28 | Résolu — **retest @security du 2026-09-28 : CONFIRMED_FIXED** (voir ligne @security ci-dessous pour le détail). |
| @dev-backend | SEC-011 (Medium) corrigé : les trois setters de scoring de `RiskEvaluationService` (`recordInherentScoring`, `recordMasteryAssessment`, `recordResidualScoring`) exigeaient seulement `riskevaluation.update` et ne vérifiaient jamais que l'acteur était le `evaluatorId` désigné — le contrôle des quatre yeux dans `validate()`/`reject()` (comparaison `actor.userId` vs `evaluatorId`) arrivait trop tard, après qu'un tiers ait déjà pu écrire tout le contenu de scoring (y compris `appetiteOverride`, qui décide `appetiteExceeded`) sur un brouillon ouvert par quelqu'un d'autre. Correctif : nouvelle fonction `assertIsEvaluator(actor, evaluation)` (même comparaison que `validate()`/`reject()`, réutilisée en amont), appelée juste après `assertMutable(before)` dans les trois setters. Le test `it.fails` SEC-011 de `SecurityBoundaries.test.ts` (describe "SEC-011 RiskEvaluation scoring is not bound to the evaluator") est passé à `it` sans modification du corps. Grep de `RiskEvaluationService` dans `backend/test/` (`RiskEvaluationService.test.ts`, `GovernanceService.test.ts`) : tous les appels aux setters de scoring utilisent déjà systématiquement le même acteur évaluateur, aucune régression. `npm run typecheck` + `npm test` verts (366 tests, 34 fichiers). Commit `23d09e3`. | 2026-09-28 | Résolu — **retest @security du 2026-09-28 : CONFIRMED_FIXED** (voir ligne @security ci-dessous pour le détail). |
| @security | **Retest complet de la série SEC-009 à SEC-014** (round 2, commit `710ca5e` → 6 fixes `dev-backend` ci-dessus, commits `11b236a`..`1918b82`, tous locaux sur `main`). Verdict par finding — tous **CONFIRMED_FIXED**, aucun contournement trouvé : SEC-009 (recordedBy retiré du type `CreateXMeasureInput` accepté par `record()`, donc fermé au niveau du compilateur, pas seulement d'un test — aucun autre point d'entrée n'écrit une mesure) ; SEC-010 (`role.assign` vérifié avant l'insert `users`, aucun autre chemin de création d'utilisateur trouvé) ; SEC-011 (`assertIsEvaluator` appelé dans les 3 setters de scoring, `create()` fixe déjà `evaluatorId: actor.userId` donc pas de détournement possible via une réassignation d'évaluateur) ; SEC-012 (`server.ts` câble bien les vraies instances `PostgresUserRepository`/`PostgresDepartmentRepository`, réutilisées et non recréées — vérifié par lecture directe ; seul `create()` écrit `responsibleUserId`/`departmentId`, aucune méthode d'update ne les modifie hors validation) ; SEC-013 et SEC-014 (permissions `.delete` correctement exigées, aucune autre route n'appelle `activateVersion`/`setThreshold`). Les ajustements de tests (SEC-009, SEC-012 notamment) n'affaiblissent pas l'assertion réelle : SEC-009 retire juste `recordedBy` du literal d'input (le type ne l'accepte plus), l'assertion `expect(recordedBy).toBe(measureActor.userId)` est inchangée ; SEC-012 ajoute un vrai faux `UserRepository` nécessaire pour exercer la garde optionnelle, sans changer l'assertion `rejects.toThrow`. Point d'attention documenté mais non bloquant pour ce fix : le pattern `if (!this.users) return;` dans `ActionPlanService` réintroduirait silencieusement le trou SEC-012 si un jour un autre point de construction du service omettait ces dépendances — actuellement seul `server.ts` (vraies deps) et les tests (avec deps factices explicites pour exercer la garde) instancient le service, donc pas de trou actif, mais c'est un risque structurel à surveiller à chaque nouveau point d'instanciation. `npm run typecheck && npm test` relancés indépendamment : 34 fichiers, 367 tests verts (366 + 1 nouveau `it.fails` SEC-015). **1 nouveau finding réel découvert pendant la passe de recherche** (déjà pressenti dans le commit SEC-014 mais jamais tracké) : voir SEC-015 ci-dessous. Test ajouté dans `backend/test/SecurityBoundaries.test.ts` (describe "SEC-015 retired risk appetite threshold is still applied to residual scoring"), `it.fails`, non corrigé (hors périmètre de la revue). | 2026-09-28 | Terminé — SEC-009 à SEC-014 CONFIRMED_FIXED, SEC-015 ouvert (voir ligne @dev-backend ci-dessous). |
| @dev-backend | **SEC-015 (Medium) corrigé** : `RiskEvaluationService.recordResidualScoring`/`suggestAppetite` traitent désormais un seuil d'appétence dont `active === false` comme absent (`suggested: null`), au lieu de continuer à l'appliquer — au même endroit que la dégradation déjà existante quand `riskAppetites` est absent du constructeur. Fix au niveau du service, **pas** du repository : `RiskAppetiteRepository.getBySubCategory` (interface + `PostgresRiskAppetiteRepository`) reste inchangé (il continue d'ignorer `active`, comme requis par `RiskAppetiteService.setThreshold` qui a besoin de retrouver un seuil désactivé pour l'upserter en place — toucher au repository aurait cassé ce cas d'usage et forcé une mise à jour de tous les doubles de test). Le test `it.fails` SEC-015 de `SecurityBoundaries.test.ts` (describe "SEC-015 retired risk appetite threshold is still applied to residual scoring") est passé à `it` sans modification du corps. Grep de `getBySubCategory`/`riskAppetites` dans `RiskEvaluationService.test.ts` : les 3 fixtures existantes (`appetiteThresholdSuggested`, override, breach) utilisent toutes `active: true`, aucune régression. `npm run typecheck` + `npm test` verts (34 fichiers, 367 tests, plus aucun `it.fails` dans `SecurityBoundaries.test.ts`). Commit `6179428`. Clôt (sous réserve du retest @security) l'intégralité de la série SEC-009 à SEC-015 issue de la revue round 2. | 2026-09-28 | Résolu — en attente de retest @security. |
| @security | **Retest final SEC-015 — CONFIRMED_FIXED.** `git show 6179428` : filtre `active !== false` appliqué correctement aux deux sites (`recordResidualScoring` ligne 317-319, `suggestAppetite` ligne 352-354). Grep `getBySubCategory` dans tout `backend/src` : exactement 3 appels au total, les 2 patchés plus `RiskAppetiteService.setThreshold` (ligne 62) — volontairement non touché, confirmé, car il a besoin du seuil désactivé pour le réactiver via `upsert` (comportement vérifié par lecture directe : `before` sert uniquement à décider CREATE/UPDATE pour l'audit, jamais à filtrer). `compareToAppetite` (ligne 364) ne lit que les champs déjà stockés sur l'évaluation (`appetiteThresholdApplied`, `appetiteThresholdSuggested`, `appetiteExceeded`, `appetiteThresholdOverride`) — pas d'appel direct à `getBySubCategory`, donc pas besoin du même fix : il hérite automatiquement de la correction faite en amont à `recordResidualScoring`. Diff de test (`SecurityBoundaries.test.ts`, describe SEC-015) relu intégralement : seul `it.fails` → `it`, corps et assertions (`appetiteThresholdApplied`/`appetiteExceeded` doivent être `null` malgré un score de 9 > seuil retiré de 5) inchangés — assertion non affaiblie. `npm run typecheck && npm test` relancés indépendamment par @security (pas seulement lus dans le journal dev-backend) : typecheck propre, 34 fichiers / **367 tests verts**, plus aucun `it.fails` dans tout `SecurityBoundaries.test.ts`. **VERDICT SEC-015 : CONFIRMED_FIXED.** — **Clôture de la série SEC-009 → SEC-015 (revue round 2) : CLOSED.** Récapitulatif des 7 findings, tous CONFIRMED_FIXED après retest indépendant : SEC-009 (`11b236a`), SEC-010 (`f0f7fdf`), SEC-011 (`23d09e3`), SEC-012 (`e623ec6`), SEC-013 (`88a5ede`), SEC-014 (`1918b82`), SEC-015 (`6179428`). Balayage de cohérence d'ensemble sur les 7 fixes : rien de notable à signaler. Le pattern « transition terminale ⇒ permission `.delete` dédiée en plus de `.update` » est appliqué de façon cohérente et volontairement identique entre SEC-013 (`ratingscale.delete` pour `activateVersion`/archivage) et SEC-014 (`riskappetite.delete` pour désactivation) — même famille de problème, même solution, pas de divergence non justifiée. SEC-011 (liaison à l'évaluateur) et SEC-009 (retrait au niveau du type plutôt qu'au niveau de l'autorisation) sont des familles de problèmes différentes et appellent légitimement des remèdes différents — pas d'incohérence. Seul point structurel déjà documenté (non nouveau, non bloquant) : le pattern `if (!this.users) return;` dans `ActionPlanService` (SEC-012) resterait un point de vigilance si un futur point de construction du service omettait ces dépendances optionnelles — à surveiller, pas un finding. Aucun nouveau problème découvert pendant ce balayage final. | 2026-09-28 | **CLOSED — série SEC-009 à SEC-015 intégralement retestée et confirmée corrigée.** |
| @product-manager | **Nouveau Cahier des charges GRC v0.1 (docs/Cahier_des_charges_GRC_v0.1.md)** — priorisation par criticité/risque livrée : 1. RACI minimal (Risk/Control/ActionPlan), 2. Checklist des contrôles, 3. Incident (referme la dette `ActionPlan.sourceType="INCIDENT"`), 4. Audit Findings/Recommendations (referme la dette `sourceType="AUDIT"`), 5. Référentiel catalogue/registre/évaluation, 6. Commentaires configurables, 7. Gouvernance transverse finale. Synthèse complète des 15 agents consultés : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Ouvert — en attente d'arbitrage du Product Owner (voir 3 contradictions internes du document et points §37 non tranchés dans l'artefact). **Gate des 3 artefacts de référence désormais complet** : `docs/architecture/GRC_Target_Domain_Model.md` (@architect, commit `54b20f0`), `docs/architecture/GRC_Database_Gap_Analysis.md` (@dev-db) et `docs/architecture/GRC_Migration_Plan.md` (@dev-db). **Mise à jour 2026-09-28** : les 4 points `ARBITRER` laissés ouverts par la Gap Analysis (`RiskAssessment`/`RiskEvaluation`, FK `RiskCategory`, `risk_processes`, `Kpi`/`Kri`) ont été **tranchés par le Product Owner** (SHARED_LOG, « Arbitrage des 4 points ouverts de la Gap Analysis ») et intégralement répercutés dans les 3 documents de référence : `GRC_Target_Domain_Model.md` (@architect, commit `89c2be0`), `GRC_Database_Gap_Analysis.md` et `GRC_Migration_Plan.md` (@dev-db, commit voir SHARED_LOG). Les 3 documents sont désormais alignés — chantier prêt pour le démarrage du Lot 1 (RACI minimal). |
| @architect | Cahier des charges GRC v0.1 : extension additive proposée (catalogue au-dessus de `Risk` existant, méthodologie versionnée = extension de `RatingScale`, moteur transverse polymorphe unique pour Comments/RACI/Evidence/Findings, injecté en paramètre optionnel). RACI/Comments identifié comme le changement le plus risqué (touche `server.ts` + presque tous les services). Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @dev-backend | Cahier des charges GRC v0.1 : le pattern « paramètre optionnel constructeur » suffit à absorber RACI/Comments/Evidence sans casser les 367 tests. Nouveau 4e pattern d'écriture à documenter pour Incident (timestamps incrémentaux + statut mutable). RACI reste lu, jamais utilisé comme condition de permission. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @dev-db | Cahier des charges GRC v0.1 : ~15-20 nouvelles migrations estimées. Stratégie Expand/Contract pour catalogue/registre (jamais de refonte destructive sur `risks` déjà peuplée). Polymorphe `object_type`/`object_id` avec `CHECK` whitelist plutôt qu'une table par objet. Alerte : pré-assigner les numéros de migration en un lot avant tout dispatch parallèle. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @qa-engineer | Cahier des charges GRC v0.1 : proposition d'un test de boundary générique paramétré par type d'objet plutôt que dupliqué par module. Cas limites temporels d'Incident à anticiper (désordre, fuseaux, séquence invalide). Table de correspondance ancien/nouveau modèle exigée avant toute migration sur `Risk`. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @security | Cahier des charges GRC v0.1 : risque IDOR par construction sur le moteur polymorphe Comments/RACI/Evidence si le tenant n'est pas vérifié — généraliser le pattern déjà en place dans `EvidenceService`. Garde anti-auto-désignation Accountable à écrire avant tout code RACI. Timestamps d'incident : distinguer champs factuels déclaratifs de champs d'attribution forcés serveur. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @risk-manager | Cahier des charges GRC v0.1 : séparation catalogue/registre/évaluation validée comme standard ERM reconnu. **Contradiction interne relevée** : Vélocité/Persistance traitées comme dimension de score en §10.1 alors que le document dit le contraire en §32.2 — le code actuel a déjà fait le bon choix, à préserver. Lignes de défense dynamiques = risque de sur-ingénierie pour la maturité actuelle de Djamo. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @ux-designer | Cahier des charges GRC v0.1 : panneau latéral rétractable unique et générique proposé pour Comments/RACI/Evidence (rail d'onglets avec compteur), jamais affiché à plat — répond à la consigne « rester intuitif ». Catalogue/registre/évaluation = onglets internes d'une même fiche, pas 3 écrans. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @privacy | Cahier des charges GRC v0.1 : RACI/Commentaires exposent des identités de façon transverse sans notion de sensibilité — visibilité différenciée par sensibilité d'objet proposée. Aucune règle de classification/rétention pour les évidences dans le document. Tension signalée entre audit trail append-only et droit à la rectification. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @compliance | Cahier des charges GRC v0.1 : modèle `Control` actuel manque des champs réglementaires BCEAO (`sample_size`, `evidence_nature` typée). Lignes de défense conformes à Three Lines Model mais sans contrainte RBAC couplée = ségrégation cosmétique. Aucune durée de rétention explicite (≥10 ans exigée) mentionnée dans le document. Silence total sur le périmètre LBC/FT — à vérifier avec le client. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @audit | Cahier des charges GRC v0.1 : distinction à documenter clairement entre `AuditLog` technique existant et le module Audit métier nouveau (Findings/Recommendations). **Contradiction interne relevée** : chaîne Finding→ActionPlan (§21) contredit Constats→Recommandations→Plans d'action (§27), aucune table `recommendations` dans l'annexe. Articulation nécessaire avec le skill `audit-mission` déjà présent dans le dépôt. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | **Résolu (2026-09-29, retour honnête du même agent)** — la contradiction a été arbitrée dans `GRC_Target_Domain_Model.md` §9.2 (commit `89c2be0`) : chaîne Finding→ActionPlan retenue (`sourceType="FINDING"`), `AuditRecommendation` séparée notée "non tranché" plutôt que contredite. Plus une contradiction. `Finding.relatedObjectType` confirmé comme 6e whitelist polymorphe à unifier sous `GrcObjectType` (DECISION-003/DECISION-004 ci-dessous). |
| @devops | Cahier des charges GRC v0.1 : pattern de calcul à la lecture déjà validé (ActionPlan) à répliquer pour vélocité/persistance, aucune dette nouvelle. Volume d'évidences x6-7 objets : vérifier le quota du compte Drive partagé unique. `ModuleToggle` existe mais n'a aucun middleware d'application — prérequis avant de s'appuyer dessus pour un rollout progressif. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | **Partiellement résolu (2026-09-29)** — `ModuleToggle` a désormais un middleware réel (`moduleGuard.ts`, câblé sur `/api/v1/risks`, PR #16). Quota Drive partagé toujours non vérifié — reste ouvert, hors périmètre agent (accès console Drive). |
| @infrastructure | Cahier des charges GRC v0.1 : « organisation » du document probablement un niveau métier interne au tenant, pas un remplacement de l'isolation technique existante — à trancher explicitement (risque de double dimension de scoping oubliée). Aucune séparation dev/prod n'existe aujourd'hui — à créer avant ce chantier. Aucune exigence de performance chiffrée dans le document. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @release-manager | Cahier des charges GRC v0.1 : découpage en 5 PR séquentielles proposé (suivant la dépendance métier réelle, pas l'ordre du document). Un seul agent doit centraliser les ajouts à `permissions.ts` par lot. Changelog fonctionnel séparé recommandé pour tout changement de méthodologie de scoring. Definition of Done à enrichir d'un rollback de migration testé. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @documentation | Cahier des charges GRC v0.1 : table de correspondance terminologique à publier avant tout code (`Risk` actuel = « Registre » du document, pas « Risque » générique). Nouveau 4e pattern d'écriture (Incident) à documenter avant, pas après (leçon déjà tirée 2 fois : SEC-001, SEC-009). ADR-002 dédié recommandé avant le Lot 2. Détail complet : https://claude.ai/artifact/7kg7EefZbaqyiW7RzCje1V | 2026-09-28 | Consulté — voir artefact pour le détail complet. |
| @dev-backend | **Lot 1 (RACI minimal) — démarré et livré (tranche verticale)** : `RaciAssignment` sur Risk/Control/ActionPlan (entité, repository + impl Postgres, service avec permissions dédiées `raci.assign`/`raci.revoke`/`raci.read`, routes `/api/v1/raci`, migration `027_raci_assignments.sql`, garde-fou anti-auto-désignation Accountable documenté et testé). `npm run typecheck && npm test` : 375/375 verts. Détail complet + écart assumé vs Migration Plan (noms de colonnes/sémantique soft-delete vs append-only) : SHARED_LOG 2026-09-28. | 2026-09-28 | **CLOSED — câblage livré le 2026-09-30, voir ligne @dev-backend en fin de tableau (PR #26).** |
| @security | **SEC-016 (Medium) — Lot 1 RACI : garde anti-auto-désignation Accountable contournable par ordre d'appel.** `RaciAssignmentService.assertNoSelfAccountableConflict` ne s'exécute que lorsque le rôle entrant est `"A"` (`if (role !== "A" \|\| targetUserId !== actingUserId) return;`) et ne vérifie l'existant que dans ce sens (« déjà R → refuser A »). Un acteur qui s'auto-désigne d'abord `A` (autorisé, aucun `R` n'existe encore) puis s'auto-désigne ensuite `R` sur la même entité (le garde-fou ne se déclenche jamais côté `R`) obtient l'état R+A que le garde-fou prétend explicitement empêcher — seul l'ordre "R puis A" est bloqué, pas "A puis R". Confirmé par un test standalone hors suite (bypass reproductible, retiré après vérification) avant l'ajout du test officiel. Non lié au câblage RiskService/ControlService/ActionPlanService (absent de ce lot) : c'est un défaut de la garde elle-même, indépendant de toute intégration future. Risque métier plus large signalé par Security en consultation initiale (« RACI avec auto-désignation Accountable = même classe de faille » qu'`assertIsEvaluator`) — reste non traité par ce lot : un Accountable qui ne détient jamais `R` peut déjà s'auto-désigner librement aujourd'hui (comportement documenté comme volontaire dans le code), et aucune étape de validation métier ne lit encore RACI pour appliquer un maker-checker réel — à trancher explicitement (Risk Manager/Architect) avant le câblage prévu de RACI dans les 3 services métier. Test `it.fails` ajouté : `backend/test/SecurityBoundaries.test.ts`, describe "SEC-016 RACI self-Accountable guard bypassable via assignment order". `npm run typecheck && npm test` relancés indépendamment par @security : 35 fichiers, 376 tests verts (375 existants + 1 nouveau `it.fails`). Aucun code de production modifié par @security (hors scope du rôle). | 2026-09-28 | **Ouvert — en attente de correctif @dev-backend**, puis retest @security avant que le Lot 1 (câblage RiskService/ControlService/ActionPlanService + écran frontend) puisse démarrer. |
| @dev-backend | **SEC-016 (Medium) — corrigé.** `assertNoSelfAccountableConflict` renommée `assertNoSelfRaConflict` dans `backend/src/services/RaciAssignmentService.ts` : la garde vérifie désormais le cumul R+A par le même acteur sur la même entité **dans les deux sens** — rôle entrant `"A"` avec `"R"` déjà détenu (comportement d'origine, inchangé) **et** rôle entrant `"R"` avec `"A"` déjà détenu (le cas manquant identifié par SEC-016). Implémentation : `otherRole = role === "A" ? "R" : role === "R" ? "A" : null`, guard sort tôt si `otherRole` est `null` (rôles `"C"`/`"I"` non concernés, comme avant). Le test `it.fails` SEC-016 dans `backend/test/SecurityBoundaries.test.ts` est passé à `it(...)` sans autre modification et passe tel quel. Grep de `backend/test/RaciAssignmentService.test.ts` : aucun test existant n'attendait le comportement à sens unique — les deux tests déjà présents (« blocks self-designation as Accountable... » et « still allows a different actor... ») restent valides avec la version bidirectionnelle. `npm run typecheck && npm test` : 35 fichiers, **376/376 tests verts** (375 existants inchangés + SEC-016 désormais actif et vert). Commit local (pas de push) : voir historique git. | 2026-09-28 | **Résolu par @dev-backend — retest @security du 2026-09-28 : CONFIRMED_FIXED (voir ligne ci-dessous).** |
| @orchestrator (A02) | **Root cause — pourquoi la charte artefact validée (V1→V6) n'a jamais été portée dans `tokens.css` malgré 6 itérations.** Chaque entrée `SHARED_LOG.md` (@ux-designer, V1 à V6) concluait « portage attend une validation PO explicite » — mais cette phrase n'a jamais été transformée en item trackable ici avec un owner et une échéance ; elle restait une conclusion narrative noyée dans un journal, jamais vérifiée par l'orchestrateur avant dispatch (règle déjà écrite dans `CLAUDE.md` § onboarding point 7 : « consulte `ACTION_ITEMS.md`... un point déjà ouvert sur son périmètre ? » — non appliquée ici). Conséquence : le "go" donné par le PO (HUMAN) n'a pas pu se rattacher à une décision identifiée, et le dispatch du Lot 1 RACI frontend est parti ce matin sans rouvrir ce point. **P0 identifié : A02 Orchestrator** (responsable d'escalader toute décision bloquante vers HUMAN de façon tracée, et de vérifier `ACTION_ITEMS.md` avant tout dispatch touchant un périmètre concerné — `CLAUDE.md`, hiérarchie N0/N1) ; **A03 Product Manager** en second point d'accountability (Decision Log, `product-manager.md` §47, jamais utilisé pour ce sujet). Règle ajoutée à `CLAUDE.md` § onboarding pour éviter la récidive : toute mention "attend validation PO/HUMAN explicite" dans `SHARED_LOG.md` doit immédiatement générer une ligne ici, et tout "go" verbal du PO doit être journalisé comme entrée de Decision Log référençant l'item fermé (voir DECISION-001 ci-dessous). | 2026-09-28 | **Résolu — règle ajoutée à `CLAUDE.md`, voir DECISION-001.** |
| @qa-engineer | **Lot 1 RACI — revue QA indépendante passée, pas de finding bloquant.** 7 points cas limites inter-modules demandés par le PO (entité inexistante, entité soft-deleted, double revoke, cumul C+I/R+C, list() vide, fuite inter-tenant sur revoke(), cohérence avec `QA_REVIEW_BATCHES_1_3.md`) tous vérifiés OK sur le code existant — aucun bug réel, seulement des trous de couverture, comblés par 6 nouveaux tests `it()` (préfixe `QA-RACI:`) dans `RaciAssignmentService.test.ts` (8 → 14 tests). Point de vigilance non bloquant noté (pas un finding) : le double in-memory `getById` ne filtre pas `deletedAt` contrairement à `PostgresRaciAssignmentRepository.getById`, écart de fidélité sans conséquence aujourd'hui (`remove()` rattrape le cas). `npm run typecheck && npm test` verts : 35 fichiers, 382 tests. Détail complet des 7 points dans `SHARED_LOG.md`, entrée `@qa-engineer` du 2026-09-28. | 2026-09-28 | **Résolu — feu vert QA pour le câblage `RiskService`/`ControlService`/`ActionPlanService` + écran frontend.** |
| @architect @risk-manager | **DECISION-006, point gouvernance — second avis convergent (2026-09-29, 2 agents dispatchés indépendamment).** Confirme et durcit le diagnostic du 1er passage : `CreateRiskInput` n'a même pas de champ `ownerId` (tout risque naît sans propriétaire, ce n'est pas un cas limite) ; `Risk.processId` nullable **jamais backfillé** (en données réelles, quasi aucun risque n'a de `processId` aujourd'hui) — l'option B (dérivation automatique depuis `Risk.ownerId`) donnerait **zéro valideur pour pratiquement chaque processus au démarrage**. **Option A (permission dédiée `evaluationmode.validate`) confirmée par les deux agents, mais pas nue** — Risk Manager : une permission librement attribuable, seule, peut dégénérer en tampon automatique si elle atterrit sur un rôle générique (rejoint la "ségrégation cosmétique" déjà signalée par @compliance, ligne 46) — demande que quand le processus a au moins un risque avec propriétaire assigné, le pool de valideurs éligibles soit l'intersection {propriétaires de risques du processus} ∩ {détenteurs de la permission}. Architect : accepte l'esprit de la demande sans réintroduire l'autorisation mutable de B — rendre la propriété des risques **visible et auditée** au moment de la validation (affichée à l'écran, capturée dans l'audit log), jamais **autoritative** (un champ nullable/multi-valué/mutable comme `Risk.ownerId` ne doit jamais être la source de l'autorisation — sinon n'importe quel détenteur de `risk.update`, permission largement distribuée, pourrait changer qui a le droit de valider une demande en cours, la même classe de faille que SEC-011/SEC-013/SEC-014). **A est un sur-ensemble de B, pas un rejet** : l'organisation qui veut que les propriétaires de risques valident leur attribue la permission ; B, lui, interdit tout autre schéma et casse au démarrage. **Reste à trancher par le PO** : accepter A (permission + visibilité/audit des propriétaires, jamais autoritative), ou insister sur un "B-light" (permission + contrainte d'être propriétaire d'au moins un risque du processus) — déconseillé par les deux agents (réintroduit l'autorisation mutable, exige une méthode de repo qui n'existe pas encore, règle difficile à auditer), à ne reconsidérer que si `processes.owner_id`/`risks.process_id` sont un jour réellement peuplés. **FINDING DE SÉCURITÉ TROUVÉ EN COURS DE REVUE, À CORRIGER AVANT COMMIT du lot DIV-06 (voir ligne @dev-backend ci-dessus)** : `processes.routes.ts` accepte déjà `evaluationMode` dans `UpdateProcessBody`, gaté seulement par `process.update` — la consigne "pas de route d'écriture hors permission Risk Manager" posée au 1er passage n'a pas été respectée par l'implémentation DIV-06, non commitée. | 2026-09-29 | **TRANCHÉ PAR LE PO (2026-09-29) : Option A retenue** (permission dédiée `evaluationmode.validate` + propriétaires de risques affichés/audités à la validation, jamais autoritatifs). Reste à faire, non bloquant (écran Processus pas encore construit) : coder la table `process_evaluation_mode_requests` + le service au moment du lot Processus. **Correctif sécurité fait** : `processes.routes.ts` a désormais une route dédiée `PUT /processes/:id/evaluation-mode` sous permission `process.evaluationmode.set`, retirée du PATCH générique. Voir PR #17. |
| @architect | **DECISION-006, point gouvernance — structure du garde-fou de validation, spécifiée (2026-09-29), pas encore codée.** Verdict : table dédiée append-only `process_evaluation_mode_requests` (PENDING_VALIDATION/VALIDATED/REJECTED, index partiel unique 1 demande en attente par processus), PAS un champ de statut sur `Process.evaluationMode` (qui reste exclusivement le mode *en vigueur*, jamais une proposition — sinon indécidable pendant l'attente). **2 trous de modèle trouvés, à faire trancher par le PO** : (1) "propriétaire du processus" n'existe pas comme sujet d'autorisation — `Process.owner` est du texte libre ; correctif proposé = `processes.owner_id` FK (même geste que `risks.process_id`), un processus sans `owner_id` n'a que le chemin Risk Manager direct. (2) "propriétaire du risque" comme valideur est structurellement ambigu à l'échelle d'un Processus (N risques, N propriétaires différents, un processus sans risque n'aurait pas de valideur) — **l'agent a reformulé de sa propre initiative** : le valideur est défini par une permission dédiée (`evaluationmode.validate`) plutôt que dérivé de `Risk.ownerId`, avec 3 gardes cumulatifs (proposant ≠ validateur, jamais de dérogation même pour un Risk Manager, chemin direct RM = méthode séparée `setMode` distincte de `propose()`/`validate()`). **Cette reformulation doit être confirmée explicitement par le PO** — ce n'est pas ce qu'il a dit littéralement. **Consigne immédiate, sans conflit avec le travail en cours** : ne pas exposer de route d'écriture sur `Process.evaluationMode` hors permission Risk Manager tant que ce garde-fou n'est pas construit. Non bloquant, additif à 100%, à construire au moment de l'écran Processus (pas prioritaire). | 2026-09-29 | **Spécifié — confirmation PO requise sur la reformulation "valideur = permission" avant tout code de ce garde-fou.** |
| @dev-backend | **DIV-01/DIV-05/DIV-06 implémentées (2026-09-29).** Migrations `029_risks_process_id.sql` (`risks.process_id`, nullable, FK `processes`, pas de backfill) et `030_evaluation_mode.sql` (`configs.evaluation_mode` NOT NULL défaut CLASSIQUE, `processes.evaluation_mode` nullable) + `.down.sql` pour les deux. `ActionPlanSourceType`/`ActionLinkResourceType` unifiées sur `GrcObjectType` (asymétrie source/lien préservée comme demandé). `resolveInheritedEvaluationMode` (fonction pure, calquée sur `computeKriStatus`) + `ProcessService.resolveEvaluationMode` écrits et testés isolément — **pas encore câblés dans `RiskEvaluationService`**, comme prescrit (lot Évaluation ultérieur). Nouvelle dépendance optionnelle `RiskService.processes` lève une erreur si `processId` fourni sans le repository câblé (règle SEC-012 respectée). `PUT /config/evaluation-mode` et `processId` sur les routes `risks`/`processes` ajoutés pour la testabilité. `npm run typecheck && npm test` : **446/446 verts** (426 existants + 20 nouveaux), zéro régression. Aucun fichier frontend touché, `Control.process` non touché (hors périmètre). **Commité et poussé** : branche `feature/evaluation-mode-process-fk`, PR #17 (https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/pull/17). | 2026-09-29 | **CLOSED — PR #17 ouverte, en attente de revue/merge PO.** |
| @architect | **Audit demandé par le PO (2026-09-29) — divergences backend réel vs feuille de route "objet imbricable" (DECISION-003/CHALLENGE-002).** Constat d'entrée : la feuille de route n'est pas à démarrer, elle est **déjà appliquée à moitié** — `GrcObjectType.ts` existe, RACI et Notification y sont déjà raccrochés, 2 whitelists sur 3 exposées sont conformes. **Divergences réelles trouvées (8, priorisées, preuve code à chaque fois — voir SHARED_LOG pour le détail complet)** :
  - **DIV-01 (corriger maintenant, type-only, 0 migration)** : `ActionPlanSourceType`/`ActionLinkResourceType` (`ActionPlan.ts:33,45`) sont la dernière whitelist hors `GrcObjectType`, retapée à la main 7 fois (`ActionPlanService.ts`, 3 fichiers de routes, 2 CHECK SQL). Coût nul aujourd'hui, grandissant plus tard.
  - **DIV-05 (corriger maintenant pour Risk, prochain lot Contrôle pour Control)** : `Risk.process`/`Control.process` en texte libre alors que `Kpi.processId` est déjà une vraie FK vers `processes` — le même concept modélisé deux fois différemment dans le même backend. C'est le prérequis dur de DECISION-006.
  - **DIV-06 (corriger maintenant, après DIV-05)** : DECISION-006 (mode Classique/Participatif) a **zéro ligne de code** — ni `Config.evaluationMode`, ni `Process.evaluationMode`, ni la FK dont elle dépend. Ordre imposé : (a) `risks.process_id`, (b) `Config.evaluationMode` (défaut tenant), (c) `Process.evaluationMode` (résolution héritée à la lecture, jamais dénormalisée).
  - **DIV-07 (lot Évaluation, pas maintenant)** : `RiskEvaluationService` ne compose jamais les contrôles du risque qu'il évalue (`listCoveringRisk` existe, inutilisé) — corriger via un `RiskEvaluationViewService` (gabarit déjà normé ADR-003), **jamais** en dérivant automatiquement `masteryLines` de l'efficacité des contrôles (réserve assumée : la maîtrise reste un jugement humain par ligne de défense, ACT-152 — sinon une évaluation validée changerait rétroactivement).
  - **DIV-04 (au lot concerné, pas maintenant)** : Comments/Evidence-links/Finding n'existent pas du tout en base — à concevoir avec `GrcObjectType` dès le jour 1 quand leur lot arrivera (2e cas d'usage réel confirmé par le brief UX panneau latéral, pas de l'anticipation).
  - **DIV-08 (lot Appétence, jamais sur RiskEvaluation)** : `RiskAppetite.subCategory` doit devenir une FK vers `RiskCategory` ; `RiskEvaluation.subCategory` doit rester du texte (instantané délibéré et documenté, `RiskEvaluation.ts:12-26` — le transformer en FK casserait l'immuabilité d'une évaluation validée). Même champ, même nom, deux verdicts opposés, assumé.
  - **DIV-02/DIV-03 : faux positifs, ne pas corriger** — asymétrie source/lien ActionPlan = narrowing métier volontaire (doctrine déjà posée `GrcObjectType.ts:46-51`) ; `module_toggles.module_name` mélange modules et objets GRC, à garder séparé pour ne pas polluer `GrcObjectType` avec des écrans (`DASHBOARD`/`CARTOGRAPHY`).
  **Désaccord assumé avec la formulation du PO, à lui signaler** : "reprendre par objet imbricable, ça va corriger beaucoup de choses" suppose une refonte transverse — l'audit ne le confirme pas. Le polymorphisme est presque fini. Ce qui bloque réellement l'écran Évaluation, ce sont deux choses banales et non polymorphes (une FK manquante, une composition en lecture jamais branchée) — traiter ça comme une refonte "héritage" ferait payer les 29 modules restants pour un problème qui tient en deux corrections ciblées. | 2026-09-29 | **Audit livré — DIV-01/05/06 à exécuter maintenant (dev-backend + dev-db), DIV-07/04/08 à reporter au lot concerné, DIV-02/03 classés non-problèmes.** |
| @architect | **DECISION-007 — Arbitrage `risk_processes` refait avec faits corrects (2026-09-29) : ÉCARTÉ, pas différé.** Rouvert sur demande PO après correction de la prémisse fausse (`risks.process_id` n'a jamais existé, `003_risks.sql:4` = texte libre). Verdict : corriger la prémisse **ne change pas** la conclusion de 2026-09-28, elle change sa motivation — ce qui manquait n'était pas le N:N, c'était l'intégrité référentielle tout court, déjà apportée par la FK 1:1 de DECISION-006. **8 preuves contre le N:N** : aucun besoin métier exprimé (CDC v0.1 §37.A pose la question, ne tranche pas) ; données réelles mono-valuées (`RiskImportService`, une seule colonne `PROCESSUS`) ; le besoin multi-processus est déjà couvert par Catalogue→N `Risk` (`GRC_Target_Domain_Model.md` §4.1) — un N:N créerait un 2e mécanisme concurrent pour le même besoin, la pathologie déjà diagnostiquée en DECISION-003 ; hiérarchie `processes` (parent_id) couvre déjà le rattachement transverse ; le N:N casserait DECISION-006 (mode indécidable sans `is_primary`, une FK 1:1 déguisée) ; fausserait Cartography/Dashboard (un risque comptabilisé plusieurs fois) ; incohérent avec l'imputabilité N:1 déjà en place (`ownerDepartmentId`) ; asymétrie de coût (différer = gratuit, construire maintenant = migration+repo+service+permissions+écran pour rien). **Critère de réouverture fixé** : une expression métier explicite (PO/Risk Manager) d'un risque de registre piloté sur plusieurs processus **avec une seule évaluation partagée** — même règle que DECISION-003 (2e cas d'usage réel, jamais anticipé). **Corrigé directement par l'agent** : `docs/architecture/GRC_Database_Gap_Analysis.md` (lignes 157 et 268, affirmation fausse retirée aux deux endroits, nouveau §2.5bis avec le verdict complet). **2 points de vigilance signalés, non bloquants** : `Control.process` est aussi du texte libre (même lacune que `Risk.process`, hors périmètre de cette décision) ; `ADR-002`/`GRC_Target_Domain_Model.md` ne portaient pas l'erreur mais présentent encore le N:N comme "différé" plutôt qu'"écarté" — à rafraîchir plus tard, non urgent. | 2026-09-29 | **CLOSED — doc corrigé, décision définitive sous réserve du critère de réouverture explicite ci-dessus.** |
| @architect @risk-manager | **DECISION-006 — Niveau de réglage du mode Classique/Participatif : PROCESSUS (niveau PROCESS uniquement, hérité vers SUBPROCESS/ACTIVITY), défaut `Config.evaluationMode` tenant. TRANCHÉ PAR LE PO le 2026-09-29**, avec 3 amendements à la proposition Architect+Risk Manager (convergence des 2 agents, mais PO a corrigé le mode d'affichage et le mode de gouvernance) :
  1. **`Risk.process` → FK réelle `risks.process_id → processes.id`** : confirmé tel quel par le PO (migration Expand, `risks.process` texte conservé en parallèle jusqu'à backfill).
  2. **Affichage du mode — PO a dit NON à la proposition initiale** ("afficher le mode partout où des scores sont comparés côte à côte" — registre/Cartographie/dashboard). **À la place** : un badge Classique/Participatif visible **au niveau de la liste des Processus elle-même** — permettant de voir en un coup d'œil quels processus sont gérés en participatif vs classique. **Écran "Processus" n'existe pas encore** (aucune maquette, aucun écran dans la séquence des 29 modules jusqu'ici) — à ajouter au backlog UX, pas à construire maintenant (règle "un écran à la fois" — priorité reste Évaluation puis Cartographie). PO confirme être d'accord avec le reste du point (2) tel que proposé par les agents (snapshot sur `RiskEvaluation.evaluationMode`, résolution unique à la création, jamais dans les setters).
  3. **Gouvernance du réglage — PO a précisé, différent de la proposition "co-détention" des agents** : le mode est réglé **par le Risk Manager directement**, OU **par le propriétaire du processus sous réserve de validation par le propriétaire du risque** (pas une co-détention symétrique — un chemin direct Risk Manager, un chemin propriétaire-processus-puis-validation). Implique un statut (`PENDING_VALIDATION`/`VALIDATED`) sur `Process.evaluationMode` quand fixé par le propriétaire du processus, avec un valideur qui n'est pas l'auteur — même famille de garde que `assertIsEvaluator` (SEC-011) et le futur garde-fou brut/inhérent (L1 soumet, L2 endosse). **À faire trancher par @architect avant code** : la structure exacte (champ statut simple, ou table d'historique des changements de mode).
| 2026-09-29 | **Tranché par le PO — reste à : (a) écran Processus à ajouter au backlog UX (pas construit maintenant), (b) @architect à consulter sur la structure du garde-fou de validation propriétaire-processus→propriétaire-risque avant tout code, (c) backfill `process_id` (chantier réel, non planifié).** |
| @dev-frontend | **DECISION-008 — Extraction du design system en package réutilisable `@djamo/design-system` (2026-09-29), demande explicite du PO ("réutilisable dans d'autres projets").** `packages/design-system/` (workspace npm racine ajouté, `backend/` non touché) : 18 atomes UI (5 déjà existants portés + 13 nouveaux construits depuis l'artefact validé — Breadcrumb, Card, Menu, MessageBanner, Pagination, Panel/PanelRow, FileUpload, Grid, Slider, DatePicker, SegmentedControl, Timeline, Modal), 6 composants graphiques Chart.js (LineChart avec gradients/stacked/animation progressive, BarChart, BubbleChart, DoughnutChart, ScatterChart multi-axes, ProgressBar), `DashboardGrid` (wrapper GridStack maison — le wrapper React officiel v14 et `gridstack-react` écartés, voir détail ci-dessous), icônes `lucide-react`. Documentation complète livrée (`packages/design-system/README.md`, 644 lignes). `frontend` consomme le package comme une vraie dépendance externe (5 fichiers dupliqués supprimés). Décisions de conception assumées : `TrendChart` renommé `LineChart` (aucun consommateur externe) ; `Message` renommé `MessageBanner` (collision de nom évitée) ; badge de statut non dupliqué (`StatusBadge` existant suffit) ; `DashboardGrid` purement structurel, ne décide rien du contenu par widget (le contenu par rôle reste l'arbitrage ouvert DECISION-002 point 5) ; wrapper GridStack écrit à la main (~50 lignes, chemin "DOM existant" documenté par gridstack) car le wrapper officiel v14 est construit autour de widgets sérialisables incompatibles avec une prop `content: ReactNode` sans remount, et `gridstack-react` est dépublié. `npm run typecheck && npm run build` verts (package + frontend) à chaque étape. PR #18 : https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/pull/18. **CI corrigée (2026-09-29, 3 itérations)** : (1) le job `frontend` ne buildait jamais `packages/design-system` avant `frontend` — job réécrit pour tourner depuis la racine du workspace ; (2) `npm ci`/`npm install` échouaient sur Linux avec « Cannot find native binding » (rolldown, dépendance optionnelle de vite 8) — root cause confirmée par inspection directe du lockfile : `package-lock.json` généré sous Windows ne porte aucune entrée résolue pour `@rolldown/binding-linux-x64-gnu` malgré sa présence en `optionalDependencies` (npm/cli#4828, bug connu de résolution cross-plateforme des optional deps en contexte workspace) ; correctif : le job CI supprime le lockfile checked-out (fichier commité intact) et résout à neuf sur le runner Linux avant de builder. **CI verte** (backend + frontend). | 2026-09-29 | **PR #18 verte — prête à merger. Dette assumée notée : pas de test runner sur le package (aucun test demandé), à ajouter si le package grossit.** |
| @dev-backend | **FINDING OPÉRATIONNEL — la base Neon de dev réelle n'a pas la migration 029 appliquée (2026-09-29), trouvé en validant l'outillage de backfill `risks.process_id`.** `information_schema.columns` confirme l'absence de `risks.process_id` sur cette base (colonnes réelles : `id, tenant_id, process, description, owner_department_id, status, created_at, updated_at, deleted_at, deleted_by, deletion_reason, owner_id, superior_owner_id`), et la table `risks` n'y contient qu'1 seule ligne. Conséquence : tout le travail DIV-05/DIV-06 (PR #17, mergée) est correct dans le code mais **n'a jamais été appliqué à cette base** — `npm run migrate` n'a pas tourné depuis un moment sur cet environnement. Pas exécuté par l'agent (action sur base réelle, hors périmètre du chantier backfill demandé). | 2026-09-29 | **Résolu — `npm run migrate` lancé sur confirmation explicite du PO.** 4 migrations appliquées (027/028/029/030), vérifié directement via `information_schema.columns` : `risks.process_id`, `configs.evaluation_mode`, `processes.evaluation_mode` tous présents sur la vraie base. Le backfill lui-même (`--apply`) reste non exécuté — outillage prêt (voir ligne PR #19), à lancer séparément une fois le rapport dry-run revu. |
| @dev-backend @dev-frontend | **Lot DIV-07 + outillage backfill + remplacement atomes hand-coded (2026-09-29), actions 2/4/10 de la liste des 10 demandées par le PO.** `RiskEvaluationViewService.getEvaluationContext` (DIV-07) compose les contrôles couvrant un risque évalué + leur dernière efficacité, garde-fou testé (jamais de dérivation auto de la maîtrise). Outillage de backfill `risks.process_id` livré en dry-run (classification match unique/ambigu/non-matché, `--apply` jamais exécuté contre la vraie base — voir finding ci-dessus). `MessageBanner`/`Card` remplacent 6 patterns codés à la main dans le frontend (FeedbackAdmin, RolesAdmin, RisksPage, FeedbackWidget, RaciPanel), matrice RACI et fieldset de permissions volontairement non touchés (pas d'équivalent générique). 465/465 tests backend verts, builds design-system + frontend verts. PR #19 : https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/pull/19 | 2026-09-29 | **PR #19 ouverte — en attente CI puis revue/merge PO.** |
| @orchestrator | **Écran « Évaluation des risques » déclaré STATUÉ (2026-09-29, action 1 de la liste des 10)** — 24/24 fils de commentaires résolus sur l'artefact, mode Classique/Participatif tranché (DECISION-006). Cartographie des risques démarrée en parallèle (action 3) — heatmap Inhérent/Résiduel en deux cartes distinctes (retour PO en commentaire pendant la session), 6 risques de démonstration, RISK_BLOCK respecté (statut toujours affiché à côté d'un score résiduel). Artefact v24. | 2026-09-29 | **Résolu — prochain écran après Cartographie : à définir avec le PO.** |
| @orchestrator | **Auto-relevé en balayage (2026-09-29) : DIV-07 (`RiskEvaluationViewService`, PR #19) a été codé sans repasser par la condition PRIV-CH-DASH-001** ("avant tout premier `*ViewService` codé — Risk 360, Dashboard ou autre — la matrice widget × donnée × permission doit être produite et revue conjointement UX/Risk/Compliance/Privacy"). Vérifié après coup : ce service ne résout aucune identité utilisateur (pas de `UserRepository`, pas d'appel `getById` sur `User` — seulement `RiskEvaluation`/`Risk`/`Control`/`ControlEffectivenessAssessment`), donc la fuite concrète déjà identifiée (`PostgresUserRepository.getById` sans filtre `deleted_at`) ne s'applique pas ici. Mais la condition elle-même (revue conjointe avant codage) n'a pas été suivie formellement. | 2026-09-29 | **Ouvert — @privacy à consulter pour une confirmation courte a posteriori (pas de blocage identifié, mais le process n'a pas été respecté à la lettre) ; resserrer la vigilance avant le prochain `*ViewService` (Risk 360/Dashboard, où le risque réel existe).** |
| @architect | **Audit de rafraîchissement "objet imbricable" (2026-09-29), demandé par le PO en complément du premier audit.** Conclusion confirmée et renforcée : aucune nouvelle divergence trouvée dans le code ajouté depuis le premier audit (Lot 1 RACI, `@djamo/design-system`, `RiskEvaluationViewService`/DIV-07) — le polymorphisme `GrcObjectType` est fini, pas à moitié fait, les 4 consommateurs réels dérivent tous du type canonique (compilateur + CHECK SQL alignés). DIV-01/05(Risk)/06/07 confirmés conformes par lecture directe du code mergé. **2 trous de gouvernance réels trouvés dans DIV-06 (pas des divergences d'architecture d'objets)** : (1) Medium — `processes.routes.ts` `CreateProcessBody` acceptait encore `evaluationMode` en création (`ProcessService.create` n'exigeait que `process.create`, pas `process.evaluationmode.set`) alors que la route `update` était déjà verrouillée ; (2) Low — DECISION-006 réserve le réglage au niveau PROCESS, mais rien ne vérifiait `level === "PROCESS"`. | 2026-09-29 | **Audit livré, aucune refonte transverse nécessaire (confirmé). Les 2 trous corrigés directement par l'agent du chantier garde-fou de validation avant sa PR** (`evaluationMode` retiré de `CreateProcessBody`/`ProcessService.create` au niveau du type ; contrainte `level === "PROCESS"` ajoutée dans `setMode`/`propose`/`validate`) — voir PR #21. |
| @product-manager | **DONNÉE DE RÉFÉRENCE REÇUE DU PO (2026-09-29) — Nomenclature officielle des 9 processus et 15 directions Djamo**, transmise en commentaire sur l'écran Cartographie (thread `23e7baee`). **9 processus** : Gouvernance & Audit Interne ; Crédit ; Recouvrement & Expérience Client ; Conformité LBC-FT/KYC ; Juridique & Gestion des Tiers ; Trésorerie, ALM & Fonds propres ; Comptabilité, Fiscal & Reporting ; RH ; DSI & Cybersécurité. **15 directions** : Direction Générale, Risque, Audit Interne, Gouvernance, Crédit, Recouvrement, Conformité, Juridique, Trésorerie, Finance, Sécurité SI, Ingénierie, Data/BI, Data/Revenue Assurance, RH. Utilisée dans l'artefact (graphiques 3/4 Cartographie, v39) avec un remappage provisoire des 3 processus "placeholder" existants (Trésorerie→Trésorerie ALM & fonds propres, Paiements marchands→Crédit, Conformité LBC/FT→Conformité LBC-FT/KYC). **Pas encore propagée** au Registre des risques ni aux fiches d'évaluation déjà maquettées, ni à aucun schéma backend (`processes`/`departments` restent avec des données de test génériques). | 2026-09-29 | **CLOSED — CONFIRMÉE DÉFINITIVE par le PO (2026-09-30)**, avec une précision produit ajoutée : les cartes de concentration (graphiques 3/4) ne doivent être visibles qu'aux détenteurs R/A (RACI) sur les objets concernés — pas un accès plat. À propager au Registre, aux fiches d'évaluation, et au seed backend `processes`/`departments` quand ces lots seront codés. |
| @dev-backend | **DIV-05 (Control.process → FK) + DIV-08 (RiskAppetite.subCategory → FK) implémentées (2026-09-29), go PO explicite.** Migrations `031_controls_process_id`/`032_risk_appetites_sub_category_id`, pattern Expand-only identique à la 029 (`controls.process`/`risk_appetites.sub_category` texte gardés en parallèle). `RiskEvaluation.subCategory` non touché, comme prescrit. 12 nouveaux tests, 476/476 verts. Collision d'environnement (pas d'isolation worktree, répertoire de travail partagé avec l'agent du chantier garde-fou) gérée proprement par l'agent : seuls ses propres fichiers committés. | 2026-09-29 | **CLOSED — PR #20 mergée (merge PO), migrations 031/032 appliquées sur la base de dev réelle, vérifié via `information_schema` (`controls.process_id`, `risk_appetites.sub_category_id` présents). 495/495 tests verts sur `main`.** |
| @dev-backend | **DECISION-006 garde-fou de validation (`process_evaluation_mode_requests`) + CHALLENGE-001 (agrégation maîtrise AVERAGE→MAX) implémentés (2026-09-29), go PO explicite.** Migration `033_process_evaluation_mode_requests` (append-only, index partiel unique 1 demande PENDING par processus), permissions `process.evaluationmode.propose`/`evaluationmode.validate`, `ProcessEvaluationModeRequestService` (`propose`/`validate`/`reject`/`setMode`, garde anti-auto-validation `assertNotSelfValidated`, propriétaires de risques visibles/audités mais jamais autoritatifs). Maîtrise globale : `RatingScale.ts`/`RatingScaleService.ts`/`RiskEvaluationService.ts` passés à `Math.max(...allValues)` — **point de vigilance tracé** : barème 1..3 Inadéquat→Adéquat (plus haut = meilleur), donc MAX retient l'axe le PLUS favorable parmi toutes les lignes de défense, pas le plus défavorable ; décision PO assumée, non remise en question. 19 nouveaux tests, 484/484 verts. | 2026-09-29 | **CLOSED — PR #21 mergée (merge PO, conflit ACTION_ITEMS.md résolu au préalable), migration 033 appliquée sur la base de dev réelle, vérifié via `information_schema` (`process_evaluation_mode_requests` existe). 495/495 tests verts sur `main`.** |
| @security | **Revue sécurité indépendante rétroactive PR #17 à #21 (2026-09-29)**, rattrapage suite au signalement PO (5 PR mergées sans le triptyque de clôture de batch — voir entrée `@orchestrator` ci-dessous). Verdict par PR, sur le code réellement mergé (`git show`/`git diff` des commits de merge, pas les descriptions) : **CONFIRMED_SAFE sur les 5**, aucun finding CRITICAL/HIGH/MEDIUM. Points vérifiés en détail sur PR #21 (le plus sensible, nouveau workflow maker-checker) : garde anti-auto-validation non contournable par ordre d'appel (contrairement à SEC-016/RACI), index partiel unique protégé au niveau DB contre les races applicatives (pas un simple pré-check racy — violation `23505` capturée et mappée proprement), chemin direct `setMode` réellement isolé de `propose`/`validate` (pas de chaînage interne caché), toutes les routes gardées par permission avant mutation, agrégation `Math.max(...allValues)` sans risque d'injection/débordement (longueur bornée par la config tenant, valeurs validées par `assertIntegerInRange` avant calcul). PR #17/18/19/20 également confirmées saines (validation FK cross-tenant systématique, `*ViewService` DIV-07 conforme ADR-003, aucun secret dans le package design-system, aucune nouvelle permission manquante). 1 observation mineure non-sécurité notée (friction UX possible : `GET /:id` sur une demande de mode exige `evaluationmode.validate`, un proposant ne peut pas consulter sa propre demande via cette route). | 2026-09-29 | **CLOSED — rattrapage effectué, aucune vulnérabilité trouvée sur les 5 PR. Point de process non effacé par ce bon résultat : la revue aurait dû avoir lieu avant le merge, pas après.** |
| @architect @risk-manager | **CHALLENGE-001 rouvert le jour même : l'agrégation `Math.max` (PR #21) était une inversion de vocabulaire du PO, pas la bonne implémentation.** Architect a démontré par preuve code que sur le barème 1=Inadéquat→3=Adéquat, `Math.max` retient le MEILLEUR axe/ligne de défense, pas le pire — exactement l'inverse de ce que CHALLENGE-001 visait à corriger (pire que l'ancienne moyenne : celle-ci diluait le signal, MAX l'inversait). Risk Manager consulté, tranche net via le Three Lines of Defense Model : les 3 lignes de défense (L1 opérationnel/L2 risque-conformité/L3 audit interne) sont **non compensatoires** — une ligne faible ne peut jamais être masquée par une ligne forte, c'est le principe même du modèle (pas une préférence Djamo). MIN est la seule fonction cohérente avec ce principe ; confirmé mathématiquement équivalent entre MIN sur les 9 valeurs brutes et MIN par ligne puis MIN entre lignes. PO confirmé explicitement : `Math.max`→`Math.min` corrigé dans `RiskEvaluationService.ts`/`RatingScaleService.ts`/`RatingScale.ts` (`aggregation: "MIN"`), tests recalculés (pas devinés), 495/495 verts. **Revue sécurité indépendante non redispatchée pour ce correctif** : c'est un changement de sémantique symétrique (`Math.min` au lieu de `Math.max`, mêmes 9 valeurs, mêmes garde-fous déjà vérifiés par la revue PR#21 — longueur bornée par la config tenant, `assertIntegerInRange` avant calcul) sans nouvelle surface (aucune route, aucune permission, aucun accès donnée modifié) — propriétés de sûreté déjà confirmées CONFIRMED_SAFE s'appliquent à l'identique. | 2026-09-30 | **CLOSED — PR #22 mergée par le PO, `main` vert.** |
| @orchestrator @security | **CI/CD : scanners de sécurité ajoutés (2026-09-30), demande explicite du PO.** Le PO a d'abord demandé l'installation d'un package npm `herozion` — **refusé après vérification** : mainteneur anonyme (email personnel Yahoo), 4 versions publiées en moins d'une heure le 2026-09-29, aucune réputation/organisation établie, package se présentant comme outil de sécurité (vecteur classique d'attaque supply-chain) destiné à tourner en CI/CD avec accès aux secrets du pipeline. Décliné, alternatives établies proposées à la place. **Semgrep** (SAST, ruleset public `p/ci`, aucun token requis) et **Trivy** (scan de vulnérabilités des dépendances `package-lock.json`, seuil HIGH/CRITICAL, fait échouer le job) installés localement (pip / winget, sources officielles vérifiées) et ajoutés au workflow `.github/workflows/ci.yml` (nouveau job `security`). Semgrep non bloquant pour l'instant (résultats en SARIF uploadé en artefact, à trier avant de le rendre bloquant) ; Trivy bloquant dès maintenant. Un premier pin de version cassé (`trivy-action@v0.28.0`, référence un tag `setup-trivy` supprimé) trouvé et corrigé en vérifiant les tags réels du dépôt (`v0.36.0`) avant de committer, pas deviné. CI vérifiée verte sur les 3 jobs (backend/frontend/security) après correction. | 2026-09-30 | **CLOSED — CI verte, 0 finding Trivy HIGH/CRITICAL, 0 finding Semgrep sur le ruleset p/ci.** |
| @product-manager @architect | **Débat PO (2026-09-30) sur l'extensibilité de la nomenclature Djamo (9 processus/15 directions) avant propagation — 2 agents dispatchés indépendamment.** Convergence nette : `processes`/`departments` sont déjà de vraies entités (aucun enum codé en dur, ajouter un 10e processus = un `INSERT`), donc rien à construire pour l'extensibilité elle-même. Le vrai sujet est (1) gouvernance de création — `process.create`/`department.create` restent des permissions plates, écart assumé face au maker-checker déjà imposé sur le simple changement de mode (DECISION-006), pas de maker-checker à construire dessus maintenant (pas de 2e cas d'usage réel, doctrine CHALLENGE-002/DECISION-003) ; (2) contrat de rendu pour l'écran Cartographie réel (pas la maquette, jetable) — jamais de grille à N cases fixes, dimensionnement dérivé des données actives en base, règle explicite à N élevé (tri criticité + top-N + "Autres") à trancher une fois par le PO, critère d'acceptation avant que l'écran passe "prêt à coder" ; (3) le lien processus↔risque doit rester N:1 (DECISION-007) — précondition arithmétique de la validité de la grille de concentration, à écrire dans la spec Cartographie. **2 bugs réels trouvés par l'Architect au passage, hors périmètre de la question posée** : `ProcessService.archive` fait un soft-delete alors que la FK `process_id` est `NO ACTION` — un processus archivé référencé par des risques/contrôles devient irrésolvable en silence (le bon geste est `active=false`, pas soft-delete) ; aucune contrainte d'unicité `(tenant_id, name)` sur `processes`/`departments` (risque de doublons faussant le backfill par nom et la grille de concentration). Les deux transmis directement à l'agent en cours sur `ProcessService`/`CartographyService` (branche `feature/wire-processid-evaluationmode`, déjà ouverte sur les mêmes fichiers) pour correction avant sa PR. | 2026-09-30 | **Débat livré — nomenclature toujours `Ouvert` côté validation PO comme définitive (voir entrée `@product-manager` plus haut), mais le "comment anticiper" est tranché : rien à construire pour N, gouvernance de création et contrat de rendu Cartographie à écrire au moment de l'écran réel.** |
| @dev-backend | **"Fermer la boucle Processus" livré (2026-09-30), go PO explicite.** `risk.processId`→`Process.name` câblé dans `CartographyService`/`DashboardService` avec fallback explicite (jamais silencieux) sur `risk.process` texte via un champ `resolvedVia: "processId"\|"processText"` — écart assumé signalé : ni l'un ni l'autre service n'avait en réalité d'agrégation par processus avant ce lot (juste un champ d'affichage plat), le FK a été câblé dans ce champ plutôt que d'inventer une agrégation qui n'existait pas. `evaluationMode` résolu une seule fois à la création de l'évaluation (`RiskEvaluationService.create`, marche héritée processus→config tenant), stocké en instantané immuable (migration 034, `risk_evaluations.evaluation_mode` nullable), jamais retouché par les 3 setters de scoring — même traitement que `subCategory`/`entity`. **2 correctifs relayés par l'audit Architect intégrés** : `ProcessService.archive` refuse désormais si un risque/contrôle/demande de mode en attente référence encore le processus (garde, pas changement de sémantique du soft-delete existant) ; migration 035 ajoute l'unicité de nom — index plat `(tenant_id, name)` pour `departments`, mais **volontairement scopé aux fratries** (pas de parent, pas de niveau) pour `processes` : `backfillRiskProcessId.ts` documente déjà qu'un même nom peut légitimement exister à des niveaux/parents différents, un index plat aurait contredit un comportement déjà livré et intentionnel. 495→515 tests, 40 fichiers, verts. | 2026-09-30 | **CLOSED — PR #23 mergée par le PO (conflit avec PR #24 résolu au préalable, recombinant `AUTHORITATIVE_EVALUATION_STATUSES` et `evaluationMode`), migrations 034/035 appliquées sur la base de dev réelle et vérifiées.** |
| @security | **Revue indépendante PR #23 (2026-09-30).** Verdict : aucun finding bloquant. Garde `archive()` CONFIRMED_SAFE (couverture risques/contrôles/demandes de mode, tenant-scopée, pas de contournement par un autre chemin d'écriture — `getById` filtre déjà `deleted_at`). `resolvedVia` CONFIRMED_SAFE, toujours renseigné. Snapshot `evaluationMode` CONFIRMED_SAFE pour l'immuabilité (aucun `UPDATE` ne touche la colonne hors `create()`). Migrations 034/035 CONFIRMED_SAFE (Expand-only, `.down.sql` non destructifs). **3 findings LOW, non bloquants** : (1) `assertNoActiveReferences`+`softDelete` non transactionnels dans `archive()` — fenêtre TOCTOU théorique ; (2) dépendances optionnelles du constructeur `ProcessService` désactiveraient silencieusement la garde si un futur point de construction les omettait (aucun trou actif aujourd'hui, `server.ts` câble tout) ; (3) duplication volontaire et documentée de `resolveInheritedEvaluationMode` entre `ProcessService`/`RiskEvaluationService` — risque de dérive si l'un est modifié sans l'autre, un test de parité serait une bonne protection. | 2026-09-30 | **CLOSED — CONFIRMED_SAFE, 3 findings LOW consignés pour suivi ultérieur, aucun ne bloque le merge.** |
| @ux-designer @risk-manager @compliance @privacy | **Matrice widget × donnée × permission pour le Dashboard (PRIV-CH-DASH-001), 4 agents dispatchés indépendamment (2026-09-30).** UX propose ~14 widgets ancrés sur les 7 vues déjà calculées par `DashboardService` (aucune invention), avec sensibilité proposée par widget. Risk Manager confirme le pattern RISK_BLOCK déjà correct (`getMostRecentValidatedEvaluation` filtre `VALIDATED` à la source, pas un post-filtre) mais **trouve un vrai bug** : le filtre est codé en dur sur `"VALIDATED"` seul, **excluant silencieusement `VALIDE_COMITE`** (statut terminal distinct, atteint via `validateByCommittee`) — les risques les plus graves, escaladés au comité, disparaîtraient du classement executive comme s'ils n'avaient jamais été évalués. Signale aussi l'absence d'un champ `evaluationStatus` explicite dans `DashboardRiskSummary` (aujourd'hui juste `score: number|null`, indifférencié entre "jamais évalué" et "rejeté"). Compliance pose 8 règles dont plusieurs bloquantes avant code (RBAC vérifié par widget jamais en filtre a posteriori — converge avec l'avis Architect déjà donné le 2026-09-28 ; statut d'évaluation toujours visible ; périmètre LBC/FT à trancher explicitement widget par widget, silence actuel du CDC v0.1 ne doit pas se propager tacitement au dashboard). **Privacy refuse de lever PRIV-CH-DASH-001 seul** : le correctif `getById`/`RiskOwnershipService` tient (vérifié, pas de régression), mais pose une vraie question de conception non tranchée — `dashboard.executive` est aujourd'hui une permission binaire tenant-global, sans scope par entité/département ; un détenteur voit le détail nominatif de tous les risques toutes entités confondues (`ownerId`, `process`, `description` par risque, pas juste un agrégat). Condition de levée posée explicitement : la matrice doit trancher noir sur blanc si `dashboard.executive` reste tenant-global (acceptable si décision PO assumée) ou doit devenir scopé par entité (changement de modèle de permission à écrire avant le premier widget exécutif). | 2026-09-30 | **Décision PO reçue (b) : corriger VALIDE_COMITE maintenant, indépendamment — voir ligne @dev-backend ci-dessous (PR #24). Décision PO reçue (a) : scope configurable par rôle (GLOBAL/DEPARTMENT/PROCESS), voir ligne @architect ci-dessous — conception livrée, 2 points d'arbitrage PO restants avant code.** |
| @dev-backend | **Correctif VALIDE_COMITE livré (2026-09-30), go PO explicite.** `AUTHORITATIVE_EVALUATION_STATUSES = ["VALIDATED", "VALIDE_COMITE"]` introduit (`RiskEvaluation.ts`), `listForRisk` accepte un tableau de statuts (`= ANY($n::text[])`), 3 sites corrigés : `DashboardService.getMostRecentAuthoritativeEvaluation` (renommée), `CartographyService`, et **`RiskOwnershipService` — 3e site trouvé par grep exhaustif, même bug, pas explicitement demandé mais corrigé**. Champ `evaluationStatus` ajouté à `DashboardRiskSummary`/`CartographyDataPoint` (le gap signalé par Risk Manager). Priorité VALIDATED vs VALIDE_COMITE quand les deux existent dans l'historique d'un risque : la plus récente des deux gagne (tri `created_at DESC` déjà correct, testé dans les deux sens). `RiskEvaluationViewService` vérifié non affecté (lecture par id, pas de filtre statut). 495→505 tests, verts. | 2026-09-30 | **CLOSED — PR #24 mergée par le PO.** |
| @architect | **Conception du scope configurable `dashboard.executive` via RACI (2026-09-30), en réponse à la décision PO.** Citation PO : rôle→personne→département→processus, accès limité à ce dont on a la charge, configurable depuis la matrice RACI (GLOBAL/DEPARTMENT/PROCESS). **Constat structurel qui change la conception** : `User` n'a aujourd'hui aucun rattachement à un département — "scopé par département" signifiera donc "déduit de mes objets RACI + `Risk.ownerId`", pas "mon département d'appartenance" (les deux divergeront le jour où quelqu'un change de service ; la vraie sémantique d'appartenance est un chantier séparé, `users.department_id` + écran d'admin, pas à improviser ici). RACI confirmé toujours non câblé comme condition de lecture nulle part (juste lu), et `RaciAssignmentRepository` n'a aucune méthode "par utilisateur" — à ajouter. **Décision de conception assumée** : le scope vit sur `Role` (pas `Config` — un seul interrupteur tenant forcerait DG et chef de département au même périmètre), résolu à la lecture (jamais stocké), filtré en SQL (`WHERE ... = ANY($n)`, jamais un post-filtre — conforme à la règle Architect du 2026-09-28). Multi-rôles : le scope le plus large gagne (union). Périmètre vide = dashboard vide, jamais de repli sur GLOBAL. **PROCESS refusé à l'écriture** (valeur gardée dans l'énum) : `risks.process_id` n'a jamais été backfillé en pratique, brancher PROCESS dessus rendrait un dashboard vide pour tout le monde — livrer GLOBAL+DEPARTMENT seulement. Plan d'implémentation complet fourni (migration, domaine, repositories, résolveur transverse `DashboardScopeResolver`, câblage `DashboardService`, écriture via `RoleService`, observabilité, tests) — voir `SHARED_LOG.md` pour le détail intégral. | 2026-09-30 | **Arbitrages PO reçus.** (1) **R/A élargissent tout le périmètre** (département ou processus selon le mode) ; **I/C restent limités au niveau processus, même en mode DEPARTMENT** — "un Informé accède aux risques des processus sur lesquels il travaille, pas à tout le département". Règle affinée à implémenter, pas le binaire initialement proposé. (2) Anomalies orphelines confirmées exclues (fail-closed). **PO demande en plus de construire le rattachement réel `users.department_id`** (le "chantier séparé" que l'Architect recommandait de ne pas improviser dans ce lot) — lancé indépendamment du résolveur de scope, qui reste conçu comme prévu (dérivé RACI+ownerId, pas branché sur ce nouveau rattachement pour l'instant).** |
| @dev-backend | **Rattachement `users.department_id` (2026-09-30), go PO explicite, chantier séparé du scope Dashboard.** FK nullable Expand-only vers `departments`, pattern identique aux FK 029/031/032. `UserService` valide l'existence dans le tenant via `assertDepartmentExists` (lève si le repo n'est pas câblé, jamais de dégradation silencieuse). Ne câble PAS ce champ dans le résolveur de scope Dashboard (qui reste RACI+ownerId comme conçu) — juste la donnée elle-même. 495→500 tests, verts. | 2026-09-30 | **CLOSED — PR #25 mergée par le PO, migration 036 appliquée sur la base de dev réelle et vérifiée. 530/530 tests verts sur `main` après les 3 merges (PR #23/#24/#25).** |
| @dev-backend | **Lot 1 RACI clôturé — câblage dans Risk/Control/ActionPlan livré (2026-09-30), go PO explicite.** Nouveau `RaciEnrichmentViewService` (gabarit `*ViewService`, ADR-003) : `getRiskWithRaci`/`getControlWithRaci`/`getActionPlanWithRaci` composent le service d'écriture existant + `RaciAssignmentService.list()` (pas les repositories bruts — écart assumé : `ActionPlanService.get()` applique un `toView()` privé inaccessible au niveau repository, et court-circuiter `RaciAssignmentService` aurait dupliqué sa vérification `raci.read`/whitelist `entityType`). Nouvelles routes `GET /:id/raci` sur les 3 modules. **Principe RACI déclaratif (jamais autoritatif) respecté et prouvé par test, pas juste affirmé** : un acteur avec `risk.update` mais sans `raci.read` peut toujours écrire (seule la vue RACI lui est refusée) ; un acteur RACI Responsible sur un risque mais sans `risk.update` ne peut pas écrire. Tentation "seul le R peut modifier" rencontrée et explicitement évitée, signalée comme question ouverte pour un futur arbitrage PO, pas codée. 530→537 tests, verts. | 2026-09-30 | **CLOSED — PR #26 mergée par le PO. 537/537 tests verts sur `main`, typecheck propre. Pas de nouvelle migration (lot purement lecture).** |
| @dev-backend | **Scope configurable `dashboard.executive` livré (2026-09-30), implémente la conception Architect du même jour, go PO explicite.** Migration 037 (`roles.dashboard_scope_mode`, index `raci_assignments_tenant_user_idx`), `DashboardScope.ts`/`widestScopeMode`, `DashboardScopeResolver` (dérivé RACI+`ownerId`, jamais stocké), câblé dans les 5 méthodes `dashboard.executive` de `DashboardService`. Règle de graine R/A (élargit tout le périmètre) vs I/C (limité au niveau processus même en mode DEPARTMENT) implémentée telle que précisée par le PO. Anomalies orphelines exclues du comptage scopé, multi-rôles = le plus large gagne, périmètre vide ≠ repli GLOBAL, PROCESS gardé dans l'énum mais rejeté à l'écriture (`RoleService`) tant que le backfill `process_id` n'est pas fait. 537→558 tests, verts. **2 écarts assumés et documentés, pas cachés** : (1) `getAppetiteVsResidual` scope le jeu de risques sous-jacent mais n'expose pas encore le champ `scope` dans sa réponse (évite un changement de forme d'API cassant pour un ajout informationnel) ; (2) **les KRI ne sont PAS filtrés par le scope** — le plan de l'Architect ne nommait que `RiskRepository`/`RaciAssignmentRepository`/`ActionPlanListFilters` comme repositories à étendre, pas `KriRepository` ; `getKriConsolidated` expose le champ `scope` pour la cohérence UI mais retourne toujours tous les KRI du tenant, quel que soit le mode. | 2026-09-30 | **CLOSED — voir ligne @security ci-dessous pour le verdict et le correctif.** |
| @security | **Revue indépendante PR #27 (2026-09-30).** Verdict : 7/8 points CONFIRMED_SAFE (tenant-scoping du résolveur, filtre SQL pas en mémoire, périmètre vide ≠ repli GLOBAL, `widestScopeMode` dans le bon ordre, chemin legacy `users.roles` correctement isolé, `RoleService` rejette bien PROCESS sans contournement possible, migration 037 Expand-only). **1 finding HIGH confirmé (CWE-863)** : `getKriConsolidated` résolvait le scope et l'exposait dans sa réponse mais ne filtrait jamais `kris.list()` avec — un détenteur de `dashboard.executive` en mode DEPARTMENT/PROCESS recevait les KRI de tout le tenant via ce seul endpoint, alors que la réponse suggérait un périmètre respecté. | 2026-09-30 | **CLOSED — correctif confirmé présent sur `main` (`DashboardService.ts:744-751`, filtre `riskIds`), vérifié directement après une coupure de session (voir note ci-dessous).** |
| @orchestrator | **Rattrapage après coupure de session (2026-09-30) — confusion de branches réelle, corrigée par vérification directe, pas supposée.** Une coupure de contexte (limite d'usage atteinte puis reset) a fait perdre la trace de plusieurs PR (28-34) jamais journalisées ici. Reconstitué par lecture directe de `gh pr list`/`gh pr view`/grep sur le code de `main`, pas par confiance dans les statuts "merged" seuls (plusieurs PR ciblaient une branche féature déjà mergée — `feature/dashboard-scope-resolver` — au lieu de `main`, créant des merges "réussis" qui n'atteignaient jamais la production) : **PR #28/#29/#30/#32 mergées dans une branche orpheline, jamais répercutées sur `main`** ; **PR #33 (validation utilisateur cible RACI cross-tenant) reconstruite directement depuis `main` et réellement mergée** — confirmé présent dans le code (`RaciAssignmentService.ts:69`) ; **le correctif KRI (finding HIGH de la revue PR #27) est bien sur `main`** malgré la confusion de branches (confirmé par grep direct) ; **le durcissement des uploads Evidence (validation de signature + compensation Drive/DB) n'a PAS atteint `main`** — PR #34 en attente, reconstruite proprement depuis `main`, CI verte, `mergeable: CLEAN`. 565/565 tests verts sur `main`, typecheck propre, vérifié directement après la coupure. | 2026-09-30 | **CLOSED — PR #34 mergée entre-temps par le PO. 573/573 tests verts sur `main`, typecheck propre, migration 037 appliquée et vérifiée sur la base de dev réelle. Toutes les PR de la session sont maintenant réellement sur `main`.** |
| @security (PO) | **Sprint de durcissement sécurité complet mené directement par le PO pendant une coupure de session (2026-09-30), PR #35 à #43 + #54, toutes mergées.** Revue faite après coup, à posteriori, pas pilotée par l'orchestrateur — inventaire : (35) intégrité de l'audit sur la suppression d'Evidence (ordre soft-delete→audit→corbeille Drive, restauration si l'audit échoue) ; (36) `audit_log` verrouillé append-only **au niveau PostgreSQL** (REVOKE UPDATE/DELETE/TRUNCATE + triggers, pas seulement au niveau applicatif — défense en profondeur réelle, migration 038) ; (37) garde-fou de démarrage production : refuse de démarrer si le rôle DB connecté est SUPERUSER/propriétaire/peut créer rôles ou bases/écrit dans `public` ; (38) séparation des identifiants DB migration vs runtime (Cloud Run n'utilise que `DATABASE_URL`, refuse `MIGRATION_DATABASE_URL` en prod) ; (39) toutes les GitHub Actions de la CI épinglées par SHA complet (Semgrep avait trouvé 8 findings bloquants sur des tags mutables — corrigé) ; (40) Gitleaks ajouté en scan bloquant (secrets, historique complet inclus) ; (41) Cloud Run : Node 20 EOL → Node 24 LTS, clé JSON Google Drive remplacée par l'identité de service Cloud Run/ADC en prod ; (42) `permissions: contents: read` par défaut sur tout le workflow CI ; (43) Dependabot ajouté (npm racine+backend, Docker, GitHub Actions, Semgrep), lockfile frontend versionné et utilisé via `npm ci` au lieu d'être resolu à neuf à chaque run ; (54) gate Dependency Review restauré (bloquant sur vulnérabilité HIGH+, épinglé par SHA). **Vérifié directement, pas supposé** : 608/608 tests verts sur `main`, typecheck propre, migration 038 appliquée sur la base de dev réelle. | 2026-09-30 | **CLOSED — travail de qualité, aucune action requise de ma part. Noté pour mémoire : c'est le PO qui a piloté ce sprint sécurité de bout en bout, pas moi — première fois cette session qu'un chantier substantiel avance sans orchestration de ma part.** |
| @security (PO) | **Trou réel trouvé par le PO, raté par ma propre revue indépendante de PR #27 du même jour (2026-09-30) — PR #55, ouverte, CI verte, pas encore mergée.** Ma revue n'avait vérifié le filtrage KRI que sur l'endpoint dédié `getKriConsolidated` (corrigé, PR #28). Elle n'avait pas vérifié que `getExecutiveView`/`getRiskCommitteeReport`/`getConsolidatedReport` appellent séparément `getAllKriSummaries(tenantId)` **sans aucun filtre de scope** (`DashboardService.ts:519,560,611` — confirmé par lecture directe) — donc un détenteur de `dashboard.executive` en mode DEPARTMENT/PROCESS voyait quand même les KRI critiques de tout le tenant sur ces 3 endpoints, malgré les risques eux-mêmes correctement scopés. PR #55 corrige les 3 sites, ajoute un test de régression qui vérifie que le repository reçoit bien les `riskIds` attendus, échoue fermé (jamais un tableau vide passé comme "pas de filtre"). CI verte (backend/frontend/security/dependency-review), `mergeable: CLEAN`. | 2026-09-30 | **CORRECTIF DE STATUT (2026-09-30, plus tard le même jour) : j'avais écrit par erreur "PR #55 mergée" sans l'avoir vérifié via `gh pr view` — FAUX, corrigé après vérification directe. PR #55 reste OUVERTE, CI verte, mergeable — le trou P0 (`getAllKriSummaries(actor.tenantId)` sans filtre dans `getExecutiveView`/`getRiskCommitteeReport`/`getConsolidatedReport`) est toujours présent sur `main` au moment de cette correction.** Leçon retenue et documentée (`RETEX_MULTI_AGENTS.md` §10) : ma revue de sécurité n'avait vérifié qu'un seul appelant de la fonction à risque, pas tous les appelants du fichier. **Deuxième leçon, celle-ci sur le suivi lui-même** : ne jamais écrire "mergée" sans avoir vérifié `mergedAt` via `gh pr view` — un statut de suivi non vérifié est aussi dangereux qu'un finding de sécurité non vérifié.** |
| @security (PO) | **Audit externe complet reçu du PO (2026-09-30), 4 documents, périmètre = PR #27 au commit `81c41db` (avant PR #28-#43/#54).** Cahier des charges de tests de sécurité (référentiels OWASP/ASVS/NIST SSDF/CIS/Cloud/PostgreSQL, ~130 tests SEC/AUTH/RACI/GRC/EVD/WEB/AUD/DB/SUP/INF/RES), 2 rapports d'audit technique (8+4 constats, tous confirmés par lecture de code), SARIF Semgrep (8 résultats, tous la même règle `github-actions-mutable-action-tag`). Copiés dans `docs/security/external-audit-2026-09-30/` avec un README qui recoupe chaque constat contre l'état réel de `main` au moment de la lecture (vérifié par grep direct, pas supposé) : **8 des 10 constats déjà corrigés** par le sprint sécurité du PO (PR #28-#43/#54, voir entrée plus haut) — KRI scope, RACI cross-tenant, audit append-only PostgreSQL, Semgrep bloquant+SHA pinning, lockfile frontend, signature de fichiers Evidence, compensation Drive/DB, rôles DB least-privilege. **2 constats réels toujours ouverts, vérifiés par lecture directe** : (1) `RaciAssignmentService.assign`/`revoke` exécutent `raci.create()`/`raci.remove()` **avant** `audit.record()`, sans transaction commune ni compensation si l'audit échoue après la mutation (`RaciAssignmentService.ts:75-116`) — Evidence a reçu ce traitement (PR #32/#35), pas RACI ; (2) aucun durcissement HTTP (`helmet`, rate limiting) — absent de `server.ts`/`package.json`. **La campagne de tests de sécurité elle-même (le cahier des charges, ~130 tests) n'a pas été exécutée** — c'est un plan de plusieurs semaines, pas un backlog à clôturer d'un coup ; les tests P0 (SEC-001 à SEC-012, DASH-001 à DASH-010) sont désignés par le document lui-même comme la priorité de la Phase 1. | 2026-09-30 | **Points (1) et (2) CLOSED — voir ligne @security ci-dessous (PR #58). Point (3) toujours ouvert — campagne de tests non lancée.** |
| @security | **Correctifs des 2 constats restants livrés (2026-09-30), PR #58.** RACI : `assign()`/`revoke()` compensent maintenant (`raci.remove()`/`raci.restore()`) si `audit.record()` échoue après la mutation, erreur explicite (`AggregateError`) si la compensation elle-même échoue — pattern Evidence (PR #32/#35) repris plutôt qu'une transaction DB partagée (aucun mécanisme cross-repository aujourd'hui entre `RaciAssignmentRepository`/`AuditRepository`, en ajouter un pour ce seul appelant aurait été plus risqué). HTTP : `helmet` ajouté (CSP/COEP/CORP assouplis pour ne pas casser le SPA + Google Identity), rate limiting sur les échecs `/api/v1` + seuil plus strict sur upload Evidence/import Excel — **couverture partielle assumée** : pas toutes les opérations coûteuses (exports/recherches), store en mémoire donc par instance (pas de garantie multi-réplica Cloud Run sans store partagé). **Doublon géré proprement** : l'agent a trouvé une PR #56 déjà ouverte sur le même sujet (run précédent non journalisé), cherry-pické ses commits plutôt que de redévelopper, commenté sur #56 pour recommander #58 à sa place. 608→613 tests, verts. | 2026-09-30 | **PR #58 ouverte, CI en cours — en attente de merge PO. Fermer/ignorer PR #56 (doublon).** |
| @security (PO) | **Plan de continuation sécurité complet reçu du PO (2026-09-30), après lecture du sprint de durcissement.** Archivé intégralement dans `docs/security/external-audit-2026-09-30/plan-continuation-po-2026-09-30.md` — c'est le PO qui pilote ce séquencement, pas une proposition d'agent. Résumé : après PR #41 (Cloud Run baseline), la suite voulue est GitHub Actions least-privilege → dépendances/supply chain → CodeQL/SAST approfondi (SQLi, XSS, SSRF, path traversal, command injection, authz bypass, IDOR, open redirect, prototype pollution, désérialisation, fuite d'info) → HTTP/API → Auth/RBAC/IDOR → Logging/PII → Docker/SBOM/provenance → Google Cloud IAM réel → Secret Manager réel → Neon roles réels → Monitoring → tests de sécurité finaux → revue de clôture. **Correction factuelle faite par le PO sur PR #55/#56/#57** : les 3 sont vertes et fusionnables mais **aucune n'était encore mergée** au moment du plan (confirmé par vérification directe, voir correctif de statut ci-dessus) — PR #57 (`enforce Semgrep findings and Dependabot cooldowns`, jusque-là inconnue de ce suivi) corrige 5 findings Semgrep liés à l'absence de cooldown Dependabot sur les 5 écosystèmes configurés, et ajoute `--error` à Semgrep pour le rendre réellement bloquant. **Actions immédiates listées par le PO** : (1) revue/merge PR #55/#56/#57 ; (2) activer la protection native GitHub des secrets (bouton "Enable" visible, Gitleaks CI ne suffit pas) ; (3) vérifier la protection de branche `main` (PR obligatoire, review, pas de bypass admin) — non confirmable depuis le dépôt seul ; (4) antivirus/quarantaine des preuves, aucun contrôle dédié visible sur le flux Drive ; (5) DAST/API en staging autorisé ; (6) restauration PostgreSQL réelle + mesure RPO/RTO. **Vérifié directement par moi (2026-09-30, immédiatement après réception du plan)** : secret scanning natif GitHub + push protection étaient bien désactivés — **activés dans la foulée** (`gh api` PATCH, aucun risque de casse). Protection de branche `main` confirmée **désactivée** (`gh api .../branches/main/protection` → 404 "Branch not protected") — push direct sur `main` toujours possible, aucune review/CI obligatoire. Aucun fichier `CODEOWNERS`, aucun workflow CodeQL. **Repo confirmé PUBLIC** — à signaler explicitement, pas noté avant dans ce suivi. | 2026-09-30 | **Ouvert — transmis à l'agent Security comme périmètre continu. La protection de branche `main` (bloquerait les commits directs de doc utilisés toute la session) n'a PAS été activée sans confirmation explicite du PO — voir échange en cours.** |
| @architect @dev-backend | **GAPS FRONTEND RM V1 — set ouvert, alimenté lot par lot (démarré 2026-10-06, Lot 1 Évaluations).** Jean-Philippe a demandé de compiler tous les gaps backend trouvés en reconstruisant les pages métier du contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` avant de les traiter en bloc, plutôt qu'un STOP isolé par lot. Trouvés jusqu'ici, confirmés par grep sur `backend/src` et `database/postgresql/migrations` (zéro résultat à chaque fois), aucun contournement frontend tenté : **(1) `RiskFramework`/`risk_frameworks` (Dispositif, §10) — inexistant, bloque entièrement la page "Dispositif de risque", traité comme hors périmètre frontend tant que non livré.** **(2) Contribution (§7, Signalement/Identification/Analyse/Inherent/Maîtrise distinctes d'une Cotation) — aucune entité/endpoint, page Évaluations affiche une bannière de gap honnête à la place.** **(3) Treatment Decision (§8, Accepter/Surveiller/Réduire/Transférer/Éviter, rattachée à l'évaluation qui l'a déclenchée, 2 seuils Comité indépendants) — livré (Lot A/B backend sur staging, Lot C frontend intégré dans `EvaluationPage.tsx`, 2026-10-06), gap refermé.** **(4) Mode `HYBRIDE` (§7) — `EvaluationMode` backend n'a que `CLASSIQUE`/`PARTICIPATIF`, 3e mode du contrat absent.** **(5, non bloquant) `Risk.ts` n'a pas de champs structurés causes/événements/impacts potentiels pour l'Analyse (§4) — seuls `description` libre et les contrôles couvrants (DIV-07) existent et sont affichés, rien inventé.** **(6, Lot 2 Appétence, 2026-10-06) Seuil de passage Comité de l'Évaluation (§8) non configurable — `COMMITTEE_VALIDATION_MIN_SCORE = 15` est une constante codée en dur dans `RiskEvaluationService.ts` (ligne 30), jamais lue depuis une config tenant ni exposée par une API ; le contrat exige explicitement que ce seuil soit configurable côté backend.** **(7, Lot 2 Appétence, 2026-10-06) Seuil de passage Comité de la Treatment Decision (§8) — totalement absent, cohérent avec l'absence de Treatment Decision elle-même (gap 3) ; les deux seuils Comité ne peuvent donc pas être aujourd'hui indépendants puisqu'un seul existe, et celui-ci n'est pas configurable (gap 6).** Page Appétence (`AppetitePage.tsx`) n'affiche ni ne permet d'éditer aucun seuil Comité — seul le seuil de score (1-25) par sous-catégorie/entité (contrat déjà existant, `RiskAppetite`) est géré, avec bannières honnêtes référençant ces deux gaps plutôt qu'une UI inventée. **(8, Lot 3 Grilles de cotation, 2026-10-06) `probabilityLabels`/`impactLabels` (libellés de la grille N×N elle-même, distincts des axes d'impact) ne sont acceptés qu'à la création (`CreateRatingScaleBody`, `ratingScales.routes.ts`) — aucun `PUT` dédié n'existe pour les modifier ensuite, contrairement aux autres sous-configurations (seuils, axes, vélocité, persistance, maîtrise) qui ont chacune leur endpoint, y compris en DRAFT où R-01 autorise la mutation. Confirmé par grep sur `ratingScales.routes.ts`/`RatingScaleService.ts` (zéro route `probability-labels`/`impact-labels`). `RatingScalesPage.tsx` (Lot 3) affiche ces libellés en lecture seule avec une bannière référençant ce gap, sans endpoint inventé.** **(9, Lot C UI Treatment Decision, 2026-10-06) `TreatmentDecisionService.getForEvaluation` (0..1, par `riskEvaluationId`) n'est exposé par aucune route — `treatmentDecisions.routes.ts` n'a que `GET /?riskId=` (scope risque, pas évaluation) et `GET /:id`. Contourné sans aucun contrat inventé : le frontend appelle `listForRisk` (le vrai contrat) puis filtre côté client par `riskEvaluationId` (`decisionsForEvaluation`, pure fonction, aucune règle métier) — le tri `created_at DESC` déjà fait par `PostgresTreatmentDecisionRepository.listForRisk` donne directement l'élément actif en position 0. Non bloquant aujourd'hui (volume de décisions par risque faible), à surveiller si ce volume augmente : prévoir alors le vrai endpoint plutôt que de pousser plus loin le filtrage client.** Liste vouée à grossir au fil du lot Registre — ne pas la traiter item par item avant le GO explicite du PO sur l'ensemble. | 2026-10-06 | **Mise à jour 2026-10-08 (passage Architecte)** — gap (9) **fermé** : `GET /api/v1/risk-evaluations/:id/treatment-decision` existe (`riskEvaluations.routes.ts:189-199`), le filtrage client peut passer à la vraie route ; gap (6) **fermé** par le Lot A (seuil désormais lu depuis la configuration, `RiskEvaluationService.ts:38-39`, `:586-595`). Restent (1) RiskFramework/Dispositif, (2) Contribution et (4) HYBRIDE — cadrés, en attente des OD-1 à OD-11 —, (5) champs Analyse (OD-10, hors lot), (8) labels grille N×N. |
| @architect (HUMAN/@risk-manager à trancher) | **Traduction technique Treatment Decision (§8) — rapport Architecte livré (2026-10-06), 9 Open Decisions bloquantes/non-bloquantes, aucun code écrit.** Mandat : concevoir `TreatmentDecision`/`treatment_decisions` (pattern retenu : append-only à la `RiskEvaluation`, pas ticket lifecycle à l'`Anomaly` — le suivi d'exécution reste sur `ActionPlan`) + rendre les deux seuils Comité (§8) configurables via deux colonnes sur `Config` (pas `RiskAppetite`, pas de table dédiée) derrière une permission `config.committeethreshold.set` dédiée, raison obligatoire. Plan en 3 lots gatés : **Lot A (seuils configurables) GO immédiat**, faisabilité élevée, `ConfigRepository` déjà injecté dans `RiskEvaluationService`, fallback 15 garantit zéro régression ; **Lot B (`TreatmentDecision` CRUD) NO-GO tant que OD-1/2/3/5 ne sont pas tranchées** ; **Lot C (UI) après Lot B + Penpot**. **9 Open Decisions, à trancher par toi (métier = @risk-manager en appui)** : OD-1 (la décision peut-elle naître dès le résiduel coté, évaluation encore BROUILLON, ou seulement après validation finale ?) ; OD-2 (qui a le droit de créer/valider — Risk Owner, évaluateur, rôle Comité ?) ; OD-3 (une décision rejetée est-elle re-tentable sur la même évaluation, ou le rejet force-t-il une réévaluation §12 ?) ; OD-4 (**change un flux déjà livré au Lot 1** — le seuil Comité Évaluation reste-t-il un simple plancher d'accès comme aujourd'hui, ou devient-il une obligation qui bloque `validate()` au-dessus du seuil ?) ; OD-5 (un seuil Comité Treatment Decision non configuré = fail-closed "aucun passage possible" ou fail-open "tout passe" ? recommandation Architecte : fail-closed) ; OD-6 (l'option "Accepter" au-delà de l'appétence exige-t-elle systématiquement un passage Comité ?) ; OD-7 (date cible/responsable/échéance sur la décision, ou exclusivement sur `ActionPlan` ? recommandation Architecte : exclusivement `ActionPlan`) ; OD-8 ("Réduire"/"Transférer" doivent-ils obligatoirement générer un `ActionPlan` avant validation de la décision ?) ; OD-9 (seuil Comité tenant-wide — recommandation Architecte — ou par sous-catégorie/entité comme `RiskAppetite` ?). Détail complet des 9 écarts techniques (E-1 à E-9) et du schéma de données proposé : voir le rapport Architecte du 2026-10-06 dans l'historique de session (non fichier séparé à ce stade). | 2026-10-06 | **Conception finalisée par l'Architecte (round 2, 2026-10-06) — Lot A et Lot B tous deux GO, aucune Open Decision bloquante restante.** `Risk.superiorOwnerId` (ACT-122) confirmé réutilisable tel quel pour le N+1 (OD-2) — snapshoté à la proposition comme `RiskEscalation` le fait déjà, jamais re-dérivé. OD-1 (création après validation finale uniquement) simplifie le modèle : l'évaluation étant alors immuable, aucun snapshot de score n'est nécessaire sur `TreatmentDecision`, une simple FK suffit. OD-4 → 3 colonnes sur `Config` en une seule migration (045) : `committeeEvaluationMinScore` (défaut 15, zéro régression de valeur), `committeeTreatmentMinScore` (NULL par défaut = fail-closed OD-5), `committeeEvaluationEnforced` (booléen, défaut `true`) ; 2 permissions dédiées (`config.committeethreshold.set` pour les seuils, `config.committeeenforcement.set` séparée pour le toggle — désactiver l'obligation Comité est un acte de gouvernance, pas un réglage anodin). **Effet de bord important du Lot A** : il ferme aussi E-1 (le contournement du Comité via `validate()`) puisque le défaut livré est `enforced=true` — donc Lot A **change le comportement d'un flux déjà livré au Lot 1 frontend**, pas un simple ajout ; le frontend doit gérer le nouveau refus de `validate()` et rediriger vers `validate-committee`, et un passage QA+Security ciblé est requis après merge. OD-3 (rejet re-tentable) réglée par le pattern lui-même (append-only façon `ProcessEvaluationModeRequest` : une nouvelle tentative = une nouvelle ligne, jamais une réécriture) — n'était donc pas vraiment bloquante. OD-6/7/8/9 confirmées non bloquantes (gardes de service additives, pas de changement de schéma). **Nouveau constat non bloquant, E-10** : `RiskEvaluationService.create` n'impose pas `evaluatorId === Risk.ownerId` alors que le contrat §5/§7 l'exige — non corrigé ici (la garde G4 de la Treatment Decision rend le maker-checker robuste sans ce durcissement), à traiter avec le gap Contribution (2/4). Plan final : **Lot A (backend, seuils+toggle+garde validate()) → Lot B (backend, TreatmentDecision CRUD, dépend de A mergé) → Lot C (frontend, dépend de B + Penpot)**. Rappel opérationnel : prochaine migration = **045** (collision déjà connue sur 044, ne pas déduire le numéro visuellement). **Lot A et Lot B livrés et sur `staging` (2026-10-06)** — migrations 045/046 créées, non exécutées contre aucune base. **Point critique non traité, à faire avant tout usage réel** : le frontend Lot 1 (déjà en production sur staging) appelle `validate()` sans gérer son nouveau refus pour un score ≥ seuil — un utilisateur QA tombant sur ce cas verra une erreur générique au lieu d'être redirigé vers le Comité. Lot C (UI Treatment Decision) reste NO-GO tant que Penpot n'est pas fait, mais ce point-ci est un correctif minimal et urgent, indépendant de Lot C.** |
| @architect (HUMAN) | **E-1 — finding sur du code déjà livré, pas seulement sur la conception Treatment Decision (signalé explicitement par l'Architecte comme méritant sa propre ligne, 2026-10-06).** Le "seuil de passage Comité" (§8, `RiskEvaluationService.validateByCommittee`, seuil 15) n'est aujourd'hui qu'un **plancher d'accès** à la validation Comité — rien n'empêche `validate()` (permission `riskevaluation.validate`, largement distribuée) de finaliser directement une évaluation à un score ≥ 15 en `VALIDATED` **sans jamais passer par le Comité**. Un détenteur de `riskevaluation.validate` contourne donc entièrement la barrière `riskevaluation.validate.committee` — même famille que SEC-013/SEC-014 (action terminale à enjeu atteignable par une permission plus faible que celle prévue). Rendre le seuil configurable (Lot A ci-dessus) ne corrige pas ce gap, il le rend seulement paramétrable. Correctif technique s'il est confirmé : `validate()` refuse si `residualScore >= committeeEvaluationMinScore`, message renvoyant vers `/validate-committee` (même forme que la garde `RiskService.update`/`ControlService.update` contre `status: "ARCHIVED"`). **Mais corriger ceci change le comportement d'un flux déjà livré et consommé par le frontend du Lot 1** — c'est exactement OD-4 ci-dessus, séparé ici parce que c'est un constat de sécurité sur l'existant, pas seulement une option de conception du nouveau lot. | 2026-10-06 | **Résolu par conception (round 2) — corrigé en effet de bord du Lot A `committeeEvaluationEnforced` (défaut `true`). Reste à livrer en code ; voir entrée ci-dessus pour le plan.** |
| @architect | **E-10 — `RiskEvaluationService.create` n'impose pas `evaluatorId === Risk.ownerId` (trouvé en concevant la Treatment Decision, 2026-10-06).** Le contrat §5/§7 exige que le Risk Owner soit le seul décideur des cotations Inhérent/Résiduel et que les contributeurs ne cotent jamais à sa place, mais la seule garde d'entrée de `create` est la permission `riskevaluation.create` — n'importe quel détenteur peut devenir `evaluatorId`. Non bloquant pour Treatment Decision (sa garde G4 — le N+1 du Risk Owner ne peut pas être aussi le proposant — rend le maker-checker robuste indépendamment de qui a évalué). Aujourd'hui sans conséquence pratique : aucun chemin de code ne permet à un "contributeur" de coter puisque la Contribution elle-même n'existe pas (gaps 2/4 ci-dessus) — mais à corriger dans le même lot que ces deux gaps, pas isolément. | 2026-10-06 | **Ouvert — non bloquant, à traiter avec les gaps Contribution (2) et mode HYBRIDE (4).** |
| @architect @risk-manager (HUMAN à confirmer) | **E-11 — `validateByCommittee` de la Treatment Decision n'empêche pas l'auto-validation par le proposant (trouvé par dev-backend en implémentant le Lot B, 2026-10-06).** Les gardes G1-G9 conçues par l'Architecte protègent explicitement la voie de validation ordinaire (`confirm`/`invalidate` : G5 impose `actor.userId === decision.validatorId`, le N+1 snapshoté — le proposant ne peut jamais être son propre validateur, G4 l'empêche dès la création). Mais la voie Comité (`validateByCommittee`, permission dédiée `treatmentdecision.validate.committee`) n'a **aucune garde équivalente** dans la spec — seuls G6 (statut PROPOSEE) et G8/G9 (seuil configuré et atteint) la protègent. Rien n'empêche donc techniquement le proposant lui-même, s'il détient par ailleurs `treatmentdecision.validate.committee`, de valider sa propre décision en Comité. Implémenté strictement selon le mandat (qui ne mentionnait pas cette garde) — dev-backend l'a signalé explicitement comme un point à confirmer plutôt que de trancher seul ou de l'ajouter sans mandat. Question : absence volontaire (le Comité est une instance collégiale distincte, pas un rôle individuel, donc "le proposant est aussi au Comité" est un cas normal et attendu) ou oubli de spec (même maker-checker que la voie ordinaire attendu partout) ? | 2026-10-06 | **Résolu — PO arbitre pour la cohérence (garde ajoutée, pas d'exception collégiale). Corrigé avant merge, sur `staging` (PR #106, test de régression G4-bis dédié).** |
| @security @devops | **SEC-017 — jetons Bearer en clair dans les logs Render (trouvé 2026-10-08, lecture des logs du backend staging via le connecteur Render).** `server.ts` appelait `pinoHttp()` sans `redact` : chaque requête authentifiée écrivait l'en-tête `Authorization` complet dans les logs (constaté sur le compte QA `qagrctest`). Correctif code : `api/middleware/httpLogger.ts` retire `authorization`/`cookie`/`set-cookie` des logs, test `httpHardening.test.ts` (échoue sans le correctif). **Reste côté HUMAN** : les jetons déjà écrits dans les logs (rétention Render) restent lisibles jusqu'à expiration — faire tourner `LOCAL_AUTH_TOKEN_SECRET` sur staging (invalide tous les jetons locaux émis) après déploiement du correctif. | 2026-10-08 | **Résolu (2026-10-08)** — PR #116 déployée, `LOCAL_AUTH_TOKEN_SECRET` staging changé par HUMAN. **Confirmé sur logs réels** : 100 requêtes `/api/v1` authentifiées (13:23-13:26 UTC) relues, aucune ne contient d'en-tête `authorization` ni de jeton `Bearer`. |
| @security @devops | **SEC-018 — quota d'échecs du rate limiter partagé par tous les utilisateurs (trouvé 2026-10-08, logs Render : `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`).** Express ne faisait confiance à aucun proxy, donc `req.ip` = l'adresse du proxy pour tout le monde : 50 requêtes en échec en 15 min, de n'importe qui, bloquaient l'API pour tous. Correctif code : nouvelle variable `TRUST_PROXY_HOPS` (`env.ts`, défaut 0 = comportement inchangé en local/tests), `app.set("trust proxy", …)` dans `server.ts`. Valeur vérifiée sur la chaîne réelle observée sur Render (Cloudflare → proxy Render → proxy local) : **3**. Test ajouté (quota distinct par client). | 2026-10-08 | **Résolu (2026-10-08)** — PR #116 déployée, `TRUST_PROXY_HOPS=3` défini par HUMAN. **Confirmé sur logs réels** : plus aucune erreur `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` depuis le déploiement. Voir l'entrée « Permissions RM V1 » ci-dessous pour un effet de bord sur le quota (les 403 le consomment). |
| @dev-db @devops (HUMAN) | **Migrations 045 (`committee_thresholds`) et 046 (`treatment_decisions`) jamais appliquées sur Neon staging (constaté 2026-10-08, `schema_migrations` lu en lecture seule).** Le code des Lots A/B/C est sur `staging` mais la base s'arrête à 044 : écrans seuils Comité et Décision de traitement non fonctionnels sur l'environnement déployé, E-1/E-11 fermés dans le code mais pas en exécution. Cause racine : aucune étape du déploiement Render n'applique les migrations. Contrainte PO maintenue : aucun agent n'applique de migration. Note annexe : deux fichiers portent le numéro 044 (`044_audit_log_escalate`, `044_risk_idempotency`) — contraire à la règle de numérotation de `CLAUDE.md`, sans casse aujourd'hui (le runner trie par nom de fichier). | 2026-10-08 | **Résolu (2026-10-08)** — 045/046 appliquées par HUMAN via `npm run migrate` avec le rôle `grc_migrator_runtime` (vérifié : `schema_migrations` jusqu'à 046, colonnes `committee_*` présentes, `treatment_decisions` détenue par `grc_migrator_runtime`). **Défaut découvert au passage** : sur Neon staging (pas en production, vérifié), la règle `ALTER DEFAULT PRIVILEGES` de la migration 043 n'était pas enregistrée pour `grc_migrator_runtime`, donc `grc_app_runtime` n'avait aucun droit sur `treatment_decisions`. Corrigé par HUMAN dans l'éditeur SQL Neon (`GRANT` sur la table + `ALTER DEFAULT PRIVILEGES FOR ROLE grc_migrator_runtime`), vérifié en lecture seule. Automatisation des migrations décidée par le PO le 2026-10-08 (DECISION-009) : workflow `.github/workflows/migrate.yml` livré ; Environments GitHub `staging`/`production` et leurs secrets créés par HUMAN le 2026-10-08. **Testé de bout en bout le 2026-10-08** lors de la promotion `staging` → `main` (PR #120) : le workflow « Migrate database #1 » a attendu l'approbation de HUMAN sur l'Environment `production` (relecteur obligatoire), puis appliqué 044 ×2, 045 et 046 sur Neon production à 15:35 UTC ; le backend Render de production, passé en `autoDeployTrigger=checksPass`, n'a démarré son déploiement qu'après (15:35:11) — jamais de nouveau code sur l'ancien schéma. |
| @devops (HUMAN) | **Déploiement backend staging de la PR #109 en échec (`update_failed`, 2026-10-07 00:13 UTC, « Port scan timeout reached »).** La version de la PR #108 reste en ligne. PR #109 ne touche pas le backend : probablement un démarrage trop lent sur le plan gratuit Render. Constat lié : latence ~1,1 s par requête, la base Neon est en `aws-us-east-2` alors que les services Render sont à Frankfurt (chaque requête SQL traverse l'Atlantique) ; base de production Neon non protégée, rétention d'historique 6 h. | 2026-10-08 | **Partiellement résolu (2026-10-08)** — backend staging redéployé avec succès (PR #116, `live`). **Reste Ouvert — HUMAN** : arbitrer région Neon (us-east-2) vs Render (Frankfurt), plan Render payant pour la production, protection et rétention de la base de production Neon. |
| @architect @security (HUMAN) | **Permissions Risk Management V1 jamais attribuées sur staging (constaté 2026-10-08 en relisant les premières requêtes réelles après la PR #116).** Aucun des 8 utilisateurs de staging ne détient `treatmentdecision.read/create/validate/validate.committee` ni `config.committeethreshold.set` (Lots A/B) : les droits passent tous par la colonne héritée `users.roles` (44 permissions identiques chacun), la table `roles`/`user_roles` est vide. Conséquence : l'écran Décision de traitement renvoie 403 (`GET /api/v1/treatment-decisions` → 403, 4 fois en 3 min), de même que `GET /api/v1/users` (manque `user.read`) et l'archivage d'une appétence (manque `riskappetite.delete`). Effet de bord : chaque 403 consomme le quota d'échecs du rate limiter (50 / 15 min / client) — 16 consommés en 3 min de navigation normale, risque d'auto-blocage d'un testeur. Aucune donnée modifiée par l'orchestrateur. | 2026-10-08 | **Résolu (2026-10-08)** — SQL exécuté par HUMAN dans Neon staging, vérifié en lecture seule : 7 comptes à 99 permissions, `aboubacar.ouattara@djamo.io` à 41 (profil Contributeur : `treatmentdecision.create` oui, `treatmentdecision.validate` non). Rate limiter / 403 : correctif proposé dans la PR qui suit (les erreurs renvoyées à un utilisateur déjà authentifié ne consomment plus le quota) — **en attente du go PO avant merge**. |
| @orchestrator @security (HUMAN) | **Promotion `staging` → `main` et comptes de production (2026-10-08).** PR #120 mergée (Risk Management V1 Lots 1-4/A/B/C, SEC-017/018, correctif 403, migrations automatiques) ; frontend et backend de production `live` sur le commit `9c0e6d2`. Permissions de production, vérifiées en lecture seule après exécution des scripts par HUMAN dans l'éditeur Neon : `jean-philippe.kouadio@djamo.ci` 99 permissions (administrateur, au lieu de 36) ; `charles.kouassi@djamo.io` créé, profil Validateur métier (76 : actions métier + validations + Comité, aucune suppression ni administration) ; `aboubacar.ouattara@djamo.io` créé, profil Contributeur (41 : lectures + création/mise à jour, aucune validation ni Comité). Création des deux comptes faite par SQL faute d'écran de création d'utilisateur, tracée dans `audit_log` (`request_id = MANUAL-2026-10-08-TESTERS`, auteur HUMAN). Connexion par Google SSO Djamo (la connexion locale est interdite en production) ; un compte Gmail externe a été écarté pour cette raison et pour ne pas donner de droits de validation en production à un compte hors organisation. | 2026-10-08 | **Résolu.** Point à surveiller : la première connexion SSO de Charles et Aboubacar (domaine `djamo.io` vs `djamo.ci` du compte PO) confirmera que le client OAuth accepte les deux domaines. |
| @risk-manager (HUMAN) | **OD-1 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Définition métier du mode HYBRIDE et matrice mode × types de contribution ouverts (Signalement/Identification/Analyse/Inherent/Maîtrise). Recommandation Architecte : matrice fixe en code, contenu fourni par le Risk Manager. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : modes emboîtés CLASSIQUE ⊂ HYBRIDE ⊂ PARTICIPATIF ; Signalement toujours ouvert, Identification et Analyse ouvertes en HYBRIDE et PARTICIPATIF, Inherent et Maîtrise seulement en PARTICIPATIF, Résiduel jamais. **Ouvert — arbitrage PO** (bloque B-2 et B-3.). |
| @risk-manager | **OD-2 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Une contribution Inherent/Maîtrise porte-t-elle seulement du texte, ou aussi des valeurs indicatives (jamais recopiées dans l'évaluation) ? Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : texte obligatoire, valeurs indicatives optionnelles pour Inherent/Maîtrise, jamais recopiées ni agrégées. **Ouvert — arbitrage PO** (bloque le schéma de B-3.). |
| @risk-manager | **OD-3 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Qui peut contribuer, et le Risk Owner est-il exclu des contributions ? Recommandation : permission + mode en V1, owner exclu. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : permission + mode en V1, owner exclu, pas de RACI ni d'invitation. **Ouvert — arbitrage PO** (défaut possible pour B-3.). |
| @risk-manager | **OD-4 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Le Risk Owner statue-t-il sur chaque contribution (RETENUE/ECARTEE) ou simple journal ? Recommandation : statut de revue. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : RETENUE / ECARTEE par l'owner, commentaire obligatoire si écartée. **Ouvert — arbitrage PO** (bloque B-3.). |
| @risk-manager (HUMAN) | **OD-5 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Signalement : destinataire, rattachement (aucun / processus), conversion en risque officiel. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : file de triage de la fonction Risk, pas de rattachement obligatoire, conversion/rattachement/rejet motivés ; confidentialité du signalant à soumettre à Privacy et Compliance. **Précisé par le PO (DECISION-012, 2026-10-08) : le signalant choisit entre signalement anonyme ou nominatif.** **Ouvert — arbitrage PO sur le reste** (bloque B-4.). |
| @risk-manager | **OD-6 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Portée d'E-10 : le Risk Owner seul pour les trois saisies (Inhérent, Maîtrise, Résiduel), ou saisie déléguée avec endossement ? Recommandation : strict, conforme au §5. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : Inherent et Résiduel strictement réservés à l'owner ; la Maîtrise n'est pas nommée par le contrat §5 (trou à arbitrer), repli : saisie par l'owner, appuyée sur l'efficacité des contrôles. **Ouvert — arbitrage PO** (bloque B-1.). |
| @risk-manager | **OD-7 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Owner changé pendant une évaluation en brouillon : l'ancien termine (instantané) ou contrôle à chaque saisie ? Recommandation : instantané. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM (à l'inverse de l'Architecte) : contrôle « acteur = owner actuel » à chaque saisie, abandon explicite et tracé du brouillon. **Ouvert — arbitrage PO** (non bloquante.). |
| HUMAN | **OD-8 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Après E-10, les risques sans owner deviennent inévaluables (staging et production) : assigner les owners avant déploiement, après comptage `risks.owner_id IS NULL`. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | **Ouvert — bloque le déploiement de B-1.** |
| HUMAN @security | **OD-9 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Durcir `assignOwner` (finding F-1) : permission dédiée `risk.owner.assign` + interdiction de l'auto-désignation ; impose de revoir les droits staging et production. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | **Validé par le PO (2026-10-08, DECISION-013)** — permission dédiée `risk.owner.assign` portée par un groupe (rôle RBAC) ; un non-membre ne se désigne jamais et voit la liste des désignateurs (DECISION-011) ; un membre peut se désigner lui-même seulement avec justification obligatoire et confirmation par un autre membre du groupe (groupe d'un seul membre → confirmation HUMAN), audit des deux acteurs ; refus de désigner un owner sans `riskevaluation.create`. Débloque le lot B-0 (taille revue à la hausse : la confirmation d'une auto-désignation ajoute une demande en attente). **Reste ouvert : validation Security de l'exposition de la liste des désignateurs.** |
| @risk-manager | **OD-10 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Structure (textes ou listes) et historisation (en place ou instantané par évaluation) des champs Analyse (gap 5). Recommandation : hors lot. Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : listes causes / événements / impacts + contexte, instantané par évaluation, champ `target` sur la contribution Analyse dès B-3 ; question PO : qui édite l'Analyse. **Ouvert — arbitrage PO** (non bloquante.). |
| @risk-manager | **OD-11 (passage Architecte Contribution/HYBRIDE/E-10, 2026-10-08)** — Des contributions encore SOUMISE bloquent-elles `validate()` ? Recommandation : non (contribution ≠ décision). Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | Recommandation RM : pas de blocage dur, compteur visible et KRI. **Ouvert — arbitrage PO** (non bloquante.). |
| @security @dev-backend | **F-1 — `RiskService.assignOwner` contrôlé par la permission générique `risk.update`, sans interdiction de l'auto-désignation (`RiskService.ts:165-174`), trouvé par le passage Architecte du 2026-10-08 et vérifié par l'orchestrateur.** Même famille que SEC-013/014 : une fois E-10 corrigé, être Risk Owner donnera le droit exclusif de coter, donc s'auto-désigner owner sera une élévation de privilège obtenue sous une permission de mise à jour générique. Les profils Contributeur de staging et de production (`aboubacar.ouattara@djamo.io`) détiennent `risk.update`. Sans conséquence tant qu'E-10 n'est pas corrigé (aujourd'hui n'importe quel détenteur de `riskevaluation.create` peut déjà coter). Détail : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`. | 2026-10-08 | **Ouvert — à corriger dans le lot B-0, avant ou avec E-10 (OD-9).** |
| @product-manager @risk-manager (HUMAN) | **Deux trous du contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` relevés par le Risk Manager (2026-10-08).** (1) §5 nomme Inherent et Résiduel comme cotations réservées au Risk Owner, mais ne dit rien de la **Maîtrise** ; repli recommandé : saisie par l'owner dans le même parcours, appuyée sur les évaluations d'efficacité des contrôles. (2) §4 ne dit pas **qui édite l'Analyse** ; suggestion : l'owner, permission dédiée `risk.analysis.update`. Détail : `.claude/agent-context/memory/risk-manager.md`. | 2026-10-08 | **Recommandation RM au regard d'ISO 31000 / COSO ERM / trois lignes IIA (2026-10-08, second passage)** : (1) Maîtrise enregistrée par l'owner seul, chaque note de ligne de défense alimentée par sa source (L1 exécutions, L2 évaluations d'efficacité validées + contributions retenues, L3 audit), écart ou absence de source signalé `Evidence Missing` sans blocage V1 ; risque accepté : l'owner reste juge et partie sur L1. (2) Analyse éditée par l'owner seul (`risk.analysis.update`), les autres informent par contribution. Références normatives paraphrasées, à vérifier sur les textes. **Ouvert — HUMAN : arbitrer et compléter le contrat ; trancher aussi la consultation en mode CLASSIQUE (via le Meeting, recommandé, ou ouverture d'Identification/Analyse dans les trois modes).** |
| @architect @dev-backend @dev-frontend @ux-designer @security @privacy | **DECISION-011 à construire — fenêtre « action non autorisée » avec deux listes de personnes, pour toute action refusée (PO, 2026-10-08).** Remplace le simple message d'erreur 403 dans tout le frontend. Contenu : (1) les personnes qui peuvent faire l'action (détiennent la permission manquante) ; (2) les personnes à qui demander ce droit (détiennent `role.assign`). Prérequis techniques à cadrer par l'Architecte : le backend doit exposer la permission manquante dans la réponse 403 (aujourd'hui seulement dans le texte du message `Missing permission: x`), plus une route qui liste les utilisateurs actifs du même tenant détenant une permission donnée (nom et email seulement). Revue Security (énumération des détenteurs de droits sensibles, ex. validation Comité) et Privacy (exposition nom/email à tous les utilisateurs, PRIV-CH-DASH-001) avant code ; maquette UX de la fenêtre. Premier usage : la désignation du Risk Owner (OD-9). | 2026-10-08 | **Ouvert — cadrage Architecte + revues Security/Privacy avant tout code.** |
| @privacy @security @architect @risk-manager | **DECISION-012 à cadrer — signalement anonyme ou nominatif, au choix du signalant (PO, 2026-10-08).** Point technique à trancher avant le lot B-4 : « anonyme » peut vouloir dire (a) **anonymat réel** : aucune identité stockée (pas de `contributed_by`), donc aucun suivi possible du signalant, risque d'abus non traçable, et exception explicite à la règle CLAUDE.md « attribution forcée côté serveur » ; ou (b) **confidentialité** : identité stockée mais visible seulement d'un rôle restreint (ex. conformité), jamais de l'owner ni de la file de triage. Le choix a des conséquences légales (protection des lanceurs d'alerte, droit d'accès RGPD / loi ivoirienne sur les données personnelles) : avis Privacy et Compliance requis, Security pour l'anti-abus (rate limiting, journal sans identité). | 2026-10-08 | **Modalité tranchée par le PO (2026-10-08, DECISION-012 complétée)** : signalement **« confidentiel »** (pseudonymisé, identité stockée à part et levée réservée à la conformité) ou **« nominatif »** ; le libellé « anonyme » n'est pas utilisé. Validation juridique confiée par le PO aux **juristes internes de Djamo** (points listés dans `memory/compliance.md` et `memory/privacy.md`). **Ouvert — HUMAN : retour des juristes internes ; PRIVACY_ASSESSMENT + décision DPIA ; avant tout code de B-4.** |
| @dev-backend | **Commentaire périmé dans `RiskEvaluationService.recordMasteryAssessment`** (« maîtrise globale = moyenne » alors que le code applique `Math.min`, vérifié le 2026-10-08 par l'orchestrateur ; même famille que F-5 du passage Architecte). | 2026-10-08 | **Résolu (2026-10-11)** — commentaire corrigé (« minimum des notes saisies »), aucun changement de code. |
| @architect @risk-manager @compliance @ux-designer @dev-frontend (HUMAN) | **Position du PO sur les modes de cotation (2026-10-08), proposée comme modification d'une seule partie du contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` (§5/§7), en consultation pour objections.** (1) L1 = l'exécutant du contrôle. (2) Trois modes de cotation, enregistrés en configuration au même titre que les échelles (paires 4/6, impaires 3/5) et la description des probabilités corrélée aux impacts. (3) Le **Résiduel** est toujours saisi par un membre de **l'équipe risque**. (4) **Classique** : l'équipe risque fait tout. (5) **Participatif** : Inhérent et Maîtrise par l'exécutant L1 ; Résiduel et Maîtrise par l'équipe risque. (6) **Hybride** : dans un même dispositif, le mode se choisit risque par risque. (7) Le dispositif et ses paramètres sont définis à chaque ajout de risque. Remplace la question OD-6 telle que formulée par le passage Architecte ; interagit avec OD-1, OD-7, E-10 et les lots B-1 à B-3. | 2026-10-08 | **Consultation close (2026-10-08) — 11 questions au PO, voir `docs/architecture/RM-V1-Modes-cotation-objections.md` §3.** Convergence des cinq rôles : contradiction avec le contrat §5/§7/§10 ; décisions bloquantes : Q1 qui est le Risk Owner, Q2 saisie L1 officielle ou retenue, Q3 Maîtrise à deux acteurs, Q7 dispositif à l'ajout du risque. Lot B-1 suspendu, B-2/B-3 à reformuler, B-0/B-4 inchangés. **Ouvert — HUMAN : répondre à Q1 à Q11, puis décider de l'amendement de cette seule partie du contrat.** |
| @architect @risk-manager @compliance @ux-designer @dev-frontend @dev-backend (HUMAN) | **Workflow cible du PO RO / DEL / EXEC (2026-10-08)** — dispositif (mode) → processus avec Risk Owner et délégué → exécuteur de contrôle → risque ; matrice de 5 configurations ; règle d'or « RO + DEL interdit ». Second tour de consultation des cinq rôles : `docs/architecture/RM-V1-Modes-cotation-objections.md` §6. | 2026-10-08 | Q1 et Q7 tranchées. Convergence : RO/DEL sur le Processus, EXEC sur le Contrôle ; la règle d'or ne suffit pas (validateur hors de tous les auteurs, désignations tracées) ; cumul RO + EXEC (configs 1 et 4) seulement avec compensation (Compliance, objection n° 5). Nouveau lot B-5 proposé, prérequis de B-1. Questions A à H validées par le PO (DECISION-014), avec dispositif configurable et annotations de l'équipe risque sur l'Inhérent L1. Projet d'amendement rédigé par le Risk Manager : `docs/architecture/RM-V1-Amendement-contrat-modes-PROJET.md` (7 points « À VALIDER PO », dont la revue explicite « retenu / amendé » de l'Inhérent L1 en plus de l'annotation). 7 points validés par le PO (DECISION-015) ; **contrat amendé le 2026-10-08** (§4, §5, §7, §8, §10, §16, §17). **Résolu.** Restent ouvertes Q9 (qui propose la Treatment Decision), Q10 (« équipe risque »), Q11 (probabilités corrélées aux impacts). Suite : reformulation des lots B-0, B-1, B-2, B-3 et cadrage du lot B-5 par l'Architecte sur le contrat amendé. |
| HUMAN @risk-manager @architect | **Q9, Q10, Q11 déduites des positions du PO par le Risk Manager (2026-10-08), à confirmer.** Q9 : pas de proposeur distinct — le Risk Owner (ou le Délégué en délégation datée) enregistre la Treatment Decision ; l'équipe risque peut joindre une recommandation non contraignante ; `TreatmentDecisionService.ts:53` (réservé à l'évaluateur) contredit §8. Q10 : « équipe risque » = un rôle RBAC, n'importe quel membre sur n'importe quel risque du tenant, avec des permissions par étape ; non déductible : un membre qui est aussi RO/DEL/EXEC d'un risque ne saisit ni ne revoit ce risque (recommandé). Q11 : grille probabilité × niveau d'impact retenu, cellules optionnelles avec repli sur le libellé générique, dans la Rating Scale (pas le Dispositif). | 2026-10-08 | **Tranché par le PO (DECISION-016)** : Q9 accordée ; Q10 = groupe fixe Risk Manager (jamais vide), plus groupes Risk Committee et Audit (vides possibles) et groupes-départements ; Q11 = même taille d'échelle pour probabilité et chaque axe (3/4/5/6, choisie à la création du Dispositif), niveaux décrits par axe, 7 axes au maximum. **Reste ouvert — HUMAN** : un membre du groupe Risk Manager qui est aussi RO/DEL/EXEC d'un risque peut-il saisir ou revoir ce risque (recommandé : non) ; que faire si le groupe approbateur choisi (Audit ou Comité) est vide (recommandé : refuser de le choisir comme approbateur). |
| HUMAN @architect @risk-manager | **Plan de lots re-cadré sur le contrat amendé (Architecte, 2026-10-08)** : `docs/architecture/RM-V1-Lots-contrat-amende.md`. Chemin critique B-6 (nouveau, Dispositif `RiskFramework`) → B-5 (RO/DEL/EXEC) → B-1 → B-3 → F-2 ; nouveaux lots B-6 et B-7 (Treatment Decision réalignée) ; migration 047 HYBRIDE caduque. Peuvent partir sans Q9-Q11 : B-0, B-6, B-5. Arbitrages PO demandés (§5 du document) : (1) le Dispositif fait foi pour le mode par défaut, `Config.evaluationMode` rendu obsolète ; (2) validation du changement de mode par la fonction risque et retrait de `process.evaluationmode.set` (contredit DECISION-006 amendement 3) ; (3) DECISION-013 : auto-désignation strictement interdite (invariant 5) ; (4) « direction du département » sans lien Processus → département (F-11) ; (6) approbateur de l'exception de cumul RO + EXEC = Comité. Risk Manager : F-9 (surcharge d'appétence) et valeurs par défaut B-6. | 2026-10-08 | Point 6 tranché (DECISION-016 : approbateur configurable, Audit ou Comité). Point 4 en partie : les départements deviennent des groupes ; reste à dire si un Processus est rattaché à un groupe-département. **Ouvert — HUMAN : points 1, 2, 3 et fin du 4, puis go de lancement de B-0, B-6, B-5.** |
| HUMAN @orchestrator | **Nouvelle séquence des actions à venir (Architecte, 2026-10-08)** : `docs/architecture/RM-V1-Sequence-actions.md`, 21 étapes reprenant les phases 0 à 7 du §17 ; nouveaux lots B-8 (groupes fixes) et B-9 (échelle, F-13). Dernier tour : Risk Manager et Dev Frontend « rien de bloquant » ; Architecte : le contrat ne reflète pas encore DECISION-016 et Q9 (§6, §8, §10) — étape 2. Le Risk Manager approuve les recommandations P1 à P6 et ajoute : P4 nécessite `processes.department_id` ; P6 doit aussi bloquer le vidage d'un groupe déjà choisi comme approbateur. OD-4 (qui statue sur une contribution) reste ouverte et bloque B-3. | 2026-10-08 | **Ouvert — HUMAN : arbitrer P1 à P6 et OD-4 ; valider le report de DECISION-016/Q9 dans le contrat (étape 2) ; go de lancement des étapes prêtes (B-0, B-8 hors départements, B-9, cadrage DECISION-011).** |
| HUMAN @ux-designer | **Expérience utilisateur globale du Dispositif (UX Designer, 2026-10-08)** : `docs/ux/RM-V1-Experience-Dispositif.md` — file « À faire » par acteur, un seul écran d'évaluation éditable selon le mode et le rôle, défauts et pré-remplissage, interdits impossibles à saisir, refus → fenêtre DECISION-011 ; checklist + formulaire linéaire plutôt qu'un assistant ; 12 contrats backend listés. Questions au PO : (1) checklist + formulaire plutôt qu'assistant ? (2) notifications V1 : application seule ou aussi e-mail ? (3) « Retourné » et « Rejeté » : deux états distincts ? (4) règle de clôture et échéance du Comité asynchrone ? (5) Appétence et Grilles dans « Risques » ou dans « Dispositif » ? | 2026-10-08 | **Tranché par le PO (DECISION-017)** : assistant pas à pas par défaut + configuration directe pour experts ; notifications application + e-mail ; Retourné ≠ Rejeté ; Comité asynchrone configurable (défauts à proposer) ; appétence et grilles dans le Dispositif, Dispositifs par défaut activables. Défauts du Comité asynchrone proposés par le Risk Manager (2026-10-08, mémoire risk-manager) : quorum = majorité simple des éligibles (≥ 3, jamais 1) ; décision à la majorité des exprimés ; égalité → relance puis séance ; abstention motivée ; un rejet motivé suffit à ouvrir « Retourné » ; échéance 10 jours ouvrés (3–30), relances à 50 % et 90 %, une prolongation motivée ; à l'échéance sans quorum → escalade, jamais de validation tacite ; groupe vide → envoi refusé ; RO/DEL/EXEC et auteurs exclus du vote. **Ouvert — HUMAN : valider ces défauts et 3 questions (quorum de 2 pour les petites structures ? le responsable de la fonction risque peut-il être membre du Comité ? rétractation de vote ?) ; @ux-designer : intégrer DECISION-017 avant la maquette Penpot.** |
| HUMAN @orchestrator | **Nouvelle fonctionnalité annoncée par le PO (2026-10-08) : import de fichiers Excel / CSV d'évidences pour le contrôle interne** — les métiers consignent leurs informations dans des fichiers Excel/CSV ; récupérer automatiquement ces données et les persister en base, pour évaluation/analyse des évidences. Cahier des charges reçu : `docs/specs/CDC-module-evidences-excel.md` (v1.0, 15 décisions à prendre en §33). | 2026-10-08 | Cadrage Architecte : `docs/architecture/EVD-Import-Excel-cadrage.md` — lots EVD-1 (socle preuve : SHA-256, doublon, audit des téléchargements, `evidence.download`, S), EVD-2 (analyse sans écriture, S), EVD-3 (dataset et versions de schéma, M), EVD-4 (import JSONB + lineage, M), EVD-5 (assistant frontend 4 écrans, M) ; synchrone, plafonds 5 Mo / 20 000 lignes, `exceljs` déjà présent ; étapes 11a–11e de la séquence, piste parallèle hors chemin critique RM. **Ouvert — HUMAN : décisions §33 n° 3-4 (champs canoniques / libres), 8 (qui crée une version de schéma), 9 (qui supprime une évidence), 11 (lignes invalides par défaut), 12 (report de la clé métier) ; HUMAN + @compliance : n° 5 (conservation) ; HUMAN + @privacy : n° 10 et 14 (données personnelles, confidentialité) ; @security : accepter les risques résiduels (bombe de décompression, pas d'antivirus).** |
| HUMAN @orchestrator | **Roadmap V1 et balayage de préparation des 16 agents (2026-10-08)** : `docs/ROADMAP-V1.md` (releases R0 à R5 + piste EVD). 14 agents prêts avec réserves ; Privacy bloqué sur B-4, fenêtre DECISION-011 et EVD-1/4 ; Infrastructure et Release Manager bloqués pour la mise en production seulement. | 2026-10-08 | **Ouvert — HUMAN : GO de lancement de R0 ; périmètre V1 (étape 18, B-4, piste EVD) ; sens du masquage ; OD-4 ; défauts du Comité ; accès Penpot, IDs des dossiers Drive, fournisseur e-mail ; testeurs de la recette.** |
| @orchestrator HUMAN | **Cockpit de pilotage publié (2026-10-08, DECISION-021)** : artefact « Pilotage GRC Tools » https://claude.ai/artifact/LQgXExeGTqAHxijeSrSRf3 (source `docs/pilotage/pilotage-grc-tools.html`) — état global, roadmap V1 (R0–R5 + EVD), arbitrages à trancher, une section par agent, journal des livraisons ; base partagée (`project`, `releases`, `agents`, `questions`, `deliveries`). **Protocole** : après chaque livraison d'agent, l'orchestrateur met à jour la base (statut de l'agent, items de release, nouvelles questions, ligne de journal) ; chaque réponse du PO saisie dans la page est relue par l'orchestrateur et inscrite au Decision Log ici avant toute action. 12 arbitrages ouverts au 2026-10-08 (q01 GO R0 … q12 échec d'audit). | 2026-10-08 | **Ouvert — HUMAN : répondre aux arbitrages dans la page ; @orchestrator : tenir la base à jour à chaque livraison.** |
| HUMAN @ux-designer @architect | **Nouvelle fonctionnalité PO (2026-10-08) : reprise du registre des risques (Excel / Google Sheets) après création du Dispositif, et organisation de l'Administration.** Cadrage : `docs/architecture/ADMIN-et-RRI-cadrage.md` — réglages de plateforme dans l'Administration, réglages du Dispositif dans l'espace Dispositif, raccourcis seulement dans les sections ; lot RRI (moteur partagé avec l'import d'évidences, brouillon, cotations en historique « reprise », Google Sheets par téléchargement .xlsx au MVP). | 2026-10-08 | **Ouvert — HUMAN : arbitrages q13 à q16 dans la page de pilotage.** |
| @dev-backend @security HUMAN | **Bombe de décompression déjà exposée en production (Security, 2026-10-08)** : `RiskImportService.ts:52` charge tout le classeur `exceljs` en mémoire avant le plafond de lignes (`riskImport.routes.ts:7`, 10 Mo) ; utilisateur authentifié ; ~CVSS 6,5 (sous le seuil d'escalade 7). | 2026-10-08 | **Fermé (2026-10-11, constat de l'état des lieux)** — corrigé par R0.3 : `69796a7` (décompression plafonnée) puis `17dbe04` (garde alignée sur JSZip). |
| HUMAN @architect | **RRI — confirmation q17 (2026-10-08, DECISION-027)** : les réponses q14 à q16 tranchent le rapprochement colonnes / objets par le client et les propositions de cotation (si matrice P × I identique), sans se prononcer sur : objets importés en brouillon activés par l'équipe risque ; périmètre risques, processus et contrôles ; Google Sheets par .xlsx en V1, lien direct en V1.1. | 2026-10-08 | **Résolu (2026-10-08) — q17 confirmée, DECISION-029.** |
| HUMAN @security | **Migration 047 (B-0) — revue des rôles avant fusion dans `staging` (2026-10-08)** : le workflow `migrate.yml` (DECISION-009) applique automatiquement toute migration fusionnée dans `staging`. La 047 accorde `risk.owner.assign` aux rôles détenteurs de `role.assign` et aux rôles nommés exactement « Risk Manager » (resserrée après SEC-B0-2). Le PO vérifie la liste réelle des rôles de staging/production ; tout autre rôle qui doit désigner des Risk Owners reçoit la permission à la main. | 2026-10-08 | **Résolu (2026-10-08) — q18 validée, DECISION-029.** |
| HUMAN @risk-manager @security | **SEC-R04-3 — clé de compte de service Drive longue durée sur Render (2026-10-08)** : sur Render, pas d'identité de plateforme ; la clé JSON (Secret File) est longue durée, contrairement à l'ADC Cloud Run. Mesures : compte de service membre des deux Shared Drives seulement, clé dédiée et tournée, jamais dans le dépôt ; dossiers globaux acceptables tant que mono-tenant, à bloquer avant tout multi-tenant. Risque résiduel à accepter par le PO jusqu'à la migration Cloud Run / AWS. | 2026-10-08 | **Résolu (2026-10-08) — risque accepté avec mesures (q19, DECISION-029).** |
| @documentation @dev-db HUMAN | **Écarts relevés par le runbook de migration (R0.6, 2026-10-08)** : pas de workflow de sauvegarde quotidienne (décidée en q03, à livrer en R5) ; 043 et 044_risk_idempotency sans `.down.sql` ; deux fichiers numérotés 044 ; le rollback doit utiliser `MIGRATION_DATABASE_URL` et non `DATABASE_URL` ; procédures de rollback et de branche preview jamais exécutées de bout en bout. | 2026-10-08 | **Ouvert — à traiter avant R5 ; détail dans `docs/runbook/migrations.md` §9.** |
| HUMAN @ux-designer @dev-frontend | **Design system V1 — inventaire et audit (2026-10-11, DECISION-028)** : `docs/ux/DS-V1-inventaire.md` — 28 écarts (11 accessibilité), 18 composants manquants, 3 vagues ; audit technique : build OK, 0 test, pas de catalogue visuel, focus clavier non stylé sur Button/Menu/Tabs/Pagination/SegmentedControl/Modal. Points ouverts : (1) cible WCAG 2.1 AA comme critère de sortie (q20) ; (2) `--gs-info` alias de primary alors que PEOS distingue info et primary ; (3) pas de token « blanc / texte sur primaire » (8 `#fff` en dur) ; (4) Tabs = navigation (`aria-current`) ou vrais onglets. | 2026-10-11 | **Résolu (2026-10-11) — q20 et q21 validées, DECISION-030.** |
| @architect @dev-backend @security | **DiD-1 — liste des détenteurs de permissions sensibles jamais envoyée au client (revue Security DS-1b, 2026-10-11)** : la fenêtre de refus en mode « sensible » (DECISION-025 q02) masque les noms, mais une liste reçue resterait lisible dans le réseau et l'état React. Exigence pour l'endpoint qui fournira un jour les détenteurs : pour les permissions sensibles (levée d'identité des signalements, `audit.read`, gestion des rôles), le serveur décide et renvoie seulement `sensitive: true`, jamais la liste. Aujourd'hui un 403 ne renvoie que `{ error, requestId }` : rien n'est exposé. | 2026-10-11 | **Ouvert — à appliquer au lot de la fenêtre de refus (F-1) ; retest Security au branchement.** |
| HUMAN @compliance | **Validation juridique de la conservation 10 ans et de la suppression sur demande (passage Compliance EVD-1, 2026-10-11)** : la durée de 10 ans (DECISION-018 n° 5) et le fondement de la suppression sur demande (n° 9) ne s'appuient sur aucun texte vérifié. À faire confirmer par les juristes de Djamo. | 2026-10-11 | **Résolu (DECISION-038)** : 10 ans confirmés par le PO, **durée configurable dans l'interface d'administration** (nouvelle exigence, à porter au lot EVD stockage/rétention). |
| @dev-backend @compliance HUMAN | **COMP-EVD1-2 — suppression d'une évidence sur demande conforme à DECISION-018 n° 9** : motif obligatoire (aujourd'hui `reason: null`), `deleted_at`/`deleted_by`, demande traitée par le groupe Risk Manager (demandeur ≠ traitant), `evidence.delete` réservée ; décision HUMAN sur le refus de supprimer une preuve qui alimente des records importés (EVD-4). | 2026-10-11 | **Ouvert — lot suivant, avant toute suppression sur demande en production.** |
| @infrastructure @compliance HUMAN | **COMP-EVD1-4 — protection du stockage des preuves** : rétention ou verrouillage sur les deux Drive partagés, droits du compte de service sans suppression définitive, journaux d'activité Drive conservés, politique de purge écrite, archivage après 1 an (DECISION-018 n° 5) derrière `DocumentStorage`. | 2026-10-11 | **Ouvert — lot Infra/Conservation.** |
| @dev-backend HUMAN | **COMP-EVD1-5 — rattrapage des empreintes des évidences historiques** : script hors migration (relecture par `getContent`, hash marqué « établi a posteriori », trace dans `audit_log`) ; écriture de masse à valider par HUMAN avant exécution. Ajouter le KRI « % évidences avec empreinte ». | 2026-10-11 | **Ouvert — lot de rattrapage dédié.** |
| HUMAN @risk-manager @product-manager | **Étape 2 du contrat (R1.1) — 11 questions ouvertes Q-E2-1 à Q-E2-11** dans `docs/architecture/RM-V1-Contrat-etape2-PROJET.md` (rédaction Risk Manager, relecture Product Manager, 2026-10-11), reportées dans la page de pilotage (q23 à q33). Bloquent : R1.2 (Q-E2-1, -2), R1.3 (-3), R1.4 (-4, -5, -6), R2 (-7, -8, -9), R3 (-10, -11). Le texte du projet doit aussi être validé par le PO avant report dans le contrat. | 2026-10-11 | **Résolu (DECISION-038)** : q37 tranchée (escalade vers la fonction risque, jamais l'administrateur technique) ; texte final validé par le PO (« MVP, les itérations suivront »). Report dans le contrat en cours (A13). |
| HUMAN @ux-designer @dev-frontend | **Revue Penpot du design system (PO, 2026-10-11)** : `docs/ux/DS-V1-revue-penpot.md`. Faite sur une copie locale antérieure à la vague 1 : la plupart des « bloquants » sont déjà corrigés sur staging ; les écarts de couleur/police/rayon sont la marque Djamo validée (le fichier Penpot donne la structure, pas la marque). Vrais écarts restants listés en fin de fichier (tailles Button/Modal, Table zébrée/compacte/sélection, Tabs/Card désactivé et sélectionné, paliers 12px et display, 13 composants sans fiche Penpot). | 2026-10-11 | **Ouvert — HUMAN : GO de la vague 2 du design system sur ce périmètre.** |
| @dev-backend @security | **Évidence supprimée acceptée comme preuve de clôture d'un plan d'action (Security, revue EVD-1, 2026-10-11, préexistant)** : `ActionPlanService.ts:399-401` vérifie l'évidence de clôture par `getById` sans contrôler `status !== 'DELETED'`. | 2026-10-11 | **Corrigé (mini-lot sécurité)** : refus d'une évidence DELETED sans oracle ; A06 + QA A08 (24 tests) + Security A10 PASS ; PR vers `staging`. |
| @infrastructure @security HUMAN | **Partage des fichiers sur les Drive partagés (Security, revue EVD-1, 2026-10-11)** : le lien Drive stocké est un lien statique ; si les Drive partagés sont ouverts à tout le domaine, `evidence.download` et son audit se contournent hors application. Vérifier que l'accès aux 4 Drive partagés est limité au compte de service et aux administrateurs nommés. | 2026-10-11 | **Résolu (DECISION-038)** : le PO confirme que les 4 Drive partagés n'ont pour membres que lui et les comptes de service. |
| @infrastructure @dev-backend HUMAN | **Authentification Google Drive en production non prouvée (Infrastructure, 2026-10-08)** : `googleDriveAuth.ts` et `env.ts:101` interdisent la clé JSON en production et supposent l'identité Cloud Run, alors que la production tourne sur Render ; le dépôt d'évidences en production peut échouer. | 2026-10-08 | **Ouvert — à vérifier (R0.4) ; décision HUMAN sur le mécanisme d'identité Drive en production.** |
| HUMAN @architect @risk-manager | **P3 configurable = amender l'invariant 5 du §10 (Architecte, 2026-10-08).** Un paramètre ne peut pas abaisser un invariant (invariant 8) : rendre l'auto-désignation configurable exige de réécrire l'invariant 5 en « jamais auto-approuvés ; une auto-proposition n'est permise que si le Dispositif l'autorise ». Paramètre « auto-désignation permise » désactivé par défaut, approuvé par le Comité ; si activé : approbation par un autre membre du groupe Risk Manager (`approved_by <> requested_by`), motif, audit, cumul marqué ; refus si aucun autre approbateur. B-0 (refus strict) reste compatible. | 2026-10-08 | **Fermé (2026-10-11, constat orchestrateur)** — amendement accepté par DECISION-019 P3 ; précisé par q35/q65 (DECISION-042 §7 : activation par un vrai vote du Comité seulement). |
| HUMAN @architect | **P4 validé par l'Architecte (2026-10-08) avec un modèle plus simple** : `departments` reste l'entité métier (déjà cible de 5 FK) ; `roles.department_id` (nullable, unique par tenant) fait d'un groupe le groupe d'un département ; `processes.department_id` corrige F-11 ; la « direction du département » = membres du groupe rattaché ; `Department.riskOwner` (texte libre) gardé en lecture seule puis obsolète. Porté par B-8, utilisé par B-5. | 2026-10-08 | **Confirmé (DECISION-040 §6).** |
| HUMAN @privacy @architect @compliance | **Propositions EVD §33 n° 10, 11, 12, 14 et stockage (2026-10-08).** n° 10/14 (Privacy) : déclaration « données personnelles oui / non / ne sait pas » (ne sait pas = oui) ; colonne persistée / ignorée / masquée, valeurs ignorées jamais copiées même dans les erreurs ; dataset `confidential` (lecture des lignes et téléchargement réservés à des rôles nommés) ; colonnes personnelles masquées en liste ; lecture et téléchargement journalisés sans valeurs ; plancher non désactivable ; la classification se relève librement, ne s'abaisse que par l'équipe risque ; ces protections dès EVD-1. n° 11 (Architecte) : contrôles type / obligatoire / ligne vide / doublon de clé ; défaut = annuler l'import si une ligne est invalide, option tenant = importer les valides (import marqué partiel). n° 12 : clé métier facultative, déclarée dans la version de schéma, défaut aucune. Stockage (DECISION-018 n° 5) : Drive ne tient pas 10 ans (pas d'archive, pas de verrou, corbeille purgée à 30 jours) → **GCS** : classe Archive après 365 jours (accès immédiat), rétention 10 ans non verrouillée d'abord, `GcsStorage` derrière `DocumentStorage`, nouveau lot **EVD-0 Stockage** avant EVD-1, copie unique des évidences Drive existantes. | 2026-10-08 | **Ouvert — HUMAN : valider ces propositions ; décider plus tard du verrouillage Bucket Lock (irréversible, conflit avec un effacement avant 10 ans — avis Privacy et juristes requis) ; faire qualifier par les juristes la localisation des données (Neon US, Drive/GCS) avant EVD-4.** |
| @dev-backend @compliance @security | **Écarts Evidence relevés par le cadrage EVD (2026-10-08)** : la table `evidences` n'a ni SHA-256, ni taille, ni type MIME ; `getUrl` ne journalise pas les téléchargements ; la suppression envoie le fichier dans la corbeille Drive, vidée après 30 jours — l'original finit physiquement détruit (conflit avec la conservation et le soft delete) ; deux migrations numérotées `044_` (`044_audit_log_escalate`, `044_risk_idempotency`). | 2026-10-08 | Ouvert — corrigés par EVD-1 (hash, métadonnées, audit téléchargement) ; corbeille Drive à arbitrer avec la décision §33 n° 5 ; doublon 044 à documenter (ne pas renuméroter une migration déjà appliquée). |
| @dev-backend @security | **Nouveaux écarts code / contrat amendé relevés par l'Architecte (2026-10-08).** F-8 : seuils Comité relus à la validation au lieu d'être figés sur l'évaluation (`RiskEvaluationService.ts:436`, `:518`, `:586-595`, invariant 9). F-9 : surcharge d'appétence libre (`RiskEvaluation.ts:119-122`, invariant 8). F-10 : `process.evaluationmode.set` change le mode sans tiers (invariant 5). F-11 : `Process` sans lien département. F-12 : un seul `evaluatorId`, validateur comparé à lui seul. | 2026-10-08 | Ouvert — corrigés respectivement par B-6 (F-8), arbitrage RM (F-9), B-2/arbitrage PO (F-10), arbitrage PO (F-11), B-1 (F-12). **F-14 (2026-10-08)** : `validateByCommittee` valide dès l'appel d'un seul membre, sans vote, quorum ni échéance, et n'exclut que l'évaluateur (pas RO/DEL/EXEC). **F-13 (2026-10-08, DECISION-016)** : `RatingScale` limite probabilité et impact à 1..5 (`RatingScale.ts:69-73`), avec deux tailles indépendantes et des libellés d'impact communs à tous les axes (`impactLabels`, `ImpactAxis` sans niveaux) ; il manque la taille 6, l'égalité des tailles, un descriptif par niveau pour chaque axe (en plus de celui de la probabilité), saisi à la création du Dispositif, et le plafond de 7 axes. |
| HUMAN @security @devops @dev-frontend @dev-backend | **SonarCloud — base et plan de correction (A10, 2026-10-11)**, `docs/security/sonarcloud-issues.md` : 688 issues (apps-script-legacy 475, frontend 94, backend 65) ; 38 réelles, aucune CVSS ≥ 7. Lot S1 (`--ignore-scripts` sur `npm ci` CI/migrate/Dockerfile, hashes Semgrep, SRI/épinglage CDN legacy) recommandé en premier. | 2026-10-11 | **Partiellement résolu (DECISION-036)** : S1 CI/backend en cours ; reste reporté au lot « dette Sonar » après bouclage (dont legacy et Cartographie). |
| HUMAN | **Quality Gate SonarCloud en échec sur PR #147 (2026-10-11)** : « C Security Rating on New Code ». Cause probable (non vérifiable d'ici, sonarcloud.io bloqué par le proxy) : la règle S5693 se redéclenche sur les lignes multer modifiées (seuil Sonar inférieur à 25 Mo / 10 Mo), comme annoncé par la revue Security. PR déjà fusionnée, gate non bloquante. | 2026-10-11 | **Ouvert — HUMAN : dans SonarCloud, confirmer l'issue en cause ; si c'est S5693 sur `evidences.routes.ts` / `riskImport.routes.ts`, la marquer « Safe » avec la justification de `docs/security/sonarcloud-issues.md` ; sinon me transmettre l'issue.** |
| HUMAN @security @dev-backend | **Snyk — dépendances backend (A10, 2026-10-11)**, `docs/security/snyk-dependencies.md`. **zod 4.6.5 (CVE-2023-54404) exploitable** : CVSS effectif 6.5, escaladé (Snyk 7.5/8.7). PoC local : 1 Mo de JSON → ~2 s d'event loop bloqué, ~540 Mo de heap. Tout utilisateur authentifié peut le déclencher. Aucune version corrigée, `.max()` inefficace seul. 14 `z.array` HTTP sans borne. unzipper / traverse / inflight (via exceljs) non atteignables dans notre usage. | 2026-10-11 | **Partiellement résolu (DECISION-037)** : S-1 livré sur staging (PR #148, déploiement Render live 2026-10-11) — à promouvoir avant tout nouvel utilisateur prod ; S-2 reporté au lot « dette Sonar ». |
| HUMAN @documentation @architect | **Retours d'expérience versés dans PEOS (2026-10-11)** : 37 patterns anonymisés (`candidate`), `agents/ROLE_KNOWLEDGE.yaml` (patterns chargés par rôle à la création d'un agent), index `docs/retex/RETEX-2026-10-batch-01.md`. Contrôle de fuite A10 PASS ; avis A05 : 23 recommandés `approved`, 8 retravaillés par A21, 6 à garder `candidate`, 0020/0022 `superseded`. PR https://github.com/mrjeanphilippekouadio-beep/Personal-Engineering-OS/pull/56. | 2026-10-11 | **GO PO (DECISION-038)** : 23 recommandés + 8 retravaillés → `approved`, 6 restent `candidate` ; puis merge de la PR PEOS #56. Domaine : en attente d'explication au PO. |
| HUMAN @dev-backend @security | **Surfaces relevées par le retest A10 de S-1 (2026-10-11), non traitées** : ~60 `z.string()` sans `.max()` (jusqu'à 1 Mo persisté en base puis dupliqué dans `audit_logs`) ; `GET /audit-logs` : un `limit` négatif atteint `LIMIT -n` en SQL (non testé) ; upload `branding` borné en taille seulement (ni `files` ni `parts`) ; `express.json` 1 Mo → 256 ko recommandé en défense en profondeur ; `coveredRiskIds`/`riskIds` plafonnés à 1000 (refus au-delà de 1000 risques cochés). | 2026-10-11 | **Partiellement GO (DECISION-038)** : `limit` négatif sur `/audit-logs` traité maintenant (mini-lot sécurité) ; le reste au lot « dette Sonar ». |
| HUMAN @risk-manager | **Premier Dispositif — dernier recours d'activation (A13, report de l'étape 2, 2026-10-11)** : la règle (contrat §10, projet résumé point 11, §7.2, Q-E2-6) cite encore l'**administrateur du client** pour activer le premier Dispositif à défaut d'utilisateur dans le groupe risque. DECISION-038 a écarté l'administrateur pour q37 (il peut être de l'équipe technique) ; le même motif vaut a priori ici, mais le PO n'a tranché que q37. Également : « concerné » (q37) lu au sens des garde-fous q35 (demandeur, auteur, RO, Délégué, Exécuteur). | 2026-10-11 | **Répondu (q51, DECISION-040) : administrateur retiré ; seul un membre du groupe Risk Manager active le premier Dispositif ; l'admin crée d'abord le RM de plus haut niveau, et peut lui-même être RM (cumul q63). Démarrage à un seul RM : DECISION-043 §8 (q77, « amorçage »).** |
| HUMAN @risk-manager | **q37 révisée (DECISION-039 §3) intégrée par A13 au contrat (2026-10-11) — questions ouvertes Q-37a à Q-37i** (détail : `RM-V1-Contrat-etape2-PROJET.md` §13) : (a/b) sens de « avec consultation » et défaut du paramètre admin ; (c/d) tension avec q35 et sens de « responsable du risque » ; (e) Comité vide → suppléance directe vs quorum impossible → Audit d'abord, et chaîne 3.2 vs 6.2 à unifier ; (f) quorum d'Audit lui-même impossible ; (g) motif/trace et notification d'Audit disparus de la règle ; (h) votes déjà émis à l'échéance ; (i) Premier Dispositif = q51. Posées au PO dans l'artefact Pilotage (q52 à q57, q51). | 2026-10-11 | **Répondu (DECISION-040 §10 à §16) ; suites q58 à q61 — Ouvert HUMAN.** |
| HUMAN @dev-frontend @ux-designer @security | **DS vague 2 livrée (2026-10-11, 60d48ec) — suites** : (1) contrôle visuel navigateur jamais fait (padding `.btn` rétabli, topbar mobile, Modal lg sur écran étroit) ; (2) décision PO sur les rayons 2/4/8/16 de la revue Penpot ; (3) reste de l'inventaire : M10–M13, M16, M17, écarts E11, E13, E18–E28 (vague 3) ; (4) A10 : filtrer `javascript:` / schémas non http(s) sur les `href` de `Breadcrumb`/`Menu` dès qu'un écran leur passe des URLs backend. | 2026-10-11 | **Ouvert — HUMAN (rayons, contrôle visuel) ; Dev Frontend (vague 3).** |
| @dev-backend @security | **Validation des paramètres de requête (A10, revue du mini-lot sécurité, 2026-10-11), INFORMATIONAL, CVSS effectif 0,0** : `from`/`to` passés à `new Date()` sans validation sur `/audit-logs` et `/kri-measures` (date invalide → 500 générique) ; `page`/`pageSize` KRI parsés par `Number()` brut (normalisés par le repository ; `page=1e20` → 500). À faire : zod sur `from`/`to`, réutiliser le `PaginationQuery` borné 1..100, `grep "Number(req.query" backend/src/api`, test de régression (400 attendu). | 2026-10-11 | **Ouvert — basse priorité, lot « dette Sonar » (DECISION-036).** |
| HUMAN @risk-manager @product-manager | **Relecture A03 du contrat étape 2 (2026-10-11) : CONFORME, aucune correction. Points de fond préexistants à trancher** : (1) **impasse §5** — si toute l'équipe risque est concernée et que les groupes Audit et Comité sont vides, la suppléance est exclue par ses propres garde-fous : aucune issue définie (blocage explicite avec alerte, ou autre recours ?) ; (2) l'ordre de repli §5 « Audit, puis Comité, puis suppléance » est une rédaction non confirmée par le PO (et Audit qui revoit un risque pose une question d'indépendance de la 3e ligne) ; (3) « jamais un seul membre » (invariant 10, §8) vs suppléance par « une personne au moins » (§5) : la conciliation q35 n'est que dans le projet — ajouter au contrat que la règle vise le vote du Comité, pas la suppléance ? Pour mémoire : ordres de repli différents §5 / §8, voulu par DECISION-038. | 2026-10-11 | **Ouvert — HUMAN.** |
| HUMAN @dev-backend @security @compliance | **B-8 groupes fixes (R1.2, 2026-10-11) — questions PO soulevées par A06** : (1) les 3 groupes fixes sont créés **sans aucune permission** : quels droits pour Risk Manager, Risk Committee, Audit ? Le groupe Audit doit-il remplacer le rôle « Auditeur » (`audit.read`) ? (2) `processes.department_id` reste facultatif (données et UI existantes) alors que le contrat exige un rattachement : le rendre obligatoire quand, après le rattrapage F-11 ? (3) suspendre le dernier membre actif de Risk Manager via `UserService` contourne l'invariant « jamais vide » (revue Security/Compliance en cours) ; (4) le modèle P4 (ligne « P4 validé par l'Architecte ») est implémenté tel que proposé, confirmation PO toujours attendue. | 2026-10-11 | **Répondu (DECISION-040 §1 à §6) — A06 lot B-8 bis.** |
| HUMAN @risk-manager @dev-backend | **Plafonds de score à 25 alors que B-9 autorise une échelle 6×6 (score max 36)** (A06, 2026-10-11) : `MAX_APPETITE_THRESHOLD`/`MAX_THRESHOLD` = 25 (appétence), zod `threshold` ≤ 25, CHECK `committee_*_min_score` 1..25 (migration 045), bandes de criticité par défaut (« Critique » = 16–25) dans `CartographyService`/`DashboardService`. Tant que ce n'est pas aligné, une échelle 6 ne doit pas être activée. Petit lot dédié à prévoir (avec B-6 ou l'UI) ; **la Cartographie est concernée côté backend — consigne PO : ne pas toucher la page Cartographie, à confirmer pour ses bandes backend.** Également : `levelLabels` par axe facultatif — obligatoire à l'activation ou à la création du Dispositif (B-6, recommandé A06) ? | 2026-10-11 | **Ouvert — HUMAN : go du petit lot « score 36 » et périmètre Cartographie.** |
| HUMAN @dev-backend @dev-db @compliance | **Compliance B-8 (A14, 2026-10-11) : CONFORME AVEC RÉSERVES, aucun bloquant** (`docs/security/compliance-B8.md`). Questions PO : (1) cumul Risk Manager + Audit interdit (A14 : oui) ? RM + Comité interdit ou autorisé avec cumul marqué ? (2) un membre **suspendu** compte-t-il dans « jamais vide » (A14 : non) — confirmé : `UserService.suspend` ne révoque pas les `user_roles` et le comptage ignore le statut ; refuser la suspension du dernier RM actif ? (3) droits des 3 groupes (reco A14 : RM larges sans auto-approbation + permission distincte « responsable de la fonction risque » ; Comité lecture + vote ; Audit lecture seule transverse) ; (4) motif obligatoire et approbateur tiers pour entrer/sortir d'un groupe fixe ? (5) qui modifie les permissions du groupe Audit (3e ligne) : l'équipe risque ou une autorité distincte ? (6) calendrier du rattrapage Processus → département (F-11) puis `NOT NULL`, qui rattache les processus existants ? Suivi technique : garde de cumul + correction suspension/comptage (A06), index d'unicité partiel `user_roles` actifs + rattrapage département (A07), audit hors transaction (invariant 7, lot transverse), adoption par nom à vérifier sur les données réelles avant prod. | 2026-10-11 | **Répondu (DECISION-040 §1 à §5) ; portée du réglage de cumul → q58.** |
| @dev-backend @qa-engineer HUMAN | **Retest A10 B-8 (2026-10-11) : F-B8-01 et F-B8-03 CLOSED** (suspension/révocation du dernier Risk Manager actif refusées, sérialisées par `FOR UPDATE` sur la ligne `roles`). Nouveaux constats INFO, non bloquants : **F-B8-05** (CVSS 0) le pré-contrôle de `RoleService.revokeFromUser` ignore la cible — révoquer un membre suspendu est refusé tant qu'il ne reste qu'un actif (fail closed) ; **F-B8-06** (CVSS 2,0) un rôle détenu uniquement par des suspendus devient désactivable, leurs `user_roles` restent → à la réactivation l'utilisateur perd silencieusement ces droits (réduction, jamais élévation). Reco : A06 restreint le pré-contrôle aux cibles actives ; PO décide pour F-B8-06 (signaler/auditer à la réactivation, ou refuser `reactivate` sans rôle actif) ; A08 test de concurrence sur vraie base si souhaité. | 2026-10-11 | **F-B8-05 CORRIGÉ ; F-B8-06 DÉCIDÉ (DECISION-039 §2) ; q48 tranchée (DECISION-040 §7 : noms affichés) — A06 puis Dev Frontend.** |
| HUMAN @orchestrator | **Suites de DECISION-040 posées au PO (artefact Pilotage, 2026-10-11)** : q58 portée du réglage de cumul (q43) ; q59 (RÉPONDU, DECISION-041) ; q60 refus de co-signer (q52) ; q61 règle de décision par défaut sans quorum (q55, révise q27). | 2026-10-11 | **Répondu (DECISION-041, DECISION-042).** |
| HUMAN @risk-manager @dev-backend | **Compliance DECISION-040 (A14, 2026-10-11) : CONFORME AVEC RÉSERVES, aucun bloquant** (`docs/security/compliance-DECISION-040.md`). Réserves à lever avant prod de B-8 bis / B-9 bis : **R1** « aucun quorum » doit viser la décision de repli, pas le vote du Comité (sinon contredit DECISION-026 « jamais un seul membre ») → paramètre « décideurs minimum » (défaut 1) — rattaché à q61 ; **R2** Audit (3e ligne) décide en repli puis audite ses propres décisions → marquer les décisions « prises en repli », indicateur par groupe décideur, ratification a posteriori non bloquante par le Comité dès qu'il existe — q62 ; **R3** admin = RM : marquer le cumul, motif, notifier un tiers, sans bloquer — q63. Autres reco : suspendus exclus du comptage « groupe vide » ; réglages cumul/quorum/circuit = permission dédiée + motif + trace ; fenêtre « droits perdus » = nom d'affichage seul, audit par affichage, avis Privacy (A15) ; seule la 5×5 activable tant que plafonds/bandes non alignés (B-9 bis). | 2026-10-11 | **Répondu (DECISION-042 §3 à §5) — A13 contrat.** |
| HUMAN @risk-manager | **A13 a intégré DECISION-040 au contrat (2026-10-11)** (projet étape 2 §3.1, §3.2, §6, §6.2, §7.2, §11 bis, §13 ; contrat §5, §6, §8, §10 ; passages remplacés barrés, pas supprimés). Incohérences relevées, posées au PO : q64 Audit « lecture seule » mais valide (q45) et décide en repli (q54) ; q65 activation de l'auto-proposition hors vote réel du Comité (garde-fou q35 non repris) ; q66 « droits larges » RM pour tous les membres vs réservé au responsable ; q67 validation q45 quand Audit et Comité sont vides ; q68 sort du paramètre « consultation » (A13 l'a retiré du texte, à confirmer) ; q69 approbateur choisi au Dispositif vs circuit unique (et reformulation invariant 10). | 2026-10-11 | **Répondu (DECISION-042) — A13 contrat.** |
| HUMAN @risk-manager | **A13 a intégré DECISION-041/042 au contrat (2026-10-11)** ; invariant 10 reformulé avec un sens de « jamais un seul membre » rédigé par A13 (on ne sollicite un groupe que s'il compte au moins deux membres éligibles ; la décision de repli est un autre régime) — à valider. Nouvelles incohérences N1 à N7 posées au PO : q72 (sens de « jamais un seul membre » + N1 un seul vote exprimé peut décider) ; q73 (N2 même personne Comité + Audit sur un même dossier) ; q74 (N3 ratification sans délai ni conséquence) ; q75 (N4 circuit sans maillon) ; q76 (N5 Audit en repli d'un Comité vide : vote ou décision de repli) ; q77 (N6/N7 amorçage avec un seul Risk Manager). | 2026-10-11 | **Répondu (DECISION-043) — A13 à intégrer au contrat.** |
| @dev-backend @qa-engineer @risk-manager | **B-9 bis livré (A06, `300ff8f`, fusionné sur la branche de travail)** : plafond de score n² et bandes par défaut dérivés de l'échelle ACTIVE (`domain/scoring.ts`, `services/scoreCeiling.ts`), descriptifs obligatoires à l'activation (q50), migration 052 (CHECK 25 → 36 sur `risk_appetites`, `configs` comité ; non appliquée). Écart : le lien « taille choisie à la création du Dispositif » n'existe pas dans le modèle — n vient de l'échelle active, repli 5×5. Restes à traiter : `DashboardService` garde des bandes 5×5 (scores 6×6 tous « Critique ») ; appétences/seuils Comité existants non revalidés si une échelle plus petite est activée ; défaut Comité figé à 15 ; bandes par défaut calculées en lecture seulement ; anciens brouillons sans descriptifs ne s'activent plus. | 2026-10-11 | **CORRIGÉ (`f8e1e41`, fusionné `8d0205a`) : down 050/052 atomiques, défaut Comité = borne haute de « Élevé » (3×3 : 5, 4×4 : 9, 5×5 : 15, 6×6 : 21 — validation PO q71), Dashboard sur les bandes de l'échelle, plafond P×I, activation refusée si un seuil dépasse le nouveau plafond (F-B9b-01). Reste : ligne `configs` existante garde 15 → passer en 3×3/4×4 exige d'abaisser le seuil d'abord. Historique : QA PARTIAL_PASS (4 KNOWN GAP : down 050/052 non atomiques, seuil Comité figé à 15, Dashboard 5×5, tailles inégales) ; Security PASS (F-B9b-01 LOW) → correctifs A06 en cours (`wt/b9fix`). Le défaut Comité proportionnel à la taille (borne haute de « Élevé ») est un choix orchestrateur à faire valider : question PO à poser avec les valeurs exactes.** |
| @dev-backend @qa-engineer @security HUMAN | **B-8 bis livré (A06, `8024b39`, fusionné `ea0d638`)** : droits des 3 groupes (migration 051, posés seulement si le groupe est vide de permissions), groupe Audit remplace « Auditeur » (détenteur déjà RM retiré sans entrer dans Audit → perd `audit.read`), cumul RM+Audit refusé en dur (réglage attend q58), `fixedGroups`/`riskManagerAndCommittee` sur la fiche, motif obligatoire (groupes fixes), `PUT /roles/audit-group/permissions` (`rolegroup.audit.update`, 202 PENDING si l'acteur est RM, validation Audit/Comité non-auteur), `departmentId` obligatoire à la création d'un processus, réactivation → `lostRoles` + notification, `GET /roles/grantors?permission=` (noms d'affichage seuls, audit par appel). Non fait : §10 premier Dispositif (n'existe pas au backend → lot B-6). À vérifier QA/Security : **`ActionPlanService` n'a pas de contrôle d'auto-validation pour `actionplan.validate`** ; claim + application du changement Audit hors transaction ; pas de limite de volume sur `/roles/grantors` ; plusieurs changements Audit PENDING possibles ; suspension sans motif. Constat : tout membre RM voit déjà tous les risques du tenant (aucun scoping existant) — lien q66. | 2026-10-11 | **Ouvert — QA/Security B-8 bis ; Dev Frontend (fenêtre droits perdus).** |
| @dev-frontend @security HUMAN | **Fenêtre « droits perdus » livrée (Dev Frontend, `f739854`, fusionné `a654e8b`)** : sur tout 403 d'écriture dont le message est `Missing permission: x`, Modal DS « Vous n'avez pas ce droit » listant les noms de `/roles/grantors` (message honnête si vide). Limites : (1) permission lue par regex dans le texte du 403 — champ structuré à ajouter côté backend (déjà demandé par DECISION-011) ; (2) fenêtre limitée aux écritures (choix Dev Frontend, à valider) ; (3) **le frontend n'a AUCUN centre de notifications** : la notification « droits perdus à la réactivation » n'est visible nulle part — la partie « prévenir l'utilisateur » de DECISION-039 §2 n'est donc pas encore tenue (écran M17) ; (4) la fenêtre s'ouvre sur tout refus, pas seulement après une perte de droits, avec les noms même pour les permissions sensibles q02 — revue Security demandée ; fusion future avec la fenêtre q02 (DECISION-011, pas encore construite). Aucune vérification navigateur. | 2026-10-11 | **Ouvert — Security (point 4), HUMAN (points 2 et 3).** |
| @dev-backend @risk-manager @compliance | **Security B-8 bis (A10, 2026-10-11) : PASS avec réserves, aucun CVSS ≥ 7** (`docs/security/snyk-dependencies.md`, « Revue B-8 bis » + « Complément q48 »). MEDIUM : **F-B8b-01** (4,9) droits du groupe Audit sans limite (toute permission acceptable, Audit peut valider l'élargissement de ses propres droits, `rolegroup.audit.*` posable ailleurs) → liste blanche lecture ; **F-B8b-02** (4,4) validateur pas indépendant (un RM+Comité peut valider le changement d'un admin RM ; pas de route de lecture des PENDING, pas de notification) ; **F-B8b-03** (4,3) `/roles/grantors` trop large côté serveur (toutes permissions dont q02, pas de limiteur, audit_log gonflable) → refuser si déjà détenue, limiteur, audit dédoublonné, liste blanche hors `role.*`/`rolegroup.*`/`user.*`/`audit.*` ; **F-B8b-06** (4,3) le responsable d'un plan d'action peut le clore lui-même (le contrôle créateur ≠ clôturant existe). LOW : F-B8b-04 plusieurs PENDING / hors transaction ; F-B8b-05 cumul RM+Audit contournable par permissions effectives (rôle ordinaire `audit.*`). INFO : bascule Auditeur→Audit sans audit, `PUT /audit-group/permissions` écrit `reason: null`. Avant prod : requête de détection des doubles RM+Audit, rejeu 051 sur staging. | 2026-10-11 | **QA B-8 bis PARTIAL_PASS (A08) : MAJOR B8bis-02 nouveau tenant = 3 groupes sans droits (051 ne sème que l'existant), F-B8b-06 confirmé (responsable clôt sa propre action), B8bis-01 `UserService.create` crée le compte avant de vérifier le motif ; MINOR B8bis-03 approbation non transactionnelle, B8bis-04 échec de notification → 500 après réactivation ; `PATCH /processes/:id` accepte `departmentId: null`. → lot correctifs B-8 ter (A06) lancé.** |
| @dev-backend @dev-frontend @qa-engineer @security HUMAN | **B-8 quater livré (A06, `5d4c9c7`, fusionné)** : q58 réglage cumul Comité+Audit (migration 054 `configs.committee_audit_cumul_allowed` défaut true, `PUT /config/committee-audit-cumul` `{allowed, reason}`, permission `config.cumul.set` **donnée à aucun rôle** — l'admin doit l'ajouter, comme `config.committeeenforcement.set`) ; q63 cumul admin+RM (admin = détenteur d'une permission de `ADMIN_PERMISSIONS` : `role.create/update/delete/assign`, `user.create/update/delete/reactivate`, `rolegroup.audit.update`) → motif exigé + notification `ADMIN_RISK_MANAGER_CUMUL` aux porteurs de `rolegroup.audit.validate`, champ `administratorAndRiskManager` sur `GET /users/:id` ; q65 notification `COMMITTEE_MEMBER_ADDED` aux porteurs de `audit.read` ; DECISION-041 `GET /cartography/scale` (`cartography.read`, `data:null` sans échelle active, bandes effectives triées). Limite connue : **le contrôle q63 ne couvre que l'assignation, pas `RoleService.update`** (ajouter une permission admin à un rôle déjà porté par un RM ne déclenche rien). 1204 tests verts. | 2026-10-11 | **Ouvert — Dev Frontend (Cartographie n×n), QA/Security finales B-8 ter + quater.** |
| @dev-frontend HUMAN | **Cartographie n×n livrée (A11, `c72f5d5`, fusionné)** : grille `probabilityLevels`×`impactLevels` depuis `GET /cartography/scale`, aucune grille + bandeau si aucune échelle active, couleur = bande serveur contenant p×i (`ceil(x*y/5)` supprimé), risques hors grille listés sous la heatmap (plus de recadrage `Math.min(5,…)`). Visuel inchangé (CSS non modifié, grille en `style` inline). En attente PO : répartition des 5 couleurs existantes sur 4 bandes (z1,z2,z4,z5) → **q78**. Pas de contrôle navigateur fait. | 2026-10-11 | **q78 répondu (DECISION-043 §9 : répartition conservée). Reste : QA visuelle.** |
| @dev-backend @qa-engineer @security @risk-manager | **QA B-8 ter+quater PARTIAL_PASS (A08, `c636c0f`) + Security PASS avec réserves (A10, `d5e59f0`, max CVSS 4,4)**. À corriger (lot B-8 quinquies, A06) : q58-01 MAJOR réglage Comité+Audit contournable par rôle ordinaire `audit.*` ; F-B8t-01 MEDIUM / q63-01 `RoleService.update` ne rejoue ni le cumul RM+Audit ni admin+RM (y c. permission admin posée sur le groupe RM) ; q63-02 `config.cumul.set` absent de `ADMIN_PERMISSIONS` ; q65-01 double assignation → 500 ; F-B8t-03 approbation d'un PENDING sans revérification liste blanche/auteur, predeploy sans contrôle des PENDING ; F-B8t-04 `reopen` après échec d'audit. Restent ouverts : F-B8t-02 (legacy `users.roles`, course sur deux `assign`), F-B8t-05 (avis Privacy A15 grantors, limiteur par instance), F-B8t-06 (`config.manage`/`config.update` comptent-ils comme admin ? → A13). | 2026-10-11 | **Ouvert — A06 B-8 quinquies lancé ; A13 F-B8t-06 ; A15 grantors.** |
| @dev-backend @risk-manager @compliance | **B-8 quinquies livré (A06, `fbf96f9`, fusionné) — Security retest PASS (A10, `638942d`, max CVSS 2,7)** : F-B8t-01/03/04 RETEST_PASS, aucun contournement trouvé. Résidus non bloquants pour staging : **F-B8q-03 LOW** `reopen` encore possible si réponse de `roles.update` perdue (statut REJECTED, droits appliqués) ou si un nouveau PENDING existe (index unique) → audit avant application ou transaction + requête de réconciliation « APPROVED sans audit_logs » ; **F-B8q-01 LOW** course `update`/`assignToUser` sans verrou → `FOR UPDATE` sur `roles` ; **F-B8q-02 INFO** (A13/A14) `rolegroup.audit.update` inopérante dans `ADMIN_PERMISSIONS`, pas de règle admin+Comité, élargissement rétroactif à `config.*` (ajouter détection des doubles admin+RM existants au predeploy), audit du PATCH sans liste des utilisateurs touchés. À rejouer sur staging : contrôle n°6 de `B8-predeploy-checks.sql`. | 2026-10-11 | **Ouvert — A06 (F-B8q-01/03, lot suivant), A13/A14 (F-B8q-02, F-B8t-06).** |
| @dev-backend @audit | **QA retest B-8 quinquies PASS avec réserves (A08, `be05a67`, 1336 tests + 1 `it.fails`)** : MINOR **q65-02** deux assignations simultanées du même rôle → le perdant reçoit 500 (23505 non traduit dans `PostgresRoleRepository.assignToUser`) au lieu de 409. Observation pour Audit & Observability : après un échec d'audit à l'approbation, la ligne `PERMISSION_CHANGE` est définitivement absente (seuls le log et `role_permission_changes` tracent) — rejoint F-B8q-03. | 2026-10-11 | **Ouvert — A06 (q65-02 avec F-B8q-01/03, lot suivant).** |
| @dev-backend @qa-engineer @security | **B-8 sexies livré (A06, `7c29441`, fusionné)** : q65-02 (23505 → 409), F-B8q-01 (`FOR UPDATE` sur `roles` dans `assignToUser`), F-B8q-03 (pas de `reopen` si droits déjà appliqués ; `reopen` gardé par `NOT EXISTS`), contrôle n°7 « APPROVED sans audit » dans `B8-predeploy-checks.sql`. Résidus LOW : règles de cumul vérifiées avant le verrou (fenêtre non fermée) ; cas (b) APPROVED sans droits appliqués signalé par log seulement. | 2026-10-11 | **Ouvert — QA/Security retest.** |
| @dev-backend @privacy @security @compliance HUMAN | **EVD-2 livré (A06, `aed8ec1`, fusionné)** : `POST /evidences/:id/analysis` (`evidence.import`, xlsx ≤ 5 Mo, 20 000 lignes, 50 colonnes, 50 feuilles ; garde R0.3 ; SHA-256 revérifié → 409). Points ouverts : (1) **exemples de valeurs renvoyés pour toute évidence** — aucun flag confidentiel / données personnelles n'existe encore (décision 14, EVD-3) → un détenteur d'`evidence.import` sans `evidence.download` lit des valeurs du fichier : **avis Privacy + décision PO avant d'attribuer `evidence.import`** ; (2) lecture du contenu non auditée (cadrage « aucune écriture ») → Security/Compliance ; (3) `evidence.import` attribuée à aucun groupe → HUMAN ; (4) xlsx de 5 à 25 Mo stockés mais refusés à l'analyse. | 2026-10-11 | **Ouvert — QA/Security ; Privacy (1) ; HUMAN (1, 3).** |
| @dev-frontend @dev-backend HUMAN | **Centre de notifications livré (Dev Frontend, `de605e4`, fusionné, q70)** : cloche + badge non-lus (rafraîchi 60 s), centre (liste, lu/non lu, marquer lu, lien vers le module), onglet abonnements. Pas de contrôle navigateur. **Gaps backend** pour un centre « complet » : pas de « tout marquer lu » ; pas de compteur de non-lus (compté côté client, plafond 100) ; abonnements enregistrés mais jamais consultés à l'émission, pas de catalogue des types ; notifications plans d'action / KRI envoyées seulement sur Telegram, jamais persistées ; pas de lien profond vers un objet. | 2026-10-11 | **Ouvert — A06 (gaps backend), QA visuelle.** |
| HUMAN @risk-manager @compliance @architect | **A13 a intégré DECISION-043 au contrat (`28dfdea`) ; nouveaux trous N8 à N14 (§13.1 bis).** Posés au PO : **q79** (droits de configuration = administrateur ? F-B8t-06), **q80** (cumul admin + Comité, F-B8q-02), **q81 à q83** (amorçage q77 : périmètre N8, fin N9, exception à « jamais d'auto-approbation » N10) — **q81 à q83 conditionnent B-6**. Restent à formuler après B-6 (lot Comité B-12) : N11 vote unique sans revue, N12 ratification (règle de vote, effets d'une décision non ratifiée, Comité entièrement concerné), N13 éligibles moins les cumulants, N14 libellés de repli / règle d'Audit en repli / q75 sans échéance. Signalé par A13 : cumul **admin + Audit** plus sensible (l'admin modifie les droits d'Audit, q45) → avis Compliance. | 2026-10-11 | **Ouvert — HUMAN (q79 à q83) ; B-12 (N11 à N14) ; A14 (admin + Audit).** |
| @dev-backend @infrastructure @devops @audit @privacy | **Security B-8 sexies + EVD-2 (A10, `f021be5`, 2026-10-11) : B-8 sexies PASS avec résidu, EVD-2 PASS avec réserves, max CVSS 4,3 (6,5 si conteneur ≤ 512 Mo) — aucune escalade.** À corriger (lot EVD-2 bis / B-8 septies, A06) : **F-B8s-01** LOW 2,2 — cumul vérifié avant verrou : deux affectations simultanées de rôles différents au même utilisateur contournent la règle de cumul → verrouiller la ligne `users` cible, relire `held`, rejouer `assertCumulRules` (ordre user puis role) ; **F-EVD2-01** MEDIUM 4,3 — plafonds lignes/colonnes testés après `xlsx.load` (1,75 Mo → 367 Mo RSS) → plafond décompressé réduit (~8 Mo) + sémaphore 1-2 analyses + limiteur par utilisateur ; **F-EVD2-02** MEDIUM 4,3 — `examples` renvoyés sans `evidence.download` → ne les renvoyer que si l'acteur détient `evidence.download` ; **F-EVD2-03** LOW 3,1 — lecture non auditée → `audit.record` action `READ` fail-closed (métadonnées seulement). **@infrastructure/@devops** : confirmer la mémoire réelle du conteneur Cloud Run. **@audit** : alerte automatique sur changement APPROVED sans droits appliqués (résidu INFO F-B8q-03, détecté seulement par la requête 7 de `B8-predeploy-checks.sql`). Tant que F-EVD2-02 n'est pas corrigé : n'accorder `evidence.import` qu'à des détenteurs d'`evidence.download`. | 2026-10-11 | **Ouvert — A06 dispatché ; mémoire conteneur et alerte A23 à suivre.** |
| @dev-backend @qa-engineer @security HUMAN | **Gaps backend du centre de notifications livrés (A06, `20e703d`, fusionné `f5d6286`)** : `GET /notifications/unread-count`, `POST /notifications/read-all` (audit `MARK_ALL_READ`), `GET /notifications/types` (catalogue `domain/notificationCatalog.ts`, 4 types de gouvernance obligatoires non désactivables), abonnements appliqués par `NotificationService.emit`, notifications persistées `ACTION_STARTED_LATE`/`ACTION_OVERDUE` (responsable de l'action) et `KRI_THRESHOLD_BREACH` (propriétaire + supérieur du risque principal) ; bannières de gap retirées du frontend. Vérifié : typecheck, 83 fichiers / 1411 tests + 5 it.fails, build frontend. Restes : destinataires plans d'action (ACT-193, action multi-risques) → **q84** ; destinataires KRI à confirmer → **q85** ; `escalateIfOverdue` sans dédoublonnage ; Telegram de `RiskService`/`GovernanceService`/`FeedbackService` non persisté. | 2026-10-12 | **Ouvert — HUMAN : q84, q85 ; QA + Security sur le centre de notifications à dispatcher.** |
| @dev-backend @privacy @audit | **QA B-8 sexies PASS avec réserves, EVD-2 PARTIAL_PASS (A08, `b4e3371` + mémoire `fe6bc09`)** : MAJOR **EVD2-QA-01** (cellule date hors plage → RangeError → 500) ; MINOR **B8s-QA-01** (ROLLBACK en échec masque le 409), **B8s-QA-02** (changement avec doublons pris pour appliqué → APPROVED sans droits), **EVD2-QA-02** (en-tête contenant des années), **EVD2-QA-03** (hyperlien rich-text « [object Object] »). QA_CHALLENGE convergent avec Security F-EVD2-02/03. Non couvert : Postgres réel (verrous, concurrence), Drive réel. | 2026-10-12 | **Ouvert — confié au même lot A06 que F-B8s-01/F-EVD2-01..03 ; test d'intégration Postgres à planifier.** |
| @dev-backend @security @qa-engineer | **Correctifs EVD-2 bis / B-8 septies livrés (A06, `d22abf9`, fusionné `74c8993`)** : F-B8s-01 (verrou `users` puis `roles`, cumul rejoué sous verrou dans `assignToUser` et `update` élargissant), F-EVD2-01 (plafond décompressé 8 Mo / 6 Mo par entrée avant `xlsx.load`, sémaphore 2 analyses → 409, `perUserRateLimiter` 20/15 min), F-EVD2-02 (`examples` seulement avec `evidence.download`), F-EVD2-03 (audit `READ` fail-closed), 5 KNOWN GAP QA corrigés. Changement de comportement : affecter un rôle à un utilisateur suspendu → 404. Vérifié : 84 fichiers / 1421 tests. Restes : pas de test Postgres réel (concurrence RM + Audit à rejouer en staging) ; sémaphore par instance ; mémoire conteneur à confirmer (@infrastructure). | 2026-10-12 | **Livré — retest Security dispatché.** |
| @dev-backend HUMAN @risk-manager | **Security centre de notifications PASS avec réserves (A10, `14f152c`, max CVSS 5,4) + QA PASS_WITH_RESERVES (A08, `56082fe`, 1443 + 7 it.fails)** : **F-NOTIF-01** MEDIUM 5,4 inondation (`escalateIfOverdue` et mesures KRI sans dédoublonnage ni limiteur) = **NOTIF-QA-02** ; **F-NOTIF-03** LOW 3,1 message KRI/plan d'action lisible sans `kri.read`/`risk.read` ; **NOTIF-QA-01** MINOR un échec pour l'owner empêche la notification du superior ; INFO F-NOTIF-04 (abonnement hors catalogue accepté), F-NOTIF-05 (id non uuid → 500, filtre sans `.max`), F-NOTIF-06 (KRI émis pour risque archivé). **F-NOTIF-02** LOW 3,1 (alertes désactivables par leur seul destinataire) → décision PO **q85** (mise à jour). | 2026-10-12 | **Ouvert — A06 dispatché sur F-NOTIF-01/03/04/05/06 + NOTIF-QA-01/02 ; HUMAN : q84, q85.** |
| HUMAN @architect @risk-manager @dev-backend | **Spec B-6 Dispositif livrée (A05, `docs/architecture/RM-V1-B6-Dispositif-spec.md`, `b4e3371`)** : 4 sous-lots B-6a socle (migration 055) → B-6b branchement (056) → B-6c multi-Dispositif → B-6d amorçage (attend q81-q83). Questions §14 posées au PO : **q86** (Q1 fenêtre de bascule, B-6b), **q87** (Q2 demande Audit/Comité en attente avant B-12, B-6a), **q88** (Q3 ordre des votes « et », B-12), **q89** (Q4 règle d'approbation au changement de Dispositif, B-6c), **q90** (Q6 audit hors transaction, B-6a), **q91** (Q7 paramètres ajoutés au fil des lots, B-6a), **q92** (Q8 auto-proposition désactivée jusqu'à B-12, B-6a). B-6a est dispatché en appliquant les recommandations de q87/q90/q91/q92, qui correspondent toutes à « en faire moins » (fail-closed, report) et s'étendent sans casser ; B-6b n'est pas dispatché avant q86, B-6c avant q89, B-6d avant q81-q83. | 2026-10-12 | **Ouvert — HUMAN : q86-q92 ; B-6a en cours (A06).** |
| @dev-backend @infrastructure @devops | **Security retest EVD-2 bis (A10, `58b4c41`) : F-B8s-01, F-EVD2-02, F-EVD2-03 RETEST_PASS ; F-EVD2-01 PASS avec résidu LOW 3,1** — premier rejeu sur un vrai Postgres 16 jetable (hors Neon) : 0 cumul RM + Audit sur 50 affectations parallèles (20/20 sans le correctif). Résidus : pire fichier sous 8 Mo ≈ 245 Mo et ~1 s de boucle bloquée ; 2 analyses parallèles = pic 362 Mo/processus (tient dans 512 Mo sans marge) ; pas de délai maximal d'analyse (INFO). **F-EVD2b-01** LOW 2,2 (suspend verrouillait roles puis users → deadlock 40P01/500 contre un élargissement RM) **corrigé par l'orchestrateur** (verrou `users` en tête de `PostgresUserRepository.suspend`, test `SuspendLockOrder.test.ts`). | 2026-10-12 | **Fermé côté sécurité, sauf : @infrastructure/@devops confirmer la mémoire du conteneur ; délai maximal d'analyse (A06, non bloquant).** |
| @dev-backend HUMAN | **Security retest centre de notifications (A10, `4f74607`, Postgres jetable)** : F-NOTIF-03/04/05/06 RETEST_PASS ; ACTION_STARTED_LATE sans impact (INFO, `start()` exige PLANIFIEE). **F-NOTIF-01 RETEST_FAIL partiel, résidu MEDIUM 4,3** : dédoublonnage efficace en séquentiel (10 appels → 1) mais quasi inopérant en parallèle (20 appels simultanés → jusqu'à 20 notifications), et la route de mesure KRI n'a aucun limiteur. Correctif attendu (A06) : sérialiser vérification + insertion (advisory lock transactionnel sur la clé de dédoublonnage, sans migration) + `perUserRateLimiter` sur la route de mesure KRI. F-NOTIF-02 attend q85. | 2026-10-12 | **REMEDIATION_REQUIRED — A06 dispatché.** |
| @dev-backend @dev-db @qa-engineer @security @compliance | **B-6a Dispositif socle livré (A06, `0a465fa`, fusionné `32b93ab`)** : tables `risk_frameworks` / `risk_framework_versions` / `risk_framework_change_requests`, cycle DRAFT → PENDING_APPROVAL → ACTIVE → ARCHIVED, circuit fonction risque + repli, maker-checker en service et en base, permissions `riskframework.*` (6), routes `/risk-frameworks`, migration 055. **Migration 055 cassée à l'origine (42710, collision de nom de CHECK) — corrigée et validée par A07 (`9936da3`)** sur Postgres 16 jetable : 001→055, rejeu ×2 idempotent, 57 assertions (triggers d'immuabilité, maker-checker, GRANT runtime, droits des groupes fixes), down → up identique au schéma direct ; garde TRUNCATE ajoutée sur `risk_frameworks`. Note A07 : `npm run migrate` impose TLS, inutilisable sur une base locale. | 2026-10-12 | **Livré — QA et Security en cours ; remédiations Compliance à dispatcher.** |
| @dev-backend @dev-db @qa-engineer HUMAN | **Compliance B-6a (A14, `docs/compliance/B6a-compliance-review.md`) : CONFORME AVEC RÉSERVES, aucun blocage.** MOYEN **C-B6a-01** audit hors transaction (q90) : un échec d'audit empêche aussi les notifications → accepter pour staging seulement, notifications indépendantes de l'audit, requête de réconciliation « décision sans audit », et **audit de l'activation dans la même transaction que la bascule AVANT production** ; MOYEN **C-B6a-02** un approbateur COMMITTEE/AUDIT accepté avant B-12 peut verrouiller la méthodologie (seule sortie : intervention en base) → refuser tout approbateur autre que RISK_MANAGER jusqu'à B-12 ; MOYEN latent **C-B6a-03** (B-12) « Audit et Comité » avec un seul groupe éligible → décision marquée dégradée + ratification dans une table dédiée ; FAIBLE C-B6a-04 motif de retrait obligatoire, C-B6a-05 ancienneté des demandes PENDING, C-B6a-06 commentaire d'approbation obligatoire pour seuils/approbateur, C-B6a-07 activation liée en base à une demande APPROVED (B-6b), C-B6a-08 avertissement en tête du `.down.sql` ; INFO C-B6a-09 cas de test pour A08. Recommandations sur q86-q92 et q81-q83 dans l'avis ; nouvelle question **q93** (nombre de Risk Managers à la mise en production — si ≥ 2, B-6d est inutile). Références réglementaires à faire confirmer par les juristes Djamo. | 2026-10-12 | **Ouvert — échéance C-B6a-01 : avant toute mise en production ; A06/A07 à dispatcher après QA + Security ; HUMAN : q93.** |
| @dev-backend @dev-db @risk-manager | **Security B-6a (A10, `2bf7d0e`, Postgres jetable) : PASS avec réserves, max CVSS 3,8, aucune escalade. QA B-6a (A08, `824bef7`, 112 tests) : PASS_WITH_RESERVES.** À corriger avant tout déploiement de B-6a sans B-6b (A06) : **F-B6a-01** LOW 3,8 l'activation miroir laisse deux échelles ACTIVE → plafond hérité faux, garde Comité neutralisée (F-B9b-01 rouvert), saut de `assertThresholdsFitCeiling`, réactivation d'une échelle ARCHIVED ; **F-B6a-02** LOW 2,0 demande d'activation validée sans verrou → version modifiée en concurrence activée (q65 contourné, rejoué 3/30). Avant B-6c (A06) : **F-B6a-03** `discardDraft` sans `assertRiskManager`. A06 : **B6a-QA-01** MINOR (éditeur dont l'audit a échoué puis écrasé par un autre éditeur peut décider), **F-B6a-07** INFO notification PENDING sans dédoublonnage. A13 puis A06 : **F-B6a-04** auteurs de l'échelle non exclus, **F-B6a-05** membre RM + Comité exclu du Comité. A07 : **F-B6a-06** contrôles en base partiels (BOOTSTRAP admis, ACTIVE non liée à une demande APPROVED = C-B6a-07), **F-B6a-08** `dev_seed.sql` sans `riskframework.*`. **F-NOTIF-01 RETEST_PASS sur Postgres réel (20 parallèles → 1) : CLOSED.** | 2026-10-12 | **REMEDIATION_REQUIRED — A06 (lot B-6a bis), A07 et A13 dispatchés.** |
| HUMAN @dev-backend @dev-db @security @architect | **Arbitrage A13 B-6a (`docs/architecture/RM-V1-B6a-arbitrage-A13.md`)** : F-B6a-04 → exclure les auteurs de l'échelle en DRAFT (pas de décision PO, invariant 1 ; ajouté au lot A06 B-6a bis) ; F-B6a-05 → règle voulue (contrat §8), recommandation : noter la cause du repli (ABSENCE/EXCLUSION), ratification prioritaire, KRI des replis par exclusion → **q94** (PO, facultative) ; C-B6a-03 → B-12 : régime FALLBACK « double contrôle dégradé », Audit seul marqué 3e ligne, ratification append-only (A05). **F-B6a-06 (A07, analyse)** : migration de durcissement proposée — FK composite version ACTIVE → demande APPROVED (même tenant/framework/version), garde trigger PENDING→ACTIVE exigeant une demande APPROVED par un tiers non BOOTSTRAP, index unique sur `activation_request_id`, CHECK refusant BOOTSTRAP jusqu'à B-6d. **En attente** : numéro de migration à fixer après le retour d'A06 (B-6a bis peut prendre 056), puis relecture A10 avant écriture. | 2026-10-12 | **Ouvert — HUMAN : q94 ; @orchestrator : dispatcher la migration F-B6a-06 après A06.** |
| @dev-backend @dev-db @security | **Security retest B-6a bis + revue migration 056 (A10, `1b843b1`, Postgres jetable, vrai service) : feu vert PR staging (B-6a + 055 + 056), max CVSS 3,3, aucune escalade.** RETEST_PASS : F-B6a-01 (avec résidu), F-B6a-02 (0/60 sous verrou, 3/30 sans), F-B6a-03, F-B6a-04, F-B6a-07, B6a-QA-01, `531558c` ; chaîne F-B6a-02 + 01 fermée ; migration 056 rejouable, contournements du runtime refusés, compatible `recordDecision`. **Nouveaux, à corriger avant production** : **F-B6a-10** LOW 3,3 (A06) `mirrorScale` peut archiver l'échelle lue par le code hérité, qui bascule sur une autre échelle ACTIVE jamais vérifiée → garde Comité fail-open ; correctif : comparer au plus petit plafond de toutes les échelles restant ACTIVE. **F-B6a-09** LOW 2,2 (A07) triggers 055/056 sans `BEFORE INSERT` → version insérée directement ACTIVE / demande insérée APPROVED sous le runtime ; correctif : migration 057 (INSERT version = DRAFT, demande = PENDING sans champs de décision). QA retest B-6a bis (A08, `b612887`) : PASS_WITH_RESERVES, B6abis-QA-01/02 corrigés par l'orchestrateur (`531558c`). | 2026-10-12 | **F-B6a-01..07 et B6a-QA-01 CLOSED ; F-B6a-09/10 ouverts (A07/A06 dispatchés).** |
| @product-manager @dev-backend @dev-frontend | **Revue Gitar PR #165 : les 4 notifications `RISK_FRAMEWORK_*` (PENDING, DECIDED, NO_DECIDER, AUDIT_NOTICE) sont hors `NOTIFICATION_CATALOG`** → libellé générique « Notification » dans le centre de notifications. Le lien erroné « Ouvrir les rôles » est retiré (orchestrateur, PR #165). Décision PO : les ajouter au catalogue comme types **obligatoires** ? Cela porte DECISION-042 de 4 à 8 types obligatoires (tests QA-Notifications qui figent « 4 » à adapter). | 2026-10-12 | **Ouvert — owner HUMAN** |
| @orchestrator @devops @dev-db | **PR #165 fusionnée dans staging (`fe3bd4d`)** ; contenu vérifié par `git diff` : identique au head `1fc0781`. `migrate.yml` run 7 vert : « Applied migration: 055_risk_frameworks.sql » puis « 056_risk_framework_activation_guard.sql ». Suite intégrée sur la branche de travail (`40bd608`) : F-B6a-10 (`c8a845c`, A06) + migration 057 F-B6a-09 (`7d1907b`, A07), 1706/1706 ; passages QA (A08) et Security (A10) dispatchés avant la PR suivante. | 2026-10-12 | **En cours** |
| @dev-db @security @dev-backend @risk-manager | **Retest A10 (`b51a274`) + QA A08 (`0a08b71`, PASS_WITH_RESERVES, 1723/1723) : F-B6a-10 et F-B6a-09 CLOSED, feu vert PR staging.** Nouveaux, avant production : **F-B6a-11** LOW 2,2 (A07, migration 058) — fonctions de garde 055/056/057 sans `search_path` fixé, contournables par table temporaire ; **F-B6a-13** INFO (A07, même 058) — down 057 ne retire pas sa ligne `schema_migrations`. **F-B6a-12** INFO (A06) — `configs` lu sans verrou par `mirrorScale`, fermé par B-6b. Réserves QA : minimum des échelles lu sans verrou (même famille que F-B6a-12) ; seuils comparés aux échelles d'autres Dispositifs — choix à confirmer par A13 avec B-6c (q89). | 2026-10-12 | **F-B6a-09/10 CLOSED ; F-B6a-11/13 ouverts (A07 dispatché) ; F-B6a-12 → B-6b** |
| @dev-db @qa-engineer @security @infrastructure | **PR #166 fusionnée (`720b4c3`), 057 appliquée sur staging (migrate.yml run 8).** Migration 058 (A07 `ea6d469`) : `search_path` fixé sur les 6 gardes 055–057. QA A08 (`1fbe1ba`) PASS ; Security A10 (`c881751`) : **F-B6a-11 et F-B6a-13 RETEST_PASS, CLOSED**, feu vert PR staging. **F-B6a-14** INFO (rollback 057.down joué avant 058.down efface le `search_path`) : corrigé par l'orchestrateur — note d'ordre dans 057.down + garde statique dans `QA-B6a11.test.ts` (toute fonction de trigger ≥ 058 doit fixer son `search_path`) + règle CLAUDE.md → **CLOSED**. Reste optionnel @infrastructure : `REVOKE TEMP ON DATABASE … FROM PUBLIC` sur Neon (défense en profondeur, non vérifié). | 2026-10-12 | **F-B6a-11/13/14 CLOSED ; REVOKE TEMP optionnel ouvert (A16)** |
| @orchestrator @dev-db @security | **PR #167 fusionnée (`7326886`)**, contenu vérifié (`git diff` vide avec le head `383ce7b`) ; `migrate.yml` run 9 vert : « Applied migration: 058_risk_framework_guard_search_path.sql ». Revue Gitar : garde F-B6a-14 durcie (ALTER compté seulement après son CREATE, délimiteur `$tag$`), 4 sondes vérifiées. **Tous les findings Security B-6a sont fermés** (F-B6a-01..14), sauf F-B6a-12 INFO → B-6b. Reste avant production : C-B6a-01 (audit d'activation dans la même transaction) ; optionnel `REVOKE TEMP` (A16). | 2026-10-12 | **Fait** |
| @dev-backend @qa-engineer @product-manager | **A06 notifications `0c4384b` fusionné** (q95 : 4 types `RISK_FRAMEWORK_*` au catalogue, obligatoires ; q85 : KRI + retards d'action obligatoires, **F-NOTIF-02 CLOSED** ; q84 : destinataires d'action = responsable + propriétaire et supérieur de chaque risque couvert, dédoublonnés). 1743/1743. Garde F-B6a-14 durcie sur la valeur du `search_path` (`9af087e`, Gitar #167). QA A08 à passer. | 2026-10-12 | **Fait, QA en attente** |
| @product-manager | **Question PO (q96)** : une action dont la source est un KRI (sans lien RISK explicite) doit-elle notifier aussi le propriétaire/supérieur du risque de ce KRI ? Aujourd'hui : responsable seul. | 2026-10-12 | **Décidé (DECISION-045)** |
| @product-manager @ux-designer | **Question PO (q97)** : depuis q85 les 11 types sont obligatoires — l'écran « abonnements » ne permet plus rien de désactiver. Le retirer, le garder en lecture seule, ou réintroduire des types optionnels ? | 2026-10-12 | **Décidé (DECISION-045)** |
| @dev-backend @security @compliance | **A06 B-6a `e5b6381` fusionné** — q87 : la copie de brouillon force `RISK_MANAGER` (dernier chemin ouvert) → **C-B6a-02 CLOSED** ; q90 : audit du Dispositif écrit dans la même transaction que l'action (ROLLBACK si l'audit échoue) pour les 8 mutations → **C-B6a-01 CLOSED pour le Dispositif**. Testé sur faux pool uniquement : A08 rejoue sur Postgres jetable. | 2026-10-12 | **Fait, QA/Security en attente** |
| @risk-manager @architect | Une version ACTIVE héritée portant un approbateur COMMITTEE/AUDIT gèle le Dispositif (409 sur toute demande, seule issue une intervention en base). Aucune n'existe à ce jour à notre connaissance ; décider s'il faut un garde-fou ou une requête de repérage avant production. | 2026-10-12 | **Ouvert — A13/A05** |
| @security | L'écart « audit écrit hors transaction » (fermé pour le Dispositif par q90) subsiste dans les autres modules (Risk, Control, …). À évaluer par A10 : périmètre et priorité. | 2026-10-12 | **Ouvert — A10** |
| @dev-backend @security | **A06 RBAC `2b14eb7` fusionné** — q94 : cumul RM + Comité refusé (tous chemins, y compris réactivation d'un utilisateur portant un cumul interdit antérieur) ; q80 : admin + Comité marqué (motif + notification `rolegroup.audit.validate`) ; q79 : `config.manage` compte comme droit administrateur. Requêtes de repérage 8 et 9 ajoutées à `docs/security/B8-predeploy-checks.sql` (lecture seule, à jouer par HUMAN). Exigence B-12 consignée : l'admin ne vote ni ne ratifie sa propre demande. Intégration : 1755/1755. | 2026-10-12 | **Fait, QA/Security en attente** |
| @infrastructure | **HUMAN : jouer les requêtes 8 et 9 de `docs/security/B8-predeploy-checks.sql` sur staging/prod** avant mise en production (détenteurs actuels de cumuls RM + Comité et de `config.manage`). | 2026-10-12 | **Ouvert — owner HUMAN** |
| @architect | **Spec B-6 mise à jour avec DECISION-044** (`docs/architecture/RM-V1-B6-Dispositif-spec.md`, §14.1 Q1–Q8 tranchées, §18 plan : 0 q87/q90 → 1 B-6b (A06+A07, migration ≥ 059) → 2 B-6d (A06+A07) → 3 B-6c, séquentiels). En production (un seul RM, q93) **B-6d doit partir avant ou avec B-6b**. Mémoire `architect.md` créée. | 2026-10-12 | **Fait** |
| @risk-manager | **Bloquant B-6d (spec §14.2)** — I-D1 : un tenant 1 RM + 1 membre Audit sort du bootstrap mais reste bloqué (q72, 2 membres éligibles requis) — voulu ? I-D2 : le RM ne peut pas créer d'utilisateurs (droit admin, q79) — « impossible » de q83 accepté sur déclaration écrite ? I-D3 : fin du bootstrap définitive ou réversible ? I-D4 : q83 (pas de ratification) l'emporte-t-il sur q62 et la recommandation A14 ? | 2026-10-12 | **Ouvert — A13 (dispatché)** |
| @risk-manager | **Non bloquant B-6b/B-6c (spec §14.2)** — R1 statuts de contribution / mode d'appétence dans « tous les paramètres » ? R2 seuil « faible » sans défaut contractuel ; R3 options de cumul booléennes ; R4 `FIRST_LINE` ; R5 délégation sans durée max → date de fin obligatoire ? I-C1 réserve QA échelles inter-Dispositifs ; I-C2 un `ReviewCycle` ouvert verrouille-t-il le Dispositif ? | 2026-10-12 | **Ouvert — A13 (dispatché)** |
| @product-manager | **Questions PO (q98, q99)** — q98 (I-D5) : un Dispositif activé par bootstrap doit-il utiliser les valeurs par défaut du contrat ? q99 (I-D6) : la notification de bootstrap est-elle obligatoire au catalogue ? | 2026-10-12 | **Décidé (DECISION-045)** |
| @risk-manager @dev-backend @security | **Revue A13 DECISION-044** (`docs/risk/A13-review-DECISION-044.md`) : **G1** (MEDIUM, séparation des tâches) — `changeAuditGroupPermissions` ne met en attente que si l'auteur est RM ; un admin + Comité (légal depuis q80) applique seul des droits d'Audit → correctif A06 dispatché. Autres demandes A13 pour B-6d : fin d'amorçage mémorisée, motif structuré, notification lue/non lue tracée, KRI « âge de l'amorçage ». | 2026-10-12 | **G1 en cours (A06)** |
| @product-manager | **Questions PO q100–q105** (issues de la revue A13) : q100 version héritée COMMITTEE/AUDIT (Q-A13-1) ; q101 sens de « fin » du démarrage (I-D1) ; q102 fin définitive (I-D3) ; q103 tiers prévenu si groupes vides (Q-A13-4) ; q104 admin + Audit (Q-A13-5) ; q105 `config.manage` et import (Q-A13-6). q101–q103 bloquent B-6d. | 2026-10-12 | **q100–q105 répondues** (q105 précisée par q106 : laisser en l'état, DECISION-046 point 6) |
| @dev-backend @dev-frontend | Mise en œuvre DECISION-045 : q96 (risque du KRI source = risque couvert, A06) et q97 (écran abonnements en lecture seule, Dev Frontend). | 2026-10-12 | **Fait** (q96 `5ce5d39`, q97 `dc06a38`) |
| @qa-engineer @security @audit @dev-backend | **Revues du lot DECISION-044 + G1 + DECISION-045** : QA A08 `3de31bf` **PASS** (40 tests, dont 15 sur Postgres 16 jetable : ROLLBACK réel des 8 mutations du Dispositif si l'audit échoue) ; Security A10 `5a6e117` **feu vert staging** (CVSS max 3,1) ; Audit A23 `a3b5e40` 14 constats sans bloquant ; G1 corrigé `180c015`. Intégration : 1783 tests + 15 Postgres, build frontend OK. | 2026-10-12 | **Fait** |
| @dev-backend @risk-manager | **F-D044-01** LOW 2,7 CONFIRMÉ (PoC) — q94 contourné par les permissions effectives : un admin peut donner à un RM les permissions de validation du Comité via un rôle ordinaire ou le groupe RM, sans motif ni notification. **À corriger avant production** (dispatché A06) + requête de repérage 8 à étendre. | 2026-10-12 | **Corrigé `ea4ef9f` (A06) + `6aebb98` (q80). Retest A10 : RETEST_PASS, CLOSED (`70e2d74`).** |
| @dev-backend @security | **F-D044-07** LOW 2,7 (retest A10) : G1 (`changeAuditGroupPermissions`) ne mettait en attente que pour les groupes RM/Comité ; un admin avec `governance.validate` par un rôle ordinaire appliquait seul. | 2026-10-12 | **Corrigé (orchestrateur) : `isCommitteeRole`, test F-D044-07 dans `B8bis.test.ts`** |
| @orchestrator @dev-frontend @ux-designer HUMAN | **Retard du frontend constaté par le PO (2026-10-12)** : 43 modules d'API, 13 écrans ; 18 modules sans aucun écran (KRI, KPI et mesures, anomalies, processus, journal d'audit, cycles de revue, référentiels, catégories de risque, Dispositif, propriétaires de risque, rapports, réglages client…). **Cause racine : l'orchestrateur.** Chaque décision PO a été dispatchée côté backend ; les specs renvoient l'écran à un « lot F » qui n'a jamais été planifié ni tracé. Rien de technique ne bloque la plupart de ces écrans. Correctif : lots frontend dispatchés en parallèle des lots backend ; toute spec qui renvoie un écran à « un lot F » crée une ligne ici. | 2026-10-12 | **En cours** : lots F-KRI/KPI et F-Audit/Anomalies dispatchés |
| @dev-backend @dev-frontend | **Gaps de contrat relevés par le lot frontend KRI/KPI (2026-10-12)** : (1) = gap « mes permissions » ci-dessous ; (2) `apiRequest` ne garde que `data` → la pagination de `GET /kri-measures` (`total`, `page`) est perdue (côté frontend) ; (3) `GET /kpi-measures` sans pagination ni filtre de dates ; (4) `GET /kris` sans tendance ni valeur précédente ; (5) KRI/KPI ne renvoient que des identifiants (risque, département, processus) — libellé côté serveur souhaitable ; (6) pas de client `processes` avant ce lot (client minimal ajouté, suppose `id`/`name`). Non livré (le backend le permet) : désactivation KRI, archivage KPI, risques couverts d'un KRI, rattachement KPI. | 2026-10-12 | Ouvert — A06 (1, 3–5), Dev Frontend (2, 6) |
| @dev-backend @dev-frontend | **Gaps de contrat backend relevés par le lot frontend Journal d'audit + Anomalies (2026-10-12)** : (1) aucun endpoint « mes permissions » → le frontend ne peut pas masquer les actions, il s'appuie sur le 403 ; (2) l'API anomalies n'expose pas les transitions possibles (l'UI propose tout, le backend refuse) ; (3) `GET /audit-log` sans offset ni total (500 max) ; (4) `entityId` seul ignoré par la route audit-log ; (5) pas de libellés lisibles (utilisateurs, contrôles, risques) dans ces réponses. | 2026-10-12 | Ouvert — A06 |
| @dev-backend @dev-frontend @security | **Gaps de contrat relevés par le lot frontend Processus / Départements / Catégories (2026-10-12)** : (1) « mes permissions » (déjà listé) ; (2) valeur effective héritée de `evaluationMode` non exposée (`resolveEvaluationMode` existe côté service) ; (3) pas de processus rattachés à un département ni de comptage des références d'un processus (blocage d'archivage seulement par message texte) ; (4) catégories : pas d'archivage dédié ni de motif, désactivation par `active:false` sous `config.manage` → **à faire juger par A10** au regard de la règle « état terminal = permission dédiée » (SEC-013/014), et aucune référence aux catégories dans risques/évaluations/appétence (texte libre) ; (5) `riskOwnerDesignatedBy` brut sans libellé ; (6) listes sans pagination ni total ; (7) sans `department.read`, création de processus impossible (département obligatoire). Écran Dispositif (`riskFrameworks.routes.ts`) non couvert : lot frontend suivant. | 2026-10-12 | Ouvert (A06 ; point 4 A10) |
| @dev-backend @security | **F-D046-01** LOW 2,7 (A10, revue DECISION-046) : un administrateur qui reçoit un rôle ordinaire portant `audit.read` n'est pas signalé administrateur + Audit (ni motif, ni notification). Même famille que F-D044-08 : à coder avec lui (appartenance Audit et Comité par les pouvoirs). | 2026-10-12 | Ouvert — A06, avec F-D044-08 |
| @dev-backend @qa-engineer | **F-D046-02** INFO (A10) : si un repository Postgres oublie `auditsInTransaction`, le service repasse sans bruit en audit hors transaction → test garde sur cet indicateur pour chaque repository migré (F-D044-03). | 2026-10-12 | Ouvert — A06/A08 |
| @dev-frontend | **F-D046-03** INFO (A10) : `READ` et `DOWNLOAD` absents de l'union `AuditAction` du frontend (filtre du journal d'audit). | 2026-10-12 | **Corrigé (orchestrateur)** |
| @dev-frontend @qa-engineer | **QA DECISION-046 : PASS avec réserves (A08, 2026-10-12)** — backend sans défaut (q104 et RatingScale rejoués sur Postgres 16 jetable). Réserves frontend : QA-D046-01 règle « commentaire obligatoire pour clôturer » recodée côté écran anomalies → **retirée** (le serveur décide) ; QA-D046-02 = F-D046-03 **corrigé** ; QA-D046-03 401/réseau mal libellés (audit, anomalies) → **corrigé** (`describeError` partagé) ; QA-D046-04 réponse périmée de l'historique KRI/KPI → **corrigé** ; QA-D046-05 libellé « Inactif » jamais affiché (`GET /kris` et `/kpis` excluent les inactifs) → ouvert, mineur. Observations : réactivation sans rejeu admin + Audit (comme q80) ; détail `oldValue`/`newValue` brut dans le journal d'audit → regard Privacy (A15) ; aucun test frontend automatisé. | 2026-10-12 | 01–04 corrigés ; 05 ouvert (Dev Frontend) ; Privacy à solliciter |
| @dev-backend | **B-6b-01** `RatingScaleService.activateVersion` reste un second écrivain de « l'échelle ACTIVE » quand le Dispositif est branché (spec B-6 §3) — non fermé par B-6b (fichier hors périmètre de l'agent). A10 : LOW, CVSS 2.7. | 2026-10-12 | Corrigé (A06) — activateVersion refusé quand le Dispositif est branché |
| @dev-backend @qa-engineer | **B-6b-02** Inventaire des lecteurs de « l'échelle ACTIVE » partiel : `resolveMaxScore` (Config, Appetite, RatingScale, scoreCeiling) et `DashboardService` non migrés ; test de précondition B-6c « inventaire vide » à écrire. Bloque B-6c. | 2026-10-12 | Corrigé (A06) — inventaire fait, test de précondition B-6c dans B6bFollowups.test.ts |
| @ux-designer @dev-frontend | **B-6b-03** Avertissement non bloquant R2 (seuil « faible » au-dessus du haut de la bande la plus basse) non implémenté — à porter dans le lot F / UX. | 2026-10-12 | Ouvert |
| @dev-backend @qa-engineer @security @compliance | **B-6b** intégré (45cbd86, migration 059 jamais appliquée hors Postgres jetable) ; typecheck + 1828 tests verts sur la base fusionnée. Passages A08 / A10 / A14 (ligne GRC Trigger Matrix « gouvernance des paramètres ») à faire. | 2026-10-12 | En revue |
| @compliance | **Compliance B-6b (A14, 2026-10-12) : conforme avec réserves**, aucun blocage staging (`docs/compliance/A14-review-B6b.md`). C-B6b-01 moyen : valeurs de seuil rattrapées peu distinguables (seul repère : version NULL). B-6d annoncé COMPLIANCE_BLOCK s'il n'est pas déployé avant ou avec B-6b en production. | 2026-10-12 | Revue faite |
| HUMAN | **Q-A14-B6b-1 / q107** Marquer l'origine « reprise » des seuils des évaluations antérieures au Dispositif ? Décidé (DECISION-047) : compter d'abord en production, colonne d'origine seulement si le compte > 0. Reste : le comptage HUMAN avant production. | 2026-10-12 | Décidé — comptage HUMAN en attente |
| HUMAN | **Q-A14-B6b-2 / q108** Fermeture de B-6b-01 = condition de mise en production ? (recommandé : oui) | 2026-10-12 | **Décidé (DECISION-048)** : oui, condition de mise en production. B-6b-01 déjà corrigé (A06) → à revérifier dans la checklist pré-production |
| HUMAN | **Q-A14-B6b-3 / q109** Présentation des évaluations sans version : « antérieures au Dispositif, seuils de reprise » ? (recommandé : oui) | 2026-10-12 | **Décidé (DECISION-049)** : oui → item @dev-frontend ci-dessous |
| @dev-frontend @dev-backend | **DECISION-049** Afficher les évaluations sans version de Dispositif comme « antérieures au Dispositif, seuils de reprise », sans conclure sur leur conformité à la méthode — écrans et exports. Donnée déjà disponible (`risk_framework_version_id` NULL), aucun recalcul côté frontend. | 2026-10-18 | Ouvert |
| @orchestrator | **Passage A14 du lot PR #184 (référentiels + 061) : non requis selon la GRC Trigger Matrix** (vérifiée le 2026-10-18) — aucune nouvelle route (`git diff a3b8594^1 a3b8594 -- backend/src/api` : aucune), aucun nouveau traitement de données, aucun changement de rôle ; correctifs d'intégrité et écran sur API existante (= « UI simple » : Compliance Non). 061 renforce l'instantané B-6b déjà revu par A14 (`A14-review-B6b.md`). Le PO peut demander une revue supplémentaire. | 2026-10-18 | Décidé (orchestrateur) |
| @dev-backend | **B-6b-04** Test de câblage `server.ts` : le service d'évaluation et les écrivains fermés (`ConfigService`, `RiskAppetiteService`) reçoivent bien la dépendance Dispositif (sinon instantané absent et écrivains ouverts en silence). | 2026-10-12 | Corrigé (A06) — test statique du câblage server.ts |
| @dev-backend @risk-manager | **B-6b-05** Source de maîtrise `FIRST_LINE` : le marquage « indépendance réduite » demandé par A13 (R4 ii) n'existe pas (vérifié : aucune occurrence hors l'énumération). | 2026-10-12 | Corrigé (A06) — `reducedMasteryIndependence` dérivé à la lecture ; persistance à l'approbation seulement si A13 la demande |
| @dev-backend @qa-engineer | **B-6b-06** B-5 doit traiter un seuil « faible » NULL (versions déjà ACTIVE) en refus, avec un test explicite. | 2026-10-12 | Ouvert (à faire avec B-5) |
| @qa-engineer | **QA B-6b (A08, 2026-10-12) : PASS avec réserves** — 42 tests (`QA-B6b.test.ts`), 1870 verts ; modifications de fixtures A06 acceptées ; Postgres réel non exercé (059 et concurrence). | 2026-10-12 | Revue faite |
| @dev-backend | **QA-B6b-01** MINEUR : évaluation avec version mais seuil Comité copié NULL → `RiskEvaluationService.committeeSettingsOf` relit `configs` (contraire spec §8.1, incohérent avec TreatmentDecision). Inatteignable via le service ; corriger en fail-closed. | 2026-10-12 | Corrigé (A06) — fail-closed |
| HUMAN | **QA-B6b-02 / q110** Vue 360 du risque : afficher l'appétence de la version actuellement applicable (comportement actuel) ou celle figée sur l'évaluation ? | 2026-10-12 | **Décidé (DECISION-050)** : appétence actuelle en principal, appétence figée à titre d'information quand elles diffèrent → item @dev-backend @dev-frontend |
| @security | **Sécurité B-6b (A10, 2026-10-12) : feu vert staging avec réserves**, max CVSS 2.7, aucune escalade HUMAN (`docs/security/snyk-dependencies.md` §B-6b). | 2026-10-12 | Revue faite |
| @dev-backend | **F-B6b-01** LOW 2.7 : `DashboardService.getAppetiteVsResidual` (`GET /reports/appetite-vs-residual`) lit encore `risk_appetites` (plus alimentée) → rapport de direction faux après une nouvelle version. À traiter avec B-6b-02, avant B-6c. | 2026-10-12 | Corrigé (A06) — appétence lue dans la version applicable (spec §9 ; à revoir selon q110) |
| @dev-db | **F-B6b-02** LOW 2.0 : l'instantané d'évaluation n'est figé qu'en applicatif ; ajouter un trigger BEFORE UPDATE (search_path épinglé) refusant la modification des colonnes figées une fois renseignées + contrôle tenant sur la FK de version. | 2026-10-12 | Corrigé (A07) — migration 060 (non appliquée) |
| @dev-backend | **F-B6b-03** INFO : `/risk-frameworks/applicable?riskId=` ne demande pas `risk.read` (existence d'un risque déductible). Exiger aussi `risk.read` sur cette branche. | 2026-10-12 | Corrigé (A06) — `risk.read` exigé |
| @architect @dev-backend | **F-B6b-04** INFO (B-6c) : changer le processus d'un risque choisira son Dispositif → acte méthodologique (audit ancien/nouveau Dispositif ou permission dédiée). | 2026-10-12 | À intégrer à B-6c |
| @qa-engineer @security | **Correctifs B-6b (a084834 + c6ef708) : QA PASS avec réserves (A08, `QA-B6bF*.test.ts`, Postgres 16 jetable 001..060 OK) ; Sécurité : F-B6b-01/02/03, B-6b-01, QA-B6b-01 retestés et fermés, feu vert staging (A10).** | 2026-10-12 | Revues faites |
| @dev-backend | **QA-B6bF-02** MINEUR : toute erreur 42501 (y compris un vrai défaut de droit) devenait « échelle figée » (400). | 2026-10-12 | Corrigé (orchestrateur) — correspondance sur le message du trigger |
| @qa-engineer @dev-backend | **QA-B6bF-01** MINEUR : le test d'inventaire B-6c ne voit pas un champ renommé ; garde ajoutée par A08 (noms canoniques), accès par crochets/déstructuration non couverts. | 2026-10-12 | Atténué |
| @dev-backend | **QA-B6bF-03** INFO : `createDraft`/`updateDraft`/`discardDraft` renvoient la version sans `reducedMasteryIndependence`. | 2026-10-12 | Fermé (A08, 2026-10-17) |
| HUMAN @risk-manager | **QA-B6bF-04 / F-B6b-09 / q111** Rapport appétence : un risque dont la sous-catégorie n'a pas de seuil dans le Dispositif (ou sans Dispositif applicable) apparaît « non dépassé » — à signaler comme « non suivi » ? | 2026-10-12 | **Décidé (DECISION-051)** : signaler « pas d'appétence rattachée », distinct de « non dépassé » → item @dev-backend @dev-frontend |
| @dev-db | **F-B6b-06** LOW 2.2 : 060 ne garde que l'UPDATE ; un INSERT direct peut créer une évaluation à l'instantané fabriqué → trigger BEFORE INSERT (search_path épinglé). **F-B6b-07** INFO : FK composite `(tenant_id, rating_scale_id)` et `rating_scale_version` à geler. Migration 061. | 2026-10-12 | Migration 061 écrite (590b745), à revue A08/A10 — jamais appliquée à la main |
| @dev-backend @dev-db | **F-CAT-02** LOW 2.7 : `RiskCategoryService.update` ne revérifie pas `parentId` comme `create` (parent d'un autre tenant accepté, oracle d'existence via 23503, cycle possible) → réutiliser les contrôles de `create` + FK composite `(tenant_id, parent_id)`. F-CAT-01 (désactivation sous `config.manage`) : INFO, non terminal, conforme. | 2026-10-12 | Corrigé (service 60560c4 + FK 061), à retest A10 |
| @dev-backend @security | **QA-REF-01** MAJOR (= F-CAT-02 côté écran) : `RiskCategoryService.update` ne valide ni existence ni profondeur du parent → chaîne de profondeur 2 invisible à l'écran, cycle A↔B possible. | 2026-10-12 | Fermé (A08 + A10, 2026-10-17) |
| @dev-backend @security | **QA-REF-02** MAJOR : `DepartmentService.archive` sans contrôle de références (processus gardant un département archivé). **+ violation CLAUDE.md** : `CreateDepartmentBody` accepte `riskOwnerDesignatedBy` (attribution client-settable) → à forcer côté serveur ou retirer. | 2026-10-12 | Fermé (A08 + A10, 2026-10-17 ; complété par QA-REF2-01) |
| @dev-frontend | **QA-REF-03..06** MINOR : libellé « désigné le … » faux pour un Risk Owner par défaut ; courses de réponses périmées sur `refresh` ; selects parent/département qui perdent une valeur inactive/archivée ; filtre client `d.active` ; ArchiveModal ouvert sur 403 ; création de processus inactif ; resynchro silencieuse du Risk Owner. | 2026-10-12 | Fermé par revue statique (A08, 2026-10-17) — pas de QA navigateur |
| @dev-backend @dev-frontend | **Gaps écran Dispositif (94b3d9d)** : pas d'endpoint « mes permissions » (actions toujours visibles, serveur tranche) ; seuils d'appétence en lecture seule dans le brouillon (éditeur de liste à construire) ; `changeApprover` figé RISK_MANAGER jusqu'à B-12 ; B-6b-03 (avertissement R2) non fait ; `GET /applicable` et assignation Dispositif→processus non couverts (aucune route d'assignation vue) ; pas d'archivage de Dispositif ; demandes de changement sans libellés (identifiants bruts). **Ajout 2026-10-18 (revue Codex PR #186)** : la page Appétence lit encore l'ancien référentiel `GET /appetite` (libellé « ancien référentiel » posé) ; afficher les seuils de la version active du Dispositif ; l'éditeur de seuils dans le brouillon est le seul chemin d'écriture restant à construire. | 2026-10-17 | Ouvert |
| @dev-backend | **QA-REF2-01** MAJOR : un processus inactif ne bloquait pas l'archivage de son département (réactivation ensuite sur département archivé). Corrigé par l'orchestrateur : `archive` compte aussi les inactifs ; test QA-REF2 réécrit. | 2026-10-17 | **Fermé — RETEST_PASS A08 (2026-10-18)**, invariant « jamais un processus, actif ou non, sur un département archivé » vérifié sur tous les chemins séquentiels (`QA-REF2b.test.ts`) |
| @qa-engineer @dev-db HUMAN | **Réserves retest QA-REF2-01 (A08, 2026-10-18)** : (1) lignes antérieures à `3792a89` non réparées — processus inactif déjà rattaché à un département archivé possible en production ; requête lecture seule de contrôle à ajouter à la checklist pré-production ; invariant tenu par le service seul (FK aveugle au soft delete, cf. F-REF-02). (2) Un département `active: false` non archivé reste rattachable — conforme à « archivé », à confirmer PO si besoin. (3) **Test `QA-D044-pg` (l. 115) fragile** : compte les sessions `idle in transaction` de toute la base, échoue dès qu'une autre session (psql, autre agent) est ouverte en parallèle — restreindre au pool du test. | 2026-10-18 | Ouvert |
| @product-manager @dev-frontend | **QA-REF2-02..05** MINOR/TRIVIAL : parent de catégorie inactif accepté à l'update (règle produit à trancher) ; bouton « Retirer » proposé à tous alors que réservé au demandeur ; commentaire d'approbation non marqué requis en régime FALLBACK ; demandes ASSIGN_PROCESS/SET_DEFAULT affichées « — ». **QA-REF2-06** : le 409 de course 061 dépend du texte du message PG — ne pas reformuler ce message sans le test. Hors périmètre : utilisateurs rattachés à un département archivé (UserService) non vérifié. | 2026-10-17 | Ouvert (mineur) |
| HUMAN | **QA-REF2-02 / q112** Une catégorie désactivée peut-elle servir de parent ? (recommandé : refuser). Posée dans le cockpit. | 2026-10-17 | **Décidé (DECISION-052) et implémenté (2026-10-18)** : refus d'un parent inactif à la création ou au changement de parent ; lien existant conservé |
| @dev-backend @dev-frontend | **DECISION-050 (q110)** Fiche 360 : garder l'appétence de la version actuellement applicable comme référence, et afficher l'appétence figée sur l'évaluation à titre d'information quand elle diffère. Le backend doit exposer les deux valeurs (aucun recalcul frontend). | 2026-10-18 | Ouvert |
| @dev-backend @dev-frontend | **DECISION-051 (q111)** Rapport appétence vs résiduel (`GET /reports/appetite-vs-residual`) : un risque sans seuil d'appétence (sous-catégorie sans seuil ou sans Dispositif applicable) est signalé « pas d'appétence rattachée », état distinct de « non dépassé », calculé côté backend. | 2026-10-18 | Ouvert |
| @dev-backend | **F-REF-06** INFO, CVSS 0 (A10 retest 2026-10-18) : le motif `risk_framework…` de `mapPgError` (F-REF-05) attrape aussi les gardes d'isolement tenant de 057 (`requested_by/decided_by must belong to the tenant`) → 400 « figé » au lieu de 500. Inatteignable (champs forcés à `actor.userId`). Exclure ce message au prochain passage sur le fichier. | 2026-10-18 | Ouvert (non bloquant) |
| @dev-frontend | **q112 côté écran** : l'écran Catégories peut encore proposer une catégorie inactive comme parent ; le serveur refuse désormais (400). Filtrer les inactives des options de parent (garder l'option « parent actuel »). | 2026-10-18 | Ouvert (mineur) |
| @dev-backend @dev-db | **F-CAT-03** LOW 2.2 (A10, `docs/security/review-referentials-2026-10-17.md`) : deux updates croisés concurrents (A→B, B→A) créent un cycle de catégories (PoC `[OK, OK]`) ; exige `config.manage`. Confirmé aussi par Codex sur PR #184 (P2). Correctif proposé : trigger (search_path épinglé) qui verrouille la ligne parente `FOR UPDATE` et vérifie la profondeur. **Avant production.** | 2026-10-17 | Ouvert (A06 + A07) |
| @dev-backend @dev-db | **F-REF-02 / Codex P2 (PR #184)** : archivage d'un département non atomique — une création/réaffectation de processus concurrente peut rattacher un processus à un département archivé (la FK ne voit pas le soft delete). À traiter avec F-CAT-03 (même famille : invariant à porter en base, verrou ou trigger). **Avant production.** Codex P1 (061 : lecture de la version sans verrou) corrigé par `FOR SHARE`, prouvé sur PG16 local. | 2026-10-17 | Ouvert (A06 + A07) |
| @dev-backend @dev-db @dev-frontend | **A10 INFO** : F-REF-02 limites de l'archivage (repo processus optionnel, course création/archivage) ; F-061-01 version d'échelle NULL→texte libre sur évaluation sans Dispositif ; F-REF-01 commentaire périmé `Department.ts` ; F-REF-03 identifiants dans les URL sans `encodeURIComponent`. **F-REF-04** (message 061 ACTIVE/tenant séparé) et **F-REF-05** (`mapPgError` ne masque plus un vrai 42501 de privilège) : corrigés par l'orchestrateur. | 2026-10-17 | INFO ouverts ; **F-REF-04/05 RETEST_PASS A10 (2026-10-18), fermés** ; `FOR SHARE` (30d1359) PASS |
| @dev-db @qa-engineer | **061 — tests pg** : les fichiers pg qui font `ALTER TABLE … TRIGGER` se bloquent en parallèle → lancer avec `--no-file-parallelism`. FK composites 061 NOT VALID : `VALIDATE CONSTRAINT` à jouer à part après contrôle des données (requête pré-déploiement à fournir au PO). | 2026-10-17 | Ouvert |
| @dev-backend | **F-B6b-08** INFO : `/applicable?processId=` révèle le Dispositif d'un processus aux détenteurs de `riskframework.read` (déjà visible par ailleurs). | 2026-10-12 | Accepté (info) |
| @risk-manager | **I-D8 (spec B-6 §14.2, A05)** : q98 ne contraint en amorçage que les paramètres qui ont une valeur par défaut au contrat. Restent libres : échelle, appétence, seuil « faible », durée de délégation, seuil Comité de traitement → un Risk Manager seul peut fixer une appétence ou un seuil « faible » élevés au démarrage. Acceptable, ou question PO ? | 2026-10-12 | **Tranché A13 (2026-10-18, `A13-review-DECISION-044.md` §7)** : acceptable sans plafond (un plafond serait une décision PO nouvelle) ; les 5 valeurs libres figées dans `bootstrap_justification`/audit et montrées dans la route BOOTSTRAP et la notification ; R2 = « valeur à examiner », non bloquant. Transmis à A06 (B-6d) |
| @risk-manager | **I-D9 (spec B-6 §14.2, A05)** : un Risk Manager qui est aussi administrateur peut se désigner lui-même comme « administrateur sollicité » dans le motif structuré d'amorçage (I-D2). Faut-il l'interdire ? | 2026-10-12 | **Position A13 (2026-10-18) : interdire** (refus si `askedUserId = actor.userId`, `askedUserId` doit être un administrateur actif du tenant). Implémentée isolée par A06, **en attente PO (q113)** — spec §5.6 pt 6 non modifiée tant que le PO n'a pas tranché |
| HUMAN | **q113 (I-D9)** [**Répondue → DECISION-055** : tout configurable par client, défaut strict ; consultation A13/A06/A10/A05 en cours] Si la même personne est à la fois l'unique administrateur et l'unique Risk Manager, le démarrage du Dispositif par simple déclaration (« aucun autre administrateur ne peut créer un second membre ») reste-t-il permis ? A13 recommande de l'interdire : il faut alors un second administrateur, ou créer un second membre du groupe Risk Manager avant d'activer. Vérifier si c'est le cas de Djamo au démarrage (q93). Posée dans le cockpit. | 2026-10-18 | Ouvert (HUMAN) |
| @dev-backend @dev-db @qa-engineer @security @compliance | **B-6d livré (A06, 2026-10-18, migration 062 jamais appliquée hors PG16 local)** : repli q100 (`foldVoteBeforeB12`, `fallback_cause = LEGACY_APPROVER_PRE_B12`), amorçage §5.6 (route `POST /change-requests/:rid/bootstrap-approve`, fin mémorisée `tenants.risk_framework_bootstrap_ended_at` posée par trigger, jamais rouverte, notification `RISK_FRAMEWORK_BOOTSTRAP_NOTICE`), I-D8 (valeurs libres figées dans `bootstrap_justification.freeParameters`), I-D9 isolée (`BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF = false`, en attente q113). Vérifié par l'orchestrateur : typecheck OK, 1974 passed / 46 skipped, pg 46/46 (base recréée 001..062). **Tests existants adaptés** (409 → repli q100 dans B6a, QA-B6a, QA-B6abis, QA-D044 ; catalogue 11 → 12) : à revoir par A08. **Limite connue** : un changement de `roles.system_group` ou la réactivation d'un rôle désactivé ne pose pas le marqueur de fin d'amorçage. A07 non spawné (migration écrite par A06). Passages A08, A10, A14 (spec §17) dispatchés. | 2026-10-18 | Livré, en revue |
| @dev-backend @qa-engineer @security | **Correctifs revues B-6d (A06, 2026-10-18)** : QA-B6d-01 (comparaison sur l'id canonique renvoyé par la base), F-B6d-01 (`user_roles.granted_by/granted_at` : refus si le droit admin de l'administrateur cité a été accordé par le demandeur ou après `askedOn` ; limite : un tiers complice reste indétectable), QA-B6d-02/F-B6d-03/C-B6d-01 (062 corrigée en place : trigger sur `roles`, cause et ligne déclencheuse de fin mémorisées), F-B6d-04 (`FOR NO KEY UPDATE`), notice enrichie (motif + « également administrateur »), tests de câblage. Vérifié par l'orchestrateur : typecheck OK, 2005 passed, pg 60/60, 0 `it.fails`, search_path sur les 3 fonctions. Non fait : PoC d'interblocage F-B6d-04 non rejoué ; essai sur copie de staging (C-B6d-07, HUMAN). Retests A08 + A10 dispatchés. **A08 : RETEST_PASS** sur les 3 constats (+6 tests, typecheck OK, 2007 passed, QA-B6d-pg 18/18). **A10 : RETEST_PASS** sur QA-B6d-01, F-B6d-03, F-B6d-04 (PoC interblocage rejoué : plus de deadlock), search_path (up/down/up/up) ; F-B6d-01 RETEST_FAIL LOW 2,0 non bloquant (ligne dédiée). Feu vert staging. | 2026-10-18 | Corrigé, retests OK |
| @dev-backend | **F-B6d-01 résiduel (A10 retest, LOW 2,0)** : un RM détenant `role.update` peut ajouter une permission admin à un rôle ordinaire que l'administrateur cité tient depuis longtemps (affectation ancienne, par un tiers) — le contrôle ne regarde que l'affectation, pas la date où le rôle a reçu la permission admin. Correctif proposé : exiger `role.updatedAt` (jour UTC) `<= askedOn`. Non bloquant pour staging. **Corrigé (orchestrateur, PR #185)** : 1er correctif `day(role.updatedAt) <= askedOn` (5588fbd) → **RETEST_FAIL A10** (contourné par `askedOn` = aujourd'hui). 2e correctif : refus si la piste d'audit du rôle (`listForEntity("Role")`) contient un `CREATE` ou `PERMISSION_CHANGE` du demandeur — le contrôle par date sur le rôle est retiré (plus de faux refus sur renommage). Résidu accepté : l'audit de `RoleService.update` est écrit hors transaction (variante plus robuste `roles.permissions_changed_by` proposée par A10, non retenue — ponytail). Test B6d `askedOn` = aujourd'hui ; 2008 passed, pg 64/64. 3e correctif 4e43770 (Gitar : `RoleService.update` journalise tout en `PERMISSION_CHANGE` → ne compter que l'ajout effectif d'une permission admin). **A10 RETEST_PASS sur 4e43770** (PoC rt6–rt8 sous `grc_app_runtime` : élargissement par le RM refusé, par un tiers accepté, renommage accepté, retrait/remise refusé). | 2026-10-18 | **Fermé** |
| @dev-db | **F-B6d-07 (INFO, A10)** : `UPDATE user_roles SET role_id/user_id` contourne le trigger de fin d'amorçage (il ne suit que `revoked_at`). SQL direct uniquement, pas atteignable par l'API. | 2026-10-18 | Ouvert |
| @dev-backend @security | **Même classe que QA-B6d-01 hors B-6d (orchestrateur, 2026-10-18, non rejoué)** : comparaison texte d'un identifiant **fourni par le client** avec `actor.userId` (canonique, minuscules). PG `uuid` accepte les majuscules et résout le même utilisateur → garde maker-checker contournable. `RoleService.assignToUser` (`POST /roles/:id/assign`, `userId: z.string()`) : **un admin peut s'auto-attribuer un rôle** (ACT-093/113) ; `RoleService.revokeFromUser` (auto-révocation) ; `UserService.suspend` (auto-suspension). Sans effet : `NotificationService.listForRecipient` (lit toujours `actor.userId`). Correctif racine proposé : normaliser l'id à la frontière (schéma zod `Id` partagé qui valide l'uuid et le passe en minuscules) plutôt que patcher chaque comparaison + test garde. **A10 : SEC-ID-01 confirmé par PoC, MEDIUM 6,7** (auto-attribution Comité/Audit, auto-modification de ses propres permissions via `PATCH /roles/:id` en MAJUSCULES, auto-révocation, auto-suspension) + SEC-ID-02 (LOW/INFO : cumuls, dernier rôle, catégorie parente d'elle-même, archivages) — `docs/security/review-id-case-2026-10-18.md`. **Corrigé (orchestrateur, PR #185, demande PO)** : 1er correctif e3456c9 (minuscules seules) insuffisant — PG accepte aussi sans tirets, accolades, tirets mal placés (vérifié). Correctif racine : `domain/ids.ts` `canonicalId()` (toutes les graphies PG → forme canonique) + middleware `canonicalIdsMiddleware` monté avant toutes les routes (chemin, y compris `%41`, query, corps JSON récursif) ; gardes service en défense en profondeur (`assignToUser`/`revokeFromUser`/`suspend` canonisent, `update` compare l'id relu en base). Tests : `CanonicalIds.test.ts` (5 graphies HTTP + garde de montage) + régressions RoleService/UserService. Hors HTTP (import Excel, jobs) non couvert par le middleware. **A10 retest 76adb55 : RETEST_PASS** (app réelle, 32 requêtes toutes 403, aucun contournement du middleware, aucun faux positif — `review-id-case-2026-10-18.md`). Reste INFO : entrées non HTTP (import Excel, multipart, jobs) — seules les 4 gardes maker-checker ont la défense en profondeur ; id invalide → 500 au lieu de 400 ; ne jamais nommer `…Id` un identifiant externe hexadécimal (commentaire à ajouter au middleware). | 2026-10-18 | Fermé (INFO restants) |
| @security @HUMAN | **INFO A08 (retest B-6d)** : F-B6d-01 ne remonte pas la chaîne d'octroi — un tiers créé (ou promu) par le demandeur peut lui-même accorder le droit admin à l'administrateur cité, et un `granted_by` NULL (seed, octrois antérieurs) passe le contrôle. Limite déjà admise par A06 (« tiers complice indétectable ») ; à confirmer avec A10 si une remontée transitive vaut son code, puis arbitrage PO. | 2026-10-18 | Ouvert |
| HUMAN | **Requête pré-production n° 10** (`docs/security/B8-predeploy-checks.sql`, lecture seule, B-6d / q100) : à exécuter par le PO avant production, attendu 0 ligne. | 2026-10-18 | Ouvert (HUMAN, avant production) |
| @compliance @dev-backend @dev-db @dev-frontend HUMAN | **Compliance B-6d (A14, `docs/compliance/A14-review-B6d.md`) : CONFORME AVEC RÉSERVES, aucun COMPLIANCE_BLOCK pour staging** ; le bloc est levé pour le code mais **maintenu comme règle de livraison : B-6b ne part jamais en production sans B-6d (059 à 062 ensemble)**. Limite de la revue : ni tests ni `git show` lancés par l'agent. | 2026-10-18 | Revue faite |
| @dev-backend @dev-db | **C-B6d-01** MOYEN : la fin d'amorçage est datée sans cause mémorisée (pour les tenants existants, date = migration) ; changement de `roles.system_group` / réactivation d'un rôle ne posent pas le marqueur. À corriger **dans 062 avant toute application** (jamais appliquée hors PG16 local). À croiser avec les constats A08/A10. | 2026-10-18 | Ouvert (A06/A07) |
| @dev-frontend HUMAN | **C-B6d-02** MOYEN : la vue « décisions prises en votre absence » promise par le contrat n'existe qu'en API (`GET change-requests?regime=BOOTSTRAP`). Question PO q114. | 2026-10-18 | Ouvert |
| @dev-backend | **C-B6d-03** FAIBLE-MOYEN : l'administrateur cité dans le motif d'amorçage n'est pas prévenu ; la notice ne reprend ni le motif ni le marquage administrateur + Risk Manager. | 2026-10-18 | Ouvert (A06) |
| @dev-backend | **C-B6d-05** MOYEN : aucune écriture possible de la ratification q100 avant B-12 ; indicateur « en attente de ratification » non vérifié. Table de ratification avec B-12. | 2026-10-18 | Ouvert (A06, B-12) |
| @architect @dev-db @dev-backend @qa-engineer HUMAN | **C-B6d-04/06/07/08** FAIBLES : risque accepté par le PO (amorçage sans ratification ni échéance, q83) ; spec §5.6 pt 6 / §14.2 à aligner après q113 (A05) ; 062 à jouer sur une copie de staging + `VALIDATE CONSTRAINT` du CHECK NOT VALID (HUMAN/A07) ; test de câblage `RoleService` manquant (A06/A08). | 2026-10-18 | Ouvert |
| HUMAN | **q114 (Q-A14-B6d-2)** La vue « décisions prises en votre absence » doit-elle être livrée avant l'arrivée du premier membre Audit ou Comité en production, avec à défaut une procédure écrite tenue par le PO ? (A14 recommande : oui). Posée dans le cockpit. **Répondue : oui → DECISION-056.** | 2026-10-18 | Fermé |
| HUMAN | **Consultation configurabilité (DECISION-054/055) terminée** — A05, A06, A10, A13 : `docs/architecture/consultation-configurabilite-2026-10-18.md`. Arbitrages posés au PO dans le cockpit : **q115** (éléments jamais configurables), **q116** (assouplir = deux personnes, jamais la personne contrainte), **q117** (régime « structure à une personne » à la place de l'auto-désignation I-D9), **q118** (qui modifie la méthodologie dans l'Administration : Risk Manager seul ou aussi l'admin), **q119** (cumul Comité + Audit : interdit par défaut ?). Aucune implémentation de la configurabilité avant réponse. **Répondues le 18/10 → DECISION-057 à 061.** Reste : q120 (3 invariants absents de la réponse q115). | 2026-10-18 | Fermé (sauf q120) |
| @dev-backend @dev-frontend @qa-engineer | **Correctifs « un seul chemin d'écriture » (A05, DECISION-054), sans arbitrage PO requis** : (1) fermer `PUT /processes/:id/evaluation-mode` (contrat §10 retire la permission ; seul le circuit demande/validation reste) ; (2) fermer ou marquer « non appliqué » `PUT /config` et `/config/appetite-mode` (réglages inertes, lus par aucun code) ; (4) écrans Appétence / Grilles : retirer les écritures mortes (`frontend/src/api/riskAppetite.ts:29,31`, `evaluations.ts:155`) au profit d'un lien vers le brouillon du Dispositif ; (7) test de garde « porté par le Dispositif ». À vérifier : `PATCH /rating-scales/:id/disable`. **Livré A06 `5b35762` (fusion `ebbc70d`)** : 3 routes en 410, écritures mortes retirées du frontend, `SingleWritePath.test.ts`, motif obligatoire sur le toggle de module (DECISION-058) ; `disable` n'est pas un second chemin. Restes : (a) le retour d'un processus à « hérité » (null) n'est plus possible — impact évalué par A08 avant question PO ; (b) code mort sans route à retirer en lot dédié (`ProcessService.setEvaluationMode`, `ConfigService.updateMethodology/updateAppetiteMode`, permission `process.evaluationmode.set`, épinglés par SEC-017/QA-B6b). Revues A08 + A10 en cours. | 2026-10-18 | Livré, en revue |
| HUMAN | **q120 (suite q115 / DECISION-057)** Votre réponse à q115 cite 6 invariants ; la liste proposée en contenait 3 de plus : pas de validation tacite ; cumul de rôles toujours visible ; historique jamais réécrit. Les garder aussi non configurables ? Posée dans le cockpit. | 2026-10-18 | Décidé (DECISION-063) |
| HUMAN | **q121 (OD-10)** Étape Analyse de la refonte Risques : structure (listes causes/événements/impacts + contexte, figées à chaque évaluation) et qui l'écrit (recommandé : Risk Owner seul, les autres contribuent). Posée dans le cockpit. Bloque la partie Analyse de DECISION-062. | 2026-10-18 | Décidé (DECISION-064) |
| HUMAN | **q122 à q125 (UX navigation Risques, `docs/ux/RM-V1-Navigation-Risques.md` Q1-Q4)** : q122 grille modifiable seulement depuis un brouillon de Dispositif ; q123 raccourci = ouvrir l'écran d'Administration seulement (V1) ; q124 Méthodologie en lecture seule pour tous les lecteurs des risques ; q125 garder l'entrée « Évaluations ». Recommandé : oui aux quatre. Posées dans le cockpit. Ne bloquent ni le déplacement des entrées ni le retrait des écritures d'appétence. | 2026-10-18 | Décidé (DECISION-065) |
| HUMAN | **q126 à q130 (A13, vérification DECISION-060)** : q126 structure à une personne : auto-approbation « sans second regard » après le premier Dispositif ? ; q127 levée du régime à l'arrivée d'un 2e Risk Manager ou de toute 2e personne ? ; q128 l'admin peut-il abandonner un brouillon ? ; q129 l'admin propose-t-il le rattachement processus → Dispositif (B-6c) ? ; q130 DECISION-058 limitée aux réglages hors Dispositif ? Recommandations A13 : oui / 2e Risk Manager / oui / oui / oui. Posées dans le cockpit. Aussi à valider : passage §10 « Gouvernance d'un changement de paramètre » du contrat amendé, marqué « Rédaction A13, à valider par le PO ». | 2026-10-18 | Décidé (DECISION-066/067/068) |
| HUMAN | **q131 (QA-SWP-05)** Un processus doit-il pouvoir revenir au mode d'évaluation de son Dispositif (« hérité ») ? Le circuit ne sait plus l'exprimer depuis la fermeture de `PUT /processes/:id/evaluation-mode`. Recommandé : oui, demande « revenir au mode du Dispositif » dans le circuit. Lien QA-SWP-07 : en structure à une personne (q126/q127), plus personne ne peut changer le mode d'un processus. Posée dans le cockpit. | 2026-10-18 | Décidé (DECISION-069) |
| HUMAN | **Revue Codex PR #186, 2 constats non corrigés (choix de l'orchestrateur, à confirmer)** : (a) P2 course « désactivation d'échelle / brouillon de Dispositif qui la référence » : seul effet, un brouillon non activable, corrigé par son auteur ; correction = verrou de ligne sur deux chemins, jugée disproportionnée (déjà résidu INFO de la Sécurité). (b) P1 « plus d'éditeur de seuils d'appétence » : l'ancien formulaire échouait déjà à chaque envoi (refus serveur depuis le Dispositif) ; l'éditeur dans le brouillon relève de l'étape 2 de DECISION-062. Fils laissés ouverts sur la PR. | 2026-10-18 | **Fermé par DECISION-070** (le PO demande de corriger les deux). |
| HUMAN | **Arbitrage des droits et accès (DECISION-068)** : catalogue fusionné `docs/governance/droits-acces/catalogue.json` (209 droits, 12 rôles), publié dans la section « Droits et accès » du cockpit. 20 conflits de gouvernance signalés par A13, dont 5 élevés : `config.committeeenforcement.set` et `config.cumul.set` (un administrateur seul assouplit, alors que le Dispositif exige deux personnes), `rolegroup.audit.update` (l'Audit réglé par un non-Audit), `guard:noSelfRoleChange` et `guard:noSelfValidation` (structure d'une personne, à concilier avec DECISION-066). L'arbitrage se fait dans le cockpit (collection `rightDecisions`) ; chaque réponse devient une entrée du Decision Log. Bloque : DECISION-060/067, DECISION-064, DECISION-066, DECISION-069. | 2026-10-18 | Fermé (DECISION-072, sauf `guard:notLastRiskManager` rouvert en question) |
| HUMAN | **q132 / q133 (cockpit) — éditeur des seuils d'appétence dans le brouillon du Dispositif (correctif Codex P1, commit 60f7757)** : q132 placement (fenêtre « Modifier le brouillon » actuelle ou onglet dédié) ; q133 sous-catégorie choisie dans le référentiel ou en texte libre (`subCategoryId` non alimentable depuis l'écran aujourd'hui). Mineur, non soumis : une erreur serveur sur la liste s'affiche en bannière globale, sans pointer la ligne. | 2026-10-18 | Fermé (DECISION-071) |
| HUMAN | **q134 (cockpit) — A10 F-063-03** : un brouillon de Dispositif abandonné (ARCHIVED) bloque pour toujours la désactivation de l'échelle qu'il référençait (règle `isReferencedByFrameworkVersion` + migration 063). Recommandation : seules les versions approuvées (en vigueur ou anciennes) bloquent. | 2026-10-18 | Fermé (DECISION-071) |
| HUMAN | **`guard:notLastRiskManager` — démission ou absence du seul Risk Manager, intérim** : le PO a rouvert ce point dans son arbitrage (« comment gérons-nous une démission s'il n'y avait qu'un seul Risk Manager ? comment gérons-nous l'intérim ? le groupe peut être vide »). Options A13 posées en cockpit : **q137**. | 2026-10-18 | Fermé (DECISION-074) |
| HUMAN | **Panel « Principes de gouvernance non respectés » (DECISION-073)** : catalogue des principes et indications TPE / PME / grande entreprise (A13), règle de détection de la taille d'après les rôles assignés (A13), architecture du calcul côté serveur (A05), maquette (A04). Propositions livrées (`docs/governance/principes/`, `docs/architecture/RM-V1-Panel-Principes-Gouvernance.md`, `docs/ux/RM-V1-Panel-Principes-Gouvernance.md`). Questions cockpit **q135, q136, q138 à q144** (taille, principes affichés, acceptation, données manquantes, qui voit, portée de la double confirmation, statut, rétroactivité, notification). Bloque les lots P1 à P6 de la spec A05. | 2026-10-18 | Fermé (DECISION-074) |
| @dev-backend | **Constats A13/A05 pendant le cadrage DECISION-073** : (1) commentaire de `Config.committeeAuditCumulAllowed` « Default true » périmé depuis DECISION-061 ; (2) `isAdministrator` / `isRiskManagerMember` privés dans `RoleService.ts`, à déplacer dans `domain/fixedGroupPermissions.ts` (pas de duplication) au lot P2 ; (3) la table du journal s'appelle `audit_log` (singulier), CLAUDE.md écrit `audit_logs`. | 2026-10-18 | Ouvert |
| @dev-backend | **A10 F-FW-01 LOW 2.2** (`docs/security/review-codex-fixes-pr186-2026-10-18.md`) : le libellé libre `subCategory` d'un seuil d'appétence n'est pas relié à `subCategoryId` (libellé trompeur possible). Correctif : déduire le libellé de l'id côté serveur — à traiter avec la réponse PO à q133. | 2026-10-18 | Fermé côté écriture (q133, d387257) ; résidu F-FW-01-R ci-dessous |
| @dev-backend | **QA-064-01 (MINOR) + A10 F-FW-01-R (LOW 2,2)** (`docs/security/review-q132-q134-2026-10-18.md`) : à la demande d'activation, revérifier chaque seuil comme à l'écriture (id présent, catégorie active avec parent) et refuser un libellé hérité différent du nom de la catégorie. Corrigé (b485f5a, fusionné 64ac8c0) ; RETEST_PASS QA et A10. INFO A08 : une catégorie renommée pendant une demande PENDING_APPROVAL fait échouer l’approbation ; rejeter la demande rend le brouillon modifiable. | 2026-10-18 | Fermé |
| HUMAN | **q145 (cockpit) — A10 F-FW-02 (LOW 4,3, antérieur au lot)** : le seuil d'appétence appliqué à une évaluation est retrouvé par égalité exacte du libellé de sous-catégorie, saisi librement dans l'évaluation ; un libellé un peu différent ou un renommage de catégorie fait disparaître le seuil sans message. Recommandation A10 : correspondance par `subCategoryId`. À traiter avant la production. | 2026-10-18 | Fermé (DECISION-074, q145) — mise en œuvre @dev-backend |
| @risk-manager @architect | **DECISION-074 — mise à jour du cadrage du panel** : questionnaire de profil d'organisation (q135), niveau d'exigence par taille (q136), règle intérimaire / suppléant (q137), inventaire et modèle de toutes les données manquantes (q139), acceptation datée (q138), statut « Appliqué sans validation indépendante » (q142). Le questionnaire et les seuils de classement repasseront en cockpit avant développement. | 2026-10-18 | Fait (A13 v0.2, A05 révision R-0 à R-9, lots D0 à D7) |
| HUMAN | **q146 à q153 (cockpit) — panel de gouvernance, avant lancement des lots D1 à D7** : questionnaire et seuils (q146), qui remplit / baisse de taille (q147), comptage « plus d'une personne » (q148), départ du dernier Risk Manager sans intérimaire (q149), liste D01-D19 et reprise du propriétaire de processus (q150, A13 et A05 divergent), principes dépendant de fonctions non construites (q151), deux comptes d'une même personne (q152, rappel de l'arbitrage DECISION-072), acte appliqué sans validation indépendante dans les calculs (q153, change la taille du lot D4). Interprétations non bloquantes I-R1 à I-R6 : spec A05 §R. | 2026-10-18 | Fermé (DECISION-075) |
| HUMAN @risk-manager | **q154 (à poser)** : choix des 6 questions du profil d'organisation et seuils de classement ajustés (suite q146, DECISION-075). Proposition A13 puis validation PO. Bloque D3. | 2026-10-18 | Fermé (DECISION-076) |
| @devops | **Ordre migration / déploiement (lot D1, migration 066)** : l'INSERT d'audit écrit `audit_log.governance_exception` ; si le code est déployé avant que migrate.yml applique 066, toute écriture d'audit échoue (déjà vrai pour 065 / `sub_category_id`). Vérifier que le déploiement Render de staging attend la fin de migrate.yml, sinon le documenter et surveiller la fenêtre au merge. | 2026-10-18 | Ouvert |
| @dev-backend @qa-engineer @security @privacy | **Panel de gouvernance — vagues 1 et 2 fusionnées** : D1 (066), D2a (067), D2d (068), D2b (069, 0d217e9), D4 (sans migration, da1f6f5), D2c (070, ae57e5e), D3 (071, 09c5aa0). Suite complète : 2224 tests verts. Passages QA (A08) + Sécurité (A10) + Compliance (A14) sur D1 à D4 dispatchés ; ensuite D5 (072), D6 (073, bloqué par q155/q156), D7 (UI). | 2026-10-18 | En cours |
| HUMAN @security @risk-manager | **D2c — choix à confirmer** : (1) la suspension du dernier Risk Manager reste refusée (la passation à l'intérimaire ne couvre que le retrait de rôle) ; (2) un intérimaire dont la date de fin est dépassée n'est pas utilisé, on tombe sur le départ avec confirmation (groupe vide) ; (3) marqueur d'audit `riskManager.vacancy`. À soumettre en question cockpit après revue A10/A13. | 2026-10-18 | Fermé (DECISION-078 : q160 trace seule, q161 comportements gardés) |
| HUMAN @security @risk-manager @compliance | **D3 — choix à confirmer** : (1) seule une baisse de taille avec un tiers disponible passe en attente de seconde confirmation ; sans tiers, elle s'applique avec le marqueur `orgprofile.adminAlone` ; (2) `orgprofile.approve` est donné au groupe Audit (tension avec « l'Audit ne décide jamais »). À trancher après revue A10/A13/A14. | 2026-10-18 | Fermé (DECISION-078 q157 ; règle « sans tiers » gardée avec marqueur) |
| HUMAN @compliance | **D4 — choix à confirmer** : (1) le circuit à deux personnes pour modifier la politique d'auto-validation n'est pas construit (admin seul + motif + trace, marqueurs `config.selfvalidation.adminAlone` / `.direct`) ; (2) les actions de rejet, la proposition de décision de traitement (N+1 fixe), RoleService, RiskFrameworkService et RiskService restent hors de la double confirmation. À trancher après revue A14. | 2026-10-18 | Ouvert |
| @dev-backend | **CMP-PNL-01 (A14, Élevée en production)** : dans les 8 services avec double confirmation (D4), dans la politique et dans les désignations, l'écriture métier précède l'audit hors transaction ; si l'audit échoue, l'acte reste sans marqueur. Rendre l'écriture et l'audit atomiques (modèle : 071, passation D2c). Conditionne le COMPLIANCE_BLOCK de production avec D5 (CMP-PNL-02). Rapport `docs/compliance/review-panel-d1-d4-2026-10-18.md`.  **Confirmé par A10 (SEC-PNL-01, MEDIUM 4,3, PoC)** : un octet NUL dans le motif `governanceConfirmation` fait échouer l'audit (22P05) — validation enregistrée, aucune trace, affichée INDEPENDENT ; idem sur la politique (22021). Correctif : refuser les caractères de contrôle dans les motifs + effet et audit dans la même transaction. À corriger avant la production. Rapport `docs/security/review-panel-d1-d4-2026-10-18.md`. | 2026-10-18 | Partiellement fermé (5b49656 : `reasonText` refuse NUL, contrôles et invisibles, vecteur SEC-PNL-01 fermé) — reste : atomicité effet+audit (panne de l’audit après l’effet) et contrôle détectif « validateur = auteur sans marqueur » ; conditionne toujours la production |
| HUMAN @security @privacy | **Lot arbitrages PO (3ed076c) — points à confirmer** : (1) q155 côté Google : pas de moment de connexion côté serveur ; « connexion » = première vérification d'un nouveau jeton (`iat` nouveau), donc un renouvellement silencieux du jeton (~1 h) compte comme connexion (plafonné par le throttling 1 h) ; (2) une demande d'assouplissement PENDING n'expire pas, l'admin peut la remplacer (retrait tracé) ; (3) `PUT /config/self-validation-policy` répond 202 + `pendingRequest` quand une demande est créée — le frontend devra le gérer (D7). À revoir au passage QA/Sécurité. | 2026-10-18 | Ouvert |
| @dev-db | **CMP-PNL-10 / CMP-PNL-15 (A14)** : `governance_designations` (070) sans trigger d'immuabilité ni REVOKE (contrairement à 071) ; le régime une personne (068) n'écrit aucune entrée d'audit à la déclaration ni à la levée. | 2026-10-18 | Ouvert |
| @dev-backend | **SEC-PNL-03 (LOW 2,7, PoC)** : une baisse de taille déclarée masquée par les faits observés passe ACTIVE sans seconde confirmation ni marqueur ; mesurer la baisse sur les seules réponses déclarées. **SEC-PNL-04 (LOW 2,7)** : un admin seul peut fabriquer « aucun tiers » (retrait Audit/Comité/dernier RM, action, remise en place) — tracé mais sans notification ; à couvrir par les notifications D5. | 2026-10-18 | Ouvert |
| @dev-db | **SEC-PNL-06 (LOW 2,2, SQL direct uniquement)** : `organization_profiles` sans garde à l'insertion (ligne ACTIVE/CONFIRMED par un tiers d'un autre tenant) ; `governance_designations` accorde DELETE, permet de ré-armer un intérimaire utilisé, accepte un utilisateur d'un autre tenant ; le rôle runtime peut déclarer le régime une personne ; colonnes utilisateur de `processes` sans FK liée au tenant. À regrouper avec CMP-PNL-10/15. | 2026-10-18 | Ouvert |
| @dev-backend | **Passage QA panel (A08, PARTIAL_PASS, 7962d90 fusionné ; 2358 tests verts + 8 `it.fails` à basculer en `it` à la correction)** — MAJOR : **F-PNL-01** (D2c) un intérimaire inutilisable (cumul Audit) bloque aussi la sortie `confirmEmptyGroup` → le traiter comme « pas d'intérimaire » ; **F-PNL-03** (D3) une baisse de taille contourne la seconde confirmation si une hausse concurrente rend la version active périmée → revalider sous verrou ; **F-PNL-06** (D2b) `setResponsibilities` compare les ids en texte brut : son propre id en MAJUSCULES contourne l'interdiction de se désigner → `canonicalId` (classe SEC-ID-01). MINOR : F-PNL-02 (404 au lieu de Conflict « retry »), F-PNL-04/05 (gate D4 après les contrôles « déjà validé » / seuil Comité), F-PNL-07 (= CMP-PNL-10), F-PNL-08 (version PENDING sans issue, = CMP-PNL-13). INFO F-PNL-09 à 14 (dont 11 : caractère invisible accepté comme motif, lié à SEC-PNL-01 ; 13 : libellé q142 absent des vues agrégées, = CMP-PNL-06). Rapport `docs/qa/qa-panel-d1-d4-2026-10-18.md`. | 2026-10-18 | Ouvert |
| HUMAN | **A14 — arbitrages PO à poser au cockpit** : CMP-PNL-03 (politique d'auto-validation : « direct » transitoire ou circuit à deux personnes avant recette), CMP-PNL-04 (chemins Comité dans ou hors de la double confirmation, tension DECISION-026), CMP-PNL-08/09 (vacance du Risk Manager : qui confirme, alerte, délai maximal), CMP-PNL-11 (Audit approbateur d'une baisse de taille ou seulement informé). Verdicts A10 convergents : SEC-PNL-02 (Audit approbateur d'une baisse : non compatible avec q42, retirer et notifier), SEC-PNL-05 (politique assouplie par admin seul malgré un tiers, écart DECISION-055), seconde confirmation de vacance = booléen du même admin. Questions cockpit créées : **q157** (Audit et baisse de taille), **q158** (circuit à deux personnes pour la politique), **q159** (chemins Comité), **q160** (vacance du RM : alerte et délai), **q161** (suspension du dernier RM, intérimaire expiré — couvre aussi la ligne « D2c — choix à confirmer »). | 2026-10-18 | Fermé (DECISION-078) |
| @dev-backend @architect | **A14 — constats secondaires** : CMP-PNL-05 (vidage du pool de validateurs), 06 (étiquette d'auto-validation absente des exports/agrégats), 07 (liste couverte/exclue non documentée, pas de test de câblage), 12 (première version du profil et baisses sans changement de classe sans second regard), 13/17 (PENDING bloque le profil, pas de retrait, approbation sans motif), 14 (rattrapages 066/069/070/071 sans liste nominative), 16 (structure à une personne : aucune décision de traitement possible). | 2026-10-18 | Ouvert |
| HUMAN @risk-manager @architect | **D2b I-R1 vs DECISION-066** : personne ne peut se désigner soi-même propriétaire / champion / N-1 d'un processus (I-R1, sans exception). En structure à une personne, le Risk Manager ne peut donc pas se nommer champion. À arbitrer avec le régime « une personne » (D2d) : exception avec double confirmation et marqueur, ou maintien. Question cockpit à poser au lot D6/D7 si confirmé par A13. | 2026-10-18 | Ouvert |
| @architect | **D2b — écarts au plan** : `process.responsibility.assign` hors `ADMIN_PERMISSIONS` (sinon tout Risk Manager compterait comme administrateur et déclencherait les règles de cumul) ; candidats propriétaire limités à 1000 comptes par tenant ; compte suspendu conservé dans la colonne (à signaler par le panel, I-R2). Mettre le plan à jour. | 2026-10-18 | Ouvert |
| HUMAN | **q155 (cockpit) — Privacy D2a R1** : `last_seen_at` est écrit à chaque requête authentifiée (« dernière activité »), pas seulement à la connexion ; une session ouverte fait paraître actif un compte dormant (GOV-ACC-01). Renommer ou limiter l'écriture aux authentifications. Bloque D6. | 2026-10-18 | Fermé (DECISION-077) — à implémenter avant D6 |
| HUMAN | **q156 (cockpit) — Privacy D2a R2** : le masquage q140 couvre les noms, pas les dates attachées à « Personne N » ; sans `audit.read`, n'afficher que des comptages ? Bloque D6. Tests à ajouter en D6 : `last_seen_at` absent de `/users`, `/users/me` et du panel sans `audit.read`. | 2026-10-18 | Fermé (DECISION-077, risque R2 accepté par le PO) |
| HUMAN (juriste Djamo / DPO) | **Privacy D2a R3, R5, R6** : durée de conservation de `last_seen_at` (sauvegardes et PITR compris), texte d'information aux personnes concernées, base légale et formalités ARTCI (loi 2013-450 à confirmer par le juriste). Avant mise en production de D6 (R5 : au plus tard au déploiement de 067 en production). Rapport `docs/privacy/review-d2a-last-seen-2026-10-18.md`. | 2026-10-18 | Ouvert |
| @security HUMAN | **Privacy D2a R7** : les journaux HTTP contiennent déjà IP et user-agent par requête (constat staging 2026-10-08) ; « pas d'IP » (q152) vaut pour la base seulement. À évaluer par A10. | 2026-10-18 | Ouvert |
| @risk-manager @architect | **Privacy D2a R8 (faible)** : `NULL` = aucune activité enregistrée depuis la mise en service de 067, pas « jamais connecté » ; libellé du panel à ajuster en D6/D7. | 2026-10-18 | Ouvert |
| @dev-backend | **Privacy D2a R4** : `userId` retiré du journal d'échec d'écriture de `last_seen_at` (orchestrateur). | 2026-10-18 | Fermé |
| @dev-backend | **q145 / A10 F-FW-02** : l'évaluation choisit sa sous-catégorie dans le référentiel ; le seuil d'appétence est retrouvé par `subCategoryId`, plus par libellé (+ F-FW-03). Avant production. | 2026-10-18 | Fermé (backend c44f0e7, frontend 7eb58ca ; retest A10 PASS addendum 2) |
| @dev-db | **A10 F-064-01 (INFO)** : depuis 064, le contenu d'une échelle référencée seulement par des brouillons abandonnés redevient modifiable (cohérent avec q134 : un brouillon abandonné n'est la preuve d'aucune évaluation). À documenter dans le README des migrations. | 2026-10-18 | Ouvert |
| @dev-backend | **A10 F-FW-03 (INFO)** : deux sous-catégories de même nom sous des parents différents ne peuvent pas porter chacune un seuil (unicité sur le libellé). À traiter avec q145. | 2026-10-18 | Fermé (backend c44f0e7, frontend 7eb58ca ; retest A10 PASS addendum 2) |
| @dev-backend | **q145 régression** : `GET /risk-categories` exige `config.read`, qu'aucun groupe fixe ne porte ; le Risk Manager ne peut donc plus lister les sous-catégories pour créer une évaluation (ni régler les seuils, q132). Correctif : lecture des catégories actives aussi avec `riskevaluation.create` ou `riskframework.read`. Revue A10 requise. | 2026-10-18 | Fermé (be1a397 / ea6e435, A10 PASS addendum 3) |
| @dev-backend | **A10 F-CAT-RD-01 INFO** : lecture de la taxonomie accordée via `riskevaluation.create`/`riskframework.read` plutôt qu'une permission dédiée `riskcategory.read` ; chaînes passées à `includes` non typées `Permission`. Optionnel. | 2026-10-18 | Ouvert (faible) |
| HUMAN / @devops | **q145 staging** : après application de 065 par migrate.yml, compter `SELECT count(*) FROM risk_evaluations WHERE sub_category_id IS NULL` (évaluations antérieures, rapprochées par libellé et signalées « libellé libre hérité »). Lecture seule. | 2026-10-18 | Ouvert |
| @dev-backend | **A10 résidu INFO q145** : la base n'impose ni que `sub_category_id` désigne une sous-catégorie ni que le libellé corresponde au nom (seul le service le vérifie). Retour arrière : down de 065 après retour arrière du code. | 2026-10-18 | Ouvert (faible) |
| @dev-db | **A10 F-063-01 INFO** : la garde de la migration 063 suppose READ COMMITTED (en REPEATABLE READ la course revient ; aucun code applicatif ne change l'isolation). Documenter cette hypothèse dans la migration suivante qui touche ces triggers. | 2026-10-18 | Ouvert (optionnel) |
| HUMAN @devops | **A08 — vérification staging avant/après migration 063** : une version de Dispositif qui référencerait déjà une échelle supprimée reste lisible, mais cloner une nouvelle version depuis elle sera refusé. Requête de contrôle (lecture seule, à lancer par le PO ou un accès autorisé — l'orchestrateur ne touche pas Neon) : `SELECT v.id FROM risk_framework_versions v JOIN rating_scales s ON s.id = v.rating_scale_id WHERE s.deleted_at IS NOT NULL`. Aussi INFO A08 : rendre `isReferencedByFrameworkVersion` obligatoire sur `RatingScaleRepository` (le trigger 063 reste le filet). | 2026-10-18 | Ouvert |
| @dev-backend @dev-db @dev-frontend | **Revue QA lot « un seul chemin » (A08, PASS_WITH_RESERVES, `QA-SWP.test.ts`)** : **QA-SWP-01 MAJOR** toggle de module écrit l'état puis l'audit hors transaction (module désactivé sans trace si l'audit tombe) → audit transactionnel comme `RatingScaleRepository` ; **QA-SWP-03 MAJOR** `RatingScaleService.disable` accepte une échelle référencée par une version BROUILLON → `getById(...)!` (RiskFrameworkService l.598) en 500 → refuser si une version quelconque la référence ; QA-SWP-02 MINOR audit `oldValue: null` au 1er toggle → `{enabled:true}` ; QA-SWP-04 MINOR textes périmés (AppetitePage, RatingScalesPage, commentaire `processEvaluationModeRequests.routes.ts`) ; QA-SWP-06 INFO permission `process.evaluationmode.set` orpheline → retirer. `it.fails` QA-SWP-01/03 à basculer au correctif. **Revue A10 (`docs/security/review-SWP-2026-10-18.md`, feu vert staging, CVSS max 2,2)** : F-SWP-01 LOW 2,2 `ProcessEvaluationModeRequestService.validate()` écrit le mode avant le statut, hors transaction (validation + rejet simultanés → demande REJECTED mais mode appliqué, sans audit) ; F-SWP-02 = QA-SWP-01 ; F-SWP-03 = QA-SWP-02 ; F-SWP-05 = QA-SWP-04 (commentaire) + test de garde « méthodes mortes absentes de `src/api` » ; F-SWP-06 = QA-SWP-03 ; F-SWP-04 INFO option PO : permission dédiée `config.module.toggle`. Correctifs QA-SWP-01..04 + F-SWP-01 dispatchés à A06 le 2026-10-18. **Corrigés en `07055f2` : RETEST_PASS A08 et A10.** | 2026-10-18 | Fermé |
| @dev-backend @dev-db | **Résidus INFO du retest SWP (A10/A08, 2026-10-18)** : F-SWP-07 deux premiers toggles simultanés enregistrent tous deux « avant = activé » ; F-SWP-08 (A07) `risk_framework_versions.rating_scale_id` FK sans `tenant_id` (contrairement à `risk_evaluations` depuis 061) ; F-SWP-09 le perdant d'une course reçoit 404 au lieu de « déjà décidé » ; garde F-SWP-05 à étendre à `setMode` (lot de retrait) ; `RatingScaleService.disable` contrôle hors transaction (course avec une modification de brouillon, non rejouée) ; A08 : rendre `isReferencedByFrameworkVersion` obligatoire sur l'interface. F-SWP-04 (permission dédiée `config.module.toggle`) : option PO. | 2026-10-18 | Ouvert (INFO) |
| @dev-backend @dev-db | **DECISION-060 — mise en œuvre (A13, vérifiée dans le code)** : retirer `assertRiskManager` des 7 méthodes de rédaction de `RiskFrameworkService` (create l.262, updateIdentity l.305, createDraft l.321, updateDraft l.350, discardDraft l.381, requestActivation l.401, withdraw l.458), la permission devient la garde ; **la garder** dans `decide` (l.481) et `bootstrapApprove` (l.583) ; réécrire le commentaire q51 (l.794). Migration (modèle 047) : donner aux rôles administrateur `riskframework.read/create/update`, `ratingscale.read/create/update` (+ `riskframework.archive` si q128 = oui). Jamais `riskframework.activate`, rien dans `ADMIN_PERMISSIONS`. Piège à documenter : un Risk Manager unique qui édite le brouillon de l'admin devient auteur et n'est plus éligible (q75). Après le lot A06 en cours. | 2026-10-18 | Ouvert |
| @dev-backend @security | **DECISION-058 (q116)** : assouplir un réglage = un administrateur seul, mais toujours avec motif obligatoire et audit avant/après. À aligner : `PATCH /modules/:name/toggle` (aucun motif aujourd'hui), `setCommitteeAuditCumul`. Correction A13 : `setCommitteeEnforcement` est déjà fermé quand le Dispositif est branché (`ConfigService.ts` l.89-91) — hors périmètre ; portée Dispositif/hors Dispositif posée en q130. Dispatché à A06 (DECISION-062). | 2026-10-18 | Ouvert |
| @risk-manager @dev-backend @security | **DECISION-059 (q117)** : régime « structure à une personne », déclaré par l'éditeur seul à l'ouverture du compte, affiché partout, levé définitivement à l'arrivée d'une 2e personne. Spec A13 puis lot A06. | 2026-10-18 | Ouvert |
| @architect @risk-manager | **DECISION-060 (q118)** : l'administrateur peut aussi modifier la méthodologie — amender le contrat ; confirmer que le circuit d'approbation des changements de Dispositif reste inchangé. | 2026-10-18 | Ouvert |
| @dev-backend @dev-db | **DECISION-061 (q119)** : cumul Comité + Audit interdit par défaut, autorisable par le client — sans révoquer silencieusement un cumul existant (Djamo). | 2026-10-18 | Ouvert |
| @dev-frontend | **DECISION-056 (q114)** : écran « décisions prises en votre absence » avant l'arrivée du premier membre Audit ou Comité en production. | 2026-10-18 | Ouvert |
| @dev-backend @security | **Assouplissements à un seul administrateur (A10, A05)** : `ConfigService.setCommitteeEnforcement(false)` et `setCommitteeAuditCumul(true)` sans second approbateur ; `PATCH /modules/:name/toggle` sans motif ni tiers (un admin seul peut désactiver le module AUDIT). À aligner après q116. | 2026-10-18 | Ouvert (attend q116) |
| @qa-engineer @security | **Revues B-6d : QA PASS_WITH_RESERVES (A08, `QA-B6d.test.ts` + `QA-B6d-pg.test.ts`, 1999 passed + 4 `it.fails` témoins) ; Sécurité feu vert staging, CVSS max 2,7 (A10, `docs/security/review-B6d-2026-10-18.md`).** Tests adaptés par A06 relus : aucune assertion affaiblie. Comme 062 s'applique sur staging à la fusion, les correctifs touchant 062 passent **avant** la PR. | 2026-10-18 | Revues faites, correctifs dispatchés |
| @dev-backend | **QA-B6d-01** MAJOR : I-D9 contourné par un `askedUserId` en MAJUSCULES (`z.guid()` l'accepte, comparaison texte avec `actor.userId`, PG résout le même utilisateur). Correctif : comparer et stocker `asked.id` renvoyé par la base. **F-B6d-01** LOW 2,7 : contournement par un compte créé et promu administrateur par le demandeur lui-même, `askedOn` sans borne basse → refuser un droit d'administrateur accordé par le demandeur ou postérieur à `askedOn`. | 2026-10-18 | Dispatché A06 |
| @dev-db @dev-backend | **QA-B6d-02 / F-B6d-03 / C-B6d-01** (même famille) : changement de `roles.system_group` ou réactivation d'un rôle ne posent pas le marqueur de fin (réouverture de l'amorçage par SQL, non atteignable par l'API) ; cause de fin non mémorisée. **F-B6d-04** LOW 1,9 : interblocage possible sur `tenants` entre deux affectations concurrentes → `FOR NO KEY UPDATE`. Correctifs **dans 062** (jamais appliquée). | 2026-10-18 | Dispatché A06 |
| @risk-manager | **F-B6d-02** LOW 2,7 (A10) : q87 force RISK_MANAGER comme approbateur de toute nouvelle version ; après une première activation en repli q100, Comité/Audit perdent définitivement leur rôle d'approbateur, pas seulement jusqu'à B-12. À trancher par A13, puis Decision Log. | 2026-10-18 | **Tranché A13 (`A13-review-DECISION-044.md` §8)** : perte non voulue, mais rien à coder avant B-12 (option facultative : `legacyChangeApprover` dans l'audit du repli). Aucune décision PO modifiée. |
| @architect | **F-B6d-02 suite (A13)** : écrire dans la spec B-12 une demande de rétablissement de l'approbateur d'origine (Comité/Audit) par le circuit, jamais décidée par le RM ni le demandeur d'origine ; obligatoire si la ratification est refusée ; confirmation explicite du client s'il garde RISK_MANAGER ; tenant signalé + KRI d'ancienneté tant que non clos. Bloquant pour B-12 seulement si la requête n° 10 renvoie ≥ 1 ligne. Lié à C-B6d-05. | 2026-10-18 | Ouvert (A05, échéance : spec B-12) |
| @dev-backend HUMAN | **INFO-05 (A10) / C-B6d-03 (A14)** : la notice BOOTSTRAP ne reprend ni le motif ni le marquage administrateur + Risk Manager (à corriger, A06). Prévenir l'administrateur cité : relève du PO (q103), non fait. | 2026-10-18 | Notice dispatchée A06 ; notification de l'admin cité en attente PO |
| HUMAN @ux-designer @dev-frontend @dev-backend | **Refonte de la section Risques — sources retrouvées le 2026-10-18 (aucune trace dans les sessions du 12 au 17/10, aucun commit de navigation)** : contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §3-§4-§13 (Cartographie conservée ; Analyse = étape distincte : causes, événements, impacts potentiels, contexte, contrôles connus ; contexte cumulatif Identification → Analyse → Évaluation, visible sans être éditable ; fiche risque portant le cycle ; Dispositif en contexte lecture seule dans l'évaluation) ; q13 (réglages Plateforme dans l'Administration, réglages Dispositif dans son espace, Administration les montre en lecture, raccourcis « Configurer » dans les sections, jamais un second formulaire) ; proposition UX `docs/ux/RM-V1-Experience-Dispositif.md` §4 (groupe Dispositif séparé, « À faire »), DECISION-017 n° 5. **État du code** : `App.tsx` suit encore l'ancien découpage ; Appétence et Grilles encore éditables hors Dispositif ; Évaluation montre Identification (Risk Owner) + Analyse (contrôles connus seulement) ; causes/événements/impacts absents du modèle (lié à OD-10). **À confirmer par le PO avant tout dispatch** : (a) Processus visible aussi dans Administration ? (b) réglages du Dispositif seulement visibles dans Admin, ou modifiables ? **Points (a)/(b) tranchés → DECISION-054 ; droits sur la méthodologie → DECISION-060 (q118). Débloqué côté PO au 2026-10-18, rien d'implémenté : `App.tsx` toujours à l'ancien découpage.** Prérequis : correctifs « un seul chemin d'écriture » (A05/A06), amendement du contrat (DECISION-060), modèle causes/événements/impacts (OD-10). | 2026-10-18 | En cours (DECISION-062) — Analyse en attente de q121 |
| @risk-manager | **I-D7 (lecture de q103)** : q103 dit « journalisées pour consultation dès que l'un des groupes Audit et/ou Comité est supérieur à un membre », q101 dit « l'auditeur [unique] est informé ». Lecture orchestrateur retenue : la consultation et l'information sont ouvertes dès le premier membre (sinon q101 serait contredit) ; « > 1 membre » = condition de **fin** de l'amorçage. A13 confirme. | 2026-10-12 | **Confirmé par A13** (2026-10-12, `A13-review-DECISION-044.md` §6) : ouverture dès le 1er membre actif ; fin à 2 membres **éligibles actifs** (nuance à reporter dans la spec B-6d, A05) |
| @risk-manager @dev-backend | **F-D044-08** LOW 2,2 (retest A10) : q58 (paramètre tenant interdisant Comité + Audit, `RoleService` l. 378) et q65 (notification `COMMITTEE_MEMBER_ADDED`, l. 455) ne reconnaissent le Comité que par le groupe. Faut-il étendre la définition q94 (groupe ou pouvoirs de validation) à ces deux règles ? | 2026-10-12 | **A13 : étendre les deux** (q58 dans les deux sens + `assertReactivable` ; q65 aussi à l'élargissement, à la transition non-membre → membre). Ne relève pas du PO. À dispatcher A06 |
| @dev-backend @security | **F-D044-03** (RatingScale : corrigé `0d68095`, RETEST_PASS A10 sur Postgres jetable ; reste ~32 services, Role/User/Config d'abord) LOW 3,1 — audit écrit hors transaction dans ~33 services ; chaîne concrète : `RatingScaleService` (audit après l'écriture → `authorsOf` peut ignorer un auteur d'échelle). Priorité : RatingScale, puis Role, User, Config. **F-D044-02** LOW (effets de bord de l'approbation sans audit propre, = AUD-D044-01). **F-D044-06** INFO (libellé de notification admin + Comité ; tenant dans `audited()`). | 2026-10-12 | **Ouvert — A06** |
| @dev-db | **AUD-D044-14 / F-D044-04** INFO — garde 038 sans `SET search_path` (non exploitable, conformité à la convention) ; requêtes 8/9 ignorent `users.roles` hérité (F-B8t-02). À la prochaine migration. | 2026-10-12 | **Ouvert — A07** |
| @audit @dev-backend @compliance | **Constats A23 AUD-D044-01..13** (`docs/audit/A23-review-DECISION-044.md`) : refus de cumul/réactivation et refus d'opt-out non tracés, marquage admin + Comité peu exploitable, audit RBAC hors transaction. **AUD-D044-12** (opt-outs historiques neutralisés sans trace) : décision de gouvernance A14/A15 avant correctif. QA-D044-04 (Privacy) : propriétaires/supérieurs reçoivent un id d'action sans `actionplan.read`. | 2026-10-12 | **Ouvert — A06/A14/A24** |
| @devops @dev-db | **Incident migrate.yml staging (2026-10-11, PR #151)** : 049 appliquée, 050 en échec (`constraint risks_probability_check does not exist`) — les CHECK probability/impact sont sur `risk_assessments`, pas `risks` ; 050 annulée par sa transaction, rien d'enregistré. Corrigée par A07 (bloc `DO` sur `pg_constraint`, table corrigée, vérifiée sur Postgres 16 jetable). **Cause racine du non-détection** : la CI de PR crée une branche Neon mais n'y applique pas les migrations → proposer (A09) un job `npm run migrate` sur la branche Neon éphémère de PR. | 2026-10-11 | **050 appliquée sur staging (PR #152, migrate.yml run 5 vert, 2026-10-11). Ouvert — A09 (job migrations en CI de PR).** |
## Decision Log

Format standard `product-manager.md` §47. Consulter ici avant de rouvrir un
débat déjà tranché par le PO — voir aussi `CLAUDE.md` § onboarding, règle
ajoutée le 2026-09-28 : toute mention "attend validation PO explicite"
dans `SHARED_LOG.md` doit générer une ligne dans le tableau ci-dessus, et
tout "go" verbal du PO doit être journalisé ici, référençant l'item qu'il
ferme.

```text
DECISION-001
DATE: 2026-09-28
QUESTION: Porter la charte graphique Djamo validée dans l'artefact
  (https://claude.ai/artifact/JBwqMEpRi8FSQqb6dmZy57, itérée V1→V6 par
  @ux-designer) dans les tokens réels de production
  (frontend/src/design-system/tokens.css), en remplacement de la
  direction neutre provisoire de DESIGN_NOTES.md ?
OPTIONS:
  A. Porter tel quel (palette #2A3FFF, Plus Jakarta Sans/IBM Plex
     Sans/Mono via Google Fonts, radius 8px) — valeurs de tokens
     uniquement, sans réécrire aucun composant.
  B. Ne pas porter, garder la direction neutre #1F4B99/system-ui en
     attendant une charte Djamo formelle (Figma ou brand guide).
DECISION: Option A — porté le 2026-09-28.
RATIONALE: 6 itérations sur l'artefact (V1→V6), chacune revue et
  ajustée sur retour PO explicite ("je m'attendais à être bluffé...",
  "tu as monté le niveau mais tu peux mieux faire...", purge
  typographique V6) — direction suffisamment mûrie et validée pour
  cesser d'être une simple proposition.
PRODUCT_IMPACT: RisksPage et RaciPanel (Lot 1, livrés ce jour) héritent
  automatiquement de la charte sans modification de leur code — les
  deux composants consomment déjà exclusivement les tokens `--gs-*`.
RISK_IMPACT: aucun changement de comportement métier — CSS uniquement.
KNOWN_TRADE-OFF: réintroduit une dépendance réseau (Google Fonts) que
  DESIGN_NOTES.md 4.2 excluait explicitement à l'origine ("un outil
  interne n'a pas besoin... police système garantit un rendu net...
  sans dépendance réseau"). Accepté implicitement par le go du PO sur
  un artefact qui charge ces mêmes polices depuis V1 — signalé ici
  plutôt que silencieusement écrasé ; à reconfirmer explicitement si
  un poste Djamo sans accès sortant à fonts.googleapis.com doit servir
  l'app un jour (fallback système déjà en place dans la pile de police,
  dégradation, pas de casse).
DARK_MODE: **tranché 2026-09-28, même jour** — PO confirme "mode
  clair" explicitement. Support dark retiré de `tokens.css`
  (`@media (prefers-color-scheme: dark)` supprimé) et `color-scheme`
  forcé à `light` dans `index.css` (contrôles natifs — scrollbars,
  form controls — n'basculent plus non plus). Conforme à la charte
  V1-V6 ("Thème clair uniquement").
RELATED_FEATURE: Lot 1 RACI (RisksPage, RaciPanel)
OWNER: HUMAN (Product Owner)
STATUS: CLOSED
```

```text
DECISION-009
DATE: 2026-10-08
QUESTION: Appliquer automatiquement les migrations SQL au déploiement, au lieu
  d'une exécution manuelle par HUMAN (incident : 045/046 jamais appliquées
  sur staging alors que le code des Lots A/B/C y était déployé) ?
OPTIONS:
  A. GitHub Action dédiée, déclenchée par un push sur staging/main qui
     touche database/postgresql/migrations/, secrets dans des GitHub
     Environments (staging, production).
  B. Migrations au démarrage du conteneur Render — rejeté : exigerait
     MIGRATION_DATABASE_URL dans le Web Service, interdit par
     RETEX_PRODUCTION_RENDER_NEON.md §12 et §16.1.
  C. Pre-deploy command Render — non disponible sur le plan gratuit.
DECISION: Option A — « ok pour les migrations auto » (PO, 2026-10-08).
RATIONALE: seul mécanisme séparé du runtime ; le runner tourne en
  NODE_ENV=production, donc il refuse de s'exécuter si les rôles migration
  et runtime ne sont pas distincts.
KNOWN_TRADE-OFF: la contrainte « jamais un agent n'applique une migration »
  reste vraie — c'est la CI, déclenchée par un merge validé par HUMAN, qui
  les applique. Le backend staging Render attend déjà les checks GitHub
  (autoDeployTrigger=checksPass) ; le backend de production déploie au
  commit (autoDeployTrigger=commit) et devrait passer en checksPass pour
  ne jamais démarrer avant la fin de sa migration.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — workflow livré, configuration des Environments GitHub à faire par HUMAN
```

```text
DECISION-010
DATE: 2026-10-08
QUESTION: L'orchestrateur (Claude) peut-il merger lui-même les PR ?
DECISION: Oui — « je te donne explicitement le droit de merger les PR
  lorsque tous les tests utilisés sont validés » (PO, 2026-10-08).
CONDITIONS APPLIQUÉES: tous les checks GitHub de la tête de la PR verts,
  PR mergeable, typecheck + tests lancés localement avant le push. Une PR
  qui tranche une question laissée ouverte au PO (règle métier, droits,
  sécurité) attend en plus son go explicite, même si elle est verte.
CONTEXTE: l'équipe compte deux membres (le PO et Claude) ; pas de
  relecteur humain tiers disponible pour les PR ni pour l'Environment
  GitHub `production`.
OWNER: HUMAN (Product Owner)
STATUS: ACTIF
```

```text
DECISION-011
DATE: 2026-10-08
QUESTION: Que voit un utilisateur quand une action lui est refusée faute de
  permission ?
DECISION: Pour toutes les actions non autorisées, une fenêtre (popup /
  modale) présente deux listes : les personnes qui peuvent faire l'action,
  et les personnes à qui il peut demander les droits (PO, 2026-10-08).
CONTEXTE: question soulevée par OD-9 (désignation du Risk Owner par un
  groupe détenant `risk.owner.assign`) ; le PO l'a étendue à toute action.
RISK_IMPACT: expose les détenteurs de permissions à tous les utilisateurs
  du tenant — revue Security et Privacy requises avant code.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — à cadrer (Architecte) puis construire
```

```text
DECISION-012
DATE: 2026-10-08
QUESTION: Le signalement de risque (OD-5) peut-il être anonyme ?
DECISION: Oui, au choix du signalant : signalement anonyme ou nominatif
  (PO, 2026-10-08).
OPEN_POINT: anonymat réel (aucune identité stockée) ou confidentialité
  (identité stockée, visible d'un rôle restreint) — voir l'item
  DECISION-012 du tableau, avis Privacy/Compliance requis.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ sur le principe — modalité à cadrer avant le lot B-4
```

```text
DECISION-012 (complément)
DATE: 2026-10-08
QUESTION: Modalité du signalement non nominatif : « anonyme » ou
  « confidentiel » ?
DECISION: « Signalement confidentiel » (PO, 2026-10-08), conformément
  aux avis convergents Privacy et Compliance. Le choix offert au
  signalant est donc « confidentiel » ou « nominatif » ; le mot
  « anonyme » n'apparaît pas dans l'application.
LEGAL_REVIEW: confiée aux juristes internes de Djamo (PO).
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — exigences techniques dans memory/privacy.md,
  validations juridiques en cours avant le lot B-4
```

```text
DECISION-013
DATE: 2026-10-08
QUESTION: OD-9 — qui désigne le Risk Owner, et l'auto-désignation est-elle
  permise ?
DECISION: Recommandation du Risk Manager validée par le PO (« ok pour
  OD-9 ») : groupe désignateur portant `risk.owner.assign` ; auto-
  désignation d'un membre seulement avec justification et confirmation
  par un autre membre (groupe d'un seul membre → HUMAN) ; un non-membre
  ne se désigne jamais ; owner sans `riskevaluation.create` refusé.
RELATED: DECISION-011 (fenêtre « qui peut faire / à qui demander »),
  finding F-1, lot B-0.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ
```

```text
DECISION-014
DATE: 2026-10-08
QUESTION: Workflow RO / DEL / EXEC — questions A à H de
  `docs/architecture/RM-V1-Modes-cotation-objections.md` §6.5.
DECISION: Le PO valide les recommandations des rôles sur A à H (« Je suis
  ok pour les recommandations ») :
  A. RO et DEL portés par le Processus, surcharge sur le risque par paire ;
  B. le RO décide du traitement, l'équipe risque cote ;
  C. le DEL remplace le RO (absence ou délégation datée), ne valide
     jamais ses propres actes, la responsabilité reste au RO ;
  D. cumul RO + EXEC plafonné, Maîtrise revue par l'équipe risque, cumul
     marqué et approuvé, config 4 à revoir ;
  E. validateur hors de tous les auteurs (responsable de la fonction
     risque, Comité au-delà du seuil) ;
  F. désignation par la direction du département, approbation par
     l'équipe risque, trace complète ;
  G. le DEL n'est pas le N+1 d'escalade ;
  H. champs texte libres conservés, sans reprise automatique.
  Deux compléments du PO :
  1. Le dispositif doit rester **configurable** : le client final peut
     demander des modifications. Les choix ci-dessus sont des valeurs par
     défaut paramétrables, pas des règles figées en code.
  2. En Hybride et Participatif, l'équipe risque peut **commenter ou
     annoter** l'Inhérent saisi par la 1re ligne.
RELATED: DECISION-006 (mode par Processus), DECISION-013 (OD-9, à
  reformuler au niveau Processus), lots B-0, B-1, B-5.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — amendement du contrat §5/§7/§10 à rédiger par le Risk
  Manager et à soumettre au PO avant toute modification du contrat.
```

```text
DECISION-015
DATE: 2026-10-08
QUESTION: Les 7 points « À VALIDER PO » du projet d'amendement
  (`docs/architecture/RM-V1-Amendement-contrat-modes-PROJET.md` §6).
DECISION:
  1. Revue de l'Inhérent saisi par la 1re ligne : l'équipe risque le
     retient, ou le retourne / rejette avec une annotation (au lieu de
     « amendé » proposé par le Risk Manager).
  2. Qui note la Maîtrise et quelle saisie fait foi : paramètre du
     Dispositif, jamais une valeur figée (organisation en sous-effectif).
  3. Contributions (Q8) : sur les risques en mode Participatif, faites par
     la personne désignée par le Risk Owner (Délégué, Exécuteur ou Risk
     Owner lui-même), selon les règles du Dispositif.
  4. Comportements du mode Hybride : accord.
  5. Gouvernance des changements de paramètres : accord, en gardant à
     l'esprit que le Comité n'est pas disponible spontanément (la version
     reste en DRAFT jusqu'à sa séance, effet au cycle suivant).
  6. Seuil de « criticité faible » pour le cumul Risk Owner + Exécuteur :
     paramètre inscrit à la création du Dispositif.
  7. Invariants ajoutés (mode effectif jamais Hybride, cumul toujours
     marqué, un paramètre n'abaisse jamais un invariant) : accord.
  Le contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` est amendé en
  conséquence (§4, §5, §7, §8, §10, §16, §17 Phase 4).
RELATED: DECISION-006, DECISION-012, DECISION-013, DECISION-014.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — contrat amendé le 2026-10-08. Restent ouvertes : qui
  propose la Treatment Decision (Q9), définition de « l'équipe risque »
  (Q10), descriptions de probabilité corrélées aux impacts (Q11).
```

```text
DECISION-016
DATE: 2026-10-08
QUESTION: Q9, Q10, Q11 et approbateurs de la configuration du Dispositif.
DECISION:
  Q9 — accord avec la déduction du Risk Manager : pas de proposeur
    distinct ; le Risk Owner (ou le Délégué) enregistre la Treatment
    Decision ; l'équipe risque peut joindre une recommandation non
    contraignante.
  Q10 — Gestion des rôles par **groupes**. Les groupes représentent les
    départements ; s'y ajoutent les groupes techniques et trois groupes
    fixes : **Risk Manager** (= « l'équipe risque », ne peut jamais être
    vide), **Risk Committee** et **Audit** (peuvent être vides).
  Q11 — Les axes d'impact (financier, réglementaire, opérationnel, …,
    **7 au maximum**) et l'échelle sont choisis à la création du
    Dispositif : paire (4 ou 6) ou impaire (3 ou 5). La probabilité et
    chaque axe d'impact utilisent la **même taille d'échelle** (ex. échelle
    de 4 : probabilité sur 4, chaque axe sur 4) ; pour chaque axe, l'utilisateur
    choisit parmi les N niveaux de cet axe. « Corrélée » = même taille
    d'échelle pour la probabilité et les impacts, avec des niveaux
    décrits par axe.
  Seuil « faible » et configuration — le seuil est configurable ; les
    possibilités de configuration sont détenues par la fonction risque
    (groupe Risk Manager) et tracées ; l'approbateur d'un changement est
    lui-même configurable : **fonction Audit ou Comité**.
RELATED: DECISION-014, DECISION-015, contrat §6 et §10,
  `docs/architecture/RM-V1-Lots-contrat-amende.md` (points 4 et 6).
OWNER: HUMAN (Product Owner)
COMPLÉMENT (PO, 2026-10-08) — Chaque valeur de l'échelle a son
  descriptif : pour la probabilité et pour chaque axe d'impact, le niveau 1
  a le descriptif de 1, le niveau 2 celui de 2, et ainsi de suite jusqu'à
  N (ex. échelle impaire de 5 : 5 descriptifs pour la probabilité, 5 par
  axe). Les descriptifs sont renseignés à la création du Dispositif.
STATUS: DÉCIDÉ — à reporter dans le contrat (§6, §10) après validation
  du texte par le PO.
```

```text
DECISION-017
DATE: 2026-10-08
QUESTION: Les 5 questions de l'UX Designer
  (`docs/ux/RM-V1-Experience-Dispositif.md`).
DECISION:
  1. Création du Dispositif : **assistant pas à pas activé par défaut** ;
     une configuration directe reste possible pour les utilisateurs
     experts qui veulent aller vite sur des réglages spécifiques.
  2. Notifications V1 : **dans l'application et par e-mail**.
  3. « Retourné » et « Rejeté » sont **deux états distincts** :
     retourné = on demande ou on apporte une précision ; rejeté = la
     saisie n'est pas applicable / pas bonne.
  4. Comité asynchrone : règle de clôture et échéance **configurables** ;
     le PO demande une proposition de valeurs par défaut (en cours,
     Risk Manager).
  5. **Tout passe dans le Dispositif** : appétence et grilles de cotation
     sont des paramètres du Dispositif. Proposer des **Dispositifs par
     défaut** activables pour aider les utilisateurs.
RELATED: DECISION-011, DECISION-015 (revue de l'Inhérent), DECISION-016,
  contrat §5, §8, §10, §13.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — à reporter dans le contrat avec DECISION-016 (étape 2
  de `docs/architecture/RM-V1-Sequence-actions.md`) ; défauts du Comité
  asynchrone à proposer.
```

```text
DECISION-018
DATE: 2026-10-08
QUESTION: Arbitrages P1 à P6 (`docs/architecture/RM-V1-Sequence-actions.md`
  §3) et décisions du §33 du cahier des charges EVD
  (`docs/specs/CDC-module-evidences-excel.md`).
DECISION:
  P1 — accord : le Dispositif fait foi pour le mode par défaut,
    `Config.evaluationMode` rendu obsolète.
  P2 — accord : changement de mode validé par la fonction risque, retrait
    de `process.evaluationmode.set`.
  P3 — accord pour interdire l'auto-désignation, **mais doit rester
    configurable** (tension avec l'invariant 5 du §10 « jamais
    auto-attribués » : à instruire).
  P4 — accord **si l'Architecte valide** le rattachement Processus →
    groupe-département.
  P5 — question du PO : quelle est la contrainte ? (explication à fournir).
  P6 — accord : un groupe vide ne peut pas être approbateur.
  EVD §33 n° 3-4 — champs standard, avec possibilité de créer de nouveaux
    champs dérivés des champs existants ou entièrement nouveaux.
  EVD §33 n° 5 — conservation **10 ans** ; après une période cible de
    **1 an**, archivage possible avec accès conservé (type stockage
    d'archive S3).
  EVD §33 n° 8 — nouvelle version de schéma : l'administrateur et les
    rôles et/ou utilisateurs qui ont la permission.
  EVD §33 n° 9 — suppression d'une évidence **sur demande** ; les demandes
    sont traitées par l'équipe risque (groupe Risk Manager) ; suppression =
    soft delete tracé et horodaté.
  EVD §33 n° 10, 14 — proposition Privacy demandée.
  EVD §33 n° 11, 12 — proposition Architecte demandée.
RELATED: DECISION-006, DECISION-013, DECISION-016, DECISION-017,
  `docs/architecture/EVD-Import-Excel-cadrage.md`.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ en partie — P3 (configurable), P4 (validation Architecte),
  P5 (explication), EVD 10/11/12/14 (propositions) restent ouverts.
```

```text
DECISION-019
DATE: 2026-10-08
QUESTION: Suite de DECISION-018 (P3, P4, P5, stockage, import Excel).
DECISION:
  P5 — accord, à condition que le comportement expliqué soit celui
    implémenté : un membre du groupe Risk Manager qui est RO, DEL ou EXEC
    d'un risque ne saisit ni ne revoit ce risque ; un autre membre le
    fait ; s'il n'y en a pas, la revue passe au groupe Audit ou au
    Comité. Sur les autres risques, il agit normalement.
  P3 — accord avec la proposition de l'Architecte : invariant 5 réécrit
    « jamais auto-approuvés ; une auto-proposition n'est permise que si le
    Dispositif l'autorise » ; paramètre désactivé par défaut, activé par
    le Comité ; si activé, approbation par un autre membre du groupe Risk
    Manager, motif, audit, cumul marqué ; refus sans autre approbateur.
  P4 — accord avec le modèle de l'Architecte : `departments` reste
    l'entité, `roles.department_id`, `processes.department_id`.
  Stockage — Djamo a **deux dossiers partagés Drive** : un « actif » et un
    « supprimé » ; « supprimé » est une vue logique, rien n'est
    réellement effacé (une suppression = déplacement vers le dossier
    « supprimé », jamais la corbeille Drive). On doit pouvoir **connecter
    un autre système de gestion de fichiers sans modifier le code** :
    le stockage est choisi par configuration derrière `DocumentStorage`.
    Remplace la recommandation GCS de l'Architecte comme cible immédiate.
  Import Excel — souplesse : feuilles et lignes vides gérées sans bloquer ;
    l'exécutant voit un récapitulatif (types détectés, nombre de lignes,
    de colonnes, de feuilles) qu'il peut modifier et ajuster ; une fois
    validé, seules les informations sélectionnées de manière définitive
    sont persistées ; le fichier est toujours sauvegardé dans son
    intégralité.
  Questions du PO : exemples de données personnelles (Privacy) ; pourquoi
    la clé de rapprochement est facultative (exemples).
RELATED: DECISION-016, DECISION-018, contrat §10 invariant 5,
  `docs/architecture/EVD-Import-Excel-cadrage.md`.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — clé de rapprochement et données personnelles en attente
  de la réponse du PO aux explications.
```

```text
DECISION-020
DATE: 2026-10-08
QUESTION: Données personnelles et clé de rapprochement (import Excel),
  temps réel.
DECISION:
  Données personnelles — l'exécutant du contrôle choisit, par colonne, de
    **masquer** les valeurs (remplacement par des X ou des *) ; le
    masquage est le mode par défaut. **« Ignorer »** (colonne jamais
    persistée) reste disponible comme **option de configuration**. Le
    fichier original reste conservé en entier. Reste de l'avis Privacy
    retenu (déclaration oui / non / ne sait pas, dataset confidentiel,
    lectures tracées sans valeurs).
  Clé de rapprochement — facultative par défaut ; le Dispositif ou le
    contrôle peut la rendre obligatoire pour certains jeux de données ;
    l'assistant propose une colonne à valeurs uniques au premier import ;
    la clé est figée avec la version du schéma. Le code doit rester
    facile à faire évoluer et la règle **configurable depuis une
    interface**.
  Temps réel — la V1 est livrée **WebSocket-ready** (contrat §14) ; le
    WebSocket lui-même est un élément de la **V2**, avec les retours
    futurs du client.
RELATED: DECISION-017, DECISION-018, DECISION-019, contrat §14,
  `docs/architecture/RM-V1-Sequence-actions.md` étape 19.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ
```

```text
DECISION-021
DATE: 2026-10-08
QUESTION: Réponses du PO à la roadmap V1 (`docs/ROADMAP-V1.md` §4).
DECISION:
  Périmètre V1 — tout ce qui est cité : étape 18 (Traitement, Suivi,
    Réévaluation, Meeting), B-4 signalement confidentiel, piste EVD ;
    **plus Userback en staging (PR #95) et TestSprite**.
  B-4 — la condition est l'avis des juristes internes.
  Masquage (import Excel) — appliqué **à l'affichage** dans
    l'application ; prévoir un mécanisme qui supporte les deux modes
    (à l'affichage ou à l'enregistrement), choisi par configuration
    applicative ou depuis une interface d'administration, pour ne pas
    modifier le code.
  R0 — correction de la faille de l'import de risques ; Drive en
    production : permettre l'authentification implicite (clé de service
    fournie par configuration) **ou** la connexion d'un autre service
    (ex. identité Cloud Run), au choix par configuration ; modifier le
    comportement des suppressions (dossier « supprimé », jamais la
    corbeille).
  Drive — le PO fournit les identifiants de dossiers ; ce seront des
    dossiers vides, l'organisation interne revient à l'application.
  Penpot — via MCP si connecté (il ne l'est pas dans cette session),
    sinon connexion sécurisée sans exposer de secret ni de jeton.
  OD-4 — proposition demandée fondée sur COSO ERM et ISO 31000.
  Comité asynchrone — options à reproposer.
  Roadmap — à publier en **artefact** : page d'accueil (état global du
    projet) + une section par agent pour suivre et répondre à leurs
    questions et aux arbitrages, mise à jour à chaque livraison d'agent.
RELATED: DECISION-012, DECISION-017, DECISION-019, DECISION-020,
  `docs/ROADMAP-V1.md`.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ en partie — GO formel de R0 à reconfirmer ; OD-4 et
  Comité en proposition.
```

```text
DECISION-022
DATE: 2026-10-08
QUESTION: Suite de DECISION-021 (page de pilotage, infrastructure,
  e-mail, Drive, secrets, Penpot, TestSprite).
DECISION:
  Page de pilotage — les arbitrages se valident par boutons « Valider la
    recommandation », « Refuser » (commentaire obligatoire) ou « Autre
    réponse » (saisie libre) ; ajout d'une section Configuration.
  Infrastructure — production sur **Render jusqu'à la livraison de la V1
    et la fin des retouches**, puis migration vers **Cloud Run ou AWS**.
    Protections pendant la période Render (plan payant, restauration
    7 jours, rollback) : en arbitrage dans la page (q03).
  E-mail — prendre en charge **Google Workspace et Microsoft 365** ;
    question du PO : monter un petit serveur SMTP. Proposition : trois
    connecteurs par configuration (API Gmail, Microsoft Graph, SMTP
    générique), pas de serveur SMTP auto-hébergé (délivrabilité,
    maintenance) — en arbitrage (q07).
  Drive — les identifiants des dossiers seront saisis dans la section
    Configuration de la page (variables non secrètes).
  Secrets — le PO demande un mécanisme d'enregistrement des secrets et
    variables dans la page. **Retenu partiellement** : la page stocke les
    variables non secrètes et une liste de suivi des secrets à créer
    (sans valeur) ; les valeurs des secrets se créent dans Render ou les
    Environments GitHub, jamais dans la page (base lisible par tous ceux
    qui y ont accès ; garde-fou qui refuse une valeur ressemblant à un
    secret).
  Antivirus Excel — proposition en deux temps (contrôles de format, de
    taille décompressée et de ratio, formules jamais exécutées, module
    antivirus branchable désactivé ; ClamAV ou service cloud à la
    migration) — en arbitrage (q11).
  Échec d'écriture de l'audit — proposition : action et audit dans la
    même transaction, accès confidentiel refusé sans trace, alerte — en
    arbitrage (q12).
  Penpot — créer le connecteur dans claude.ai puis ouvrir une nouvelle
    session. TestSprite — le connecteur sera fourni par le PO.
RELATED: DECISION-021, `docs/pilotage/pilotage-grc-tools.html`,
  https://claude.ai/artifact/LQgXExeGTqAHxijeSrSRf3
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ en partie — q01 à q07, q11, q12 ouverts dans la page.
```

```text
DECISION-023
DATE: 2026-10-08
QUESTION: Coût de l'infrastructure du MVP et envoi d'e-mails.
DECISION:
  Le MVP doit coûter **0 €** (Render et Neon gratuits jusqu'à la
    livraison V1, puis Cloud Run ou AWS). Les protections payantes sont
    abandonnées ; protections gratuites proposées dans la page (q03) :
    sauvegarde quotidienne par GitHub Actions, rollback écrit et testé,
    mise en veille Render acceptée.
  E-mail — proposition (q07) : API Gmail de Google Workspace via le compte
    de service Google déjà utilisé pour Drive (coût nul, HTTPS, expéditeur
    dédié type noreply@djamo.io ; délégation à accorder par
    l'administrateur Workspace), puis connecteurs Microsoft 365 (Graph)
    et SMTP générique par configuration. À vérifier : limitation
    éventuelle de l'envoi SMTP sortant sur l'offre gratuite de Render.
RELATED: DECISION-022.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ (coût zéro) ; propositions q03 et q07 en arbitrage.
```

```text
DECISION-024
DATE: 2026-10-08
QUESTION: Envoi des e-mails de notification (q07).
DECISION: Envoi **configurable depuis l'administration** : fournisseur par
  API (Brevo, API Gmail, Microsoft 365) et/ou SMTP ; adresse d'expédition
  et nom affiché configurables, pour passer à une adresse mise à
  disposition sans modifier le code. Vérifié : Render gratuit bloque le
  SMTP sortant (ports 25, 465, 587, depuis septembre 2025) — le MVP envoie
  donc par API HTTPS ; **Brevo gratuit (300 e-mails par jour)** par
  défaut, sous réserve de la vérification de l'adresse d'expédition chez
  Brevo. Un alias ou un libellé (« label ») ne masque pas l'adresse : le
  nom affiché « GRC Tools » s'affiche, mais l'adresse reste visible ; pour
  la masquer, utiliser une adresse dédiée.
RELATED: DECISION-017, DECISION-022, DECISION-023, lot B-11.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ
```

```text
DECISION-025
DATE: 2026-10-08
QUESTION: Arbitrages saisis par le PO dans la page de pilotage (q01, q02,
  q03, q04, q06, q11, q12, q13), relus par l'orchestrateur le 2026-10-08.
DECISION:
  q01 — **GO pour tout R0** (R0.1 à R0.6) : B-0, correctif de l'import de
    risques, suppression vers le dossier Drive « supprimé » avec
    authentification Drive configurable, resynchronisation Git, README et
    runbook.
  q02 — Fenêtre de refus : noms masqués pour les permissions sensibles
    uniquement (levée d'identité des signalements, journal d'audit,
    gestion des rôles) ; « Contactez la fonction conformité » à la place.
  q03 — Les trois protections gratuites : sauvegarde quotidienne de la
    base de production par GitHub Actions (30 jours), rollback écrit et
    testé en staging, mise en veille Render acceptée.
  q04 — OD-4 : le Risk Owner statue sur chaque contribution (Délégué
    désignable par le Dispositif, jamais l'auteur) ; Retenue / Écartée
    (motif) / Sans suite ; append-only ; configurable.
  q06 — Procédure de migration tenue par le PO ; recette métier par
    Charles Kouassi et Aboubacar Ouattara.
  q11 — Antivirus en deux temps : contrôles V1 sur Render (.xlsx seul,
    signature, plafonds de taille et de ratio, formules jamais exécutées,
    module antivirus branchable désactivé) ; ClamAV ou service cloud à la
    migration.
  q12 — Échec d'écriture de l'audit : l'action est bloquée (même
    transaction), pas de trace pas d'accès pour les consultations
    confidentielles, alerte à l'équipe risque et au support.
  q13 — Plateforme dans l'Administration, Dispositif dans son espace,
    raccourcis seulement dans les sections.
  Variables saisies dans la page : identifiants des dossiers Drive
    « actif » / « supprimé » pour staging et production. Les secrets
    (clés de compte de service Drive, e-mail, TestSprite) restent à
    poser dans Render / GitHub par le PO.
RELATED: DECISION-021, DECISION-022, ROADMAP-V1 R0, OD-4, AUD-002, EVD-2.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — R0 lancé le 2026-10-08.
```

```text
DECISION-026
DATE: 2026-10-08
QUESTION: Comité asynchrone — option par défaut (q05, B-12).
DECISION: Le PO ne fixe pas d'option par défaut. Le Dispositif propose des
  **règles prédéfinies** (A Léger, B Standard, C Strict, telles que
  décrites dans q05) **et permet de créer une règle personnalisée** :
  groupes qui valident, quorum, majorité, délai, relances. Les règles
  fixes restent non configurables : jamais de validation tacite, jamais
  un seul membre, auteurs et RO / Délégué / Exécuteur exclus du vote,
  vote motivé et tracé, escalade à l'échéance, groupe vide refusé.
RELATED: B-12, F-14 (`validateByCommittee` à un seul membre).
COMPLÉMENT (réponse PO à q05, page de pilotage, 2026-10-08) — Règles
  prédéfinies : A Léger (petite structure) : 2 votants d'accord, 5 jours ;
  B Standard : majorité des votants, au moins 3, 10 jours, relances à 50 %
  et 90 % ; C Strict : unanimité, au moins 2/3 des éligibles et 4 minimum,
  15 jours. Quorum de 2 seulement en option A ; le responsable de la
  fonction risque peut être membre du Comité mais ne vote pas sur ce qu'il
  a saisi ; un vote peut être retiré tant que la décision n'est pas close.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — à intégrer à l'amendement de contrat étape 2.
```

```text
DECISION-027
DATE: 2026-10-08
QUESTION: Reprise du registre (RRI) — q14, q15, q16.
DECISION:
  q14 — À l'import, **vérification des colonnes et rapprochement avec le
    Dispositif** : le client fait lui-même le lien entre les objets de son
    fichier et ceux du système (ex. « process », « processus », libellés
    de processus, d'axes, de niveaux), pour absorber les nomenclatures
    changeantes. Aucun rapprochement implicite.
  q15 / q16 — Les cotations du fichier deviennent des **propositions de
    cotation** quand la matrice P × I du fichier est la même que celle du
    Dispositif ; sinon elles restent en historique « reprise ». Une
    proposition reste soumise au parcours normal (revue, validation par
    un tiers) : l'import ne contourne jamais le maker-checker.
  Non tranché explicitement (recommandations maintenues par défaut,
    question de confirmation q17 posée dans la page) : objets importés en
    brouillon activés par l'équipe risque ; périmètre risques, processus
    et contrôles ; Google Sheets par téléchargement .xlsx en V1, lien
    direct en V1.1.
RELATED: `docs/architecture/ADMIN-et-RRI-cadrage.md`, lot RRI (R3).
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ en partie — confirmation q17 ouverte.
```

```text
DECISION-028
DATE: 2026-10-08
QUESTION: Revue des maquettes Penpot alors que le serveur MCP Penpot ne
  tourne que sur le terminal du PO (inaccessible depuis la session cloud).
DECISION: Le frontend avance d'abord sur le **design system**
  (`packages/design-system`) dans la session cloud ; la **revue Penpot du
  front** se fait ensuite dans une session Claude Code locale du PO (MCP
  Penpot disponible), lancée avec `claude remote-control` depuis le dossier
  du dépôt pour la piloter aussi depuis l'application. Échange par le
  dépôt : la session locale écrit ses constats dans un fichier de revue ou
  en commentaires de PR, la session cloud corrige. Pas de tunnel exposant
  le serveur MCP Penpot ou son jeton sur Internet.
RELATED: DECISION-022 (Penpot), ROADMAP-V1 F-lots.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — audit du design system lancé (UX + Dev Frontend).
```

```text
DECISION-029
DATE: 2026-10-08
QUESTION: Arbitrages q17, q18, q19 saisis dans la page de pilotage.
DECISION:
  q17 — RRI : les trois points sont confirmés (objets importés en
    brouillon activés par l'équipe risque ; V1 = risques, processus et
    contrôles ; Google Sheets par téléchargement .xlsx en V1, lien direct
    en V1.1). Clôt la confirmation ouverte de DECISION-027.
  q18 — Migration 047 validée telle quelle : `risk.owner.assign` pour les
    détenteurs de `role.assign` et les rôles nommés exactement « Risk
    Manager ». Débloque la fusion de la PR #140 dans `staging`.
  q19 — Clé de compte de service Drive longue durée sur Render acceptée
    jusqu'à la migration Cloud Run / AWS, avec mesures : compte dédié
    membre des deux dossiers partagés seulement, rotation tous les 90 jours
    et à chaque départ d'une personne ayant accès à Render, jamais dans le
    dépôt ni la page de pilotage.
RELATED: DECISION-025, DECISION-027, SEC-R04-3, PR #140.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ
```

```text
DECISION-030
DATE: 2026-10-11
QUESTION: Design system — q20 (cible d'accessibilité) et q21 (trois
  réglages de charte).
DECISION:
  q20 — **WCAG 2.1 AA** est le critère de sortie de chaque composant,
    vérifié par les tests automatiques (axe) et une passe visuelle pour
    les contrastes.
  q21 — Acceptés : (1) une couleur « information » propre, distincte du
    bleu principal ; (2) un jeton pour le blanc des textes sur fond bleu
    (remplace les `#fff` en dur, aucun changement visible) ; (3) le
    composant Onglets reste une navigation entre pages, de vrais onglets
    seulement quand un écran en a besoin.
RELATED: DECISION-028, `docs/ux/DS-V1-inventaire.md`,
  `docs/architecture/PEOS_GRC_TOKEN_MAPPING.md`.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — lot jetons DS-1c lancé.
```

```
DECISION-031
DATE: 2026-10-11
QUESTION: q22 — que faire de la branche `origin/prod` (copie figée de
  `main` du 2026-10-03, commit b4c074b, aucun commit propre, rien ne
  l'utilise) ?
DECISION: L'archiver seulement, sans la supprimer. Archive posée sous
  la branche `archive/prod-2026-10-03` (même commit ; le push d'une
  étiquette git est refusé par le proxy de la session cloud, d'où une
  branche plutôt qu'une étiquette). `prod` reste en place.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — fait le 2026-10-11.
```

```
DECISION-032
DATE: 2026-10-11
QUESTION: Accès du compte de service Drive aux dossiers « supprimé »
  (contrôle staging du 2026-10-11 02:15 UTC : actif OK, supprimé 404).
DECISION: Le PO a ajouté le compte de service aux quatre Drive partagés
  (actif et supprimé, staging et production). Revérification staging
  par redéploiement.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — fait par le PO le 2026-10-11 ; GO de lancement de
  R1.1 (rédaction de l'étape 2 du contrat), EVD-1 (hors déclaration
  de données personnelles et dataset confidentiel, toujours ouverts)
  et correction du commentaire périmé de `RiskEvaluationService`.
```

```
DECISION-033
DATE: 2026-10-11
QUESTION: Étape 2 du contrat — que se passe-t-il quand le groupe Risk
  Committee est vide (Q-E2-6 première activation, et plus largement
  tout ce que le Comité approuve) ?
DECISION: Si le groupe Comité est vide, le groupe Risk Manager (la
  fonction risque) prend en charge ce que le Comité aurait approuvé.
  Garde-fous proposés par l'orchestrateur, à confirmer par le PO :
  l'approbateur est un autre membre du groupe que le demandeur, motif
  obligatoire, trace d'audit, cumul marqué ; un groupe Risk Manager
  d'un seul membre ne peut pas s'approuver lui-même.
RELATED: DECISION-016, DECISION-019 (P3 : auto-proposition activée par
  le Comité), Q-E2-4, Q-E2-6, Q-E2-9, page de pilotage q28.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ (principe) — garde-fous à confirmer ; à reporter dans le
  projet d'étape 2.
```

```
DECISION-034
DATE: 2026-10-11
QUESTION: Étape 2 du contrat — Q-E2-1 à Q-E2-11 (page de pilotage q23 à
  q33).
DECISION (réponses du PO, verbatim résumé) :
  q23 / Q-E2-1 — La direction du département est le membre du groupe
    hiérarchiquement au-dessus des autres (directeur ou head of) ; il
    voit le travail des membres sur les risques, les contrôles et les
    objets qu'ils détiennent ou ont créés.
  q24 / Q-E2-2 — Le responsable de la fonction risque est le responsable
    du service risque : droits sur tous les risques, les contrôles et
    l'administration ; il peut suppléer le Comité si le groupe Comité est
    vide (voir DECISION-033).
  q25 / Q-E2-3 — Un Dispositif est choisi une seule fois à la création ;
    les risques sont affichés par Dispositif, un à la fois.
  q26 / Q-E2-4 — « Les changements sont au niveau du risque et l'audit est
    notifié si le groupe n'est pas vide ; comportement par défaut ; on
    pourra choisir l'audit et/ou le comité. » (interprétation à vérifier
    dans le texte : par défaut la fonction risque approuve et Audit est
    notifié ; le Dispositif peut exiger l'approbation d'Audit et/ou du
    Comité).
  q27 / Q-E2-5 — Audit : mêmes règles de vote que le Comité, avec
    avertissement et indicateur.
  q28 / Q-E2-6 — Premier Dispositif : on demande d'abord de créer un
    utilisateur dans le groupe risque au niveau hiérarchique le plus
    élevé ; à défaut, l'administrateur du client (différent du
    demandeur), avec motif et trace, une seule fois.
  q29 / Q-E2-7 — Règle personnalisée : planchers fixes seulement ; quorum
    impossible = envoi refusé puis escalade.
  q30 / Q-E2-8 — Rejet = comme un retour, gardé en historique et compté.
  q31 / Q-E2-9 — Revue sans autre membre : l'approbateur choisi au
    Dispositif, avec alerte à l'équipe risque.
  q32 / Q-E2-10 — « Sans suite » sans commentaire, avec possibilité de
    le retirer s'il n'est pas pertinent.
  q33 / Q-E2-11 — Auteur d'une cotation importée = la personne qui
    importe ; Résiduel importé par l'équipe risque seulement.
RELATED: DECISION-033, `docs/architecture/RM-V1-Contrat-etape2-PROJET.md`.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — à intégrer au projet d'étape 2 ; le texte final reste à
  valider par le PO avant report dans le contrat.
```

```
DECISION-035
DATE: 2026-10-11
QUESTION: Étape 2 du contrat — confirmations q34 à q39 (page de pilotage).
DECISION:
  q34 — Lecture de q26 validée : par défaut la fonction risque approuve
    les changements du Dispositif ; Audit est notifié (si son groupe
    n'est pas vide) ; le Dispositif peut exiger en plus l'accord d'Audit
    et/ou du Comité.
  q35 — Suppléance d'un Comité vide par la fonction risque : **une
    personne au moins** suffit (pas deux). Garde-fous non contestés,
    maintenus : jamais le demandeur, jamais sur ce dont la personne est
    auteur / RO / Délégué / Exécuteur, jamais pour activer
    l'auto-proposition ; motif et trace.
  q36 — Revue quand toute l'équipe risque est concernée : **Audit si son
    groupe n'est pas vide** (sinon Comité, sinon suppléance — lecture de
    l'orchestrateur). Les groupes Comité et Audit ont chacun un **journal
    de toutes les décisions prises en leur absence**.
  q37 — Le PO demande une proposition (destinataire de l'escalade quand
    le quorum est impossible) → proposition en q37 de la page de pilotage.
  q38 — « Sans suite » peut être retiré ; prévoir la possibilité de
    **créer des statuts de contribution** personnalisés.
  q39 — Le Dispositif est choisi à la création de l'espace client et/ou
    à la création du Dispositif ; les risques s'affichent par Dispositif,
    un à la fois.
RELATED: DECISION-033, DECISION-034.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — q37 en attente de validation de la proposition.
```

| @release-manager | **URGENT — `main` a 27 commits jamais poussés sur `origin`, aucune PR ouverte pour le Lot 1 RACI malgré un feu vert QA + Security complet (SEC-016 CLOSED).** Vérifié le 2026-09-29 : dernière PR mergée = #15 (`security/fix-sec-009-015`, 2026-09-28). Tout ce qui a suivi (SEC-016, 3 docs d'architecture cible, ADR-002, Lot 1 RACI complet avec revue QA/Security) est resté en local sur `main`, sans branche ni PR. Working tree en plus non propre (fichiers modifiés/non trackés : `ACTION_ITEMS.md`, `SHARED_LOG.md`, `CLAUDE.md`, design system, `RisksPage.tsx`, `RaciPanel.tsx`/`.css`, `api/raci.ts`/`users.ts`, `ADR-003...`). Rollback de migration `027_raci_assignments.sql` jamais testé/tracé non plus (déjà exigé dans la DoD proposée le 28/09). Recommandation : ouvrir la PR du Lot 1 RACI (+ éventuellement une PR séparée pour les 3 docs d'architecture/ADR-002/ADR-003) avant tout nouveau lot, pour ne pas accumuler davantage de commits non tracés. | 2026-09-29 | **Résolu — PR #16 ouverte, 22 commits, mergée par le PO le 2026-09-29.** Lots A/B/C exécutés en parallèle/séquence (voir DECISION-005 ci-dessous pour le détail complet) : Lot 1 RACI + charte graphique + docs architecture poussés, fuite Privacy corrigée, `GrcObjectType` créé et `RaciEntityType` migré dessus, middleware `ModuleToggle` câblé, 20 tests `BrandingService` ajoutés, rollback de migration établi comme convention projet (027+028 `.down.sql` + `README.md` + correctif du runner). 405 tests verts sur toute la série, working tree propre. |
| @tous | **DECISION-004 — Balayage complet des 15 agents (2026-09-29), confirmation croisée du problème central de DECISION-003.** 7 agents indépendants (architect, product-manager, dev-backend, dev-db, security, compliance, audit) ont chacun, depuis leur propre angle, confirmé par preuve code la même divergence de whitelists polymorphes — désormais **7 whitelists connues**, pas 5 : `ActionPlanSourceType`, `ActionLinkResourceType`, `RaciEntityType` (6e, déjà livrée avant DECISION-003 — @product-manager), `NotificationResourceType` (7e, périmètre différent avec `RISK_EVALUATION`/`REVIEW_CYCLE` — @dev-backend), plus RACI/Comments/Evidence-links/Finding prévues. **Divergence de casse en plus de la couverture** : RACI en `PascalCase` (`'Risk'`), les autres en `SNAKE_CASE` majuscule (`'RISK'`) — @dev-db, @dev-backend. `@security` ajoute : le risque n'est pas que l'énum diverge, c'est que la fonction de résolution tenant-scopée est dupliquée à la main à chaque whitelist — recommande de centraliser aussi le **résolveur**, pas seulement le type. `@compliance` qualifie la divergence de `REGULATORY_GAP` mineur (pas juste dette technique) et demande une vérification de non-régression sur les données réelles existantes au moment de la création de `GrcObjectType` (aucune ligne en base ne doit devenir invalide sous la whitelist unifiée). Décision à prendre par `@architect` avant d'écrire `GrcObjectType.ts` : casse canonique retenue (majuscule recommandée, 5 whitelists sur 7 déjà dans cette casse) et si `NotificationResourceType` (périmètre différent) entre dans l'unification ou reste à part. | 2026-09-29 | **Résolu — `@architect` a tranché : SNAKE_CASE majuscule, `NotificationResourceType` inclus. `backend/src/domain/GrcObjectType.ts` créé, `RaciEntityType` migré dessus (migration `028`, PR #16). Restent à migrer plus tard, seulement au moment où ces modules seront exposés (pas anticipé) : `ActionPlanSourceType`/`ActionLinkResourceType`, `NotificationResourceType` lui-même (dérivation recommandée par l'architecte, pas faite), Comments/Evidence-links/Finding.** |
| @privacy | **PRIV-CH-DASH-001 — portée élargie (2026-09-29).** Confirmé toujours ouvert et non corrigé (`RiskOwnershipService.listOwners` consomme toujours `getById` sans vérifier `deletedAt`). La portée initiale ("avant le dashboard consolidé") est trop étroite : le pattern `*ViewService` que DECISION-003 généralise (10-15 repositories composés par fiche) multiplie mécaniquement le nombre de résolutions d'identité, donc le nombre de points de fuite potentiels. Exigence reformulée : la matrice widget × donnée × permission ET le correctif `getById` doivent être faits avant **tout** premier `*ViewService` codé (Risk 360, Dashboard, ou `RiskDeviceViewService`), pas seulement avant l'écran Dashboard nommément. | 2026-09-27 | **Partiellement résolu (2026-09-29)** — `RiskOwnershipService.listOwners` corrigé (masquage d'un owner suspendu, PR #16). La partie plus large (matrice widget × donnée × permission avant tout futur `*ViewService`) reste ouverte — aucun `*ViewService` codé à ce jour, condition à satisfaire au moment venu, pas avant. |
| @qa-engineer | **Trou de couverture réel trouvé (2026-09-29), non tracké jusqu'ici.** `BrandingService` (`backend/src/services/BrandingService.ts`) n'a aucun test dédié — seul service sur 32 dans ce cas. Non couvert : gates de permission `branding.read`/`branding.update`, validations d'upload (taille/MIME/nom vide), isolation tenant, branchement audit CREATE vs UPDATE. Pas un défaut fonctionnel connu, une absence totale de test. | 2026-09-29 | **Résolu — 20 tests ajoutés (`backend/test/BrandingService.test.ts`), PR #16.** |
| @documentation | **`RETEX_MULTI_AGENTS.md` confirmé obsolète (2026-09-29, reconfirmation).** En-tête toujours daté du 27/09, ne reflète ni le batch 4, ni SEC-009→016, ni DECISION-001→004, ni ADR-002/003, ni le Lot 1 RACI complet. Proposition de l'agent : ajouter une section "Mise à jour 2026-09-29" (frictions réelles : charte jamais portée faute d'item trackable, garde silencieuse SEC-012) plutôt que réécrire le document entier. | 2026-09-27 | **Résolu (Lot A, DECISION-005) — section ajoutée.** |
| @ux-designer | **Inventaire écrit des états par atome — engagement pris dans DECISION-002 (2026-09-28), jamais livré.** Signalé par l'agent lui-même lors du balayage du 2026-09-29 : les atomes ne montraient qu'un état par défaut (pas de survol/focus/chargement/erreur/vide). | 2026-09-28 | **Résolu (2026-09-29)** — table d'inventaire (18 atomes × 7 états) + démonstration visuelle pour les 3 plus utilisés (Bouton, Champ, Table), artefact `9kExAKw22AmH71rh59bdq4`. **2 vrais trous trouvés en le construisant, pas juste documentés** : aucun survol sur les boutons primaire/secondaire, et **aucun anneau de focus clavier nulle part dans la maquette** (accessibilité clavier absente) — les deux corrigés globalement dans le CSS, pas seulement pour les démos. |
| @ux-designer | **Sidebar non pensée pour l'échelle — signalé par l'agent lui-même lors du balayage du 2026-09-29.** Seulement 3 entrées/2 groupes affichés, brief prévoit ~19-25 entrées sur 7 domaines, aucun comportement de repli défini. | 2026-09-29 | **Résolu (2026-09-29)** — groupes repliables ajoutés (un seul ouvert à la fois, les autres réduits à en-tête + compteur), 6 groupes/19 entrées démontrés (Risk 360 consolidé dans "Registre" plutôt qu'entrée séparée, cohérent avec DECISION-003). Signalé par le PO en cours de route comme "pas élégant" de tout lister à plat — corrigé dans le même geste. |
| @risk-manager @architect | **Mode Classique/Participatif de cotation — question soulevée par le PO en revue de l'écran Évaluation (2026-09-29).** Réponse convergente des deux agents dispatchés séparément : "brut" (mode Participatif) n'est PAS un nouveau champ — c'est mathématiquement le score inhérent, saisi par un acteur différent (exécutant de contrôle L1 plutôt qu'équipe risque). Ce qui manque réellement : un point de maker-checker intermédiaire (L1 soumet, L2 endosse) avant que le score ne devienne l'inhérent officiel — `assertIsEvaluator` actuel n'a qu'un seul `evaluatorId` pour toute l'évaluation, pas de cran intermédiaire. Précédent direct : `VALIDE_COMITE`/ACT-253 (nouveau statut + permission dédiée, pas un objet séparé). Risque de gouvernance confirmé si non fait : un exécutant qui note seul le risque que son propre contrôle maîtrise recrée un biais d'auto-évaluation (mandat Risk Manager §43). **Désaccord de niveau non tranché** : Architect recommande de porter le mode sur `Config` (tenant-wide, par analogie avec `appetiteMode`) ; Risk Manager recommande le Dispositif (une organisation a des maturités différentes par direction, un mode global empêcherait la coexistence légitime Classique/Participatif). Les deux convergent sur un point : jamais au niveau du Risque individuel. Le niveau exact dépend de DECISION-003 (Dispositif = service de lecture composée, pas d'entité persistée) — porter une config sur une simple vue de lecture n'est pas trivial, aucun des deux agents ne peut trancher ça seul. Détail complet : `SHARED_LOG.md`. | 2026-09-29 | **Résolu par arbitrage PO — voir DECISION-006 ci-dessus (niveau Processus retenu, ni Config ni Dispositif).** |
| @security | **SEC-016 — RETEST INDÉPENDANT : CONFIRMED_FIXED. CLOSED.** Code retracé ligne par ligne (`assertNoSelfRaConflict`, commit `3db536`) : les deux sens sont désormais bloqués par un unique chemin de code (`otherRole = role === "A" ? "R" : role === "R" ? "A" : null`, recherche de `otherRole` déjà détenu par `actingUserId`) — A puis R **et** R puis A tracés à la main, tous deux `ForbiddenError`. Cas légitimes non bloqués à tort vérifiés par trace (pas seulement par les tests) : tiers désignant deux personnes différentes comme R et A (`targetUserId !== actingUserId` → sortie immédiate) ; rôles `C`/`I` toujours hors scope (`otherRole` vaut `null`). Test `SEC-016` (`SecurityBoundaries.test.ts` L1245-1271) relu intégralement : diff strictement limité à `it.fails(` → `it(`, assertion `.rejects.toThrow(ForbiddenError)` et corps du test inchangés — non affaibli. `npm run typecheck && npm test` relancés indépendamment dans `backend/` (pas repris du rapport dev-backend) : typecheck propre, **35 fichiers / 376 tests verts**. **Verdict global Lot 1 (les 6 points de la revue du 2026-09-28 + SEC-016) : 6/6 CONFIRMED_SAFE/CONFIRMED_FIXED — feu vert Security pour le câblage `RiskService`/`ControlService`/`ActionPlanService` + écran frontend**, sous réserve d'un point de vigilance non bloquant déjà noté (repositories optionnels d'`ActionPlanService`/`RaciAssignmentService` toujours injectés à tout futur point de construction) et d'un **nouveau retest Security une fois RACI effectivement câblé dans un flux d'approbation métier** (le risque métier plus large — Accountable seul sans `R` jamais gaté — devient exploitable seulement à ce moment-là, pas sur ce commit). Détail complet : `SHARED_LOG.md`, entrée `@security` du 2026-09-28 (retest SEC-016). | 2026-09-28 | **CLOSED — CONFIRMED_FIXED, feu vert Security pour la suite du Lot 1.** |

```
DECISION-036
DATE: 2026-10-11
QUESTION: Rapport SonarCloud (A10, `docs/security/sonarcloud-issues.md`) — que corriger maintenant ?
DECISION:
  Lot S1 maintenant (avant toute promotion staging → main) : `--ignore-scripts`
    sur les 5 `npm ci` (`ci.yml`, `migrate.yml`, `backend/Dockerfile`),
    Semgrep épinglé avec hash, limites multer (`files`, `fields`, `parts`)
    sur `evidences.routes.ts` et `riskImport.routes.ts`.
  Tout le reste (dette TS/React/design-system, scripts Telegram, legacy,
    réglage Sonar D5) est reporté à un lot « dette Sonar » après bouclage
    du projet.
  Tris `CartographyPage.tsx` (S2871) : non traités — page gelée par
    consigne PO.
RELATED: ligne « SonarCloud — base et plan de correction » ci-dessus.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — S1 dispatché (devops + dev-backend).
```

```
DECISION-037
DATE: 2026-10-11
QUESTION: Alertes Snyk backend (A10, `docs/security/snyk-dependencies.md`) — que traiter et quand ?
DECISION:
  S-1 (zod, CVE-2023-54404, exploitable par tout utilisateur authentifié) :
    lancé maintenant — bornes de taille vérifiées AVANT la validation des
    éléments sur les 14 `z.array` alimentés par HTTP, test de non-régression,
    règle CLAUDE.md. Obligatoire avant toute promotion staging → main.
  S-2 (`overrides` unzipper 0.12.5) et chaîne exceljs (unzipper, traverse,
    inflight — non atteignables) : reportés au lot « dette Sonar » après
    bouclage du projet. Veille A10 sur une release zod > 4.6.5.
RELATED: ligne « Snyk — dépendances backend » ci-dessus, DECISION-036.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — S-1 dispatché (dev-backend).
```

```
DECISION-038
DATE: 2026-10-11
QUESTION: Validations groupées — q37, texte étape 2, go R1.2/R1.3, mini-lot
  sécurité, Drive partagés, PEOS, conservation, ouverture aux utilisateurs.
DECISION:
  1. q37 (quorum du Comité impossible) : proposition validée SAUF le
     dernier recours. Jamais l'administrateur du client (il peut être une
     personne de l'équipe technique) : la décision revient à la fonction
     risque — le responsable du service risque (groupe Risk Manager, accès
     à tous les risques) en suppléance, garde-fous q35 ; s'il est concerné,
     Audit si son groupe n'est pas vide, sinon un autre membre du groupe
     Risk Manager non concerné. Motif, trace, Audit notifié, journal des
     décisions prises en l'absence du Comité, jamais de validation tacite.
  2. Texte final de l'étape 2 (R1.1) validé : « nous devons avoir notre
     MVP, les itérations se feront forcément ».
  3. GO R1.2 (B-8 groupes fixes) et R1.3 (B-9 échelle).
  4. GO mini-lot sécurité : `limit` négatif sur `/audit-logs`, évidence
     DELETED acceptée comme preuve de clôture (ActionPlanService).
  5. Drive partagés : seuls le PO et les comptes de service sont membres
     des 4 Drive — point clos.
  6. SonarCloud S5693 : le PO demande la marche à suivre exacte.
  7. PEOS PR #56 : GO (23 + 8 → approved, 6 restent candidate, merge).
  8. Conservation 10 ans confirmée ; la durée doit rester CONFIGURABLE
     dans l'interface d'administration de l'application.
  9. Aucun utilisateur ne sera ajouté tant que staging n'est pas à 100 %.
RELATED: DECISION-035, DECISION-036, DECISION-037.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — dispatches A13 (contrat), A06 ×3 (B-8, B-9, sécurité), A21 (PEOS).
```

```
DECISION-039
DATE: 2026-10-11
QUESTION: PEOS domaine ; F-B8-06 (droits perdus à la réactivation) ;
  réponses PO dans l'artefact Pilotage (q37 révisée, q40, q41).
DECISION:
  1. PEOS : la ligne « Source » des fiches garde « SaaS de
     gouvernance/risques multi-tenant » (recommandation acceptée). PR #56
     peut être fusionnée.
  2. F-B8-06 : l'utilisateur réactivé qui a perdu des droits (rôle
     désactivé pendant sa suspension) est PRÉVENU qu'il ne les a plus ;
     quand il tente une action refusée, une fenêtre (modal) lui montre
     les utilisateurs qui peuvent lui redonner ses droits.
  3. q37 RÉVISÉE (remplace DECISION-038 §1) — quorum du Comité impossible
     (trop de votants exclus ou échéance dépassée) : l'envoi au Comité
     est refusé et la demande passe à AUDIT ; si le groupe Audit est
     vide, elle passe au responsable du risque (membre du groupe Risk
     Manager) ; s'il est lui-même concerné, il décide AVEC CONSULTATION
     d'un autre membre du groupe Risk Manager (paramètre configurable
     dans l'administration). Décision inscrite au journal « décisions
     prises en l'absence du Comité » ; jamais de validation tacite.
     Jamais l'administrateur du client.
  4. q40 : GO vague 2 du design system sur le périmètre de
     docs/ux/DS-V1-revue-penpot.md (tailles bouton/fenêtre, tableau
     compact/zébré/sélectionné, états onglet/carte, palier 12px, titre
     30px, puis les 18 composants manquants).
  5. q41 : un Comité vide peut être choisi comme approbateur du
     Dispositif ; la suppléance s'applique (texte actuel).
RELATED: DECISION-038, F-B8-06.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — A13 (contrat q37), A06 + Dev Frontend (F-B8-06),
  Dev Frontend + A04 (DS vague 2), A21/orchestrateur (merge PEOS #56).
```

```
DECISION-040
DATE: 2026-10-11
QUESTION: réponses PO dans l'artefact Pilotage, q42 à q57 (B-8, B-9,
  F-B8-06, premier Dispositif, précisions q37 Q-37a à Q-37h).
DECISION:
  1. q42 (B8-1) : Risk Manager = droits larges sur les risques, jamais
     approuver ce qu'il a lui-même saisi ; Comité = lecture + vote ;
     Audit = lecture seule sur tout ; le GROUPE Audit REMPLACE le rôle
     « Auditeur ».
  2. q43 (B8-2) : interdire Risk Manager + Audit ; autoriser Risk
     Manager + Comité, cumul affiché sur la fiche. L'interdiction des
     cumuls doit être CONFIGURABLE, à l'exception de Risk Manager +
     Comité (portée exacte du réglage → q58).
  3. q44 (B8-3) : motif obligatoire pour entrer/sortir des 3 groupes
     fixes, sans approbateur tiers (MVP).
  4. q45 (B8-4) : seul l'administrateur de l'application modifie les
     droits du groupe Audit, jamais l'équipe risque, chaque changement
     tracé. Si l'administrateur est aussi responsable de la fonction
     risque, il fait le changement mais Audit ou le Comité doit le
     VALIDER (maker-checker).
  5. q46 (B8-5) : rattachement processus → département obligatoire pour
     tout nouveau processus dès maintenant ; rattacher les existants
     avant l'ouverture aux utilisateurs, puis NOT NULL en base.
  6. q47 (B8-6) : modèle « département = groupe » confirmé.
  7. q48 (F-B8-06) : dans la fenêtre « droits perdus », AFFICHER les noms
     des personnes qui peuvent redonner les droits (exception explicite
     à q02 / DECISION-011, limitée à ce cas).
  8. q49 (B9-1) : la taille de matrice (3×3, 4×4, 5×5, 6×6) est choisie
     à la création du Dispositif ; tout s'aligne dessus : plafond de
     score = n², bandes de criticité, seuils, nombre de descriptifs à
     remplir, côté serveur ET visuellement côté frontend (lien avec la
     page Cartographie → q59).
  9. q50 (B9-2) : descriptifs de niveaux facultatifs en brouillon,
     obligatoires pour activer l'échelle.
  10. q51 (E2-C8) : l'administrateur est retiré ; seul un membre du
     groupe Risk Manager active le premier Dispositif. Le premier
     utilisateur créé par l'administrateur est le Risk Manager (groupe
     risque, plus haut niveau d'accès). L'administrateur peut, dans
     certains cas, être lui-même le Risk Manager.
  11. q52 (Q-37a/b) : « consultation » = CO-SIGNATURE, tracée au
     journal, journal visible dans une vue dédiée au Comité et à Audit,
     sans autre restriction (Audit/Comité peuvent ensuite se rapprocher
     des décideurs). Cas du refus de co-signer → q60.
  12. q53 (Q-37c/d) : le responsable reste exclu s'il est demandeur ou
     auteur ; décision avec co-signature seulement s'il est Risk Owner,
     Délégué ou Exécuteur. « Responsable du risque » = responsable de la
     fonction risque.
  13. q54 (Q-37e) : UN SEUL circuit : Comité ; si vide → Audit ; si vide
     → fonction risque, avec journalisation. Tout nouvel utilisateur
     ajouté au Comité ou à Audit a une vue de toutes les décisions prises
     en leur absence. (Remplace la chaîne q31 et la suppléance directe
     q41.)
  14. q55 (Q-37f) : AUCUN quorum forcé par défaut pour les décisions ;
     système souple, adaptable à l'environnement de contrôle, les
     actions étant journalisées (règle de décision par défaut → q61).
  15. q56 (Q-37g) : motif obligatoire et tracé ; Audit prévenu chaque
     fois qu'il n'est pas lui-même le décideur.
  16. q57 (Q-37h) : votes déjà émis à l'échéance gardés dans
     l'historique, visibles par le décideur, non comptés dans la
     nouvelle décision.
RELATED: DECISION-011, DECISION-035, DECISION-038, DECISION-039.
NOTE: Gitar (PR #154) classe q37/q54/q55 « risque élevé » : décisions de
  risque possibles sans contrôle indépendant du Comité. Choix PO assumé
  (journalisation + vue dédiée Comité/Audit) ; revue Compliance (A14)
  demandée sur ce point.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — suites : q58 à q61 (artefact) ; A13 (contrat) ; A14
  (revue) ; A06 lots B-8 bis et B-9 bis ; Dev Frontend (fenêtre
  droits perdus) après A06.
```

```
DECISION-041
DATE: 2026-10-11
QUESTION: précision PO (chat) sur la taille de matrice et la page
  Cartographie — répond à q59.
DECISION:
  1. L'échelle est TOUJOURS carrée : 3×3, 4×4, 5×5 ou 6×6. Probabilité
     de 1 à n, impact de 1 à n quel que soit le nombre d'axes d'impact,
     n descriptifs pour la probabilité et n pour CHAQUE axe d'impact.
     La taille est configurée à la création du Dispositif.
  2. La consigne « ne pas toucher la page Cartographie » vise le VISUEL
     (design, mise en page, style), pas la taille de la grille.
  3. La heatmap de la Cartographie suit la taille de l'échelle du
     Dispositif actif : grille 3×3, 4×4, 5×5 ou 6×6.
  4. Tant qu'aucun Dispositif n'est activé, la Cartographie n'affiche
     AUCUNE grille.
NOTE: la création d'échelle impose déjà probabilité = impact
  (`RatingScaleService.create`) ; le cas « tailles inégales » ne
  concerne que d'anciennes échelles déjà en base. Le Dispositif n'existe
  pas encore au backend (lot B-6) : en attendant, « Dispositif activé »
  = « échelle active du tenant ». La page Cartographie calcule
  aujourd'hui ses zones de couleur côté frontend (`ceil(x*y/5)`, grille
  5×5 en dur) : règle métier recalculée côté frontend, à remplacer par
  les bandes servies par le backend.
RELATED: DECISION-040 §8, q49, q59.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — A06 (bandes effectives de l'échelle active exposées)
  puis Dev Frontend (grille n×n, état vide, visuel inchangé).
```

```
DECISION-042
DATE: 2026-10-11
QUESTION: réponses PO dans l'artefact Pilotage, q58 à q69 (q59 →
  DECISION-041). Toutes les recommandations sont acceptées.
DECISION:
  1. q58 : Risk Manager + Audit toujours interdit (non configurable) ;
     Risk Manager + Comité toujours autorisé ; le seul réglage porte sur
     Comité + Audit, AUTORISÉ par défaut.
  2. q60 : co-signature refusée → la décision n'est pas prise ; le
     responsable peut solliciter un autre membre du groupe risque ; sans
     co-signature, la demande reste en attente avec alerte (jamais de
     validation tacite) ; refus et motif tracés.
  3. q61 (et R1 Compliance) : par défaut, majorité des votes exprimés à
     l'échéance avec au moins un vote d'un membre non concerné ; quorum
     minimal activable dans l'administration ; personne n'a voté à
     l'échéance → niveau suivant (Audit, puis fonction risque).
  4. q62 (R2) : chaque décision « prise en repli » est marquée ;
     indicateur de leur part par groupe décideur ; ratification a
     posteriori non bloquante par le Comité dès qu'il a des membres.
  5. q63 (R3) : administrateur = Risk Manager autorisé, cumul marqué sur
     la fiche, motif exigé, tiers prévenu (Audit ou Comité dès qu'ils
     existent).
  6. q64 : Audit ne saisit ni ne modifie jamais de données ; il exerce
     seulement les décisions prévues (validation q45, repli q54),
     marquées « prises par la 3e ligne ».
  7. q65 : l'auto-proposition ne s'active que par un vrai vote du
     Comité, jamais en repli ; Audit est prévenu de toute entrée au
     Comité.
  8. q66 : tous les membres Risk Manager agissent sur tous les risques
     (q42 prévaut), jamais d'auto-approbation.
  9. q67 : changement des droits d'Audit en attente tant qu'aucun membre
     d'Audit ou du Comité n'existe ; jamais de validation automatique.
  10. q68 : le réglage « consultation » est supprimé ; co-signature
     toujours exigée.
  11. q69 : l'approbateur choisi au Dispositif décide en premier ; s'il
     est vide ou ne peut pas décider, on suit le circuit en sautant ce
     maillon (Comité, Audit, fonction risque).
RELATED: DECISION-040, DECISION-041, compliance-DECISION-040.md.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — A13 (contrat) ; A06 (q58 réglage Comité+Audit, q63
  marquage admin=RM, q65 notification d'entrée au Comité) ; q60/q61/q62/
  q69 dans le lot Comité (B-12) ; q64/q66/q67 déjà conformes au code.
```

```text
DECISION-043
DATE: 2026-10-11
QUESTION: réponses PO dans l'artefact Pilotage, q70 à q78.
DECISION:
  1. q70 : construire tout de suite le centre de notifications complet
     (et non un simple bandeau « droits perdus »).
  2. q71 : seuils Comité par défaut validés : 3×3 → 5, 4×4 → 9,
     5×5 → 15, 6×6 → 21.
  3. q72 : sens de « jamais un seul membre » validé (un groupe n'est
     sollicité que s'il compte au moins deux membres éligibles, sinon
     maillon suivant en repli marqué) ; règle q61 inchangée ; une
     décision prise par un seul vote exprimé est marquée « vote unique »
     dans la vue Comité/Audit.
  4. q73 : cumul Comité + Audit autorisé, mais sur un même dossier la
     personne n'agit qu'une fois (votante au Comité → exclue côté Audit,
     et inversement) et ne ratifie jamais une décision à laquelle elle a
     pris part.
  5. q74 : ratification sans délai imposé, indicateur « décisions en
     attente de ratification » ; refus → la décision reste en vigueur,
     marquée « non ratifiée », et le dossier repart en vote du Comité.
  6. q75 : plus personne pour décider → la demande reste en attente,
     alerte visible de tous les membres Risk Manager + indicateur ;
     jamais de validation tacite, jamais l'administrateur.
  7. q76 : Audit en remplacement d'un Comité vide vote avec la même règle
     (q61) ; décision marquée « prise en repli par la 3e ligne ».
  8. q77 : démarrage avec un seul Risk Manager → actions autorisées en
     phase de démarrage, marquées « amorçage » avec motif ; elles
     apparaissent dans la vue « décisions prises en votre absence » des
     premiers membres d'Audit et du Comité, qui sont alors prévenus.
  9. q78 : Cartographie, répartition des 5 couleurs sur les bandes
     conservée (plus basse verte, plus haute rouge).
RELATED: DECISION-040, DECISION-041, DECISION-042, q51 (premier
  Dispositif), DECISION-019 P3 (invariant 5).
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — A13 (contrat, q72 à q77) ; B-6 (q77 amorçage, premier
  Dispositif q51) ; B-12 (q72 à q76) ; centre de notifications (q70,
  backend + frontend) ; q71 et q78 déjà conformes au code.
```

```text
DECISION-044
DATE: 2026-10-12 (réponses saisies dans l'artefact Pilotage entre 01:08 et
  01:22 UTC, q94/q95 à 08:11 UTC ; journalisées ici à 08:40 UTC — retard
  de journalisation de l'orchestrateur, voir la note en fin d'entrée)
QUESTION: réponses PO dans l'artefact Pilotage, q79 à q95.
DECISION:
  1. q79 : la « gestion du client » compte comme droit d'administrateur,
     pas la « méthodologie » ; repérer avant la production les personnes
     déjà concernées.
  2. q80 : cumul administrateur + Comité autorisé comme administrateur +
     Risk Manager (cumul marqué sur la fiche, motif, tiers prévenu) ;
     l'administrateur ne vote ni ne ratifie jamais une demande qu'il a
     faite ou un changement de droits qu'il a appliqué.
  3. q81 : amorçage limité à une liste fermée — activation du premier
     Dispositif et approbation des désignations (responsable de risque,
     délégué, exécuteur). Toujours exclus : changements de droits
     d'Audit (q67), activation de l'auto-proposition (q65).
  4. q82 (réponse libre, interprétation orchestrateur à confirmer par
     A13) : l'amorçage ne s'arrête pas tant que le Comité ET Audit sont
     vides, c.-à-d. il prend fin dès que l'un des deux a un membre ; pas
     de durée maximale. Toutes les actions d'amorçage sont journalisées
     et consultables dans une vue dédiée par Audit et le Comité dès
     l'ajout de leurs membres (ce qui a été fait pendant leur absence).
  5. q83 (réponse libre, interprétation orchestrateur à confirmer par
     A13) : pas d'exception d'auto-approbation par défaut — le Risk
     Manager seul doit d'abord créer au moins un autre utilisateur du
     groupe risque ; seulement si c'est impossible, il agit seul, et
     toutes ces actions sont journalisées dans la vue dédiée accessible
     à Audit et au Comité. Pas de ratification ultérieure demandée.
  6. q84 : retard de démarrage / échéance dépassée d'une action →
     responsable de l'action + propriétaire et supérieur de chaque
     risque couvert par l'action (sans doublon).
  7. q85 : alertes KRI et retards d'action obligatoires pour tous les
     destinataires (plus de désabonnement) → ferme F-NOTIF-02.
  8. q86 : bascule vers le Dispositif : courte période sans évaluation
     possible acceptée (B-6b).
  9. q87 : interdire de choisir Audit ou Comité comme approbateur avant
     B-12 (et non plus « demande en attente ») → change B-6a livré.
  10. q88 : « Audit et Comité » : les deux votes requis, Comité d'abord,
      puis Audit (B-12).
  11. q89 : changer un processus de Dispositif → règle d'approbation du
      Dispositif d'arrivée, effet au cycle suivant (B-6c).
  12. q90 : audit écrit dans la même opération indivisible que l'action,
      dès le Dispositif (toutes ses actions, pas seulement
      l'activation) → change B-6a livré ; ferme C-B6a-01 une fois fait.
  13. q91 : tous les paramètres du Dispositif prévus dès maintenant
      (seuil « faible », cumuls, délégation, politique Hybride,
      Maîtrise, règle du Comité), pas lot par lot.
  14. q92 : auto-proposition désactivée jusqu'à B-12.
  15. q93 : un seul Risk Manager au départ → garder la phase d'amorçage
      (points 3 à 5).
  16. q94 : interdire le cumul équipe risque (Risk Manager) + Comité —
      annule la partie « Risk Manager + Comité toujours autorisé » de
      q58 (DECISION-041/042) → change B-8 livré ; repérer les cumuls
      existants avant production.
  17. q95 : les 4 notifications `RISK_FRAMEWORK_*` sont ajoutées au
      catalogue comme obligatoires.
RELATED: DECISION-040, DECISION-041, DECISION-042, DECISION-043,
  C-B6a-01, C-B6a-02, F-B6a-05, F-NOTIF-02, spec B-6 §14.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — corrections du livré : B-6a (q87, q90), notifications
  (q84, q85, q95), RBAC (q79, q80, q94) ; spec B-6 à mettre à jour par
  A05/A13 (q81-q83, q86, q88, q89, q91-q93) avant B-6b/c/d ; B-12 (q88,
  q92). NOTE ORCHESTRATEUR : ces réponses sont restées non journalisées
  ~7 h et l'orchestrateur les a décrites comme « en attente » dans ses
  points d'étape — écart à la règle 7bis / protocole cockpit
  (DECISION-021) : relire la collection `questions` (status=answered) à
  chaque transition de module, pas seulement au moment où l'on pose une
  question.
```

```
DECISION-045
DATE: 2026-10-12 (réponses cockpit 08:46–08:48 UTC, journalisées 13:25 UTC)
CONTEXT: questions q96–q99 posées par l'orchestrateur après les lots
  A06 notifications (0c4384b) et la spec B-6 mise à jour (A05, §14.2).
DECISION (PO, cockpit, toutes = recommandation acceptée) :
  1. q96 : une action née d'un KRI notifie aussi le propriétaire et le
     supérieur du risque surveillé par ce KRI (risque couvert = source
     RISK + liens RISK + risque du KRI source) → correctif A06 sur
     `ActionPlanService.resolveRecipients`.
  2. q97 : l'écran des abonnements reste, en lecture seule : il liste
     les notifications reçues et indique qu'elles sont obligatoires →
     frontend (Dev Frontend), pas de changement backend.
  3. q98 (I-D5) : en mode démarrage (B-6d), le premier Dispositif porte
     uniquement les valeurs par défaut du contrat ; tout réglage passe
     ensuite par une demande ordinaire → spec B-6d.
  4. q99 (I-D6) : `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` est obligatoire au
     catalogue → B-6d.
RELATED: DECISION-044, spec B-6 §14.2, docs/risk/A13-review-DECISION-044.md.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — q96 à dispatcher (A06), q97 à dispatcher (Dev
  Frontend), q98/q99 intégrées à B-6d. NOTE ORCHESTRATEUR : deuxième
  retard de journalisation le même jour (~4 h 30) malgré la leçon de
  DECISION-044 — la relecture `status == "answered"` doit précéder
  chaque message au PO, pas seulement chaque transition de module.
```

```
DECISION-046
DATE: 2026-10-12 (réponses cockpit 13:08–13:11 UTC, journalisées 13:14 UTC)
CONTEXT: questions q100–q104 issues de la revue A13 de DECISION-044
  (docs/risk/A13-review-DECISION-044.md) et de la spec B-6 §14.2.
DECISION (PO, cockpit) :
  1. q100 (Q-A13-1) : repérage avant production ET garde-fou construit
     tout de suite : une version active héritée dont l'approbateur est
     COMMITTEE ou AUDIT ne gèle pas le Dispositif ; la demande se replie
     vers le Risk Manager, commentaire obligatoire, ratification
     ultérieure (régime de repli q62) → B-6d + requête de repérage
     (B8-predeploy-checks.sql, lecture seule).
  2. q101 (I-D1) : réponse libre « le risk manager continue de
     s'auto-approuver et l'auditeur est informé » = option 2 : l'amorçage
     ne se termine que lorsqu'un circuit fonctionne réellement (second RM
     actif, ou ≥ 2 membres éligibles au Comité ou à l'Audit, q72) ;
     jusque-là le RM s'auto-approuve et le ou les membres existants
     d'Audit/Comité sont informés de chaque décision BOOTSTRAP.
  3. q102 (I-D3) : fin définitive et mémorisée ; l'amorçage ne se
     rouvre jamais pour ce tenant (recommandation acceptée).
  4. q103 (Q-A13-4) : réponse libre « les actions sont journalisées pour
     consultation dès que l'un des groupes Audit et/ou Comité est
     supérieur à un membre » : quand les groupes sont vides, personne
     d'autre n'est prévenu (ni administrateurs ni HUMAN) ; les décisions
     sont journalisées et consultables. Lecture du seuil à confirmer par
     A13 (item I-D7).
  5. q104 (Q-A13-5) : cumul administrateur + Audit traité comme
     administrateur + Comité (q80) : motif obligatoire, tiers prévenu,
     cumul signalé (recommandation acceptée) → A06 RoleService.
RELATED: DECISION-044, DECISION-045, spec B-6 §5.6 et §14.2.
OWNER: HUMAN (Product Owner)
STATUS: DÉCIDÉ — q104 dispatché (A06) ; q100–q103 intégrées à la spec
  B-6d (A05). CORRECTIF ORCHESTRATEUR (13:30) : q105 avait été
  répondue à 13:12:50, quelques secondes après la lecture du cockpit ;
  annoncée à tort comme « encore ouverte » au PO, qui l'a signalé.
  6. q105 (Q-A13-6) : réponse libre « conserver pour les deux rôles
     admin et manager de risque ». Lecture probable : l'import de
     risques et les catégories restent ouverts aux deux rôles, sans
     que le Risk Manager devienne « administrateur + RM » signalé, ce
     qui suppose des droits dédiés hors `config.manage` (option B).
     Précision demandée au PO (q106). Réponse q106 (13:21) : « Non :
     laisser en l'état ; un Risk Manager qui importe reçoit le droit de
     gestion client et reste signalé administrateur + Risk Manager ».
     → Aucun changement de code (option A de Q-A13-6). DÉCIDÉ.
```

```
DECISION-047
DATE: 2026-10-17 (réponse cockpit q107 le 2026-10-14 12:26 UTC, journalisée 2026-10-17)
CONTEXT: Q-A14-B6b-1 / C-B6b-01 (docs/compliance/A14-review-B6b.md) :
  marquer l'origine « reprise » des seuils des évaluations antérieures
  au Dispositif ?
DECISION (PO, cockpit) : « Compter d'abord les évaluations concernées
  en production, puis décider (ajout d'une colonne d'origine seulement
  s'il y en a) » (recommandation acceptée).
  → Aucun code maintenant. Le comptage (requête lecture seule, jamais
  exécutée par un agent sur Neon) est à fournir au PO avant la mise en
  production ; si le compte > 0, une colonne d'origine sera spécifiée.
RELATED: q107, Q-A14-B6b-1, B-6b.
OWNER: HUMAN (comptage en production) ; @dev-db (requête lecture seule)
STATUS: DÉCIDÉ — en attente du comptage HUMAN.

DECISION-048
DATE: 2026-10-18 (réponse cockpit q108 le 2026-10-17 21:02 UTC, non relue à la passation, journalisée 2026-10-18)
CONTEXT: Q-A14-B6b-2 / B-6b-01 : seconde façon d'activer une échelle
  (`RatingScaleService.activateVersion`) alors que le Dispositif gouverne.
DECISION (PO, cockpit) : « Condition de mise en production : fermé avant
  la première mise en production » (recommandation acceptée).
  → B-6b-01 est déjà corrigé (A06, activateVersion refusé quand le
  Dispositif est branché) : l'item entre dans la checklist pré-production
  comme point à revérifier, pas comme travail neuf.
RELATED: q108, Q-A14-B6b-2, B-6b-01.
OWNER: @orchestrator (checklist pré-production)
STATUS: DÉCIDÉ — satisfait sous réserve de revérification pré-production.

DECISION-049
DATE: 2026-10-18 (réponse cockpit q109 le 2026-10-17 21:02 UTC, journalisée 2026-10-18)
CONTEXT: Q-A14-B6b-3 : présentation des évaluations sans version de Dispositif.
DECISION (PO, cockpit) : « Les afficher "antérieures au Dispositif, seuils
  de reprise", sans conclure sur leur conformité à la méthode »
  (recommandation acceptée).
  → Travail frontend (écrans + exports), aucune règle recalculée côté
  client : le critère est `risk_framework_version_id` NULL renvoyé par l'API.
RELATED: q109, Q-A14-B6b-3, DECISION-047 (q107).
OWNER: @dev-frontend
STATUS: DÉCIDÉ — à implémenter.

DECISION-050
DATE: 2026-10-18 (réponse cockpit q110 le 2026-10-17 21:04 UTC)
CONTEXT: QA-B6b-02 — fiche 360 : quelle appétence afficher quand le
  Dispositif a changé depuis l'évaluation ?
DECISION (PO, cockpit, réponse libre) : « Garder l'appétence actuelle et
  indiquer l'autre à titre d'information ». Lecture orchestrateur : la
  référence affichée reste l'appétence de la version applicable ;
  l'appétence figée sur l'évaluation apparaît en information quand elle
  diffère (variante de la recommandation « afficher les deux »).
RELATED: q110, QA-B6b-02, F-B6b-01.
OWNER: @dev-backend (exposer les deux valeurs) ; @dev-frontend
STATUS: DÉCIDÉ — à implémenter.

DECISION-051
DATE: 2026-10-18 (réponse cockpit q111 le 2026-10-17 21:05 UTC)
CONTEXT: QA-B6bF-04 / F-B6b-09 — rapport appétence vs résiduel : risque
  sans seuil d'appétence présenté « non dépassé ».
DECISION (PO, cockpit, réponse libre) : « Signalement pas d'appétence
  rattachée » — équivalent à la recommandation : état explicite, distinct
  de « non dépassé ».
RELATED: q111, QA-B6bF-04, F-B6b-09.
OWNER: @dev-backend (état calculé serveur) ; @dev-frontend
STATUS: DÉCIDÉ — à implémenter.

DECISION-052
DATE: 2026-10-18 (réponse cockpit q112 le 2026-10-17 21:05 UTC)
CONTEXT: QA-REF2-02 — une catégorie désactivée peut-elle servir de parent ?
DECISION (PO, cockpit) : « Refuser : une catégorie désactivée ne peut pas
  devenir parente » (recommandation acceptée).
  → Implémenté par l'orchestrateur (`RiskCategoryService.assertValidParent`) :
  refus à la création et au changement de parent ; une sous-catégorie dont
  le parent a été désactivé plus tard reste modifiable avec ce même parent
  (sinon l'écran, qui renvoie toujours `parentId`, la bloquerait).
RELATED: q112, QA-REF2-02.
OWNER: @orchestrator (fait) ; @qa-engineer (retest) ; @dev-frontend (options)
STATUS: DÉCIDÉ — implémenté, retest A08 à faire.

DECISION-053
DATE: 2026-10-18
CONTEXT: Étape 3 de la passation du 2026-10-17 : B-6d (amorçage avec un
  seul Risk Manager, q81–q83, q93, q98–q103 ; repli q100), obligatoire
  avant la mise en production de B-6b (spec B-6 §0, §8.0).
DECISION (PO, conversation) : « Go pour B-6d ».
  → Dispatch A06 (+ A07 pour la migration, numéro suivant le dernier
  présent : 062) ; I-D8/I-D9 (§14.2) instruits en parallèle par A13,
  non bloquants selon la spec §0.
RELATED: spec `docs/architecture/RM-V1-B6-Dispositif-spec.md` §5.4.1,
  §5.6, §12.3, §15, §18 ; DECISION-045, DECISION-046.
OWNER: @dev-backend @dev-db ; @risk-manager (I-D8, I-D9)
STATUS: DÉCIDÉ — dispatché.

DECISION-054
DATE: 2026-10-18
CONTEXT: Refonte de la section Risques, points (a) et (b) laissés ouverts
  par q13 (réglages du Dispositif « dans son espace », Administration en
  lecture).
DECISION (PO, conversation) : (a) Les réglages vivent dans
  l'Administration ; les autres sections n'y donnent qu'un accès, pour
  l'ergonomie, et appellent les mêmes actions que l'Administration.
  (b) Même modifiés depuis une autre section, c'est côté backend le même
  appel que dans l'Administration : une seule action, une seule règle,
  un seul audit — jamais un second chemin d'écriture.
  → Précise et remplace q13 sur le lieu de réglage du Dispositif.
  Consultation A05 + A06 demandée par le PO (« ce qui doit être mieux »).
RELATED: q13, DECISION-017 n° 5, contrat §13, item « Refonte de la
  section Risques ».
OWNER: @architect @dev-backend (consultation) ; puis @ux-designer @dev-frontend
STATUS: DÉCIDÉ — consultation en cours.

DECISION-055
DATE: 2026-10-18 (réponse cockpit q113, horodatée 2026-10-17 21:36 UTC)
CONTEXT: q113 / I-D9 — auto-désignation de l'« administrateur sollicité »
  pendant l'amorçage.
DECISION (PO, cockpit, réponse libre) : principe produit transverse —
  « le produit est destiné à être commercialisé à des entreprises dont les
  configurations seront atypiques d'un client à l'autre : tout doit être
  modulable ; la configuration par défaut part sur une gouvernance
  stricte, en laissant au client la possibilité de configurer à sa
  guise ». Demande de redispatcher Risk Manager, Dev Backend et Sécurité
  et de lui rapporter leur retour.
  → Lecture orchestrateur pour I-D9 : réglage par client, défaut strict
  (interdit) ; à confirmer par la consultation A13/A06/A10. Les invariants
  non négociables éventuels (ex. append-only de l'audit, maker-checker)
  doivent être identifiés par la consultation et soumis au PO, jamais
  décidés seuls.
RELATED: q113, I-D9, F-B6d-01, QA-B6d-01, contrat §10 (paramètres du
  Dispositif, 9 invariants).
OWNER: HUMAN ; @risk-manager @dev-backend @security @architect (consultation)
STATUS: DÉCIDÉ (principe) — déclinaison en consultation.

DECISION-056
DATE: 2026-10-18 (réponse cockpit q114, horodatée 2026-10-17 21:40 UTC)
CONTEXT: C-B6d-02 / Q-A14-B6d-2 — la vue « décisions prises en votre
  absence » (amorçage, repli) n'existe qu'en API.
DECISION (PO, cockpit, option recommandée) : livrer l'écran avant
  l'arrivée du premier membre Audit ou Comité en production ; à défaut,
  une procédure écrite tenue par le PO.
RELATED: q114, C-B6d-02, B-6d.
OWNER: @dev-frontend (écran) ; HUMAN (procédure de repli)
STATUS: DÉCIDÉ — à planifier avant la mise en production de B-6d avec un
  premier membre Audit/Comité.

DECISION-057
DATE: 2026-10-18 (réponse cockpit q115, horodatée 01:48 UTC)
CONTEXT: Consultation DECISION-055 — éléments qui restent hors de toute
  configuration client.
DECISION (PO, cockpit, réponse libre) : non configurables — isolation
  entre clients ; journal d'audit jamais modifiable ; « qui a fait quoi »
  toujours enregistré par le serveur ; suppression logique seulement ;
  personne ne valide ce qu'il a saisi ni ne s'attribue ses propres rôles ;
  vérification de la connexion. Sur l'authentification : si d'autres
  mécanismes que le SSO existent, laisser le choix au client, avec
  e-mail + mot de passe par défaut.
  → Lecture orchestrateur : le mode de connexion devient un réglage client
  (défaut e-mail/mot de passe, SSO en option) ; la vérification du mode
  choisi reste non configurable. Le PO a demandé « à toi de valider » :
  trois éléments de la liste proposée ne figurent pas dans sa réponse
  (pas de validation tacite ; cumul de rôles toujours visible ; historique
  jamais réécrit) — non tranché, à reconfirmer (item ouvert, q120).
RELATED: q115, DECISION-055, consultation-configurabilite-2026-10-18.md.
OWNER: HUMAN (q120) ; @architect @security
STATUS: DÉCIDÉ pour les 6 éléments cités — 3 éléments à reconfirmer.

DECISION-058
DATE: 2026-10-18 (réponse cockpit q116, horodatée 01:49 UTC)
CONTEXT: Assouplir un réglage de gouvernance : une ou deux personnes ?
DECISION (PO, cockpit, contre la recommandation A10) : un administrateur
  seul peut assouplir, avec motif obligatoire et trace d'audit (avant/après).
  → Les écarts relevés par A10/A05 (`setCommitteeEnforcement`,
  `setCommitteeAuditCumul`, `PATCH /modules/:name/toggle`) n'ont pas à
  passer en maker-checker ; ils doivent en revanche tous exiger un motif
  et tracer avant/après (le toggle de module n'a aujourd'hui ni motif ni
  trace complète).
RELATED: q116, DECISION-055, item « Assouplissements à un seul
  administrateur ».
OWNER: @dev-backend @security
STATUS: DÉCIDÉ (risque accepté par le PO).

DECISION-059
DATE: 2026-10-18 (réponse cockpit q117, horodatée 01:50 UTC)
CONTEXT: I-D9 — auto-désignation de l'« administrateur sollicité ».
DECISION (PO, cockpit) : créer un régime « structure à une personne »,
  désactivé par défaut, déclaré **seulement par l'éditeur** à l'ouverture
  du compte client (jamais par le client lui-même), affiché sur chaque
  décision, rapport et cartographie (« sans second regard »), levé
  définitivement dès qu'une deuxième personne arrive. L'auto-désignation
  reste interdite.
RELATED: q117, q113, DECISION-055, I-D9, B-6d.
OWNER: @risk-manager @dev-backend @security
STATUS: DÉCIDÉ — à spécifier (lot à créer).

DECISION-060
DATE: 2026-10-18 (réponse cockpit q118, horodatée 01:50 UTC)
CONTEXT: Dans l'Administration, qui peut modifier la méthodologie
  (Dispositif : échelles, appétence, paramètres) ?
DECISION (PO, cockpit, contre la recommandation A05) : l'administrateur
  peut aussi modifier la méthodologie.
  → Amende le contrat (méthodologie réservée au groupe Risk Manager).
  Lecture orchestrateur : le circuit d'approbation des changements de
  Dispositif (maker-checker, B-6a/B-6d) reste inchangé ; seul le droit de
  proposer/modifier s'étend à l'administrateur. À confirmer avec A13
  avant implémentation.
RELATED: q118, DECISION-054, contrat §13.
OWNER: @architect @risk-manager @dev-backend
STATUS: DÉCIDÉ — mise à jour du contrat à faire.

DECISION-061
DATE: 2026-10-18 (réponse cockpit q119, horodatée 01:50 UTC)
CONTEXT: Cumul Comité + Audit autorisé par défaut (DECISION-042, q58),
  seul défaut non strict.
DECISION (PO, cockpit, option recommandée) : interdit par défaut,
  autorisable par le client.
  → Remplace le défaut de DECISION-042. Point d'attention pour Djamo
  (tenant existant) : changer le défaut ne doit pas révoquer
  silencieusement un cumul déjà en place — à traiter dans le lot.
RELATED: q119, DECISION-042, q58.
OWNER: @dev-backend @dev-db
STATUS: DÉCIDÉ — à implémenter.

DECISION-062
DATE: 2026-10-18
CONTEXT: Refonte de la section Risques, débloquée par DECISION-054/060.
  Plan proposé par l'orchestrateur : UX (A04) nouvelle navigation +
  Dev Backend (A06) « un seul chemin d'écriture » + Risk Manager (A13)
  confirmation DECISION-060, en parallèle ; puis Dev Frontend ; puis
  QA + Sécurité.
DECISION (PO, conversation : « Lance ») : go pour ce plan.
  → Réserve orchestrateur (règle 7bis) : le modèle causes/événements/
  impacts touche OD-10, jamais tranché (structure + qui édite l'Analyse).
  Il est retiré du dispatch et posé au PO en q121 ; A06 ne crée aucune
  colonne Analyse avant la réponse.
RELATED: item « Refonte de la section Risques », DECISION-054, DECISION-060,
  OD-10, q121.
OWNER: @ux-designer @dev-backend @risk-manager ; puis @dev-frontend
STATUS: DÉCIDÉ — dispatch en cours.

DECISION-063
DATE: 2026-10-18 (cockpit q120)
CONTEXT: 3 invariants proposés par les agents, absents de la réponse q115.
DECISION (PO, option recommandée) : restent non configurables — pas de
  validation tacite, cumul de rôles toujours visible, historique jamais
  réécrit. Liste complète des invariants : 9 (q115 + q120).
RELATED: q115, q120, DECISION-057.
OWNER: @architect @security
STATUS: DÉCIDÉ.

DECISION-064
DATE: 2026-10-18 (cockpit q121, réponse libre)
CONTEXT: Étape Analyse de la refonte Risques (OD-10).
DECISION (PO) : une étape Analyse distincte, avec la structure prévue par
  la refonte (listes causes/événements/impacts + contexte). Peut la
  réaliser : la personne à qui le propriétaire du risque a attribué le
  risque sur un processus, ou la personne désignée en N-1 sur le
  processus, ou le propriétaire du risque, ou le propriétaire du
  processus.
  → À traduire en droits par A13/A05/A06 dans la section « Droits et
  accès » (DECISION-068) ; « N-1 désigné sur le processus » est à
  rattacher à une donnée existante ou à créer.
RELATED: q121, OD-10, DECISION-062.
OWNER: @risk-manager @dev-backend @ux-designer
STATUS: DÉCIDÉ — modèle à concevoir.

DECISION-065
DATE: 2026-10-18 (cockpit q122 à q125, options recommandées)
DECISION (PO) : q122 une grille se crée et se modifie seulement depuis un
  brouillon de Dispositif ; q123 en V1 un raccourci ouvre seulement
  l'écran d'Administration ; q124 tous ceux qui lisent les risques voient
  Administration > Méthodologie en lecture seule ; q125 l'entrée
  « Évaluations » reste dans la barre latérale.
RELATED: docs/ux/RM-V1-Navigation-Risques.md Q1-Q4.
OWNER: @ux-designer @dev-frontend
STATUS: DÉCIDÉ — la spec de navigation sort de l'état DRAFT.

DECISION-066
DATE: 2026-10-18 (cockpit q126, q127, q129, réponses libres)
CONTEXT: Structure à une personne ; qui lève le régime ; admin et Risk
  Manager.
DECISION (PO) — principe produit transverse, « ne jamais bloquer » :
  GRC Tools est un produit commercial ; il ne doit jamais se bloquer
  parce que la maturité du client ne fournit pas assez de rôles clés.
  Quand une règle de gouvernance ne peut pas être respectée :
  (1) l'action reste possible ; (2) l'outil signale le point de
  gouvernance mis à mal (le risque pris) ; (3) l'auteur confirme une
  seconde fois (double validation par la même personne) ; (4) tout est
  tracé ; (5) on peut désigner un compte (ex. le gérant) qui statue ou
  est seulement informé ; (6) le seuil qui lève ce régime (ex. arrivée
  d'un 2e Risk Manager) est configurable. L'administrateur peut aussi
  être Risk Manager (RSSI, IT…) : à gérer intelligemment, pas à
  interdire.
  → Remplace l'option « bloqué à vie » (q126). Tension avec l'invariant
  « personne ne valide sa propre saisie » (q115) : à arbitrer dans la
  section « Droits et accès » (DECISION-068), cas par cas, avec motif.
RELATED: q126, q127, q129, DECISION-059, DECISION-060, q115.
OWNER: @risk-manager @architect @dev-backend @security
STATUS: DÉCIDÉ — principe ; application cas par cas via DECISION-068.

DECISION-067
DATE: 2026-10-18 (cockpit q128, option recommandée)
DECISION (PO) : l'administrateur peut abandonner un brouillon de
  Dispositif (motif, trace).
RELATED: q128, DECISION-060.
OWNER: @dev-backend
STATUS: DÉCIDÉ — inclus dans la mise en œuvre DECISION-060.

DECISION-068
DATE: 2026-10-18 (cockpit q130, réponse libre + conversation)
CONTEXT: Les droits se tranchaient question par question (q12, q37, q109,
  q116, q130…) et l'intention se perdait.
DECISION (PO) : une section « Droits et accès » dans le cockpit, avec la
  liste de tous les droits, accès et habilitations possibles, pourquoi
  chacun existe et son objectif selon l'Architecte, le Risk Manager et le
  Dev Backend. Tout droit qui met à mal un principe de gouvernance ou de
  risque est surligné avec son motif, et le PO arbitre là, sur une base
  claire des rôles, au lieu de questions isolées. q130 est arbitrée dans
  cette section.
RELATED: q130, DECISION-066, DECISION-058, DECISION-060.
OWNER: @architect @risk-manager @dev-backend ; orchestrateur (cockpit)
STATUS: DÉCIDÉ — dispatch en cours.

DECISION-069
DATE: 2026-10-18 (cockpit q131, option recommandée)
DECISION (PO) : ajouter au circuit une demande « revenir au mode du
  Dispositif », validée comme les autres.
RELATED: q131, QA-SWP-05.
OWNER: @dev-backend
STATUS: DÉCIDÉ — à implémenter.

DECISION-070
DATE: 2026-10-18 (consigne PO en conversation)
CONTEXT: Revue Codex PR #186, deux constats laissés ouverts par
  l'orchestrateur (ligne HUMAN « Revue Codex PR #186 ») : P2 course
  désactivation d'échelle / brouillon de Dispositif, P1 absence d'éditeur
  des seuils d'appétence.
DECISION (PO) : corriger les deux constats dans la PR #186 ; tout point
  qui demande un arbitrage passe par le cockpit.
RELATED: PR #186, q132, q133.
OWNER: @dev-backend (P2) @dev-frontend (P1, commit 60f7757)
STATUS: DÉCIDÉ — P1 livré, P2 en cours ; q132/q133 ouvertes.

DECISION-071
DATE: 2026-10-18 (cockpit q132, q133, q134, options recommandées)
DECISION (PO) :
  - q132 : un onglet « Seuils d'appétence » dédié dans le détail du
    Dispositif (l'éditeur sort de la fenêtre « Modifier le brouillon »).
  - q133 : la sous-catégorie d'un seuil se choisit obligatoirement dans
    la liste des catégories de risque du référentiel (plus de texte
    libre) ; absorbe A10 F-FW-01.
  - q134 : un brouillon abandonné (ARCHIVED) ne bloque plus la
    désactivation d'une échelle ; les versions approuvées (en vigueur ou
    anciennes) continuent de bloquer.
RELATED: q132, q133, q134, DECISION-070, A10 F-063-03, F-FW-01.
OWNER: @dev-frontend (q132, q133) @dev-backend @dev-db (q133 serveur, q134)
STATUS: DÉCIDÉ — à implémenter.

DECISION-072
DATE: 2026-10-18 (cockpit, section « Droits et accès », collection
  `rightDecisions`, 20 conflits arbitrés)
CONTEXT: DECISION-068.
DECISION (PO) : réponses verbatim dans le cockpit (`rightDecisions/<id>`).
  Principales lignes :
  - Régime hybride partout où un administrateur seul agissait :
    administrateur seul tant qu'aucun tiers (Risk Manager, Audit,
    Comité) n'existe, circuit à deux dès qu'un tiers existe
    (`config.committeeenforcement.set`, `config.cumul.set`,
    `rolegroup.audit.update`, `process.evaluationmode.set`).
  - Cumuls autorisés mais jamais silencieux, toujours visibles ;
    deux comptes d'un même humain signalés, pas bloqués
    (`guard:adminRiskManagerCumul`, `group:RISK_MANAGER`).
  - `guard:noSelfValidation` : invariant paramétrable ; par défaut
    l'action est refusée, et on recueille si le client veut la double
    validation ; une vue regroupe les principes de gouvernance non
    respectés avec leurs conséquences (→ DECISION-073).
  - `riskappetite.update` : un administrateur seul (petite organisation,
    qui est aussi le Risk Manager) peut agir, tracé et marqué « sans
    seconde validation » ; dès qu'un membre d'Audit ou de Comité arrive,
    il voit cette trace et les principes non respectés.
  - `risk.owner.assign` : le propriétaire du processus est propriétaire
    par défaut des risques du processus et les assigne à son équipe ;
    chaque processus a un champion de risque ; le Risk Manager peut
    préparer la répartition à sa demande, puis « valider et envoyer » ;
    le propriétaire confirme en une seule action (double confirmation).
  - `guard:notLastRiskManager` : non tranché, rouvert (démission, intérim,
    groupe vide) — ligne HUMAN dans le tableau.
  - Autres : options citées dans `rightDecisions`.
RELATED: DECISION-068, DECISION-059, DECISION-061, DECISION-066, q104.
OWNER: @architect @risk-manager @dev-backend
STATUS: DÉCIDÉ (19/20) — un point rouvert.

DECISION-073
DATE: 2026-10-18 (consigne PO en conversation)
DECISION (PO) : un panel qui reprend tous les principes de gouvernance
  de la gestion des risques qui ne sont pas respectés, avec les objets
  qui ne les respectent pas (rôle, permission, nombre de personnes…) et
  des indications pour les respecter sur trois volets : TPE, entreprise
  « normale » (PME), grande entreprise. La taille est déduite des rôles
  assignés et l'indication qui convient le mieux est mise en
  surbrillance.
RELATED: DECISION-072 (`guard:noSelfValidation`, `riskappetite.update`).
OWNER: @risk-manager (contenu) @architect (calcul serveur) @ux-designer
  (maquette), puis @dev-backend @dev-frontend
STATUS: DÉCIDÉ — cadrage en cours, contenu à valider en cockpit.

DECISION-074
DATE: 2026-10-18 (cockpit q135 à q145)
DECISION (PO) :
  - q135 (réponse libre) : la taille ne se déduit pas des seuls comptes ;
    on pose au client des questions sur les postes existants dans
    l'entreprise (positions, nombre de personnes) et on en déduit le
    classement TPE / PME / grande entreprise. Verbatim : « Je crois qu'il
    faut poser des questions sur les disponibilités des postes dans
    l'entreprise pour mieux situer, ça sera plus efficace : sur base de
    questions sur les positions, nombre de personnes, déduire le
    classement. »
  - q136 : tous les principes, avec un niveau d'exigence propre à chaque
    taille.
  - q137 (réponse libre) : un intérimaire désigné ou un suppléant
    (deuxième Risk Manager) est désigné à la création du rôle dès que le
    nombre de personnes de la fonction risque dépasse 1 ; si ce n'est
    pas fait, cela reste une action dans le panel. Verbatim :
    « Intérimaire désigné ou suppléant deuxième risk manager désigné à
    la création du rôle dès que le nombre de personnes dans risque
    dépasse 1 ; si c'est pas fait, le garder comme action dans le
    panel. »
  - q138 : acceptation d'un principe non respecté avec motif et durée,
    seconde confirmation dès qu'un tiers (Risk Manager, Audit, Comité)
    existe.
  - q139 : créer TOUTES les données manquantes avant de livrer le panel.
  - q140 : panel visible par administrateur, Risk Manager, Audit et
    Comité ; noms visibles seulement pour qui a accès au journal d'audit.
  - q141 : auto-validation par double confirmation activable par le
    client, proposée seulement si personne d'autre ne peut valider ;
    sinon refus.
  - q142 : statut « Appliqué sans validation indépendante », distinct de
    « Validé ».
  - q143 : « suivi depuis le <date de mise en service> », pas de
    reconstitution.
  - q144 : notification à l'attribution du rôle Audit ou Comité s'il
    existe des actions sans seconde validation, avec lien vers le panel.
  - q145 : l'évaluation choisit sa sous-catégorie dans le référentiel ;
    le seuil est retrouvé par la catégorie (plus par le libellé).
RELATED: DECISION-072, DECISION-073, A10 F-FW-02, F-FW-03.
OWNER: @risk-manager @architect (cadrage), @dev-backend (q145 puis lots
  du panel), @dev-frontend
STATUS: DÉCIDÉ — q145 en développement ; panel : cadrage mis à jour,
  questionnaire à valider en cockpit.

DECISION-075
DATE: 2026-10-18 (cockpit q146 à q153, 15:13–15:15 UTC)
DECISION (PO) :
  - q146 (contre la recommandation) : questionnaire de profil raccourci à
    6 questions. Le choix des 6 et l'ajustement des seuils ne sont pas
    précisés → proposition A13, puis validation PO (q154).
  - q147 : l'administrateur remplit le profil ; modifiable et tracé ;
    seconde confirmation pour une baisse de taille ; en cas d'écart entre
    déclaré et observé, le plus exigeant s'applique.
  - q148 : N = max(questionnaire, comptes Risk Manager) ; pour une
    personne seule, l'intérimaire reste recommandé dans le panel.
  - q149 : départ du dernier Risk Manager sans intérimaire accepté avec
    motif et seconde confirmation ; groupe Risk Manager vide signalé en
    tête du panel ; les actions réservées attendent un nouveau titulaire.
  - q150 : liste D01–D19 confirmée ; propriétaire de processus :
    rapprochement proposé automatiquement à partir du nom, confirmé
    processus par processus.
  - q151 : le panel sort avec les autres données ; les principes liés à
    l'Analyse (DECISION-064) et aux votes nominatifs du Comité
    s'affichent « évaluable à la livraison de <fonction> », jamais
    « respecté ».
  - q152 (contre la recommandation) : déclaration seule — l'administrateur
    indique que deux comptes appartiennent à la même personne ; aucun
    signal d'appareil, aucune donnée nouvelle (pas de passage Privacy
    requis sur ce point).
  - q153 : un acte « appliqué sans validation indépendante » compte dans
    les calculs comme validé, libellé distinct partout.
RELATED: DECISION-073, DECISION-074, A05 R-Q1 à R-Q3, A13 PROFIL-1/2,
  INTERIM-2, DONNEES-2.
OWNER: @risk-manager (6 questions), @architect (plan), @dev-backend
  @dev-db @dev-frontend (lots D1–D7)
STATUS: DÉCIDÉ — lots D1, D2a–D2d, D4 débloqués ; D3 (profil) attend q154.

DECISION-076
DATE: 2026-10-18 (cockpit q154, 15:24 UTC, option recommandée)
DECISION (PO) : questionnaire de profil à 6 questions — effectif (Q1),
  personnes dans le risque (Q2), audit interne (Q5), conseil
  d'administration (Q7), comité des risques ou d'audit (Q8), supervision
  (Q11). Classement : grande entreprise si E ≥ 250, ou E ≥ 100 et 3
  fonctions de contrôle sur 4 ; TPE si E ≤ 20, au plus 1 fonction, non
  supervisée ; PME sinon. E = max(réponse Q1, comptes actifs). Détail :
  docs/governance/principes/principes-gouvernance.md v0.3 (A13).
RELATED: q146, q154, DECISION-075, A13 PROFIL-3.
OWNER: @dev-backend @dev-db (lot D3), @risk-manager
STATUS: DÉCIDÉ — D0 validé ; D3 débloqué (après fusion de D1).

DECISION-077
DATE: 2026-10-18 (cockpit q155 22:19 UTC, option recommandée ; q156
  22:20 UTC, option NON recommandée)
DECISION (PO) : (q155) `last_seen_at` n'est écrit qu'à l'identification,
  libellé « dernière connexion » — l'écriture à chaque requête (D2a) est
  à remplacer. (q156) le panel affiche les dates de dernière connexion à
  côté de « Personne N » même sans accès au journal d'audit ; le risque
  de ré-identification dans une petite équipe relevé par A15 (R2) est
  accepté par le PO.
RELATED: q155, q156, A15 R1/R2, q140, DECISION-074.
OWNER: @dev-backend (q155 : écriture à l'authentification, avant D6),
  @dev-frontend (D7 libellé), @privacy (prendre acte de R2 accepté)
STATUS: DÉCIDÉ — D6 débloqué côté q155/q156 (R3, R5, R6 restent ouverts).

DECISION-078
DATE: 2026-10-18 (cockpit q157 à q161, 22:37–22:40 UTC)
DECISION (PO) :
  - q157 (option recommandée) : `orgprofile.approve` retiré au groupe
    Audit (et de `isAuditGroupPermission`) ; l'Audit ne compte plus
    comme tiers confirmateur d'une baisse de taille ; il est prévenu de
    chaque baisse et peut la contester (notification et contestation : D5).
  - q158 (option recommandée) : tout assouplissement de la politique
    d'auto-validation est confirmé par une seconde personne quand elle
    existe, avant toute recette client ; l'admin reste seul uniquement
    sans tiers (marqueur `adminAlone`).
  - q159 (option recommandée) : les validations du Comité
    (`riskevaluation` validateByCommittee, `treatmentdecision`
    validateByCommittee) sortent de la double confirmation — toujours
    collégiales (DECISION-026).
  - q160 (option NON recommandée) : départ du dernier Risk Manager sans
    intérimaire = trace seule, sans alerte ni délai maximal de vacance.
    Les recommandations A14 CMP-PNL-08/09 sont écartées par le PO.
  - q161 (option recommandée) : la suspension du dernier RM reste
    refusée ; un intérimaire échu n'est pas utilisé.
RELATED: SEC-PNL-02/05, CMP-PNL-03/04/08/09/11, q42, q147, q149,
  DECISION-026, DECISION-055.
OWNER: @dev-backend (q157, q158, q159), @dev-db (071 en place)
STATUS: DÉCIDÉ — implémenté (3ed076c, fusion sur la branche ; q158 = migration 072, D5 glisse en 073, D6 en 074).

DECISION-079
DATE: 2026-10-18 (go verbal du PO dans la session)
DECISION (PO) : (1) option 1 pour CMP-PNL-01 / SEC-PNL-01 résiduel —
  l'action et sa trace d'audit sont écrites dans une même transaction
  (modèle `TransactionalAudit` + `insertAuditEvent` déjà utilisé par 6
  dépôts) pour les 7 validations restant sous double confirmation, la
  politique d'auto-validation (et ses demandes) et les désignations ;
  (2) nouvelle revue QA + Sécurité sur les correctifs et DECISION-077/078,
  dont les 3 points « lot arbitrages PO » ; (3) lots D5 (073), D6 (074,
  reste soumis à Privacy R3/R5/R6), D7 ; (4) PR vers staging quand QA et
  Sécurité sont vertes ; (5) analyse et plan de livraison des vues
  frontend.
RELATED: CMP-PNL-01, SEC-PNL-01, DECISION-077, DECISION-078.
OWNER: @dev-backend @dev-db @qa-engineer @security @ux-designer
STATUS: DÉCIDÉ — en cours.
```
