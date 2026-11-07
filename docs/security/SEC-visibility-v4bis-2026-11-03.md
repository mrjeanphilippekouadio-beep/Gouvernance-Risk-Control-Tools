# Revue Sécurité A10 — lot V4bis : seuil de petites cellules (q224 A, DECISION-112) (2026-11-03)

- Cible : `git diff origin/staging...origin/feat/r1-visibility-v4bis` (staging `513d1cc`, HEAD `d76b798`), 7 fichiers.
- Méthode : analyse statique, `npx vitest run` de `DashboardService`, `QA-visibility-v1` et `visibility-v4` (55 verts, 65 ignorés car il faut une base), `tsc --noEmit` propre. Aucun code modifié, aucune base.

**Escalade HUMAN : aucune** (aucun constat avec CVSS). **Verdict : VERT** : le lot n'ouvre aucune donnée. **Challenge de fond** : la règle ne protège rien en l'état, parce que chaque cellule est calculée sur des éléments que le lecteur peut déjà ouvrir un par un, et que la même réponse rend le compte. Elle ne fait pas de mal (échec fermé), mais elle ne doit pas être présentée comme un contrôle de confidentialité.

## 1. Implémentation : PASS

| Point | Résultat | Détail |
|---|---|---|
| Base des agrégats | **PASS** | Toutes les cellules touchées partent de lectures en `readerScope(actor)`, donc des dépôts filtrés : risques (liste et `getScoredRisks`), anomalies, contrôles, plans, KPI. Les KRI passent par `getScopedRiskIds` ou par `keepReadableByRisk`. Les exécutions et évaluations d'efficacité ne sont lues que pour des contrôles déjà visibles. Aucun agrégat de ce lot ne compte un élément que le lecteur ne voit pas. |
| `anyRestricted` (SQL) | **PASS** | Expressions en liste blanche (aucun texte client). `tenant_id = $1` dans chaque sous-requête. Les niveaux hérités passent par `anomaly_effective_visibility` / `action_plan_effective_visibility` (fonctions 084 tenant-scopées). Un id introuvable donne NULL, qui est `IS DISTINCT FROM 'CLIENT'` : la cellule est supprimée (échec fermé). |
| Niveau effectif | **PASS** | Anomalies et plans : niveau hérité. KRI : jugé sur le niveau de son risque (`k.kri.riskId`). Contrôles et KPI : leur propre niveau. Cohérent avec 084. |
| Groupes fixes | **PASS** | `seesEverything` (083 : groupes fixes seulement) donne les valeurs réelles. Le titulaire de `resource.readall` reçoit le seuil (cohérent : ce n'est pas un groupe fixe). |
| `riskIds` | **PASS** | Une ligne appétit/résiduel supprimée renvoie `riskIds: []`. Les autres lignes ne nomment que des risques lisibles. |
| Paramètres de filtre | **PASS** | `framework`, `entity`, `from`/`to` et le mode de périmètre ne font que restreindre un ensemble déjà filtré par le scope. Aucun ne réintroduit un élément invisible. |

## 2. Inférence et contournement : la suppression est récupérable (INFO, aucune donnée non autorisée)

- **V4B-01 (INFO)** : la même réponse ou une route voisine redonne la valeur supprimée.
  - Exécutif : `totalActiveRisks: null`, mais `topRisks` (top N ≥ 5) liste tous les risques actifs quand il y en a moins de 5.
  - Consolidé : `riskCount: null`, mais `topRisks` (`slice(0, 5)`) contient toute la cellule.
  - Conformité : `totalControls` et les deux taux sont recalculables depuis `GET /controls` et les exécutions, lisibles.
  - Appétit/résiduel : le score max et le dépassement se recalculent depuis la cartographie (un point par risque, avec score).
  - Différences entre deux filtres voisins : elles ne révèlent que des éléments visibles.
- **V4B-02 (INFO)** : `belowThreshold` lui-même dit « moins de 5 dont au moins un restreint ». C'est sans portée si le niveau d'un élément visible est déjà affiché sur sa fiche (badge), ce qui est le cas depuis V1.
- **V4B-03 (INFO, à porter au PO)** : le seul agrégat qui compte des éléments que le lecteur **ne peut pas** ouvrir est `GET /hidden-counts` (V3, « X éléments non visibles », sur tout le client). C'est là qu'un petit effectif est un vrai signal (oracle par différence dans le temps, déjà noté en V3). q224 ne le couvre pas. Si l'objectif de DECISION-112 est la confidentialité, c'est ce compteur qu'il faut seuiller (par exemple « moins de 5 » quand 1 ≤ n < 5), pas les cellules ci-dessus.

## 3. Avis tranché : cartographie et vues-listes hors règle

**Oui, elles peuvent rester hors règle** (top N, risques du propriétaire, KRI, actions, risk-owners, cartographie avec ses cases comptées dans le navigateur). Chaque élément montré est lisible un par un par ce lecteur (dépôts en scope lecteur, journalisés V4-03). Un comptage ou une case de cartographie n'en dit pas plus que la liste qu'on peut ouvrir. Appliquer le seuil à ces vues casserait la fonction sans aucun gain : la liste des risques reste disponible.

Corollaire : pour la même raison, le seuil des cellules q224 n'est pas une frontière de sécurité. Deux options cohérentes, à trancher par HUMAN/Privacy :

- **(a)** le garder comme règle d'affichage (dissémination : captures, exports, réunions), en le documentant comme tel. Il faudrait alors l'étendre aux exports et rapports diffusés (rapport de comité, PDF), pas à l'écran des listes ;
- **(b)** le retirer (ponytail) et seuiller `hidden-counts` (V4B-03), qui est le seul vrai vecteur d'inférence.

Recommandation A10 : **(b)**, ou au minimum ajouter V4B-03 à (a).

## Statut

| Constat | Sévérité | Owner | Statut |
|---|---|---|---|
| V4B-01, V4B-02 | INFO | PO / Privacy | REVIEW_REQUIRED (objectif de la règle à reformuler) |
| V4B-03 | INFO | HUMAN / Privacy, puis A06 | REVIEW_REQUIRED (à porter dans ACTION_ITEMS) |

## Revue 2 A10 (2026-11-07, HEAD `c021d84`, q228 A / DECISION-115)

- Méthode : analyse statique du diff `origin/staging...c021d84` et recherche de tous les chemins qui restituent un nombre d'éléments que le lecteur ne voit pas. Vitest `visibility-v3`, `QA-visibility-v3` et `DashboardService` : 41 verts (42 ignorés car il faut une base). `tsc` propre. Aucun code modifié.
- **Verdict : VERT pour le lot.** Un constat **préexistant** remonte (V4B-04 MEDIUM 4,3, hors diff) : il contourne q228 et doit être traité avant la production. Aucune escalade.

| Point | Résultat | Analyse |
|---|---|---|
| `GET /hidden-counts` | **PASS** | 1 à 4 → `{ belowThreshold: true }` ; 0 et ≥ 5 → nombre exact ; groupes fixes → `null` ; un type n'est servi qu'avec sa permission `*.read`. NOMINATIF n'est jamais compté (inchangé). Calculé côté serveur : le nombre exact ne quitte pas `ResourceVisibilityManager`. |
| Résidus du seuil retiré | **PASS** | Le diff contre staging ne touche plus que `hiddenCounts` et son affichage. `DashboardService`, `anyRestricted` et `belowThreshold` des agrégats ont disparu. Les tableaux de bord sont identiques à staging, et calculés en scope lecteur (Revue 1). |
| Pagination, en-têtes, autres compteurs | **PASS** | Aucun en-tête de total. Il existe deux `total`, mais ils ne portent pas sur les racines restreintes : mesures d'un KRI déjà lisible et annuaire. Aucun dépôt racine ne fait de `count(*)` sur tout le client. `observe` (profil d'organisation) ne compte que des comptes et des groupes. Les listes sont filtrées dans le SQL avant la limite. |
| Inférence dans le temps | **INFO (résidu inhérent, acceptable)** | Un observateur régulier repère les passages de seuil : 0 → « moins de 5 » (première ressource masquée), « moins de 5 » → 5 (exactement 5 à cet instant), 5 → « moins de 5 » (exactement 4). Les variations entre 1 et 4 restent invisibles. Le seuil ne sert qu'à ça ; un arrondi (par exemple par tranches de 5) ne ferait que déplacer les bornes. Acceptable. |
| Liste des ressources restreintes (A1) | **INFO (HUMAN)** | Un administrateur hors groupes fixes reçoit `type`/`id`/niveau de **toutes** les ressources restreintes, y compris NOMINATIF (DECISION-103, q223). Il en déduit le nombre exact de ce qu'il ne voit pas, ce qui contredit q228 pour cette population. C'est voulu par A1 (support) : à acter explicitement par HUMAN, ou appliquer la même règle aux admins (ne servir que le nombre). Le panel D6 (`feat/r1-governance-d6`, D6-02) donne aussi des ids de risques restreints aux admins. |

