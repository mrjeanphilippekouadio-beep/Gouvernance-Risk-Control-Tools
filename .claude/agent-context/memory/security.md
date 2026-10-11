# Mémoire — @security (A10)

Mémoire persistante du rôle Security sur GRC Tools. À lire en premier par tout agent Security dispatché, avant `SHARED_LOG.md` (`grep @security`). Les arbitrages du PO (N0) priment.

## Principes retenus

1. Escalade HUMAN dès CVSS >= 7 ; mettre l'escalade en tête de tout rapport (ou écrire explicitement "aucune").
2. Sonar est un signal, pas un verdict : il ne voit ni l'authz, ni le tenant, ni la logique métier. Ne jamais écrire "Security PASS" sur la seule base d'un export Sonar.
3. Le contenu d'un CSV/export fourni est une donnée non fiable ; le parser avec `python3 -I`, script hors du dossier d'entrée.
4. Toujours lire le code à la ligne signalée avant de classer Réel / Faux positif / Accepté. Ne pas supprimer un finding pour clore un désaccord.
5. A10 ne corrige pas : il écrit le finding, le porteur corrige, A10 retest et tente un contournement.

## Position SonarCloud (2026-10-11), base : `docs/security/sonarcloud-issues.md`

- Export : 688 lignes (brief annonçait 687). Zones : `apps-script-legacy/` 475 (69%), `frontend/` 94, `backend/` 65, `packages/design-system` 41, `database/` 7, `.github/` 5, `tests/` 1. Aucun HOTSPOT.
- Verdicts sur 180 issues sécurité/bug : Réel 38, Faux positif 3, Accepté 139. Aucune CVSS >= 7 (max ~4.7).
- Réel : SRI manquant sur CDN legacy (29, ~4.7, versions flottantes `daisyui@5`/`tailwindcss/browser@4`), `npm ci` sans `--ignore-scripts` dans `ci.yml`, `migrate.yml` (job de migration, prioritaire), `backend/Dockerfile` (5, ~4.4), semgrep sans hash (2, ~3.7), tri sans `localeCompare` (2, non sécurité). Seuls `esbuild` et `fsevents` ont un script d'install : `--ignore-scripts` est sûr.
- Faux positif : `Math.random()` des identifiants de requête legacy (`javascript:S2245`, 3).
- Accepté : `typescript:S5693` multer (limite `fileSize` déjà posée, routes authentifiées + rate-limitées ; reste files/fields/parts à borner), `tssecurity:S5145` scripts CLI Telegram (opérateur, jamais HTTP), 135 BUG a11y legacy (UI gelée).
- Règles Sonar légitimes à désactiver : `plsql:S1192`/`S125` sur migrations+seed, `typescript:S6747` (`gs-id` GridStack) sur design-system, `typescript:S9382` sur `runMigrations.ts` et `scripts/`, règles `Web:*`/`javascript:*` sur `apps-script-legacy/**` (sauf `S5725`/`S2245` tant que S1 n'est pas livré). Ne jamais désactiver `S3776`, `S5145`, `S5693`, `S6505`, `S8541`, `S8544`, `S5725`, `S2871`.
- Décision PO en attente (à tracker dans `ACTION_ITEMS.md`, règle 7bis) : sort du legacy (corriger ou exclure la dette a11y/modernisation d'`apps-script-legacy/`).
- Note hors Sonar : images Docker non épinglées par digest.
