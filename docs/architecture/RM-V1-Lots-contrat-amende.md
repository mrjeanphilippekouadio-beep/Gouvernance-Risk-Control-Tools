# RM V1 — Plan de lots re-cadré sur le contrat amendé du 2026-10-08

**Statut** : PROPOSITION de l'Architecte (A05), aucun code ni migration produits.
Base : `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` amendé (DECISION-014/015),
DECISION-006/011/012/013, `RM-V1-Contribution-Hybride-E10-cadrage.md` (lots
B-0 à B-4, F-1 à F-7), `RM-V1-Modes-cotation-objections.md` §6.4 (B-5).
Questions encore ouvertes : Q9 (qui propose la Treatment Decision), Q10
(« équipe risque »), Q11 (probabilités corrélées aux impacts).

**Migrations** : la dernière est `046_treatment_decisions.sql` (deux fichiers
en 044), donc **047** est le prochain numéro libre aujourd'hui. Les numéros
ci-dessous suivent l'ordre recommandé et sont **indicatifs** : chaque lot
revérifie le répertoire juste avant d'écrire (ordre de merge).

## 1. Constats nouveaux (code vs contrat amendé)

- **F-8 (invariant 9)** : les seuils Comité sont relus dans `Config` **au
  moment de la validation** (`RiskEvaluationService.ts:436`, `:518`,
  `:586-595`), sans être figés sur l'évaluation. Un changement de seuil modifie
  donc le circuit des évaluations en cours.
- **F-9 (invariant 8)** : la surcharge d'appétence est libre et « jamais
  bloquée » (`RiskEvaluation.ts:119-122`). L'évaluateur peut relever le seuil
  appliqué et faire disparaître un dépassement.
- **F-10 (invariant 5)** : `process.evaluationmode.set` (`permissions.ts:46`)
  change le mode d'un Processus sans approbation d'un tiers. Seul le chemin
  `propose` + `validate` (`ProcessEvaluationModeRequestService.ts:32`) est
  conforme.
- **F-11 (§4, désignation par la direction du département)** : `Process` n'a
  aucun lien vers un département (`Process.ts:15-37`) et `Process.owner` est du
  texte libre (`Process.ts:24`). Le système ne sait donc pas qui est « la
  direction du département » d'un Processus.
- **F-12** : le modèle d'évaluation n'a qu'un seul auteur, `evaluatorId`
  (`RiskEvaluation.ts:74`). Les trois saisies sont réservées à cet auteur
  (`RiskEvaluationService.ts:86-90`), et le validateur n'est comparé qu'à lui
  (`:432`, `:472`, `:524`). Ce modèle est incompatible avec une saisie
  partagée entre la 1re ligne et l'équipe risque (§5, §7).
- **Rappels** : F-1 reste actif (`RiskService.ts:165-174`, `risk.update`, pas
  d'interdiction de l'auto-désignation). La proposition de traitement reste
  réservée à l'évaluateur (`TreatmentDecisionService.ts:53`). L'invariant 4
  est déjà appliqué par la contrainte CHECK à deux valeurs de la migration 034.

## 2. Lots

| Lot | Statut | Taille | Dépend de | Migration |
|---|---|---|---|---|
| B-0 Verrou F-1 | reformulé | S | — | aucune |
| B-6 Dispositif `RiskFramework` | **nouveau** | L | — | 047 (indicatif) |
| B-5 Attribution RO / DEL / EXEC | reformulé (ex-§6.4) | L | B-6 pour les règles de cumul | 048 (indicatif) |
| B-1 Saisie selon le mode effectif | reformulé (ex-E-10) | L | B-5, B-6, **Q10** | 049 (indicatif) |
| B-2 Hybride (mode par risque) | reformulé | M | B-6, B-5 | 050 (indicatif) |
| B-3 Contributions | reformulé | M | B-5, B-1 | 051 (indicatif) |
| B-7 Treatment Decision réalignée | **nouveau** | S | B-5, **Q9** | aucune |
| B-4 Signalement | inchangé sur le fond, découplé de B-3 | M | Privacy, juristes | 052 (indicatif) |
| F-1 Frontend : contexte et refus | reformulé | M | B-5, B-6, Penpot | — |
| F-2 Frontend : panneau Contributions | inchangé | M | B-3, Penpot | — |
| Champs Analyse (OD-10) | inchangé, hors lot | — | — | — |

**B-0 — Verrou immédiat sur `assignOwner` (S).** Ce lot est transitoire : B-5
remplacera ensuite la désignation directe.
- Faire passer `RiskService.assignOwner` de `risk.update` à la nouvelle
  permission **`risk.owner.assign`**, et appliquer la même règle à
  `assignSuperiorOwner`.