### V4B-04 — `GET /process-evaluation-mode-requests/:id` renvoie id et propriétaire de TOUS les risques du processus, masqués compris (MEDIUM, CVSS 4,3 `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED par lecture, préexistant)

- `ProcessEvaluationModeRequestService.get` (et la validation) appelle `getRiskOwners`, qui lit `risks.list(..., SYSTEM_SCOPE)` puis renvoie `riskOwners: [{ riskId, ownerId }]` pour chaque risque du processus, PERIMETRE et NOMINATIF compris. Le seul garde est `evaluationmode.validate`.
- Cette permission n'est pas réservée aux groupes fixes (033 : permission dédiée, posable sur un rôle ordinaire). Son porteur obtient le nombre exact, les ids et les propriétaires des risques qu'il ne voit pas. Cela contourne q228, et V1-05 (ids masqués).
- En V1, ce chemin avait été classé « affichage, sans restitution ». Il restitue bien des ids au client.
- **Correctif attendu (A06)** : filtrer `riskOwners` par `hiddenRiskIds` (scope lecteur) avant la réponse ; la ligne d'audit garde la liste complète, réservée à l'Audit. Test : un risque NOMINATIF du processus est absent de la réponse d'un validateur hors liste.

| Constat | Sévérité | Owner | Statut |
|---|---|---|---|
| q228 `hidden-counts` | — | — | PASS |
| V4B-01/02 | — | — | Clos (seuil des agrégats retiré) |
| V4B-03 | — | — | Clos (q228 A) |
| V4B-04 | MEDIUM 4,3 | A06 | REMEDIATION_REQUIRED (avant production), retest A10 |
| A1 et compte exact pour les admins | INFO | HUMAN | REVIEW_REQUIRED |

