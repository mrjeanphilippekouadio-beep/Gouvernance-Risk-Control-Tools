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

## Revue DS vague 2 (2026-10-11, commit 48d6107, statique) : PASS avec réserves, aucune escalade (max 2,1)
- Aucun package.json/lockfile touché, aucun sink HTML, aucun href ajouté, clés de sélection absentes du DOM, catalogue factice, aucun calcul métier. `Breadcrumb`/`Menu` ont un `href` antérieur : filtrer `javascript:` quand les URLs viendront du backend.
- F-DS2-01 LOW 2,1 : `VersionComparison` plante (pas XSS) si le diff backend contient un objet (types TS effacés, pas d'Error Boundary). F-DS2-02..04 INFO (clés = contenu, `ref` écrasable dans Checkbox, ReactNode libres).
- Leçon : pour un composant d'affichage de données backend, les types TS ne protègent pas à l'exécution ; React échappe les strings mais lève sur les objets. Vérifier l'Error Boundary et la normalisation au bord.

## Revue B-9 bis plafond n² (2026-10-11, commit 300ff8f, statique) : PASS avec réserves, aucune escalade (max 2,1)
- Scoping tenant de `resolveMaxScore` OK (`list(actor.tenantId)`, ACTIVE unique). Permissions inchangées (activateVersion = `ratingscale.delete`). Tous les points d'écriture de score plafonné valident côté service, plafond immuable (impactLevels figé). Migration 052 : SQL dynamique à littéraux + `%I`, noms de CHECK lus dans `pg_constraint`, pas d'injection ni de DROP deviné.
- F-B9b-01 LOW 2,1 : seuils d'appétence/Comité stockés non revalidés quand une échelle plus petite est activée : fail-open silencieux (appétit `>`, Comité `>=`, seuil 30 jamais atteint sous 5×5). Reco A06 : contrôle à `activateVersion` ; arbitrage Risk Manager. INFO : routes sans borne 36 sur comité/bandes, plafond sur `impactLevels` seul (legacy p≠i), Dashboard 5×5.
- Leçon : un plafond dérivé d'une configuration mutable protège l'ÉCRITURE, pas les valeurs déjà stockées ; vérifier le sens fail-open/closed quand la config se RÉDUIT (plafond plus bas que la valeur stockée).
- Tracker (7bis) : F-B9b-01 (A06 + Risk Manager). Migration 052 à rejouer sur staging, lister les CHECK existants avant.

## Revue B-8 bis (2026-10-11, commit 8024b39 + frontend f739854, statique) : PASS avec réserves, aucune escalade (max CVSS 4,9)
- MEDIUM : F-B8b-01 (droits d'Audit sans liste blanche lecture, Audit valide l'élargissement de ses propres droits, 4,9), F-B8b-02 (validateur pouvant être RM+Comité, aucune route de lecture des PENDING, 4,4), F-B8b-03 (`/roles/grantors` sans limite, audit gonflable, liste des admins pour toute permission, 4,3), F-B8b-06 (ActionPlan.close exclut le créateur mais pas le responsable/exécutant, 4,3). LOW : F-B8b-04 (PENDING multiples, claim+update+audit hors transaction), F-B8b-05 (cumul RM+Audit contournable par permissions effectives, course, doubles existants). INFO : migration 051.
- Point « ActionPlan sans auto-validation » : formulation fausse (créateur ≠ clôturant existe, test ligne 771), résidu réel = exécutant.
- Migration 051 PASS : listes CHECK = dernières migrations + valeur ajoutée, 105 permissions vérifiées par script contre ALL_PERMISSIONS, runner transactionnel, rien de deviné.
- Leçon : un garde-fou « seulement après un refus » implémenté dans le frontend n'est pas un garde-fou ; le serveur doit le faire respecter. Un maker-checker doit contraindre l'indépendance du validateur (pas seulement auteur ≠ validateur) et lui donner de quoi lire ce qu'il valide. Une interdiction de cumul sur l'appartenance ne couvre pas les permissions effectives.
- Tracker (7bis) : F-B8b-01..06 (A06 ; arbitrage A13/A14/PO pour 01, 02, 06).

## Revue B-8 ter + quater (2026-10-11, commits 923a7f1 + 5d4c9c7, tête 3484b77, statique + vitest 42 verts) : PASS avec réserves, aucune escalade (max 4,4)
- Retest : F-B8b-01, 02, 03, 06 PASS ; 04 et 05 partiels. Config `PUT /config/committee-audit-cumul` (permission dédiée, motif, audit, pas de mass assignment), migrations 053/054, `/cartography/scale`, notifications : sans écart, tenant-scopés.
- F-B8t-01 MEDIUM 4,4 : `RoleService.update` ne rejoue ni `assertNoCumul` ni q63 ; le groupe RM peut recevoir `ADMIN_PERMISSIONS` (tout RM devient admin+RM sans motif ni notification). F-B8t-02 (users.roles legacy ignoré, course `assignToUser` sans verrou), F-B8t-03 (approbation sans revalidation liste blanche/auteur/expiration), F-B8t-04 (`reopen` laisse droits appliqués + PENDING) LOW.
- Leçon : un contrôle ajouté à l'assignation doit aussi couvrir TOUT chemin qui change les droits effectifs d'un porteur existant (édition du rôle), pas seulement l'entrée de l'utilisateur dans le rôle. Une liste blanche appliquée à la création d'une demande doit être revérifiée à l'application (données antérieures). Une compensation « rouvrir » ne défait pas un effet déjà appliqué.
- Tracker (7bis) : F-B8t-01..04 (A06), définition « administrateur » q63 (A13/A14).

## Retest B-8 quinquies (2026-10-11, commit fbf96f9, tête dc0b9a2, statique + vitest 106 verts) : PASS, aucune escalade (max CVSS 2,7)
- F-B8t-01 RETEST_PASS : `assertCumulRules` rejouée par porteur actif avant écriture (tout-ou-rien), retrait puis ajout, rôle non assigné puis assigné, ajout au groupe RM (motif + notif, permis par q63) : pas de contournement. F-B8t-03 RETEST_PASS (liste blanche revérifiée avant claim ; auteur/expiration non traités, INFO). F-B8t-04 RETEST_PASS avec résidu.
- F-B8q-01 LOW 2,7 : course `update` / `assignToUser` sans `FOR UPDATE` (seul `revokeFromUser` verrouille). F-B8q-02 INFO : `rolegroup.audit.update` dans `ADMIN_PERMISSIONS` est inopérante (aucun rôle RBAC ne peut la porter, angle mort legacy F-B8t-02 toujours ouvert), pas de règle admin+Comité, élargissement rétroactif de la définition. F-B8q-03 LOW 2,7 : audit manquant après application = perte de l'instantané « avant » et aucun rejeu possible ; `reopen` sur échec ambigu ou index unique libéré.
- Leçon : supprimer une compensation incorrecte déplace le risque vers la perte de preuve ; vérifier qui peut réémettre l'événement et ce qui est écrasé (ici `roles.update` écrase l'état avant). Une entrée de liste de permissions doit être atteignable par le canal que le contrôle lit (ici RBAC seul).
- Tracker (7bis) : F-B8q-01, F-B8q-03 (A06), F-B8q-02 (A13/A14).

