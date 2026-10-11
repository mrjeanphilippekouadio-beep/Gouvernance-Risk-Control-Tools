# Mémoire — @qa-engineer (A08)

Mémoire persistante du rôle QA sur GRC Tools. À lire en premier par tout agent A08 dispatché, avant `SHARED_LOG.md` (`grep @qa-engineer`). Obligatoire : la mettre à jour en fin de tâche. Les arbitrages du PO (N0) priment. Créée le 2026-10-11.

## Principes retenus

1. A08 ajoute les cas limites dans un fichier `backend/test/QA-<lot>.test.ts` ; ne modifie jamais le code de production, signale le défaut.
2. Tester les bornes exactes (max accepté, max + 1 refusé), le `min` conservé, les champs nullish (`null` et absence) et au moins deux routes de bout en bout avec le payload réel du frontend.
3. Un test chronométré vérifie un ordre de grandeur, pas un seuil serré : 200 ms a échoué à 225 ms en local (S-1) ; borne relevée à 1 s, l'attaque non corrigée prenant ~1,9 s.
4. Vérifier la base du worktree (`git log -1`) après le checkout avant d'écrire un test.
5. Un verdict QA n'est pas un avis Security : le dire explicitement.

## Historique

- 2026-10-11 — QA-S1 (11 tests multer/MulterError), QA-S1-zod (15 tests de bornes `boundedArray`). Aucun défaut trouvé.

## 2026-10-11 — QA-sec-minilot (DECISION-038 point 4, branche fix/sec-minilot-qa)

- `backend/test/QA-sec-minilot.test.ts` : 24 tests (limit bornes/coercion, filtres audit-logs, oracle evidence `ActionPlanService.close`, absence d'effet de bord sur refus). 23 PASS, 1 FAIL volontaire.
- DEFAUT (MINOR QA, sécurité non évaluée, à voir par Security) : `GET /audit-logs?from=not-a-date` (idem `to`) -> `new Date("not-a-date")` = Invalid Date transmis tel quel à `AuditRepository.search` (200 avec le spy ; avec postgres.js probable 500). Attendu : 400 Zod. Test laissé en échec.
- Comportements documentés : `limit` passe par `Number()` : `" 10 "`=10, `"1e2"`=100, `"0x10"`=16 acceptés ; `""`, `Infinity`, `NaN`, `limit=1&limit=2` -> 400. Express 5 (parser query "simple") : `limit[a]=1` est une autre clé, limit absent -> défaut 100.
- Les messages d'erreur evidence incluent l'id demandé : comparer à id identique (ou id normalisé), pas en brut.
- Les tests avec `npm ci` : le worktree n'a pas de node_modules au départ.
## 2026-10-11 — QA-B9 (échelle 3 à 6, DECISION-038), branche feat/b9-scale-qa

- `backend/test/QA-B9-scale.test.ts` : 50 tests (bornes 2/3/6/7, tailles inégales, 7 vs 8 axes, descriptifs en trop/en moins, ACTIVE/ARCHIVED immuables, version héritée 1..5 lisible/activable/archivable/désactivable, évaluation 6x6 = score 36, isolation tenant, audit par mutation, routes). Suite complète : 898 pass + 1 expected fail.
- Défaut connu (MAJOR, déjà signalé par A06) : `MAX_APPETITE_THRESHOLD = 25` (RiskEvaluationService, RiskAppetiteService, route `riskAppetite`) non élargi ; un seuil d'appétence ne peut pas dépasser 25 alors que le score max d'une échelle 6x6 est 36 (bandes de criticité par défaut 1-25 aussi). Posé en `it.fails` : retirer `.fails` à la correction. Décision PO requise.
- Observation : `levelLabels` d'axe optionnel, donc « un descriptif par niveau et par axe » n'est exigé que s'il est fourni (test d'épinglage).
- Intention CVE de QA-S1-zod toujours couverte : les bornes 7/8 et 6/7 sont testées avec max+1 et des tableaux de `{}` (y compris `levelLabels` imbriqué), le garde `boundedArray.test.ts` passe.
- Principe ajouté : quand une borne métier change, tester aussi les plafonds dérivés ailleurs (seuils, bandes), pas seulement le champ modifié.