- Refuser `ownerId === actor.userId` (invariant 5 : jamais d'auto-attribution).
- Supprimer la clause de DECISION-013 « owner détenteur de
  `riskevaluation.create` » : elle est caduque puisque le RO ne cote pas (§5).
- Revoir les droits sur staging et en production : le profil Contributeur
  détient `risk.update`.

**B-6 — Dispositif persistant et versionné (L, nouveau).** Ce lot porte les
paramètres du §10.
- Deux tables :
  - `risk_frameworks` : l'identité stable du Dispositif, avec `tenant_id` et
    `name`.
  - `risk_framework_versions` : `framework_id`, `version_number`, `status`
    (`DRAFT|ACTIVE|ARCHIVED`), un paramètre par colonne typée avec CHECK,
    `change_reason`, `requested_by`, `approved_by`, `approved_at`. Un index
    unique partiel garantit au plus une version ACTIVE par Dispositif. Une
    version ACTIVE ou ARCHIVED est immuable : garde dans le service et trigger
    comme pour R-01.
- `processes.risk_framework_id` : FK nullable vers l'identité (et non vers une
  version), posée au niveau PROCESS et héritée par les sous-processus et
  activités. Le Processus n'a ainsi qu'un seul Dispositif, et donc une seule
  version active.
- Les paramètres sont des colonnes simples, sans jsonb générique : mode par
  défaut, politique Hybride, auteur de la Maîtrise qui fait foi, plafond du
  cumul RO + EXEC, seuil « faible », cumul DEL + EXEC, durée maximale d'une
  délégation, validateur. **Les invariants ne sont jamais des colonnes** : on
  ne peut pas paramétrer ce qui n'existe pas (invariant 8).
- Gouvernance :
  - `riskframework.create` / `update` créent un DRAFT motivé.
  - `riskframework.activate` exige un approbateur différent du demandeur.
  - Pour les paramètres de séparation des tâches, la nouvelle permission
    **`riskframework.activate.committee`** (absente de la liste du §10) est
    obligatoire.
  - L'activation archive la version précédente dans la même transaction et
    l'audit conserve l'ancienne et la nouvelle valeur.
  - Permissions : les 6 du §10, plus `.activate.committee`.
- Instantané : `risk_evaluations.risk_framework_version_id` (FK, version
  immuable donc suffisante) et `committee_evaluation_min_score` copié à la
  création, ce qui corrige F-8.

**B-5 — Attribution RO / DEL / EXEC (L).**
- Colonnes :
  - `processes.owner_user_id` et `processes.delegate_user_id` ;
  - `risks.delegate_id`, en paire avec `risks.owner_id` existant
    (`Risk.ts:31`) ;
  - `controls.executor_user_id`, à côté du texte libre `Control.executor`
    (`Control.ts:31`), sans reprise automatique.
- Contraintes DB :
  - `owner <> delegate` ;
  - `delegate IS NULL OR owner IS NOT NULL` ;
  - surcharge par paire sur le risque : les deux colonnes sont écrites
    ensemble, par une seule méthode.
- Table append-only `role_designation_requests`, sur le modèle de la
  migration 033 :
  - champs : cible (PROCESS, RISK ou CONTROL), valeur proposée, valeur
    précédente, motif, `requested_by`, `approved_by` ;
  - contrainte CHECK `approved_by <> requested_by` ;
  - refus si l'acteur se désigne lui-même.
- Permissions : `roledesignation.propose` (direction du département),
  `roledesignation.approve` (équipe risque). `risk.owner.assign` (B-0) est
  retiré de la désignation directe au profit de ce circuit.
- Résolution de la paire effective (surcharge du risque, sinon le Processus
  en remontant la chaîne) dans une seule fonction pure, ce qui traite aussi
  F-6.
- Cumuls :
  - un indicateur calculé à la lecture (invariant 6) ;
  - le cumul RO + EXEC au-delà du seuil « faible » du Dispositif exige une
    exception approuvée, revue à chaque cycle. Les cycles ne sont pas encore
    définis : la revue se fait à chaque nouvelle évaluation.

**B-1 — Saisie selon le mode effectif (L).** Ce lot remplace E-10 et dépend
de Q10.
- Remplacer `assertIsEvaluator` par une garde par étape :
  - **Classique** : l'équipe risque saisit l'Inhérent, la Maîtrise et le
    Résiduel.
  - **Participatif** : l'Inhérent est saisi par l'EXEC relié d'un contrôle
    couvrant le risque ; le Résiduel reste à l'équipe risque.
- Colonnes d'auteur par saisie :
  - `inherent_recorded_by`, `residual_recorded_by` ;
  - `mastery_l1_lines`, `mastery_l1_recorded_by` et `mastery_gap_comment`,
    obligatoire en cas d'écart, sans moyenne ; la saisie qui fait foi est
    choisie par le paramètre figé dans l'instantané.
