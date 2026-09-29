# Analyse d'impact UX/UI — Restructuration plateforme (§15 du brief)

> Réponse au §15 de `UX_Brief_Restructuration_Plateforme_v1.md`. Portée :
> ce qui existe aujourd'hui dans `frontend/src/` (2 modules : Risques+RACI,
> Admin) vs ce que le brief demande (29 modules + navigation par domaine).
> Document de planification, pas une spécification détaillée par écran —
> chaque ligne "Haute priorité" devra passer par le cycle maquette →
> commentaire zone → validation (voir l'artefact de revue) avant code.

## Élément transverse — bloquant avant tout module

| Élément | Action | Impact | Priorité | Dépendances |
|---|---|---|---|---|
| **Sidebar de navigation par domaine** | Créer | Remplace les onglets horizontaux (`Tabs`) — seul point du brief §1 déjà identifié dans `DESIGN_NOTES.md` §4.3 comme non fait. Sans elle, aucun des 29 modules n'a de point d'entrée cohérent avec la référence. | **Haute — bloquant** | Design System (nouveau composant `Sidebar`), `App.tsx` (restructuration du shell) |
| **Panneau latéral générique Comments / RACI / Evidence** | Créer | Actuellement `RaciPanel` est un panneau RACI seul, inline sous le tableau (pas un rail latéral rétractable multi-onglets comme spécifié dans le CDC v0.1, voir `SHARED_LOG.md` entrée `@ux-designer` du 2026-09-28 sur ce point). À généraliser avant que Comments/Evidence n'arrivent, sinon 3 panneaux différents seront construits un par un (même anti-pattern que `DESIGN_NOTES.md` §2 déjà documenté). | **Haute — bloquant pour Contrôles, Risk 360, Audit** | `RaciPanel` (à refondre en panneau à onglets), backend Comments/Evidence (n'existent pas encore) |
| **Composant `Card`** | Créer | Existe en CSS ad hoc sur `Table`/`RaciPanel` (ombre/rayon dupliqués) mais pas en composant réutilisable — chaque nouvelle fiche (Contrôle, Risque, Audit) le redemandera. | Haute | Design System |
| **Composant `Modal`** | Créer | Aucune modale dans le produit actuel (tout est inline). Le brief en demande explicitement (§3). | Haute | Design System, gestion focus-trap/accessibilité |
| **Composant `Filtres`** (barre de segments + selects) | Créer | Existe partiellement (`select` de filtre `FeedbackAdmin`) mais pas le style "segmented control" de la référence (`.filters .seg`). | Moyenne | Design System |
| **Dashboards par rôle** | Créer | Aucun dashboard n'existe. Dépend de `user`/permissions déjà en place côté backend (RBAC livré), mais aucun écran de synthèse. | Haute (bloquant §7, §17-18) | Backend : agrégation de données par rôle (n'existe pas) |
| **IAM / gestion des accès** | Créer | `RolesAdmin` couvre rôles/permissions/assign-revoke ; manquent groupes, périmètres, séparation des tâches visible, workflows de demande/validation. | Haute | RBAC backend (existe), nouvelles entités Groupe/Périmètre (n'existent pas) |
| **États vides / erreur / chargement uniformes** | Modifier | `RisksPage`/`RaciPanel` gèrent loading+erreur ; aucun état vide dédié sur `RisksPage` (`DESIGN_NOTES.md` §3, déjà noté, jamais corrigé). À industrialiser avant les 29 modules pour ne pas le refaire 29 fois. | Moyenne | `Table` (composant) |
| **Responsive** | Modifier | La sidebar (nouvelle) doit être pensée mobile dès sa création (le brief l'exige en §3) — coût très supérieur si ajouté après coup sur 29 modules. | Haute (au moment de créer la sidebar) | Sidebar |

## Gouvernance et gestion des risques

| Page / Module | Action | Impact | Priorité | Dépendances |
|---|---|---|---|---|
| Cartographie des risques | Créer | Écran de référence lui-même (heatmap 5×5, zones, tooltip) — n'existe pas en code, seulement en maquette. | Haute | Backend : agrégation P×I par risque (partiel — `RiskEvaluation` existe) |
| Évaluation des risques (`RiskEvaluation`) | Créer | Écran de référence — cotation, dérivation du score, historique. Backend `RiskEvaluationService` déjà livré (batch 2), aucun écran frontend. | Haute | Aucune (backend prêt) |
| Appétence au risque | Créer | Aucun écran, backend `RiskAppetite` existe (batch 2). | Moyenne | Aucune (backend prêt) |
| Grilles de cotation | Créer | Aucun écran, backend `RatingScale` existe (batch 2). | Moyenne | Aucune (backend prêt) |
| Registre des risques | Modifier `RisksPage` → étendre | `RisksPage` actuel est un registre minimal (processus/description/statut/RACI). Le brief demande ~15 colonnes (causes, conséquences, KRI liés, mécanismes de réponse…). Extension du même écran, pas une nouvelle page. | Haute | Champs `Risk` manquants (causes/conséquences/mécanismes de réponse — à ajouter en backend) |
| Fiches de risque | Créer | Aucune vue détail par risque n'existe (RisksPage est une liste plate). Prérequis de Risk 360. | Haute | Registre des risques |
| Dispositif de risque (classique + participatif) | Créer | Aucun des deux modes n'existe. Le mode participatif implique des droits différenciés — dépend d'IAM. | Basse (dépend d'IAM) | IAM, workflows |
| Risk 360 | Créer | Vue d'agrégation transverse — ne peut être construite qu'une fois Contrôles/KRI/Incidents/Plans d'action/Audit existent côté données. | Basse (dernier maillon) | Tous les modules listés dans son parcours (§9) |

## Contrôle interne

| Page / Module | Action | Impact | Priorité | Dépendances |
|---|---|---|---|---|
| Contrôles (liste) | Créer | Backend `Control`/`ControlExecution` existent (batch), aucun écran. | Haute | Aucune (backend prêt) |
| Fiche de procédure individualisée (§4, ~22 champs structurés) | Créer | Le plus gros écart backend actuel : `Control` n'a pas tous les champs structurés demandés (échantillonnage, critères de conformité, seuil/tolérance…). C'est un chantier backend avant d'être un chantier UI. | Haute | **Backend : migration `Control` + nouveaux champs structurés (pas de champ libre)** |
| Exécution des contrôles | Modifier/Créer | `ControlExecution` existe côté backend, écran à créer. | Haute | Aucune |
| Statistiques des contrôles | Créer | Aucun écran, nécessite agrégation (taux de conformité, tendance) — probablement calculé à la lecture (pattern déjà validé pour `ActionPlan`, voir `SHARED_LOG.md`). | Moyenne | Fiche de contrôle (champs structurés) |
| Plan de contrôle | Créer | Aucun écran ni entité dédiée identifiée dans le backend actuel — à vérifier avec `@architect`. | Moyenne | À clarifier (entité manquante ?) |
| Lignes de défense (L1/L2/L3) | Créer | Existe comme *champ* sur `Control` (probable) mais pas de vue dédiée transverse. | Basse | Fiche de contrôle |

## Indicateurs

| Page / Module | Action | Impact | Priorité | Dépendances |
|---|---|---|---|---|
| KRI | Créer | Backend `Kri`/`KriMeasure` existe (batch, SEC-009 déjà corrigé dessus). Aucun écran. | Haute | Aucune |
| KPI | Créer | Backend `Kpi`/`KpiMeasure` existe. Aucun écran. Le brief insiste : ne jamais fusionner KRI/KPI dans un seul écran générique. | Haute | Aucune |
| Dashboards | Créer | Voir ligne transverse ci-dessus. | Haute | Agrégation backend par rôle |
| Dashboards personnalisés par rôle | Créer | Dépend du dashboard générique d'abord. | Moyenne | Dashboards, IAM |

## Plans et suivi

| Page / Module | Action | Impact | Priorité | Dépendances |
|---|---|---|---|---|
| Plans d'action | Créer | Backend `ActionPlan` déjà livré et testé (batch 2-3). Aucun écran. | Haute | Aucune |
| Cycle de revue | Créer | Backend `Governance`/cycles existe partiellement (batch 4, "Governance ✅" selon `ACTION_ITEMS.md`). Écran à créer. | Moyenne | Vérifier périmètre réel du module `Governance` livré |
| Suivi des actions et échéances | Modifier | Peut être une vue filtrée du module Plans d'action plutôt qu'un écran séparé — à trancher avec `@product-manager` avant de dupliquer. | Basse | Plans d'action |

## Audit

| Page / Module | Action | Impact | Priorité | Dépendances |
|---|---|---|---|---|
| Audit (missions) | Créer | **N'existe pas côté backend.** Déjà signalé comme contradiction dans le CDC v0.1 (chaîne Finding→ActionPlan vs Constats→Recommandations→Plans d'action, `ACTION_ITEMS.md` entrée `@audit`). | Haute (bloqué en amont) | **Backend : entité `Audit`/`Finding`/`Recommendation` à concevoir — ADR requis avant code (déjà recommandé par `@documentation`)** |
| Constats / recommandations | Créer | Idem — dépend de la même décision de modélisation. | Haute (bloqué en amont) | Audit (missions) |
| Suivi des recommandations | Créer | Idem. | Moyenne | Constats/recommandations |

## Administration / Configuration

| Page / Module | Action | Impact | Priorité | Dépendances |
|---|---|---|---|---|
| Paramètres (référentiels) | Créer | Aucun écran de configuration générique. Le brief demande de limiter les valeurs codées en dur (catégories, processus, fréquences…) — actuellement plusieurs enums sont en dur côté backend (`FeedbackStatus`, statuts de risque). Chantier backend + UI conjoint. | Haute | **Backend : passage de plusieurs enums codés en dur à des référentiels configurables (rupture potentielle si mal géré — migration de données)** |
| Gestion IAM | Créer | `RolesAdmin` couvre une partie (rôles/permissions). Manquent : groupes, périmètres, séparation des tâches visible, workflows de demande/validation d'accès. | Haute | RBAC (existe), nouvelles entités |
| Gestion des rôles et permissions | Modifier `RolesAdmin` | Déjà fait pour l'essentiel — à réintégrer dans la nouvelle IAM plutôt que dupliqué. | Basse (déjà là) | IAM |
| Gestion des utilisateurs | Créer | `UserService`/`UserManagement` existent côté backend (batch, cf. SEC-010 dessus). Aucun écran dédié (RolesAdmin ne fait qu'assigner par id brut). | Haute | Aucune (backend prêt) |
| Paramétrage des référentiels | Créer | Recouvre "Paramètres" ci-dessus — un seul écran, pas deux. | (fusionné avec Paramètres) | — |

## Ce que ce tableau ne tranche pas (à faire trancher explicitement, pas en silence)

- **Plan de contrôle** : entité manquante à confirmer avec `@architect`.
- **Suivi des actions/échéances** vs **Plans d'action** : écran séparé ou vue filtrée ? à trancher avec `@product-manager` avant duplication.
- **Audit** : aucun code n'existe, la modélisation même du domaine (Finding→ActionPlan vs Constats→Recommandations) est une contradiction non résolue du CDC v0.1 — un écran ne peut pas être conçu avant cette décision.
- **Paramètres/référentiels** : migrer un enum codé en dur vers une table configurable touche les données existantes (risques déjà créés avec un statut en dur) — nécessite un plan de migration, pas juste un écran.
