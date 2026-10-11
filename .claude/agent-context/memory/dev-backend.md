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

## Historique

- 2026-10-11 — Lot S1 (PR #147) : limites multer + mapping `MulterError`. Lot S-1 (PR #148) : `boundedArray` sur 14 schémas HTTP, règle ajoutée dans `CLAUDE.md`.

## Ouvert (voir `ACTION_ITEMS.md`)

- ~60 `z.string()` sans `.max()`, `limit` négatif sur `GET /audit-logs`, upload `branding` sans `files`/`parts`, `express.json` 1 Mo → 256 ko : proposés au lot « dette Sonar ».
- S-2 : `overrides` unzipper 0.12.5 (reporté, DECISION-037).
- `ActionPlanService` accepte une évidence DELETED pour clôturer (lignes ~399-401).

## 2026-10-11 — Mini-lot sécurité (DECISION-038 pt 4, branche `fix/sec-minilot`)

- `GET /audit-logs` : `limit` parsé par `z.coerce.number().int().min(1).max(500)` (max = `MAX_LIMIT` de `AuditLogService`) ; hors bornes/non numérique → ZodError → 400. Avant : `Number(x) || undefined` laissait passer `-5` jusqu'au SQL. Le parsing n'était PAS partagé : les autres routes de liste (users, notifications, riskEvaluations) ont leur propre `PaginationQuery` zod déjà bornée 1..100 ; `kriMeasures` (`page`/`pageSize` via `Number()`) n'a pas été vérifiée, hors périmètre.
- `ActionPlanService.close` : évidence `status === "DELETED"` refusée avec le même message que « introuvable ».
- Principe : un `Number(query) || undefined` n'est pas une validation ; toujours zod borné sur les paramètres numériques de query.
- Worktree sans `node_modules` : `npm ci --ignore-scripts` avant typecheck/test.
- Suite (fix/sec-minilot-v2) : `from`/`to` de `GET /audit-logs` validés par zod (date non parsable → 400, vide/absent inchangé).