- Revue de l'Inhérent :
  - colonnes `inherent_review_status` (`PENDING|RETAINED|RETURNED`),
    `inherent_reviewed_by`, `inherent_review_comment` ;
  - réviseur différent de l'auteur, annotation obligatoire en cas de retour ;
  - pas de Résiduel tant que l'Inhérent n'est pas RETAINED ;
  - permission dédiée **`riskevaluation.inherent.review`**.
- Les annotations de l'équipe risque vont dans une petite table append-only
  `risk_evaluation_annotations`, distincte de la revue.
- Le validateur doit être hors de tous les auteurs : comparaison avec chaque
  colonne d'auteur ci-dessus, avec `evaluator_id`, et avec les EXEC des
  contrôles couvrants.
- Instantané des désignations RO / DEL / EXEC dans
  `designations_snapshot jsonb`.
- Fixtures existantes à adapter : à signaler à QA (ex-F-3).

**B-2 — Hybride (M).** L'ancienne migration 047 (HYBRIDE ajouté dans quatre
contraintes CHECK) est **caduque** : Hybride est une politique du Dispositif,
jamais un mode effectif (invariant 4).
- `risks.evaluation_mode`, nullable, consulté seulement si la politique
  Hybride de la version active l'autorise.
- Les demandes réutilisent la table 033, avec un `risk_id` nullable ajouté. Le
  refus actuel hors niveau PROCESS (`ProcessEvaluationModeRequestService.ts:58`)
  est levé pour une cible de type risque.
- Permission `risk.evaluationmode.propose` ; l'approbation reste sous
  `evaluationmode.validate`.
- L'effet au cycle suivant est déjà acquis par l'instantané à la création
  (`RiskEvaluationService.ts:185`).

**B-3 — Contributions (M).**
- Le schéma C.1 du passage précédent est conservé, avec les changements
  suivants :
  - pas de valeurs indicatives : OD-2 est tranché par §7, « ne cote jamais » ;
  - OD-1 et OD-3 sont caducs ;
  - pas de type SIGNALEMENT.
- Les contributions ne sont ouvertes qu'en mode effectif Participatif.
- Le contributeur est désigné par le RO, ou par le DEL qui agit pour lui,
  parmi {RO, DEL, EXEC des contrôles couvrants}.
- Permissions : `riskcontribution.read`, `create`, `review`.

**B-7 — Treatment Decision (S).** La garde « proposant = évaluateur »
(`TreatmentDecisionService.ts:53`) devient fausse dès B-1, puisque
l'évaluateur appartient désormais à l'équipe risque. La remplacer selon Q9 ;
la décision appartient au RO effectif ou au DEL qui agit pour lui. Pas de
migration.

**B-4 — Signalement (M).**
- Table propre, sans dépendance au mode ni au Dispositif (§10), donc
  **découplée de B-3**.
- Choix offert au signalant : confidentiel ou nominatif (DECISION-012).
- L'identité est stockée à part et lisible seulement avec `riskreport.identity.read`.
- Autres permissions : `riskreport.create`, `riskreport.read`.

**F-1 (M).** Le libellé HYBRIDE est caduc. Le lot couvre :
- le Dispositif et la version appliquée, affichés en lecture seule ;
- le mode effectif et la provenance de chaque saisie ;
- les badges de cumul ;
- la fenêtre de refus de DECISION-011.

## 3. Ordre recommandé et chemin critique

**Chemin critique** : B-6 → B-5 → B-1 (bloqué par Q10) → B-3 → F-2.

1. **Peut partir tout de suite**, sans Q9, Q10 ni Q11 :
   - **B-0** (correctif de sécurité déjà exposé en production) ;
   - **B-6**, avec la correction de F-8 ;
   - **B-5**, qui peut commencer en parallèle de B-6 pour les colonnes, les
     contraintes et le circuit de désignation ; la règle du plafond de cumul
     se branche quand B-6 est mergé.
2. Ensuite : B-2, puis B-1 dès que Q10 est tranchée, puis B-3.
3. B-7 dès que Q9 est tranchée. B-4 dès l'avis Privacy et la validation des
   juristes.
4. Q11 ne bloque aucun lot : les échelles sont déjà paramétrables hors du
   Dispositif.

Tant que B-1 n'est pas livré, les évaluations restent sur la règle actuelle
(un seul évaluateur). Il ne faut pas activer la politique Hybride en
production entre B-2 et B-1.

## 4. Invariants du §10 : où ils sont appliqués

