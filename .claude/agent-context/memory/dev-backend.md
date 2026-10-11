# Mémoire — @dev-backend (A06)

Mémoire persistante du rôle Dev Backend sur GRC Tools. À lire en premier par tout agent A06 dispatché, avant `SHARED_LOG.md` (`grep @dev-backend`). Obligatoire : la mettre à jour en fin de tâche. Les arbitrages du PO (N0) priment. Créée le 2026-10-11 (aucune mémoire A06 n'existait jusque-là).

## Principes retenus

1. Après `git checkout -B <branche> origin/<branche>` dans un worktree, vérifier `git log -1` avant toute modification : le checkout a déjà échoué silencieusement (worktree resté sur `main`), 2026-10-11.
2. `npm ci --ignore-scripts` partout (CI, Dockerfile, local) ; `tsx`/esbuild fonctionnent sans script d'install (binaires `@esbuild/*`). Ne jamais commiter un lockfile modifié par un npm local.
3. Toute liste reçue en HTTP passe par `boundedArray(el, max, min)` (`backend/src/api/validation.ts`) : zod 4.6.5 (CVE-2023-54404, pas de version corrigée) parse tous les éléments avant `.max()`. Un test garde-fou (`boundedArray.test.ts`) échoue sur tout `.array(`/`z.record`/`z.tuple` nu dans `src/`.
4. Deux limites liées partagent une constante (ex. `MAX_DEFENSE_LINES` entre `defenseLines` de l'échelle et `lines` de l'évaluation de maîtrise) — écart relevé par Gitar sur PR #148.
5. Bornes de liste : partir des payloads réels du frontend et des invariants métier, prendre large en cas de doute ; les lister dans le rapport pour relecture PO.
6. Multer : borner `fileSize` + `files` + `fields` + `parts` ; `MulterError` → 400 (413 pour `LIMIT_FILE_SIZE`), message générique « Téléversement invalide. ».
7. Tests de niveau 1 seulement (cas heureux + validations de son propre code) ; les cas limites reviennent à A08.
8. Un groupe = un rôle (`roles`/`user_roles`) ; les 3 groupes fixes se reconnaissent à `roles.system_group` (jamais au nom). Invariants dans `RoleService` (non supprimable, non renommable, Risk Manager jamais vide) + garde atomique en dépôt (`revokeFromUser(..., {minRemaining})`, `FOR UPDATE` sur le rôle). Tout nouveau tenant doit naître avec ses groupes (CTE dans `PostgresTenantRepository.create`).
9. Dépendance qui porte une règle de sécurité (ex. `DepartmentRepository` pour valider un `departmentId`) : paramètre optionnel, mais `throw` si la donnée à valider est fournie sans la dépendance (fail closed), jamais « skip ».
10. Un script Python/heredoc enchaîné avec `cd`/`&&` peut être refusé par le harnais du worktree ; écrire le script dans le scratchpad et l'appeler avec un chemin absolu. Ne jamais relancer un script de patch sans vérifier `git status` (non idempotent : doublons).

## Historique

- 2026-10-11 — Lot B-8 / R1.2 (branche `feat/b8-groups`, migration 049) : groupes fixes + `roles.department_id` + `processes.department_id`.

- 2026-10-11 — Lot S1 (PR #147) : limites multer + mapping `MulterError`. Lot S-1 (PR #148) : `boundedArray` sur 14 schémas HTTP, règle ajoutée dans `CLAUDE.md`.

## Ouvert (voir `ACTION_ITEMS.md`)

- ~60 `z.string()` sans `.max()`, `limit` négatif sur `GET /audit-logs`, upload `branding` sans `files`/`parts`, `express.json` 1 Mo → 256 ko : proposés au lot « dette Sonar ».
- S-2 : `overrides` unzipper 0.12.5 (reporté, DECISION-037).
- `ActionPlanService` accepte une évidence DELETED pour clôturer (lignes ~399-401).
