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
## 2026-10-11 — QA-B8 (lot B-8 groupes fixes, `backend/test/QA-B8-groups.test.ts`, 31 tests + 1 `it.fails`)

- Aucun défaut dans le code de RoleService/ProcessService : les 3 groupes refusent disable/rename/departmentId, RM jamais vide (service + garde repo), Comité/Audit vidables, maker-checker intact, département d'un autre tenant / inexistant / déjà pris refusé, échec fermé sans DepartmentRepository, audit à chaque mutation, isolation tenant.
- DEFECT-B8-01 (MAJOR, confirmé, signalé par A06) : `UserService.suspend` d'un dernier membre RM contourne l'invariant (le `user_roles` reste actif ; `countActiveAssignments` compte aussi les suspendus). Test `it.fails` : suite verte tant que le défaut existe, rouge le jour du correctif (alors passer en `it`). Corriger côté service/repo, pas côté test.
- Migration 049 relue, non exécutée : voir rapport (adoption par nom sensible à la casse ; groupes créés vides => RM vide à la naissance ; `update` concurrent sur départements peut remonter une 23505 brute).
- Pratique : un fake de repo doit refléter la garde atomique du vrai repo (`minRemaining`) ; helper de setup qui assigne doit utiliser un autre acteur que le membre (maker-checker).

## 2026-10-11 — QA-ds2 (design system vague 2, commit 48d6107)

- `packages/design-system/src/QA-ds2.test.tsx` : 57 tests dont 2 `it.fails`. Suite DS : 166 pass + 2 expected fail (168). Builds DS et frontend OK.
- DEFECT-DS2-01 (MINOR) : `Card disabled` ne pose que `aria-disabled` sur un div sans rôle ; les enfants restent cliquables alors que le doc dit « not interactive ». `it.fails`.
- DEFECT-DS2-02 (MINOR) : l'id de la raison d'un onglet désactivé est construit depuis `item.value` ; une valeur avec espace casse l'IDREF. `it.fails`.
- Observations (épinglées, non défauts) : clés de ligne dupliquées partagent la sélection ; select-all supprime les clés périmées alors qu'un toggle les conserve ; `""` n'est pas rendu « (vide) » dans VersionComparison ; objets en valeur font planter le rendu ; `BulkActionBar count=NaN` s'affiche ; `.btn` a padding vertical 0 (min-height seul), un libellé sur plusieurs lignes colle aux bords ; `.topbar-actions .btn{padding:7px 10px}` (mobile) garde min-height 40px.
- Pratique : en jsdom `new URL(..., import.meta.url)` échoue pour lire un CSS ; utiliser `readFileSync("src/X.css")` (cwd = package).
