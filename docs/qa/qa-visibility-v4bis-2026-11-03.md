# QA — Visibilité des ressources, lot V4bis (DECISION-112 : q224 A, « moins de 5 » dans les agrégats)

Agent A08 QA, 2026-11-03. Branche `feat/r1-visibility-v4bis`, tête `d76b798` (base staging `513d1cc`). Pas un avis Security, Privacy ni Compliance.

**Verdict : VERT AVEC RÉSERVES (PASS_WITH_RESERVES).** La règle est conforme à la décision sur les quatre familles d'agrégats et à la borne (4 masqué, 5 et 6 affichés). Aucun BLOCKER ni MAJOR. 2 fuites par différence confirmées (MINOR, `it.fails`) et un point à trancher sur le titulaire de `resource.readall`.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-visibility-v4bis.test.ts` (`QA_VIS4B_LIVE=1`, vrai serveur + PG16 local 127.0.0.1:55442, base `grc_qa_vv4bt`, harnais `qaVisibilityHarness.ts`) | 28 tests : 26 PASS + 2 `it.fails` ; sans variable : tout ignoré |
| `cd backend && npm run typecheck && npm test` | OK : 161 fichiers PASS + 22 skipped ; 2782 PASS, 681 skipped |
| Mutation : seuil 5 changé en 4 dans `resourceVisibility.ts` | 12 tests rouges, source restaurée |

Jeu : l'univers est vidé puis reconstruit à chaque scénario (risques / contrôles supprimés en douceur, anomalies fermées), N éléments aux niveaux voulus ; lecteur ordinaire `named` (droit de lecture par accès nominatifs), groupes fixes `rm`/`com`/`aud`, titulaire `resource.readall` `out` (administrateur par rôle + attribution APPROVED), `out2` sans accès.

## 2. Couverture (oracles écrits avant exécution)

- **Tableau de bord exécutif** : 4 éléments dont 1 PERIMETRE, 1 NOMINATIF, tous restreints, 1 seul restreint => `totalActiveRisks` et `openAnomaliesCount` null + noms dans `belowThreshold` ; 4 tous CLIENT => valeurs ; 5 dont 1 restreint (limite exacte) et 6 dont 2 => valeurs ; 3 CLIENT + 2 restreints = 5 => valeurs ; 0 => 0 ; cellules jugées séparément (risques 6 mais anomalies sur 3 dont la restreinte => seul le compteur d'anomalies masqué, et inversement) ; une anomalie suit le niveau de son risque ; élément restreint illisible pour le lecteur (`out2`) hors de sa cellule ; levée immédiate quand le risque passe CLIENT ; groupes fixes toujours les vraies valeurs, sans `belowThreshold`.
- **Rapport consolidé** : entité A 4 risques (1 restreint) masquée, entité B 6 affichée ; limite 4/5 ; `criticalKriCount` : 2 KRI critiques sur des risques dont un restreint => masqué alors que `riskCount` (8) est affiché, 2 sur des risques CLIENT => affiché, 5 dont un restreint => affiché.
- **Appétence vs résiduel** : groupe de 4 avec un restreint => `maxResidualScore`, `exceedanceCount`, `exceeded` null, `riskIds` vide, les quatre noms dans `belowThreshold` ; groupe de 5 affiché avec ses ids ; un groupe de 4 CLIENT n'est pas masqué ; le score et l'id du risque restreint n'apparaissent nulle part dans la réponse. Seuil d'appétit absent du jeu (`threshold` null) : le calcul de dépassement masqué n'est donc vérifié que par sa valeur null.
- **Conformité** (`/dashboard/compliance` et `/reports/compliance`) : 4 contrôles dont un restreint => `totalControls` et les deux taux null et nommés (le RM reçoit 4, 1, 1) ; 5 => valeurs ; 4 CLIENT => valeurs ; `overdueControlActions` jugé séparément (6 contrôles mais 2 plans en retard dont celui du contrôle restreint => seul ce champ masqué ; 2 plans sur des contrôles CLIENT => affiché) ; 5 plans dont un sur un contrôle NOMINATIF => affiché.

## 3. Constats

| ID | Sévérité QA | Constat | Repro | Statut |
|---|---|---|---|---|
| QA-V4B-01 | MINOR | Une cellule masquée se retrouve dans la même réponse : `topRisks` (jusqu'à `topN` risques lisibles) donne exactement `totalActiveRisks` quand ce total est inférieur à 5 ; de même `criticalKris` pour un compte de KRI critiques et `riskIds`/listes voisines. Les listes sont hors périmètre de q224, mais la valeur « non envoyée » l'est quand même | 3 risques CLIENT + 1 PERIMETRE lus par `named` ; `GET /dashboard/executive` : `totalActiveRisks` null, `topRisks.length` = 4 | `it.fails` |
| QA-V4B-02 | MINOR | Fuite par différence entre deux cases : le total exécutif (≥ 5, affiché) moins la somme des `riskCount` affichés des autres entités donne le `riskCount` masqué d'une entité (pas de suppression complémentaire) | 10 risques, entité A = 4 (dont 1 PERIMETRE) masquée, entité B = 6 affichée ; total 10 − 6 = 4 | `it.fails` |

Ces deux constats relèvent du choix de la décision (q224 A masque la cellule, pas ses voisines) : à transmettre à Privacy/Security pour dire si c'est un écart assumé ; QA ne tranche pas.

### Points à trancher (QA_CHALLENGE)

1. **Titulaire de `resource.readall`** : pour q224 il est « hors groupes fixes », donc traité comme un lecteur ordinaire (le test l'observe : il lit les PERIMETRE, sa cellule de 4 dont un restreint est masquée, et les NOMINATIF ne comptent pas puisqu'il ne les lit pas). Si le produit voulait qu'il reçoive les vraies valeurs, `belowThreshold` devrait consulter `visibility_reads_all` et non `visibility_sees_everything`. La décision écrite le range avec les lecteurs ordinaires ; je n'ai pas qualifié cela en défaut.
2. **Cartographie et vues-listes** : non couvertes volontairement ; elles exposent les mêmes éléments (source de QA-V4B-01).
3. **Appétence** : seuils non posés dans le jeu (aucun Dispositif actif) ; `threshold` reste affiché pour une ligne masquée, sans lien avec les risques.
4. **Rapports de cadre** (`/reports/risk-committee`, `/reports/kri-consolidated`, tableau de bord propriétaire / département) n'ont pas de cellule de comptage de la décision : non testés.

## 4. Non-régression

`npm test` complet vert ; suites live V1 à V4 non rejouées (aucun fichier de production QA ni de harnais modifié). Reste à rejouer après correctif : `QA_VIS4B_LIVE=1 npx vitest run test/QA-visibility-v4bis.test.ts --no-file-parallelism` et repasser en `it` les 2 `it.fails`.
