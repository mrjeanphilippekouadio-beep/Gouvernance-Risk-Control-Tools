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

## 2026-10-11 — QA-B9bis (lot B-9 bis, commit 300ff8f, `backend/test/QA-B9bis.test.ts`, 98 tests dont 6 `it.fails`)

- Suite complète : 1090 pass + 6 expected fail ; typecheck OK. Migration 052 relue (texte SQL), jamais appliquée.
- Couvert : bornes n²/n²+1 pour n=3..6 (appétence, seuils Comité, appetiteOverride, bandes de l'échelle), repli 5x5 (sans repo, sans échelle, DRAFT/ARCHIVED seuls), tenant, activation (descriptifs null/[]/n-1/n+1/blanc/doublon, axes), Cartography (bandes par taille, forme de réponse), Dashboard 5x5, SQL 052.
- Les modifications A06 de `RatingScaleService.test.ts` / `QA-B9-scale.test.ts` sont légitimes (it.fails -> it quand le défaut est corrigé), mais les doubles `create` remplissent désormais des descriptifs par défaut, ce qui masque le vrai comportement du repo (null) : le test « DRAFT créé sans descriptifs ne s'active pas » vit dans QA-B9bis avec un double fidèle.
- Défauts épinglés (`it.fails`) : (1) MAJOR down 052 (et 050) non transactionnel via `psql -f` : DROP validé puis ADD CHECK échoue s'il existe une valeur > 25, colonne sans CHECK et `schema_migrations` quand même purgé ; (2) MAJOR seuil Comité par défaut 15 non adapté : en 3x3 le score max 9 passe par `validate()` sans Comité ; (3) MAJOR Dashboard garde les bandes 5x5 : 6x6 score 12 = « Élevé » (Cartography : « Modéré »), 3x3 score 9 = « Modéré » ; (4) MINOR échelles héritées P!=I (5/3) : tous les plafonds utilisent impactLevels² (9) au lieu de P×I (15).
- Observations épinglées (non défauts) : seuil d'appétence stocké > n² non revalidé après activation d'une échelle plus petite ; override borné par l'échelle capturée, appétence/Comité par l'échelle ACTIVE ; activation sans axes acceptée (échelle inutilisable pour scorer) ; ré-activer une échelle ACTIVE héritée sans descriptifs est refusé.
- Principe ajouté : une migration « down » exécutée à la main doit être atomique ; relire le README de lancement avant de juger un down.

## 2026-10-11 — QA-B8bis (lot B-8 bis, commit 8024b39, `backend/test/QA-B8bis.test.ts`, 67 tests dont 5 `it.fails`)

- Suite complète : 1152 pass + 11 expected fail (toutes instances) ; typecheck OK. Migration 051 + down relues (texte SQL + tests statiques), jamais appliquées.
- Couvert : cumul RM+Audit (deux sens, via POST /users, levée après révocation), RM+Comité + `fixedGroups`/`riskManagerAndCommittee`, motif (vide, espaces, 500/501, rôle ordinaire, HTTP), changement droits Audit (APPLIED/PENDING, auteur, non-membre, double décision, concurrence, membre Audit sur son groupe, PATCH refusé), `/roles/grantors`, réactivation/`lostRoles`, processus sans département, ActionPlan.
- Point A06 `ActionPlanService` : INFIRMÉ pour le créateur (close refuse createdBy = clôturant). CONFIRMÉ pour le RESPONSABLE (F-B8b-06, Security) : `it.fails` « KNOWN GAP F-B8b-06 ».
- Défauts épinglés (`it.fails`) : B8bis-01 MAJOR/MINOR `UserService.create` crée la ligne user AVANT la validation du motif -> compte sans rôle après refus ; B8bis-02 MAJOR `PostgresTenantRepository.create` crée les 3 groupes avec permissions `{}` (051 ne sème que les tenants existants) ; B8bis-03 MINOR approbation Audit non transactionnelle (APPROVED sans application si `roles.update` échoue) ; B8bis-04 MINOR échec de notification => 500 après réactivation déjà validée ; F-B8b-06 MAJOR (Security) responsable clôt sa propre action.
- Observations épinglées : plusieurs changements PENDING, le dernier approuvé gagne ; rien n'empêche de donner des droits d'écriture/admin au groupe Audit « lecture seule » (défi PO) ; grantors = détenteurs de `role.assign` quelle que soit la permission demandée, permission portée seulement par `users.roles` => liste vide ; `update` processus accepte `departmentId: null` (détachement possible avant NOT NULL).
- Migration 051 (relecture) : logique OK, UPDATE de droits gardés par `permissions = '{}'`, report « Auditeur » saute AUDIT/RM puis révoque puis désactive (soft). Réserves : aucune ligne d'audit_log pour les déplacements/révocations « Auditeur » ; le down remet à `{}` TOUS les groupes (perte des droits adoptés en 049) et ne ré-attribue pas « Auditeur » (les anciens détenteurs perdent audit.read ; données récupérables dans `user_roles.revoked_at`, pas « depuis l'audit ») ; tout rôle nommé « Auditeur » est traité comme l'ancien, quels que soient ses droits.
- Pièges : un regex multi-statements `[\s\S]*?` sur le SQL capture le UPDATE précédent ; utiliser `[^\]]*`. Les fakes doivent refléter les gardes du vrai repo (`listWithPermission`, `listDisabledForUser`).
