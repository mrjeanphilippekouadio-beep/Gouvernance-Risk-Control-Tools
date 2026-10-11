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
## 2026-10-11 — Lot B-9 « échelle » (R1.3, migration 050)

- Règles d'échelle (taille 3 à 6, probabilité = impact, 7 axes max, descriptifs exacts par niveau) appliquées dans `RatingScaleService` (create/updateImpactAxes), donc sur les NOUVELLES versions seulement. Pas de CHECK en base sur ces règles : les versions ACTIVE/ARCHIVED sont immuables (R-01) et des lignes héritées peuvent valoir 1..5 avec tailles inégales. La migration 050 ne fait qu'ÉLARGIR les CHECK (rating_scales, risks) à 1..6 : aucune ligne existante ne peut être cassée, pas de NOT VALID.
- Descripteurs par axe : `ImpactAxis.levelLabels` optionnel (JSONB, aucune colonne). Optionnel pour ne pas casser le front actuel ; à rendre obligatoire à la création du Dispositif (B-6) — question PO.
- `RiskEvaluationService` n'a pas été modifié : il borne déjà par `ratingScale.probabilityLevels/impactLevels`. Plafonds de score à 25 codés en dur restent (appétit, seuils comité, bandes par défaut Cartography/Dashboard) : score max devient 36.
- Les constantes `MAX_SCALE_SIZE`/`MAX_IMPACT_AXES` (`api/validation.ts`) sont dupliquées dans le service (la couche services n'importe pas `api/`).
- 2026-10-11 — v2 (F-B9-01/02, Security) : `.max(200)` label/code, `.max(120)` name/version ; `setJsonColumn` filtre `status = 'DRAFT'`, 0 ligne sur échelle existante → ValidationError (défense en profondeur de R-01).
