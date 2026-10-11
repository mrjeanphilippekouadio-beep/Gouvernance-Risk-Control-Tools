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

## 2026-10-11 — QA-B8 (lot B-8 groupes fixes, `backend/test/QA-B8-groups.test.ts`, 31 tests + 1 `it.fails`)

- Aucun défaut dans le code de RoleService/ProcessService : les 3 groupes refusent disable/rename/departmentId, RM jamais vide (service + garde repo), Comité/Audit vidables, maker-checker intact, département d'un autre tenant / inexistant / déjà pris refusé, échec fermé sans DepartmentRepository, audit à chaque mutation, isolation tenant.
- DEFECT-B8-01 (MAJOR, confirmé, signalé par A06) : `UserService.suspend` d'un dernier membre RM contourne l'invariant (le `user_roles` reste actif ; `countActiveAssignments` compte aussi les suspendus). Test `it.fails` : suite verte tant que le défaut existe, rouge le jour du correctif (alors passer en `it`). Corriger côté service/repo, pas côté test.
- Migration 049 relue, non exécutée : voir rapport (adoption par nom sensible à la casse ; groupes créés vides => RM vide à la naissance ; `update` concurrent sur départements peut remonter une 23505 brute).
- Pratique : un fake de repo doit refléter la garde atomique du vrai repo (`minRemaining`) ; helper de setup qui assigne doit utiliser un autre acteur que le membre (maker-checker).