| # | Service | Contrainte DB | Lot |
|---|---|---|---|
| 1 Validateur hors des auteurs | `validate`, `reject`, `validateByCommittee` comparent avec tous les auteurs et les EXEC couvrants | CHECK `validated_by IS DISTINCT FROM` chaque colonne d'auteur ; les EXEC relèvent du service seul | B-1 |
| 2 RO ≠ DEL, pas de DEL sans RO | désignation et résolution | CHECK sur `processes` et `risks` | B-5 |
| 3 Résiduel saisi par l'équipe risque | garde par étape | CHECK sur le type de contribution, sans valeur RESIDUEL | B-1, B-3 |
| 4 Mode effectif jamais Hybride | résolution | CHECK à deux valeurs (034), **à conserver** | déjà livré ; B-2 ne l'élargit pas |
| 5 Tracé, approuvé par un tiers | demande puis approbation, refus de l'auto-désignation | CHECK `approved_by <> requested_by` | B-0, B-5, B-6, B-2 ; F-10 à corriger |
| 6 Cumul marqué | indicateur calculé à la lecture | — | B-5, F-1 |
| 7 Attribution forcée côté serveur, audit append-only, historique non réécrit | `actor.userId` | trigger 038 existant ; trigger d'immuabilité des versions | tous ; B-6 |
| 8 Un paramètre n'abaisse jamais un invariant | les invariants ne sont pas des colonnes ; bornes validées | CHECK sur les colonnes de paramètres | B-6 ; F-9 à arbitrer |
| 9 Seuls les cycles à venir sont touchés | instantané à la création | FK vers la version immuable et seuils copiés | B-6 (F-8), B-1 |

## 5. Ambiguïtés et contradictions — recommandations

1. **DECISION-006 et le mode par défaut du Dispositif** : deux sources pour
   le mode par défaut (`Config.evaluationMode`, `Config.ts:62` ; colonne de
   la migration 030, `:24-25`). Recommandation : résoudre dans l'ordre
   surcharge du risque (si Hybride), chaîne de Processus, version active du
   Dispositif, puis `Config` seulement pour un Processus sans Dispositif.
   Rendre `Config.evaluationMode` obsolète, sans le supprimer.
2. **DECISION-006, amendement 3** (validation par le propriétaire du risque)
   contredit le §10 (approbation par le responsable de la fonction risque) et
   le §5 (le RO ne cote pas). Recommandation : réserver `evaluationmode.validate`
   à la fonction risque et retirer le chemin direct
   `process.evaluationmode.set` (F-10).
3. **DECISION-013, à reformuler au niveau Processus** : la clause
   « auto-désignation avec confirmation par un autre membre » contredit
   l'invariant 5 (« jamais auto-attribués »). Recommandation : interdiction
   stricte, et le groupe désignateur devient le circuit propose / approve de
   B-5.
4. **« Direction du département »** (F-11) : aucun lien entre Processus et
   département. Recommandation : en V1, `roledesignation.propose` suffit à
   identifier la direction ; un lien `processes.department_id` ne sera ajouté
   que si le PO veut une vérification structurelle.
5. **Absence du RO** : le système ne peut pas détecter une absence.
   Recommandation : un seul mécanisme, la délégation datée, bornée par la
   durée du Dispositif ; une absence se déclare comme une délégation.
6. **Approbateur de l'exception de cumul** au-delà du seuil « faible » : non
   précisé. Recommandation : Comité, puisque c'est un paramètre de
   séparation des tâches.
7. **Réaffectation d'un Processus à un autre Dispositif** : elle équivaut à
   un changement de paramètres. Recommandation : même circuit
   d'approbation, avec effet au cycle suivant.
8. **F-9, surcharge d'appétence** : à arbitrer par le Risk Manager.
   Recommandation : surcharge seulement à la hausse de la sévérité (jamais au-dessus du
   seuil suggéré), ou motif obligatoire visible du validateur.

## 6. Validations avant code

- **Security** :
  - B-0 ;
  - B-5 (auto-désignation, paires, cumuls) ;
  - B-6 (circuit d'activation, immuabilité) ;
  - B-1 (validateur hors des auteurs, gardes par étape) ;
  - B-2 ;
  - B-7.
  Puis un retest après chaque merge.
- **Privacy** :
  - B-4 (identité confidentielle, exigences de `memory/privacy.md`) ;
  - F-1 (la fenêtre de DECISION-011 expose les détenteurs de permissions).
- **Compliance** (lignes de la GRC Trigger Matrix) :
  - B-5 (COMPLIANCE_BLOCK annoncé si un cumul n'est ni marqué ni validé) ;
  - B-6 (gouvernance des paramètres) ;
  - B-1 (séparation des tâches) ;
  - B-4 (avis des juristes, exigences BCEAO).
- **Risk Manager** : valeurs par défaut des colonnes B-6 et points 5 à 8
  ci-dessus. **PO** : points 1 à 4 et 6, plus Q9 et Q10 avant B-7 et B-1.