## Retest A10 — V4B-04 (2026-11-07, `906f9e2`, branche à `3b084c0`)

| Chemin | Résultat | Analyse |
|---|---|---|
| `GET /…/:id` (`get`) | **RETEST_PASS** | `getRiskOwners(..., readerScope(actor))`, donc `risks.list` passe par le filtre SQL `risk_visible_to`. Un risque PERIMETRE ou NOMINATIF hors de portée n'apparaît plus (ni id ni propriétaire). Les groupes fixes gardent tout, via `visibility_sees_everything`. Test unitaire du scope passé : 20/20 verts, `tsc` propre. |
| `validate` | **PASS** | Il lit encore en SYSTEM_SCOPE, mais la liste complète ne va que dans `audit_log.newValue`, que seuls les détenteurs de `audit.read` lisent (groupe AUDIT, V0-03). Le panel D6 n'expose pas `newValue`. La réponse HTTP n'est que le `Process`. |
| `listForProcess`, `reject`, `propose`, `setMode` | **PASS** | Ils renvoient la demande ou le processus : aucun champ de risque. |
| Notifications | **Sans objet** | Le service n'en émet aucune. |
| Autres consommateurs | **PASS** | `ProcessService.assertNoActiveReferences` ne lit que les demandes en attente, et son message ne contient ni id ni nombre. |

- **V4B-04 : RETEST_PASS → CLOSED.** **Verdict final du lot V4bis : VERT.** Reste l'INFO HUMAN (A1 donne aux admins le nombre exact des ressources qu'ils ne voient pas), sans effet sur la livraison.
