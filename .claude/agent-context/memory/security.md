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

## Position dépendances Snyk (2026-10-11), base : `docs/security/snyk-dependencies.md`

- 4 alertes. zod 4.6.5 (Snyk 7.5/8.7) : **exploitable, PoC mesuré** : body 1 Mo de `{}` contre `z.array(z.object)` = ~2 s CPU bloquant + ~540 Mo heap. Auth précède parse zod, permission suit : tout utilisateur authentifié. CVSS 3.1 effectif 6.5 (PR:L), signalé à HUMAN malgré < 7 car Snyk >= 7.
- **Leçon : `.max()` n'atténue PAS le DoS zod 4.6.5** (check exécuté après le parse des éléments). Contre-mesure testée : `z.array(z.unknown()).max(N).pipe(z.array(El))`. Aucune version zod corrigée (latest = 4.6.5).
- 14 `z.array` HTTP, aucun borné. Règle à pousser dans CLAUDE.md : pas de `z.array` nu sur entrée HTTP.
- unzipper/traverse/inflight : non atteignables (exceljs `xlsx.load` en mémoire via JSZip, aucun `Extract`/`Open`/`glob`). INFORMATIONAL. exceljs latest = 4.4.0 donc pas de montée ; piste : `overrides unzipper 0.12.5` (retire binary/traverse/fstream/rimraf). Ne pas surcharger `glob` (casse archiver).
- Un score Snyk est un signal : toujours lire le code ET reproduire quand c'est peu coûteux (le PoC a invalidé l'hypothèse « .max suffit »).
- À tracker (7bis) : lots S-1 (A06), S-2 (A06), info HUMAN sur zod.

## Retest S-1 zod (2026-10-11, HEAD 9dfe022) : GO

- 17 couples route/champ rejoués sur vrais routeurs : 1 Mo de `{}` = 400 en 56-174 ms (avant 2,1 s / 540 Mo), imbriqué 16-54 ms, valides > max 6-16 ms. Aucun `z.array` nu hors `env.ts`.
- Leçon : le garde-fou par regex (`z.array(` dans `api/v1`) est contournable (`.array()`, `z.record`, `z.tuple`, hors `api/v1`) ; un retest doit toujours évaluer le test garde-fou, pas seulement le correctif.
- Notés non traités : `z.string()` sans `.max()` (~60), `limit` négatif audit-log, branding multer sans files/parts, `coveredRiskIds` max 1000 vs sélection UI. `express.json` 256 ko = durcissement optionnel.

## Mini-lot DECISION-038 (2026-10-11, commit 620e759, revue statique) : PASS 1 et 2, point 3 INFO
- `limit` audit-logs borné zod 1..500 : ferme la réserve S-1 (b). `from`/`to` = `new Date()` non validé, 500 générique sur date invalide (INFO). Les autres filtres sont paramétrés et tenant-scopés.
- `ActionPlanService.close` : DELETED = même message/400 que inexistant, lookup tenant-scopé, pas d'oracle ; `evidenceId` n'entre que par `close()`. Résidu : TOCTOU minime, évidence supprimée après clôture.
- KRI `Number()` brut : le repository normalise (`>0`, floor, pageSize <= 100, paramétré). Pire cas : `page=1e20`/`Infinity` donne OFFSET invalide, 500 générique. CVSS effectif 0 ; pas d'escalade.
- Leçon : un `Number()` brut n'est pas un défaut en soi ; suivre la valeur jusqu'au SQL avant de coter (ici la normalisation du repository neutralise négatifs/NaN/énormes sauf OFFSET non représentable).

## Revue B-9 échelle 3 à 6 (2026-10-11, commit 21cd420, revue statique) : PASS, aucune escalade (max CVSS 2,7)
- `boundedArray` OK (6/7), mais `ScaleLevelSchema.label` sans `.max()` : stockage JSONB + audit (old+new) = F-B9-01 LOW 2,7. Même classe que S-1 (a) ; pousser `.max()` sur tous les `label`/`code` de config.
- R-01 tenu côté service (`assertMutable`) mais `setJsonColumn` n'a pas `AND status='DRAFT'` : TOCTOU pré-existant, F-B9-02 INFO 2,2.
- Plafonds 25 : tous les gardes sont `>=` (Comité) ou `>` (appétit), clamp vers la dernière bande en criticité : un score 30 n'échappe à rien (fail-closed). Limite fonctionnelle : appétit ne peut pas dépasser 25. Leçon : pour un plafond élargi, vérifier le SENS de la comparaison (plancher vs plafond) avant de conclure à un contournement.
- `.down.sql` : aucun des 23 n'a de BEGIN ; le runner ignore les downs ; recommander `psql --single-transaction`.
- Tracker (7bis) : F-B9-01 (A06), décision PO/Risk Manager sur appétit/Comité pour 6x6.

## Revue B-8 groupes fixes (2026-10-11, commit efefbb1, statique) : PASS sauf point 4
- Maker-checker, non-suppression/renommage, FOR UPDATE de `revokeFromUser`, IDOR `departmentId`, tenant scoping : PASS. Aucune escalade HUMAN (max 3,8).
- F-B8-01 LOW 3,8 : `UserService.suspend` ne révoque pas `user_roles` et `countActiveAssignments` ne joint pas `users.deleted_at` : l'invariant « Risk Manager jamais vide » compte les suspendus (dans les deux sens). Impact borné car les groupes ont `permissions = '{}'` et un admin `role.assign` peut recréer le membre. Reco : joindre users actifs + garde dans suspend.
- F-B8-02 INFO : la migration adopte tout rôle actif nommé « Risk Manager / Risk Committee / Audit » sans toucher aux permissions (pas d'élévation, mais rôle figé et non désactivable) ; contrôle pré-migration à faire en prod.
- F-B8-03 INFO : `departmentId` pas `.uuid()` donc 500 ; 23505 en course donc 500. F-B8-04 INFO : groupes amorcés sans audit.
- Leçon : un invariant de cardinalité (« jamais vide ») doit compter les membres ACTIFS (jointure utilisateur), et être appliqué sur tous les chemins qui retirent un membre (suspension incluse), pas seulement sur la révocation de rôle.

## Retest F-B8-01 (2026-10-11, diff 2fb39ea..2cdf747, statique + vitest) : CLOSED, aucune escalade (max 2,0)
- Fermé dans les deux sens (jointure `users` actifs dans `countActiveAssignments`, `revokeFromUser`, `suspend`). Concurrence : suspend et revoke verrouillent la même ligne `roles` du groupe (index unique partiel = une ligne par tenant), COUNT après verrou en READ COMMITTED : sérialisé, pas de deadlock. Seul `PostgresUserRepository.suspend` rend un user inactif (pas d'email modifiable, pas de DELETE, SSO ne provisionne pas).
- `z.guid()` suffisant (regex 8-4-4-4-12 stricte, accepte ids de seed, tout ce qu'il passe est un uuid Postgres valide). 23505 mappé sur la seule contrainte `roles_active_department_idx`, message fixe, pas de fuite.
- Nouveaux INFO : F-B8-05 (pré-contrôle service refuse la révocation d'un suspendu, fail closed), F-B8-06 (`role.disable` sur rôle de suspendus : user_roles orphelins, réactivation sans permissions de ce rôle, réduction jamais élévation).
- Leçon : un retest de garde de cardinalité = vérifier (1) tous les chemins qui changent l'état « actif », (2) que les deux écrivains partagent le MÊME verrou, (3) l'effet de bord du changement de définition de « actif » sur les autres consommateurs du compteur (ici `disable`). Non rejoué sur vraie base Postgres.
