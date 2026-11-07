# QA — Visibilité des ressources, lot V4bis refait (DECISION-115 : q228 A)

Agent A08 QA, passage du 2026-11-07 (rapport daté du lot). Branche `feat/r1-visibility-v4bis`, tête `c021d84`. Pas un avis Security, Privacy ni Compliance.

**Verdict : VERT (PASS).** Aucun défaut. Le seuil « moins de 5 » ne s'applique plus qu'à `GET /hidden-counts` ; les tableaux de bord et rapports ont retrouvé leurs valeurs exactes.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-visibility-v4bis.test.ts` (nouveau contenu ; `QA_VIS4B_LIVE=1`, vrai serveur + PG16 local, base `grc_qa_vv4bt`, harnais `qaVisibilityHarness.ts`) | 27 PASS ; sans variable : 2 PASS (statique), le reste ignoré |
| Parcours navigateur `qa-visibility-v3-playwright.mjs` rejoué sur cette tête (Chromium, backend 8091 + vite 5199) | tous PASS, 0 erreur JS ou console |
| `cd backend && npm run typecheck && npm test` | OK : 162 fichiers PASS + 21 skipped ; 2781 PASS |

Serveurs et vite arrêtés ensuite.

## 2. Couverture (oracles écrits avant exécution, depuis la décision)

- **Bornes par type** : 0, 1, 2, 3, 4, 5, 6 et 12 éléments cachés des cinq types à la fois => 0 (rien), `{ belowThreshold: true }` de 1 à 4, nombre exact dès 5. Types mélangés (RISK 0, CONTROL 1, KPI 4, ANOMALY 5, ACTION_PLAN 6) jugés indépendamment. Un type sous le seuil ne porte aucun chiffre (corps brut vérifié). 4 et 3 sont indiscernables (pas de fuite par différence).
- **Ce qui compte** : seul le niveau effectif PERIMETRE non lisible par le lecteur ; NOMINATIF et CLIENT jamais comptés ; un élément accordé au lecteur sort de son compte (6 cachés dont 2 accordés => « moins de 5 », 5 cachés dont 1 accordé => 4, etc.) ; la frontière suit la donnée en direct (ouvrir un élément, en ajouter un).
- **Lecteurs** : groupes fixes (Risk Manager, Comité, Audit) => `null` ; titulaire de `resource.readall` => 0 par type (il lit tout le PERIMETRE), jamais `belowThreshold`, NOMINATIF toujours non compté ; seuls les types listables par le lecteur apparaissent.
- **Écran** : le texte « Moins de 5 éléments non visibles (accès restreint). » sous les listes Contrôles, Registre, KPI, et le nombre exact (5) sous Plans d'action et Anomalies ; aucune mention pour le Risk Manager ; test statique des cinq `HiddenCountNotice` et du seuil unique côté serveur.
- **Non-régression des tableaux de bord** : exécutif (4 risques dont 1 restreint, 1 NOMINATIF seul, 4 restreints, 5 dont 1 restreint) `totalActiveRisks` et `openAnomaliesCount` exacts pour le lecteur ordinaire et le Risk Manager ; consolidé par entité (4 et 6) ; appétence vs résiduel (score maximum, dépassements, `riskIds` rendus) ; conformité sur les deux chemins (`totalControls`, deux taux, `overdueControlActions`) ; aucun champ `belowThreshold` dans ces réponses ; DashboardService ne contient plus ni `belowThreshold` ni seuil.

## 3. Constats

Aucun. Les points de la passe précédente (QA-V4B-01 : `topRisks` relisible, QA-V4B-02 : différence total moins entités) ne se posent plus : les cellules de tableau de bord ne sont plus masquées.

## 4. Limites

Compteur figé à l'affichage (déjà noté en V3) ; la valeur « moins de 5 » ne protège pas contre un lecteur qui fait varier lui-même la donnée (un lecteur qui crée un élément restreint voit passer 4 à 5), cas assumé par la décision.
