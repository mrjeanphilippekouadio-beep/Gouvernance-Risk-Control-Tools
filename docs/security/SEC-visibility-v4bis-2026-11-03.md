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