## Revue B-8 sexies + EVD-2 (2026-10-11, commits 7c29441 + aed8ec1, tête 2cf4f48, statique + PoC xlsx hors dépôt) : PASS avec réserves, aucune escalade (max CVSS 4,3)
- F-B8q-03 RETEST_PASS (résidu INFO : APPROVED non appliqué sans rejeu API, requête 7 le détecte). F-B8q-01 partiel : F-B8s-01 LOW 2,2, le verrou sur la ligne `roles` ne sérialise pas deux rôles différents sur un même utilisateur ; les règles de cumul sont décidées avant verrou (état périmé). Reco : verrouiller la ligne `users` de la cible et rejouer `assertCumulRules` sous verrou.
- EVD-2 : bombe, XXE (tout DOCTYPE/ENTITY rejeté), macros, formules (cache seul), lookup tenant avant Drive : PASS. F-EVD2-01 MEDIUM 4,3 : plafonds lignes/colonnes testés APRÈS `xlsx.load` ; fichier de 2,3 Mo -> 473 Mo RSS / 2,6 s (event loop non bloquée, lag <= 50 ms) ; reco plafond décompressé réduit pour l'analyse + sémaphore + limiteur par utilisateur. F-EVD2-02 MEDIUM 4,3 : exemples de valeurs accessibles avec `evidence.import` sans `evidence.download` ; reco ferme : masquer les exemples sans `download`. F-EVD2-03 LOW 3,1 : lecture non auditée ; reco ferme : `audit.record` action `READ` (existe déjà) avant réponse, sans valeurs.
- Leçon : un plafond « avant parcours » ne protège pas le chargement ; mesurer la mémoire sur la fonction réelle avec des fichiers petits mais denses. Un nouveau endpoint qui lit le contenu d'une ressource doit hériter de TOUTES les permissions de lecture de cette ressource (download), pas seulement de sa propre permission d'usage.
- Tracker (7bis) : F-B8s-01, F-EVD2-01..03 (A06) ; mémoire conteneur (A09/A16).

## Revue centre de notifications (2026-10-12, commits 20e703d + de605e4, tête e1765ec, statique + vitest 7 verts) : PASS avec réserves, aucune escalade (max CVSS 5,4)
- IDOR/tenant (liste, compteur, read-all, read unitaire), types obligatoires (émis par `record()` qui ignore les abonnements : casse, type inconnu, autre resourceType sans effet), attribution, frontend (texte React, navigation par table fixe) : PASS.
- F-NOTIF-01 MEDIUM 5,4 : `/action-plans/:id/escalate` et mesures KRI persistent une notification à chaque appel, sans dédup ni limiteur (le limiteur global ne compte que les échecs d'auth). F-NOTIF-02 LOW 3,1 : ACTION_OVERDUE / KRI_THRESHOLD_BREACH désactivables par leurs propres destinataires (arbitrage PO/A13). F-NOTIF-03 LOW 3,1 : message KRI (libellé + valeur) lisible avec `notification.read` seule. INFO : abonnement hors catalogue accepté, `:id` non uuid -> 500.
- Leçon : une notification est un canal de lecture à part entière ; son contenu doit respecter les permissions de la ressource source, pas celles du centre de notifications. Toute émission déclenchable à la demande par un utilisateur doit être dédupliquée, sinon elle devient un vecteur d'inondation de la boîte d'un tiers. Pour un garde « obligatoire », vérifier d'abord QUEL chemin d'émission lit l'abonnement (ici `record` ne le lit pas : la casse n'importe pas).
- Tracker (7bis) : F-NOTIF-01, F-NOTIF-03 (A06), F-NOTIF-02 (HUMAN/A13).
