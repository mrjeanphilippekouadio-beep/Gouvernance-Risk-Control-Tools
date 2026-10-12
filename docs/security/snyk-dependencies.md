# Dépendances (Snyk, 2026-10-11)

Auteur : A10 Security. Base : 4 alertes Snyk collées par le PO sur `@grc-tools/backend`, lecture du code et `backend/package-lock.json`. Cotations = estimations A10 (le risque métier revient à A13). Contexte : `docs/security/sonarcloud-issues.md`.

## Escalade HUMAN (en tête)

**zod (SNYK-JS-ZOD-20510278) : Snyk 7.5 (3.1) / 8.7 (4.0), au-dessus du seuil.** Verdict A10 : **exploitable, mesuré**, CVSS 3.1 effectif **6.5** (AV:N/AC:L/PR:L/UI:N/A:H, car `authMiddleware` précède le parse zod) — sous 7 techniquement, mais à traiter comme prioritaire et à porter à la connaissance de HUMAN. Surtout : **ajouter `.max()` ne corrige PAS le problème** (voir §1). Les trois autres alertes : aucune escalade.

## Synthèse

| Alerte | Snyk | Atteignable chez nous ? | CVSS effectif | Action |
|---|---|---|---|---|
| zod 4.6.5 (CWE-770) | 7.5 / 8.7 | **Oui** (PoC) | **6.5** | Lot S-1, urgent |
| unzipper 0.10.14 Zip Slip | 5.3 (4.0) | Non | ~0 / INFO | Lot S-2 (hygiène) |
| traverse 0.3.9 proto pollution | 6.5 / 6.9 | Non (code mort) | ~0 / INFO | Lot S-2 |
| inflight 1.0.6 fuite mémoire | 6.2 | Non | ~0 / INFO | Lot S-2 |

## 1. zod : DoS par tableau non borné

**Mécanisme** (lu dans `node_modules/zod/v4/core/schemas.js`, `$ZodArray` / `handleArrayResult`) : pour chaque élément en échec, `final.issues.push(...prefixIssues(...))` ; aucune limite, aucun arrêt anticipé.

**Limite body** : `express.json({ limit: "1mb" })` (`server.ts:165`), global. 1 Mo = environ 349 000 éléments `{}` (3 octets chacun).

**Ordre d'exécution** : `authMiddleware` (`server.ts`, par router) passe avant le `.parse()` de la route ; la permission (`requirePermission`) est vérifiée dans le service, donc **après** le parse. Tout utilisateur authentifié, quel que soit son rôle, atteint le parse. Non authentifié : 401 avant parse.

**PoC non destructif local** (script hors dépôt, zod 4.6.5, un body de 1 048 571 octets, tableau de `{}` contre `z.array(z.object({level, label}))`) :
- 2,1 s de CPU synchrone (event loop bloquée pour tous les utilisateurs) ;
- ~540 Mo de heap pour 699 036 issues ;
- les issues ne sont pas renvoyées au client (`errorHandler` répond 400 générique), mais elles sont déjà allouées.
Quelques requêtes concurrentes suffisent à dépasser un conteneur Cloud Run de 512 Mio.

**`.max()` n'aide pas** : même PoC avec `.array(...).max(50)` = 1,7 s, 537 Mo. Le contrôle de taille est un check exécuté *après* le parse des éléments. Un `.max()` reste utile pour la validité métier, jamais comme protection DoS en zod 4.6.5.

**Contre-mesures testées (PoC)** :
- `z.array(z.unknown()).max(N).pipe(z.array(El))` : 13 ms, 4 Mo, 1 issue. Le pipe s'arrête si l'entrée échoue ; `z.unknown()` ne produit jamais d'issue.
- `z.custom(v => !Array.isArray(v) || v.length <= N).pipe(z.array(El))` : 1 ms.
- `.parse(x, { abortEarly: true })` : 3 ms (mais nécessite de changer chaque appel `.parse`).

**Version corrigée ?** Aucune. `npm view zod dist-tags` : `latest` = 4.6.5 (déjà installée), seul canary 4.5.0-canary antérieur. Snyk indique lui-même « no remediation path ». Pas de montée de version possible aujourd'hui ; surveiller une release > 4.6.5.

**Recensement des `z.array` (backend/src, 14 schémas HTTP + 1 env)** : aucun n'a de `.max()`, tous reçoivent une entrée HTTP bornée seulement par 1 Mo.

| Fichier:ligne | Champ | `.max` | Entrée HTTP |
|---|---|---|---|
| actionPlans.routes.ts:33 | `links` | non | oui |
| config.routes.ts:13 | `levelThresholds` | non | oui |
| ratingScales.routes.ts:27,28 | `probabilityLabels`, `impactLabels` | non | oui |
| ratingScales.routes.ts:32,36,41,45,46,47 | `thresholds`, `axes`, `levels`, `defenseLines`, `thresholds` | non | oui |
| riskEvaluations.routes.ts:36,40,45 | `impacts`, `lines`, `impacts` | non | oui |
| controls.routes.ts:12 | `coveredRiskIds` (`z.string()` : ne produit une issue que si non-string) | non (`.min(1)`) | oui |
| roles.routes.ts:16,23 | `permissions` (enum : toute valeur inconnue = issue) | non | oui |
| auditMissions.routes.ts:12 | `auditorIds` | non | oui |
| kris.routes.ts:25 | `riskIds` | non | oui |
| config/env.ts:75 | `LocalAuthUserSchema` | non | non (env au démarrage) |

Pire cas : les tableaux d'objets / d'enums (ratingScales, riskEvaluations, roles, config, actionPlans) où un élément invalide génère 1 à 2 issues. Les tableaux de `z.string()` sont moins amplifiants (un non-string par élément = 1 issue).

**Recommandation (lot S-1, porteur A06, effort S à M, 0,5 à 1 j)** :
1. Helper unique `boundedArray(schema, max)` = `z.array(z.unknown()).max(max).pipe(z.array(schema))` (ou `z.custom` + pipe), appliqué aux 14 schémas, avec un `max` métier réaliste (ex. 50 niveaux/seuils, 500 ids, `ALL_PERMISSIONS.length` pour `permissions`).
2. Test de non-régression : body de 1 Mo de `{}` => 400 en < 100 ms (garde-fou contre un futur `z.array` nu).
3. Règle à ajouter dans `CLAUDE.md` « Security-sensitive conventions » : jamais de `z.array` nu sur entrée HTTP.
4. Défense en profondeur (optionnel) : abaisser `express.json` à 256 ko par défaut et ne relever que sur les routes qui le nécessitent (à valider par A06 : import/branding).
5. Retest A10 : PoC d'origine + variante imbriquée (tableau dans un objet d'un tableau) + `permissions` du router roles.
Effet attendu : CVSS effectif résiduel ~2 (borné, hors DoS pratique).

## 2. exceljs et ses dépendances transitives

Fait : notre seul usage est `RiskImportService.parseRows` : `assertSafeXlsxArchive(buffer)` (`zipArchiveGuard.ts`) puis `workbook.xlsx.load(buffer)` en mémoire (JSZip). Aucun `Extract`, `Open.*`, `unzipper`, `glob` ou `traverse` dans `backend/src`. Seule référence exceljs à unzipper : `lib/stream/xlsx/workbook-reader.js` (`unzip.Parse`), API de lecture en flux que nous n'appelons pas. L'import xlsx d'évidences n'existe pas : `evidences.routes.ts` fait un upload multer vers `DocumentStorage` (Drive), sans lecture xlsx. Import limité à 10 Mo (`riskImport.routes.ts`, `files:1, fields:0, parts:1`), guard : 10 000 entrées, 20 Mo décompressés.

- **unzipper (Zip Slip, CWE-29)** : exige une extraction sur disque d'une archive non fiable. Nous ne le faisons pas, exceljs non plus. Non atteignable ; CVSS effectif ~0, INFORMATIONAL (hygiène supply chain).
- **traverse (pollution de prototype)** : tiré par `unzipper > binary > chainsaw`. `binary` n'est utilisé que par `unzipper/lib/Open/*` (non appelé). Aucune donnée attaquante n'y arrive. Non atteignable ; INFORMATIONAL.
- **inflight (CWE-772, AV:L)** : vecteur local, dans `glob@7.2.3` (via `archiver-utils` et `fstream/rimraf`), appelé seulement pour archiver/lister des fichiers. Nous n'écrivons pas de xlsx ni n'archivons. Non atteignable depuis HTTP ; INFORMATIONAL. Paquet abandonné, sans correctif.

Risque à surveiller : le risque change si quelqu'un ajoute un jour une écriture xlsx (`archiver`) ou `WorkbookReader` sur entrée utilisateur. À re-évaluer à ce moment.

## 3. Options de remédiation (non appliquées)

| Option | Vérifié | Effort | Risque |
|---|---|---|---|
| Montée de version `exceljs` | **Impossible** : `latest` = 4.4.0, seul `4.4.1-prerelease.0` ensuite ; 4.4.0 dépend de `unzipper ^0.10.11` | n/a | n/a |
| `overrides` npm `unzipper: 0.12.5` | `unzipper@0.12.5` existe, ses dépendances : bluebird, duplexer2, fs-extra 11.3.1, graceful-fs, node-int64 : **supprime `binary`, `chainsaw`, `traverse`, `fstream`, `rimraf`** et un des deux chemins vers glob/inflight | S (0,25 j) | Faible : seul `WorkbookReader` (non utilisé) appelle unzipper ; `npm ci` + `npm test` (import xlsx) à passer |
| `overrides` `traverse` (0.3.10 / 0.6.12 listés) | corrigé en 0.3.10 et 0.6.12 (existe jusqu'à 0.6.14) | XS | Faible, mais inutile si unzipper est surchargé |
| `overrides` `glob` (v8+) | non recommandé | S | **Élevé** : `archiver-utils@2` et `fstream` utilisent l'API glob 7 ; casse possible de l'écriture xlsx / archiver (non utilisée, donc non détectable par nos tests) |
| Alternative à exceljs (lecture seule : `read-excel-file`, ou JSZip + saxes en interne) | non évalué en détail (A06/A05 à cadrer) | M (1 à 2 j, tests import à refaire) | Moyen : régressions de parsing (formats de cellules), garde `assertSafeXlsxArchive` à conserver |

Recommandation : override `unzipper` seul (lot S-2), puis re-scan Snyk ; accepter `glob@7`/`inflight` résiduels via archiver (exceljs 4.4.0 bloqué), avec exception documentée (ACCEPTED_RISK à porter par A13). Ne pas remplacer exceljs tant qu'aucun finding exploitable n'existe.

## Plan de correction

| Lot | Contenu | Porteur | Effort | Priorité |
|---|---|---|---|---|
| S-1 | `boundedArray` sur 14 schémas + test 1 Mo + règle CLAUDE.md | A06 (retest A10) | 0,5 à 1 j | Haute, avant prochaine release |
| S-2 | `overrides.unzipper = 0.12.5`, lockfile régénéré, tests import xlsx, re-scan Snyk | A06 | 0,25 j | Moyenne |
| S-3 | Note de risque inflight/glob résiduel | A13 (cotation), A10 (technique) | XS | Basse |
| S-4 | Suivre une release zod > 4.6.5 (le correctif amont retirera la nécessité de S-1) | A10 | veille | Basse |

Limites : PoC local sur zod seul, pas de test actif sur un environnement déployé ; mémoire Cloud Run non vérifiée ; la pression de rate-limit authentifié n'a pas été testée.

## Retest S-1 (A10, 2026-10-11, HEAD 9dfe022)

SECURITY_RETEST FINDING zod CWE-770 : **RETEST_PASS (GO)**, deux réserves non bloquantes.

- **Rejeu** : les 14 schémas (17 couples route/champ : actionPlans, auditMissions, config, controls, kris, ratingScales x6, riskEvaluations x3, roles POST+PATCH) montés avec leurs vrais routeurs et `express.json 1mb`, services stubbés. Corps ~1 Mo de `{}` (340 000 éléments) : 400 en 56 à 174 ms de bout en bout (avant : ~2,1 s CPU, ~540 Mo). Variante imbriquée `[[{}]]` (170 000) : 400 en 16 à 54 ms. Variante éléments valides (6 000 > max) : 400 en 6 à 16 ms. Jamais atteint le service. Tas stable (38 à 178 Mo, bruit GC). Variante tableau de chaînes : non rejouée (1 Mo atteint avant 340 000 éléments), non amplifiante.
- **Couverture** : plus aucun `z.array` nu dans `backend/src` hors `config/env.ts:75` (env au démarrage, hors HTTP) et le helper. Aucun `z.record`/`z.tuple`/`z.set`/`.catchall`/`.passthrough` dans le code. Query params : aucun schéma tableau (parse manuel `asString`, `PaginationQuery` borné 1..100) ; `qs` plafonne déjà les tableaux (20 indices, 1000 paramètres).
- **Garde-fou, réserve 1** : la regex `\bz\.array\(` ne couvre que `z.array(` dans `api/v1/*.ts`. Contournements non détectés : `z.string().array()`, `z.array<T>(`, `z\n.array(`, `import { array }`, `z.record`/`z.tuple`, et tout fichier hors `api/v1` (ex. `services/`). Aucun n'existe aujourd'hui ; durcissement suggéré (A08/A06) : regex `\.array\s*[(<]|\bz\.(record|tuple)\b` sur tout `src/` sauf `validation.ts` et `env.ts`.
- **Bornes** : cohérentes avec le métier (`RatingScaleService` : niveaux 1..5 et 1..3, bornes zod 50/20 larges ; permissions = `ALL_PERMISSIONS.length` = 101 ; links 200 ; ids 200/1000). Aucun usage `frontend/src` cassé. **Réserve 2** : `coveredRiskIds`/`riskIds` à 1000 : la case à cocher de `ControlsPage` permet de tout sélectionner, au-delà de 1000 risques actifs le contrôle ne serait plus créable (400 générique). Acceptable aujourd'hui ; à relever si le registre approche 1000.
- **Autres surfaces d'amplification (notées, non traitées)** : (a) ~60 `z.string()` sans `.max()` (descriptions, commentaires, `reason`, `title`...) : un champ peut atteindre ~1 Mo, persisté en base et dupliqué dans `audit_logs` ; pas d'amplification CPU zod, mais amplification stockage/lecture par requête authentifiée (rate-limit à vérifier) ; (b) `auditLog.routes.ts` : `limit = Number(query) || undefined`, plafonné à 500 en service mais une valeur négative atteint SQL `LIMIT -n` (erreur 500 probable, non testé) ; (c) multer evidences/import : `fileSize` posé, `files/fields/parts` déjà bornés (reliquat Sonar S5693 résolu pour ces deux routes), `branding.routes.ts` n'a que `fileSize` 5 Mo ; (d) `z.coerce.date()` / `z.number()` sans bornes : non amplifiants.
- **`express.json` 256 ko** : utile en défense en profondeur mais plus nécessaire pour ce finding. Gain : divise par 4 le pire cas des chaînes non bornées (a) et couvre un futur `z.record`/tableau oublié. Coût faible : le plus gros corps légitime (1000 ids, ~40 ko) tient très largement. Recommandé comme durcissement optionnel, pas comme condition de clôture ; multer n'est pas concerné.
- **CVSS résiduel** : ~2 (borné). Pas d'escalade HUMAN. Statut : CLOSED côté Security pour S-1 ; reste S-2 (unzipper), S-3, S-4 (veille zod > 4.6.5, retirer le helper seulement si correctif amont).

## Mini-lot sécurité (DECISION-038) (A10, 2026-10-11, commit 620e759, branche fix/sec-minilot)

SECURITY_RETEST : **PASS sur les points 1 et 2 ; point 3 = finding INFORMATIONAL (CVSS effectif 0, plafond théorique 3,1), aucune escalade HUMAN.** Revue statique du diff `c43b57a..fix/sec-minilot` ; pas de test actif sur environnement déployé. Le test `auditLogRouteLimit.test.ts` (5 valeurs rejetées, 2 acceptées) n'a pas été rejoué par A10.

### Point 1 : `limit` de `GET /audit-logs` : PASS
- Ferme la surface notée au retest S-1 (b) : `z.coerce.number().int().min(1).max(500).optional()`. `-5`, `0`, `501`, `abc`, `1.5` donnent une ZodError, traduite en 400 générique par `errorHandler` (pas de fuite). La valeur arrivée au service est donc un entier 1..500 ; `Math.min(limit, 500)` du service reste en défense en profondeur ; SQL reçoit `LIMIT $n` paramétré. Résidu : `?limit=` vide donne `Number("")=0` donc 400 (acceptable) ; `?limit=a&limit=b` (tableau qs) donne `NaN` donc 400.
- Ordre : le `parse` précède `requirePermission("audit.read")` du service, donc un utilisateur authentifié sans permission reçoit 400 au lieu de 403 sur une valeur invalide. Aucun oracle (la valeur est fournie par l'appelant, aucune donnée tenant lue). Cosmétique.
- Autres paramètres : `userId`, `action`, `entityType`, `entityId` passent par `asString` (non-chaîne ignoré, pas de tableau/objet) puis en paramètres `$n` (aucune concaténation SQL, `tenant_id = $1` toujours posé depuis `actor.tenantId`). `action` n'est qu'un cast TS, non validé contre l'enum : une valeur inconnue donne simplement 0 ligne. `from`/`to` : `new Date(str)` non validé ; une date invalide (`from=zzz`) est envoyée à pg comme valeur invalide, erreur Postgres, donc 500 générique (pas de fuite, `Internal server error`). Robustesse seulement (LOW/INFO) : recommandation de réutiliser un `z.coerce.date()` (400). `entityType` sans `entityId` et `listForEntity` : non bornés par `limit` (`listForEntity` n'a aucune limite : volume d'un seul objet, tenant-scopé, non amplifiant au sens exploitable, à surveiller).

### Point 2 : `ActionPlanService.close` et évidence DELETED : PASS
- Condition `!evidence || evidence.status === "DELETED"` avec le même `ValidationError` (400) et le même texte : `Evidence <id> does not exist in this tenant`. Le `getById` est filtré par `tenant_id` (une évidence d'un autre tenant, inexistante et supprimée sont indiscernables). Le texte n'écho que l'id fourni par l'appelant. Pas d'oracle d'existence ni d'état. Ordre des gardes (permission `actionplan.validate`, statut, evidenceId requis, maker-checker, évidence) inchangé ; le `Forbidden` maker-checker précède le contrôle d'évidence mais ne dépend pas d'elle.
- Autres chemins : `evidenceId` n'est accepté que par `close()` dans tout `backend/src/services` hors `EvidenceService`. `create` n'a pas de champ évidence ; `updateProgress`, `start`, `escalateIfOverdue` non ; `setLinks` n'accepte que RISK/CONTROL/KRI/ANOMALY (pas d'évidence). `server.ts` câble bien `evidenceRepository` (le contrôle est conditionnel à `this.evidences`, optionnel par conception).
- Résidus non bloquants : (i) TOCTOU entre `getById` et `UPDATE` (évidence supprimée entre les deux, fenêtre de quelques ms, requiert `evidence.delete`) ; (ii) une évidence supprimée APRÈS la clôture laisse un plan TERMINEE pointant sur une évidence DELETED : cohérent avec le soft-delete, mais l'affichage de la preuve de clôture devrait le signaler (sujet A08/A21, pas un défaut d'autorisation) ; (iii) `evidence_id` sans contrôle SQL de statut : acceptable, la règle vit dans le service (convention du dépôt).

### Point 3 : `kriMeasures.routes.ts` l.26-27, `Number()` brut sur `page`/`pageSize` : INFORMATIONAL
- Suivi de la donnée jusqu'au SQL (`PostgresKriMeasureRepository.listForKri`) : `page` et `pageSize` sont normalisés avant usage (`> 0`, `Math.floor`, `pageSize` plafonné à 100, défaut 20/1) puis passés en paramètres `LIMIT $n OFFSET $n+1`. Aucune injection possible (valeurs numériques paramétrées).
- Valeurs : négatives, 0, `NaN` (`abc`) donnent page 1 / pageSize 20 (la garde `x > 0` est fausse pour NaN). `pageSize` énorme ou `Infinity` donne 100. `page` énorme : `1e15` donne un OFFSET valide, résultat vide ; `page=1e20` ou `Infinity` donne un OFFSET non représentable en bigint (`2e+21`/`Infinity`), erreur Postgres, 500 générique, sans fuite ni effet d'état. Le même 500 vaut pour `from`/`to` invalides (`new Date("zzz")`). Pas de charge exploitable : les requêtes lisent un `kri_id` précis, tenant-scopé, avec index/LIMIT 100 maximum ; `COUNT(*)` s'exécute avant l'OFFSET mais c'est le chemin nominal.
- Authentification et permission (`kri.read`) restent requises. CVSS 3.1 effectif : `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:N` = **0,0** (une requête invalide produit un 500 sur sa seule requête, sans dégradation du service). Plafond théorique 3,1 (A:L) si l'on comptait le bruit d'erreur. **< 7 : pas d'escalade HUMAN.** Sévérité Security : INFORMATIONAL (défaut de robustesse, pas de contournement).
- Recommandation (A06, XS) : remplacer les `Number()` par un schéma zod `PaginationQuery` déjà existant (1..100, utilisé ailleurs) pour 400 propre ; faire de même pour `from`/`to`. Même motif à vérifier ailleurs : `grep -n "Number(req.query" backend/src/api`. Test de régression : `page=1e20`, `page=-1`, `pageSize=abc` doivent donner 400.

### Recommandation globale
Mini-lot acceptable à merger. Backlog (non bloquant) : validation zod de `from`/`to` (audit-logs, kri-measures), `page`/`pageSize` KRI, `limit` sur `listForEntity`. Statut Security : points 1 et 2 CLOSED ; point 3 FINDING_IDENTIFIED (INFORMATIONAL, REMEDIATION_REQUIRED en priorité basse).

## Revue B-9 (échelle 3 à 6) (A10, 2026-10-11, commit 21cd420, branche feat/b9-scale)

SECURITY_REVIEW : **aucune escalade HUMAN (aucun constat >= 7 ; maximum 2,7).** Revue statique de `git diff c43b57a..feat/b9-scale` et du code appelant (`RiskEvaluationService`, `CartographyService`, `DashboardService`, `PostgresRatingScaleRepository`, `runMigrations.ts`) ; tests unitaires non rejoués par A10, pas de test actif. Verdict global : **PASS avec 3 constats LOW/INFO**, aucun bloquant pour le merge.

### 1. Bornes HTTP `boundedArray` : PASS
- `levelLabels` (`boundedArray(ScaleLevelSchema, MAX_SCALE_SIZE)` = 6), `probabilityLabels`/`impactLabels` (6), `axes` (7) : tous bornés, aucun `z.array` nu ajouté (le garde-fou `boundedArray.test.ts` reste vert par construction). Le plafond n'est plus 50/20 mais 6/7, en miroir de `SCALE_SIZE_BOUNDS`/`MAX_IMPACT_AXES` du service (deux constantes dupliquées `validation.ts`/service : risque de dérive, INFO). Le service refuse en plus tout tableau de taille différente de `impactLevels` (`assertDescriptors`, exactement N).

### 2. Taille des chaînes de descriptifs : constat F-B9-01, LOW (CVSS 2,7)
- `ScaleLevelSchema.label` est `z.string().min(1)` sans `.max()` ; `ImpactAxisSchema.label`/`code` idem ; `name`/`version`/`ScoreThreshold.label` idem. Les chaînes de `levelLabels` finissent dans la colonne JSONB `impact_axes` et sont dupliquées dans `audit_logs` (`oldValue` + `newValue` = scale entière, soit ~2x à chaque PUT). Plafond réel : `express.json` 1 Mo par requête, donc ~1 Mo en base + ~2 Mo d'audit par écriture. B-9 augmente le nombre de chaînes par version (jusqu'à 7 axes x 6 descripteurs + 2 x 6) mais ne crée pas la classe de défaut (déjà notée au retest S-1, (a)).
- Exploitabilité : exige `ratingscale.update`/`ratingscale.create` (rôle admin) et une version DRAFT ; amplification stockage, pas CPU. CVSS 3.1 effectif `AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:L` = **2,7**. Reco (A06, XS) : `.max(200)` sur `label`/`code` (axes, niveaux, bandes), `.max(120)` sur `name`/`version`, et idéalement `.max(500)` sur un futur champ de description longue. Test de régression : label de 201 caractères = 400 sur `POST /` et `PUT /:id/impact-axes`.

### 3. Immutabilité R-01 : PASS (une réserve pré-existante)
- Le seul chemin d'écriture des axes, `updateImpactAxes`, appelle `assertMutable` (ACTIVE et ARCHIVED refusés) après un `get` tenant-scopé, avant tout validateur. `levelLabels` n'ajoute aucune nouvelle route. `create` ne prend ni statut ni axes (les axes ne s'écrivent que via le PUT dédié) ; `activateVersion` est le seul passage ACTIVE/ARCHIVED, sous `ratingscale.delete`.
- **Réserve F-B9-02 (INFORMATIONAL, CVSS 2,2, pré-existant, non introduit par B-9)** : `setJsonColumn` fait `UPDATE ... WHERE tenant_id AND id AND deleted_at IS NULL` sans `AND status = 'DRAFT'`. La garde `assertMutable` est un contrôle lu puis écrit (TOCTOU) : si `activateVersion` passe entre le `get` et l'`UPDATE`, les axes d'une version devenue ACTIVE peuvent être modifiés (fenêtre de quelques ms, deux acteurs privilégiés, `ratingscale.update` + `ratingscale.delete`). `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,2. Reco (A06/A07) : ajouter `AND status = 'DRAFT'` dans `setJsonColumn` (défense en profondeur, l'erreur 0 ligne existe déjà : NotFound) ; test : activation concurrente simulée.
- Aucune migration ne touche la colonne `impact_axes` ni les lignes existantes : les versions ACTIVE/ARCHIVED conservent leur contenu.

### 4. Permissions, tenant, audit : PASS
- Permissions inchangées (`ratingscale.create/read/update/delete`), `actor.tenantId` passé à chaque appel repository, aucun `tenantId` client. Chaque mutation (`create`, 5 `update*`, `activateVersion`, `disable`) garde son `audit.record` (aucune modification du chemin d'audit dans le diff). Pas de champ d'attribution client ajouté. `levelLabels` est une donnée de configuration, pas une attribution. Aucun `DELETE` applicatif ajouté.

### 5. Migration 050 : PASS (réserve de forme, INFO)
- Élargissement seul (`BETWEEN 1 AND 5` vers `1 AND 6`) sur 2 contraintes `rating_scales` et 4 `risks` ; toute ligne 1..5 satisfait la nouvelle contrainte, aucune donnée réécrite ni détruite, noms de contraintes conformes aux défauts Postgres (003 et 018, CHECK de colonne). `runMigrations.ts` enveloppe chaque `.sql` dans BEGIN/COMMIT/ROLLBACK : DROP+ADD atomiques. Le runner ignore les `.down.sql`.
- `.down.sql` : `ADD CONSTRAINT ... BETWEEN 1 AND 5` valide les lignes existantes, donc échoue si une cote 6 existe (bon comportement, aucune donnée altérée). **Réserve** : sans `BEGIN/COMMIT` (convention des 23 autres `.down.sql`, aucun n'en a), un échec en cours de route sous `psql` laisse la base avec les contraintes déjà rétrécies sur `rating_scales` et sans contrainte sur la table en cours ; le `DELETE FROM schema_migrations` n'est alors pas exécuté, d'où une base partiellement rétrogradée. Reco : exécuter le down avec `psql --single-transaction` (à documenter dans `database/postgresql/README`) ou ajouter `BEGIN;`/`COMMIT;`. Les gardes métier 3..6 et probabilité = impact sont uniquement dans le service (choix documenté, cohérent avec R-01) : un INSERT direct en base peut créer une version non conforme, hors périmètre applicatif.

### 6. Scores jusqu'à 36 contre plafonds à 25 : PASS (aucun contournement), 1 constat fonctionnel
Chaque garde est de type plancher (`>=`) ou dépassement (`>`) sans borne haute ; un score > 25 ne peut donc qu'aggraver le classement, jamais l'alléger.
- **Comité** : `validate()` exige le chemin Comité quand `residualScore >= minScore` (`minScore` <= 25) ; `validateByCommittee()` refuse `residualScore < minScore`. Un risque à 30 ou 36 est donc forcément Comité (si `committeeEvaluationEnforced`). Aucune borne haute côté service. La CHECK DB 1..25 de `configs.committee_*_min_score` ne limite que le seuil, pas le score. Le contrôle `enforced=false` désactivant l'obligation est une option de configuration pré-existante, indépendante de B-9.
- **Appétit** : `exceeded = score > applied` (`applied` <= 25 par zod 1..25, service et CHECK 017). Un score 26..36 dépasse toujours l'appétit : fail-closed. Même logique dans `getAppetiteVsResidual` (`sc > threshold`).
- **Bandes de criticité** : `CartographyService.deriveCriticality` et `DashboardService.deriveCriticality` retombent sur la dernière bande si `score > last.max` (clamp explicite), donc un 30 est classé « Critique » (bandes par défaut 16..25 ou bandes de l'échelle). Il n'est jamais « Faible » ni `N/A` tant que les bandes sont contiguës.
- **Constat F-B9-03 (INFORMATIONAL, CVSS 0 : pas de contournement)** : (a) l'appétit ne peut pas être fixé au-dessus de 25 : sur une échelle 6x6 un risque de 30 ne peut jamais être déclaré dans l'appétit (sur-alerte, pas de sous-alerte) ; (b) `assertThresholds` n'impose ni contiguïté ni couverture jusqu'à N x N : des bandes avec trou donnent « N/A » pour les scores situés dans le trou (pré-existant) ; (c) les bandes par défaut du Dashboard sont figées à 1..25 et ne suivent pas l'échelle de la version (déjà documenté dans le code). Risque de sous-classement : uniquement par clamp, correct en l'état. Reco (A06 + Risk Manager, hors blocage) : décider si `MAX_APPETITE_THRESHOLD` et la CHECK 017/045 doivent devenir `n_proba x n_impact` de l'échelle active, et ajouter un test « score 30 : Critique + Comité requis + appétit dépassé » (test de régression à porter par A08).
- Réflexion chaîne d'attaque : aucune chaîne qui combine un score > 25 avec un contrôle défaillant n'a été trouvée ; la seule façon d'échapper au Comité reste `committeeEvaluationEnforced=false` ou un seuil Comité relevé à 25 sur une échelle 6x6 (un score 24 resterait alors hors Comité alors qu'il vaut 67 % du max, contre 96 % du max sur 5x5 ; décision de gouvernance, à signaler au Risk Manager).

### Synthèse

| Point | Verdict | Constat | CVSS 3.1 effectif |
|---|---|---|---|
| 1. `boundedArray` | PASS | aucun | 0 |
| 2. Taille des chaînes | PASS avec réserve | F-B9-01 LOW | 2,7 |
| 3. Immutabilité R-01 | PASS | F-B9-02 INFO (pré-existant, TOCTOU) | 2,2 |
| 4. Permissions/tenant/audit | PASS | aucun | 0 |
| 5. Migration 050 / down | PASS | réserve de forme (transaction du down) | 0 |
| 6. Scores > 25 | PASS | F-B9-03 INFO (appétit plafonné à 25) | 0 |

Statut Security : **B-9 acceptable à merger**. F-B9-01 REMEDIATION_REQUIRED (priorité basse, A06), F-B9-02 et F-B9-03 FINDING_IDENTIFIED (backlog). Retest à demander à A06 pour F-B9-01 : label de 201 caractères refusé en 400, et rejeu du chemin audit.

## Revue B-8 (groupes fixes) — 2026-10-11 (A10, revue statique, commit `efefbb1`, branche `feat/b8-groups`)

Base : `git diff c43b57a feat/b8-groups`. Lecture seule, aucun test actif. **Escalade HUMAN : aucune** (aucun constat CVSS >= 7, maximum 3,8).

| Point | Verdict |
|---|---|
| 1. Maker-checker (auto-assignation / auto-révocation) | PASS |
| 2. Suppression / désactivation / renommage d'un groupe fixe | PASS |
| 3. Risk Manager jamais vide : voie `RoleService` + concurrence | PASS |
| 4. Risk Manager jamais vide : voie `UserService.suspend` (signalée A06) | FAIL (F-B8-01, LOW 3,8) |
| 5. Adoption par la migration d'un rôle homonyme | PASS avec réserve (F-B8-02 INFO 2,0) |
| 6. `departmentId` et IDOR | PASS (F-B8-03 INFO) |
| 7. Tenant scoping du SQL ajouté | PASS |
| 8. Audit de chaque mutation | PASS avec réserve (F-B8-04 INFO) |
| 9. Bornes zod | PASS avec réserve (F-B8-03) |

### 1. Maker-checker : PASS
`assignToUser` et `revokeFromUser` refusent `actor.userId === userId` avant tout accès aux données, y compris pour un groupe fixe (le contrôle précède `this.get` et le test système). `update` conserve la garde SEC-002 (pas de modification des permissions d'un rôle que l'on détient). Aucun chemin B-8 ne contourne cela.

### 2. Groupes fixes non supprimables / non renommables : PASS
`disable` refuse `systemGroup` ; `update` refuse un `name` différent et un `departmentId` truthy sur un groupe fixe ; l'index unique `roles_active_system_group_idx` et la CHECK `roles_system_group_no_department` complètent en base. `system_group` n'est ni dans `CreateRoleInput` ni dans `UpdateRoleInput` ni dans les schémas zod : un client ne peut ni marquer ni démarquer un groupe. Aucun autre appelant de `roles.disable`/`UPDATE roles` dans `backend/src`. Un rôle ordinaire ne peut pas prendre le nom d'un groupe fixe (index `roles_active_name_idx`, mais erreur 23505 donc 500 générique, voir F-B8-03).

### 3. Concurrence sur la révocation : PASS
`revokeFromUser` ouvre une transaction, verrouille la ligne `roles` (`FOR UPDATE`, filtré par `tenant_id`), compte les membres restants hors cible, puis révoque : deux révocations concurrentes sont sérialisées, la seconde voit le décompte à jour et échoue. COMMIT/ROLLBACK/release corrects. Le pré-contrôle du service est redondant (message clair) mais n'est pas la garde réelle. Vérifié : `disable` est bloqué pour les groupes fixes, donc le TOCTOU `countActiveAssignments`/`disable` ne touche pas Risk Manager.

### 4. F-B8-01 — suspension du dernier membre actif de Risk Manager : FAIL (LOW)
- **FINDING_ID** F-B8-01, **CONFIDENCE** CONFIRMED (lecture de code), **STATUS** REMEDIATION_REQUIRED.
- **Cause** : `UserService.suspend` pose seulement `users.deleted_at` ; il ne révoque pas les `user_roles`. `countActiveAssignments` (et le sous-décompte de `revokeFromUser`) compte les lignes `user_roles` non révoquées sans joindre `users.deleted_at IS NULL`. Le décompte « membres » inclut donc les comptes suspendus.
- **Deux effets** : (a) suspendre le dernier membre actif laisse le groupe « non vide » alors qu'aucun compte actif ne le porte ; (b) inversement, tant qu'un membre suspendu traîne, le dernier membre actif peut être révoqué (le groupe se retrouve sans personne d'actif et l'invariant n'a rien vu). Le lookup d'identité (`lookupMembership`, `deleted_at IS NULL`) coupe bien l'accès du compte suspendu.
- **Impact réel** : borné. Aujourd'hui les trois groupes sont créés avec `permissions = '{}'` (migration, `PostgresTenantRepository.create`, seed) : être membre n'accorde aucun droit, donc la perte de membres actifs ne retire aucune capacité de gouvernance tant que le PO n'a pas décidé des droits du groupe. Une fois des permissions attribuées, le scénario prive le tenant de l'équipe risque, mais pas de l'administration : tout porteur de `role.assign` (autre qu'une cible) peut ré-assigner le rôle et `user.reactivate` rétablit le compte suspendu. Pas de perte de données, pas d'escalade de privilèges, pas de cross-tenant. Pas de verrouillage irréversible.
- **Exploitabilité** : exige `user.delete` (admin) ; acte d'erreur ou de malveillance interne.
- **CVSS 3.1 effectif** : `AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:L` = **3,8**. Pas d'escalade HUMAN (< 7) ; à noter pour le PO car il tranche le périmètre de l'invariant.
- **Reco (A06 + A07)** : soit (i) `UserService.suspend` refuse la suspension d'un utilisateur qui est le dernier membre actif d'un groupe `RISK_MANAGER`, soit (ii) les décomptes (`countActiveAssignments` utilisé pour la garde, et le `COUNT` de `revokeFromUser`) joignent `users` avec `deleted_at IS NULL` et `suspend` applique la même vérification dans une transaction avec `FOR UPDATE` sur le rôle. Préférer (ii)+(i). **Tests de régression** : suspendre le dernier RM actif donne 400 ; RM = {actif, suspendu} puis révocation de l'actif donne 400 ; suspension concurrente de deux membres, au plus une réussit.
- **Retest** : rejouer ces trois cas plus un contournement par réactivation puis suspension croisée.

### 5. F-B8-02 — adoption d'un rôle homonyme : PASS avec réserve (INFO, CVSS 2,0)
- Les `UPDATE roles SET system_group = ... WHERE name = ...` ne modifient pas les permissions et n'accordent rien : aucune élévation de privilèges. Les droits d'un rôle adopté restent éditables via `role.update` (restreignables, hors rôle détenu par l'acteur) ; le nom est figé, le rôle n'est plus désactivable.
- Conséquence : un rôle préexistant aux droits larges portant exactement ce nom devient permanent et, pour « Risk Manager », son dernier membre non révocable. Verrouillage de gouvernance (pas de privilège) : la correction passe par un `role.update` de réduction des permissions, pas par la suppression. `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:N/A:L` = 2,0.
- Les noms sont sensibles à la casse (« risk manager » n'est pas adopté) ; l'index unique `(tenant_id, name)` actif garantit au plus un candidat par tenant, donc l'unicité de `roles_active_system_group_idx` ne fera pas échouer la migration.
- **Reco (A07/PO, avant déploiement en production)** : lister, par requête de contrôle, les rôles existants dont le nom collisionne et leurs permissions/membres, et faire valider l'adoption (ou renommer) ; documenter dans le runbook de migration. Aucune action tenant à ce jour si seule la base de dev est concernée (à confirmer par A07).

### 6. `departmentId` / IDOR : PASS
`ProcessService.create`/`update` et `RoleService.create`/`update` appellent `departments.getById(actor.tenantId, id)` (SQL `tenant_id = $1 AND id = $2 AND deleted_at IS NULL`) avant écriture ; un département d'un autre tenant, archivé ou inexistant donne 400. Fail-closed si le repository est absent (exception, aucun contournement silencieux). Unicité « un groupe par département » vérifiée dans le service et par l'index partiel. `tenantId` jamais lu du client. Réserve de défense en profondeur (INFO) : les FK `roles.department_id`/`processes.department_id` ne sont pas composites `(tenant_id, id)`, la protection repose sur le seul service.

### 7. Tenant scoping du SQL : PASS
Toutes les requêtes ajoutées filtrent `tenant_id` (`FOR UPDATE`, `COUNT`, `UPDATE user_roles`, `INSERT` processes/roles). `PostgresTenantRepository.create` insère les trois groupes dans une CTE modifiante de la même instruction (atomique, exécutée même sans référence) avec `t.id` du tenant créé. Migration : `INSERT ... SELECT FROM tenants` crée un jeu par tenant avec `NOT EXISTS` filtré par `tenant_id`. Les `UPDATE` d'adoption n'ont pas de filtre tenant par construction (migration globale), conforme. Aucun `DELETE` ajouté.

### 8. Audit : PASS avec réserve
Chaque mutation du service (`create`, `update` PERMISSION_CHANGE, `disable`, `assign`, `revoke`, process `create`/`update`) conserve son `audit.record`, `departmentId` figure dans old/newValue. **F-B8-04 (INFO)** : les trois groupes créés par la migration et par `TenantRepository.create` ne génèrent pas d'événement d'audit (écriture SQL directe) ; acceptable pour de l'amorçage, à documenter. Un échec de garde (`last member`) ne produit pas non plus d'événement de refus (cohérent avec le reste de l'app).

### 9. Bornes zod : PASS avec réserve — F-B8-03 (INFO, CVSS 0 à 2,0)
`departmentId` est `z.string().min(1).max(64).nullish()` : borné, mais pas `.uuid()`. Un id non-UUID atteint Postgres (`invalid input syntax for type uuid`) et ressort en 500 générique (pas de fuite SQL côté client attendue d'après le handler d'erreur, non rejoué). Les violations d'unicité en course (deux liens simultanés d'un même département, nom homonyme) donnent aussi un 500 (23505) au lieu d'un 400. Aucune confidentialité ni intégrité en jeu. Reco A06 : `.uuid()` ou regex, et mapper 23505 en `ValidationError`. `name`/`description` de rôle restent non bornés en longueur (pré-existant, voir S-1).

### Synthèse
- Statut Security : **B-8 acceptable à merger sous réserve de F-B8-01** (REMEDIATION_REQUIRED, LOW 3,8, A06 puis retest A10). F-B8-02/03/04 : FINDING_IDENTIFIED (INFO), à porter par A07 (contrôle pré-migration) et A06 (uuid/23505).
- Ce n'est pas un Security PASS de conformité : Compliance/Risk Manager restent propriétaires de la décision sur l'invariant « jamais vide » et sur l'attribution de permissions aux groupes.
- Items à tracker (règle 7bis) : décision PO sur le périmètre de l'invariant (membre actif vs membre assigné) ; validation de l'adoption des rôles homonymes avant déploiement.

## Retest F-B8-01 — 2026-10-11 (A10, revue statique du diff `2fb39ea..2cdf747`, tests vitest rejoués)

**Escalade HUMAN : aucune** (max CVSS 2,0). Limite : pas de base Postgres disponible, la concurrence est démontrée par analyse des verrous, non par exécution parallèle ; `RoleService`/`UserService`/`QA-B8-groups` : 72 tests verts.

### Statut : F-B8-01 CLOSED (F-B8-03 CLOSED)

SECURITY_RETEST F-B8-01 — ORIGINAL_RESULT : LOW 3,8 (suspendus comptés comme membres actifs, dans les deux sens). RESULT : RETEST_PASS.

1. **Sens « suspendre le dernier actif »** : `PostgresUserRepository.suspend` détecte l'appartenance au groupe `RISK_MANAGER` (rôle non supprimé, affectation non révoquée), compte les AUTRES membres actifs (jointure `users.deleted_at IS NULL`, même tenant) et refuse si < 1, avant l'`UPDATE`. Pré-contrôle service `assertNotLastRiskManager` (message clair) puis garde atomique en base.
2. **Sens « révoquer le dernier actif quand un suspendu traîne »** : `countActiveAssignments` et le COUNT de `revokeFromUser` joignent `users` actifs. Cas {Y actif, X suspendu} : révoquer Y refusé (autres actifs = 0). Fermé.
3. **Concurrence** : suspend et revoke prennent le même verrou `FOR UPDATE` sur l'unique ligne `roles` du groupe (index unique partiel `roles_active_system_group_idx` : une seule ligne par tenant). Le COUNT suit le verrou dans une nouvelle instruction (READ COMMITTED) et voit donc le commit concurrent. Deux suspensions simultanées de A et B (seuls membres) : la seconde attend, voit A suspendu, compte 0, refuse. Suspension + révocation : sérialisées de même. Pas de risque d'interblocage : ordre constant (ligne `roles` puis `users`/`user_roles`), `reactivate` ne verrouille pas `roles`. Cas dégradé : si une révocation concurrente a commité, la relecture de la jointure `user_roles` peut rester périmée, le COUNT exclut de toute façon l'utilisateur ciblé, donc au pire refus excessif (fail closed).
4. **Autres chemins rendant un utilisateur inactif** : `UPDATE users` n'existe que dans `update` (displayName/departmentId uniquement, donc pas de changement d'email), `suspend`, `reactivate` (réactivation seulement ajoute un membre). Aucun `DELETE`, aucune auto-provision SSO (`lookupMembership` lit `users` avec `deleted_at IS NULL`, ne crée rien, donc pas de reprise d'identité possible par ce chemin). `UserService.suspend` échoue fermé sans `RoleService` ; câblage `server.ts:294` fournit `roleService`. Le rôle groupe fixe n'est ni désactivable ni renommable (revue B-8). Reste hors périmètre applicatif : un `UPDATE` SQL direct ou la désactivation du compte côté Google Workspace (blocage d'accès sans trace en base) ; non couvert par l'invariant, à noter pour l'exploitation.
5. **Bypass tenté** : suspendre via `PUT /users/:id` avec `deletedAt` (champ non lu par le schéma ni par `buildUpdateSet`) ; assigner puis suspendre pour vider ; auto-suspension (refusée, maker-checker). Aucun ne passe.

### F-B8-03 : CLOSED
- `z.guid()` : regex 8-4-4-4-12 hexadécimale stricte, vérifiée sous zod 4.6.5 : accepte les ids de seed non RFC (`00000000-0000-0000-0000-000000000001`), rejette accolades, 32 hex sans tirets, espaces, caractères non hex, chaîne vide. Tout ce qu'il accepte est parsé par Postgres `uuid` : plus de 500 `invalid input syntax`. Suffisant ; `z.uuid()` serait plus strict mais casserait le seed. L'IDOR reste couvert par `departments.getById(actor.tenantId, …)` dans le service.
- 23505 : le mapping ne vise que `constraint === 'roles_active_department_idx'` et émet un message fixe (« This department already has a group ») : ni nom de contrainte, ni valeur, ni SQL dans la réponse. Les autres 23505 (ex. nom homonyme) sont relancés et sortent en 500 générique avec `requestId` : pas de fuite, seulement une UX moins claire (INFO).

### Nouveaux constats
- **F-B8-05 (INFO, CVSS 0)** : `revokeFromUser` (service) pré-contrôle `countActiveAssignments <= 1` sans exclure le membre ciblé : avec {Y actif, X suspendu}, révoquer X (suspendu, sans danger) est refusé ; si tous les membres sont suspendus, toute révocation est refusée. Fail closed, nuisance de gouvernance (nettoyage des suspendus impossible tant qu'un seul actif reste), contournable en réactivant X. Reco A06 (optionnelle) : ne déclencher le pré-contrôle que si la cible est un membre actif, ou laisser la seule garde atomique du repository.
- **F-B8-06 (INFO, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,0)** — effet de bord `RoleService.disable` (ACT-112) : un rôle détenu uniquement par des suspendus devient désactivable (comportement attendu : la garde ne doit plus bloquer sur des comptes inactifs). Les lignes `user_roles` restent non révoquées ; à la réactivation, `lookupMembership` et `listForUser` filtrent `roles.deleted_at IS NULL`, donc l'utilisateur revient sans les permissions de ce rôle, voire sans aucun rôle (compte actif, privilège réduit, jamais élevé ; pas de ré-activation de rôle, l'unicité du nom n'autorise qu'un nouveau rôle d'un autre id). Risque : perte silencieuse de droits et compte réactivé sans rôle (les permissions legacy `users.roles` continuent de s'appliquer, comportement antérieur). Acceptable ; reco A06/PO : à la réactivation, signaler/auditer les rôles désactivés, ou refuser `reactivate` d'un utilisateur sans rôle actif. Le groupe Risk Manager n'est pas concerné (non désactivable).

### Résumé
- F-B8-01 CLOSED, F-B8-03 CLOSED, F-B8-02 et F-B8-04 inchangés (INFO, contrôle pré-migration A07).
- Ce n'est pas un Security PASS de conformité : l'invariant (membre actif) reste une décision Risk Manager/PO.
- À tracker (7bis) : F-B8-05, F-B8-06 (A06, optionnels) ; test de concurrence sur vraie base (A08) si souhaité.

## Revue DS vague 2 — 2026-10-11 (A10, revue statique du commit `48d6107`)

**Escalade HUMAN : aucune** (max CVSS 2,1). Verdict : **PASS avec réserves LOW/INFO**. Limite : revue statique du diff, composants non rendus avec des charges hostiles ; n'est pas un Security PASS de conformité.

### Vérifications sans écart
- **Dépendances** : aucun `package.json` ni lockfile touché par le commit. Aucune nouvelle dépendance.
- **Sinks HTML** : aucun `dangerouslySetInnerHTML`, `innerHTML`, `eval` dans les fichiers du commit. Tout est rendu en nœuds texte React (échappés). Aucun `href`/`src` ajouté par la vague 2 (`Breadcrumb` et `Menu` portent un `href` d'origine antérieure : hors périmètre, à revoir quand un écran leur passera des URLs venant du backend, filtrer `javascript:`).
- **Sélection de lignes** : `rowKey` n'est écrit nulle part dans le DOM (checkbox sans `name`/`value`/`id` dérivé de la clé) ; il ne sort que par le callback `onSelectionChange`. Pas de fuite de clé interne par le composant.
- **`disabledReason` (Tabs, Button)** : rendu uniquement en texte, relié par `aria-describedby`, texte fourni par l'appelant. Pas de fuite par le composant ; règle d'usage : ne jamais y passer un message d'erreur backend brut ni l'énoncé d'une permission interne (`risk.archive` etc.).
- **Catalogue** : données explicitement factices (« Exemple », « Valeur A »), aucun secret, e-mail, token, ni donnée réelle.
- **Calcul métier** : aucun. `MatrixView` reçoit valeur/libellé/ton de l'appelant ; `VersionComparison` n'effectue aucun diff ; `Table` ne trie pas (`aria-sort` seulement) ; `BulkActionBar` n'agit pas. Le seul calcul est « tout sélectionner / indéterminé », purement d'affichage.

### Constats
- **F-DS2-01 (LOW, `AV:N/AC:H/PR:L/UI:R/S:U/C:N/I:N/A:L` = 2,1, CONFIDENCE PROBABLE)** — `VersionComparison` : les types `string | null` sont effacés à l'exécution. Un diff backend contenant un objet/tableau/nombre-objet dans `before`/`after` (ex. champ JSONB `label` d'une échelle, voir F-B9-01) fait lever à React « Objects are not valid as a React child » et démonte tout l'arbre faute d'Error Boundary : déni d'affichage de l'écran, pas de XSS. Les chaînes saisies par les utilisateurs sont, elles, correctement échappées. Reco A04/dev-frontend : au bord (hook de données), convertir en chaîne ou rejeter ; idéalement `String(v)` pour les scalaires et un libellé `(valeur complexe)` sinon ; poser une Error Boundary au niveau écran. Test de régression : `before: {a:1}` ne doit pas casser le rendu.
- **F-DS2-02 (INFO, CVSS 0)** — clés React/sélection dérivées du contenu : `VersionComparison` (`rowKey = field`) et `MatrixView` (`key = libellé` d'en-tête) supposent l'unicité. Un doublon (`field` répété) produit des lignes écrasées/dupliquées et un `selectedKeys` ambigu pour `Table`. Intégrité d'affichage seulement ; l'appelant doit passer un identifiant unique (id de ligne), ce que le catalogue fait. Reco : documenter, ou clé composée `field#index`.
- **F-DS2-03 (INFO)** — `Checkbox` : `{...rest}` est placé après `ref` ; en React 19 `ref` est une prop et un `ref` fourni par l'appelant écraserait le callback `indeterminate` (état visuel faux, pas de risque sécurité). Reco : placer `{...rest}` avant `ref`.
- **F-DS2-04 (INFO)** — contenu libre : `Table.render`, `Card.header/footer`, `Modal.children`, `BulkActionBar.children` acceptent des `ReactNode`. Sûr tant que l'appelant ne passe pas de HTML brut. Règle à garder : le DS ne doit jamais exposer de prop de type « html string ».

### Chaîne d'attaque
Texte saisi hostile (`<img onerror>`) dans un champ versionné, remonté par le diff backend : rendu en texte inerte (échappé). La seule voie observée est le plantage F-DS2-01 si le backend émet un non-string.

### Statut
F-DS2-01 REMEDIATION_REQUIRED (LOW, A04/dev-frontend, non bloquant). F-DS2-02 à F-DS2-04 INFO. À tracker (7bis) : F-DS2-01 et la revue des `href` de `Breadcrumb`/`Menu` à l'arrivée du premier écran qui leur passe des URLs dynamiques.

## Revue B-9 bis — 2026-10-11 (A10, revue statique du commit `300ff8f`)

**Escalade HUMAN : aucune** (max CVSS 2,1). Verdict : **PASS avec réserves LOW/INFO**. Limite : revue statique du diff et des fichiers liés, tests vitest non rejoués, migration 052 non appliquée ni rejouée sur une vraie base ; n'est pas un Security PASS de conformité.

### Vérifications sans écart
- **Scoping tenant** : `resolveMaxScore(ratingScales, actor.tenantId)` appelle `list(tenantId)` ; `PostgresRatingScaleRepository.list` filtre `tenant_id = $1 AND deleted_at IS NULL AND status != 'ARCHIVED'`. Le `tenantId` vient toujours de `actor`, jamais du client. Aucune échelle d'un autre tenant ne peut fixer le plafond. `activateAndArchivePrevious` garantit une seule ACTIVE par tenant, donc `.find(ACTIVE)` est déterministe. Le helper n'ouvre aucun oracle : les messages d'erreur ne divulguent que le plafond du tenant de l'appelant.
- **Zod** : `riskAppetite.routes` `threshold` borné `1..ABSOLUTE_MAX_SCORE` (36) ; `PUT /:id/thresholds` utilise `boundedArray(…, 50)` ; aucun `z.array` nu ajouté. La borne 36 route n'est qu'un garde-fou grossier : le plafond exact n² est tenu côté service.
- **Contournement route vs service** : les 4 points d'écriture d'un score plafonné (`RiskAppetiteService.setThreshold`, `ConfigService.updateCommitteeThresholds`, `RatingScaleService.updateThresholds`, `RiskEvaluationService` `appetiteOverride`) font la validation dans le service ; aucun autre chemin d'écriture n'atteint les colonnes (le `create` d'échelle n'accepte pas `criticalityThresholds`, le body zod le retire). `appetiteOverride` est borné par l'échelle CAPTURÉE de l'évaluation (`getRatingScaleOrThrow(tenantId, ratingScaleId)`), tenant-scopée. `impactLevels` est immuable après création (R-01 DRAFT), donc pas de TOCTOU sur le plafond de `updateThresholds`.
- **Permissions inchangées** : `activateVersion` reste sous `ratingscale.delete` (SEC-013), `updateThresholds` sous `ratingscale.update`, `setThreshold` sous `riskappetite.update`, comité sous `config.committeethreshold.set`. Le diff ne touche pas `permissions.ts`. `assertReadyToActivate` ajoute une garde (fail-closed) avant `activateAndArchivePrevious`, sans nouveau chemin vers l'état terminal.
- **Migration 052** : SQL dynamique entièrement composé de littéraux du `VALUES` (tables, colonnes, expressions CHECK codés en dur, aucune entrée utilisateur) ; identifiants passés par `%I`, `current_schema()` aussi ; `%s` n'est utilisé que pour l'expression CHECK constante. Aucun `DROP` sur un nom deviné : les noms viennent de `pg_constraint` (contype `c`, `conkey = {colonne}`), les CHECK multi-colonnes ne sont pas touchés. Élargissement seul (<= 25 reste valide). Pas d'injection possible. Réserves : (i) toute CHECK mono-colonne sur ces colonnes est supprimée, y compris une éventuelle contrainte métier ajoutée hors migrations (contrôle pré-prod : lister `conname` avant) ; (ii) le `.down.sql` supprime par noms canoniques (corrects, puisque posés par l'up) et n'a pas de `BEGIN` (voir recommandation `psql --single-transaction`, revue B-9).

### Constats
- **F-B9b-01 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,1, CONFIDENCE CONFIRMED par lecture du code)** — valeurs stockées non revalidées quand l'échelle active change. Un seuil d'appétence (`risk_appetites.threshold`) ou de Comité (`configs.committee_*_min_score`) posé sous une échelle 6×6 (ex. 30) reste en base si une échelle 5×5 est activée ensuite ; plus aucun score (max 25) ne le dépasse. Comparaisons : appétit `score > applied`, Comité `>=` : le contrôle ne se déclenche plus (**fail-open silencieux**, `exceeded = false`, comité non requis). Précondition : droit `ratingscale.delete` (activation) et pas de revalidation ; erreur de configuration plus vraisemblable qu'attaque. Le sens inverse (6×6 puis seuil hérité 15) est fail-closed. C'est le reste déjà signalé par A06, confirmé exploitable fonctionnellement. Reco A06 : à `activateVersion`, refuser (ou exiger un `reason` et signaler) si un seuil actif dépasse n² de la nouvelle échelle ; ou borner à l'évaluation (`min(seuil, n²)` ne suffit pas : un seuil > n² doit se lire comme « toujours dépassé » ou être bloquant). Test de régression : seuil 30 sous 6×6, activation 5×5, attendu rejet.
- **F-B9b-02 (INFO, CVSS 0)** — `UpdateCommitteeThresholdsBody` (`z.number().int()`) et `ScoreThresholdSchema.min/max` n'ont pas de borne absolue côté route (le service rejette > n²). Pas de contournement, pas de DoS (nombre scalaire). Cohérence avec la consigne « borne absolue 36 » : ajouter `.max(ABSOLUTE_MAX_SCORE)` pour le comité et les bandes (défense en profondeur, rejet 400 plutôt que 400 service identique). Idem `label` du seuil sans `.max()` (cf. F-B9-01, non traité).
- **F-B9b-03 (INFO, CVSS 0)** — plafond calculé sur `impactLevels` seul alors que le score est probabilité × impact. Vrai pour les nouvelles versions (égalité imposée), faux pour d'anciennes lignes `probability_levels != impact_levels` (legacy 1..5). Fail-closed (plafond plus bas que réel) ; à documenter ou calculer `probabilityLevels * impactLevels`.
- **F-B9b-04 (INFO)** — `resolveMaxScore` lit `list()` entier à chaque appel d'écriture (quelques lignes, tenant-scopé) : acceptable ; sans échelle ACTIVE le repli est 25, cohérent avec `resolveActiveRatingScale` (l'évaluation exige une échelle active). `DashboardService` garde des bandes 5×5 : les scores 17..36 d'une 6×6 y sont tous « Critique » (étiquette d'affichage, jamais un contrôle d'accès ; fail-closed).
- **F-B9b-05 (INFO)** — descriptifs obligatoires à l'activation : anciens brouillons sans libellés non activables (voulu, fail-closed) ; pas de contournement, `activateVersion` est le seul chemin vers ACTIVE.

### Chaîne d'attaque
Seule chaîne plausible : activation d'une échelle plus petite (`ratingscale.delete`) + seuils hérités non revalidés (F-B9b-01) = contrôle d'appétence/Comité désactivé de fait, sans trace d'alerte. Nécessite un acteur privilégié ; pas d'élévation de privilège ni d'accès inter-tenant.

### Statut
F-B9b-01 REMEDIATION_REQUIRED (LOW, A06, à arbitrer avec Risk Manager : comportement attendu des seuils lors d'un changement d'échelle). F-B9b-02..05 INFO (optionnels). Migration 052 : revue SQL PASS, à rejouer sur staging avant prod (non appliquée ici). Rien n'est clos côté risque métier, conformité ou audit.

## Revue B-8 bis — 2026-10-11 (A10, revue statique du commit `8024b39`)

**Escalade HUMAN : aucune** (max CVSS 4,9). Verdict : **PASS avec réserves** (aucun bloquant ; 2 constats MEDIUM à traiter avant la production du lot, 4 LOW). Limite : revue statique du diff, de `RoleService`, `UserService`, `ActionPlanService`, migration 051 ; vitest non rejoué ; migration non appliquée ; pas de base Postgres réelle (concurrence raisonnée, non mesurée). CVSS 3.1 estimé, à confirmer par le Risk Manager pour le risque métier.

### Vérifications sans écart
- **Contrôle d'accès des routes** : `PUT /roles/audit-group/permissions` = `rolegroup.audit.update` (service), approve/reject = `rolegroup.audit.validate` + appartenance Audit/Comité + auteur ≠ validateur. `GET /roles/grantors` est volontairement sans permission (q48). Ordre d'enregistrement Express correct (`/grantors`, `/audit-group/...` avant `/:id`), pas d'ombrage.
- **Attribution** : `requestedBy`, `decidedBy`, `grantedBy` = `actor.userId` côté service ; `reason` client est un motif, pas une attribution. Aucun champ `...By` dans les corps zod.
- **Tenant** : `getById`/`decide` de `role_permission_changes` filtrent `tenant_id` ; `roles.update(actor.tenantId, change.roleId)` ; `listWithPermission` filtre `u.tenant_id` et jointure `roles`/`user_roles` par tenant ; `listDisabledForUser` idem. Aucun tenant client.
- **Zod** : `boundedArray(PermissionEnum, ALL_PERMISSIONS.length, 1)` (pas de tableau vide : le groupe Audit ne peut pas être vidé de ses droits) ; `:id` en `z.guid()` ; `reason` `trim().min(1).max(500)` (+ revérifié au service) ; `permission` en `z.enum`. Pas de `z.array` nu.
- **Claim atomique** : `decide()` est un `UPDATE ... WHERE status='PENDING'` : deux approbations simultanées, une seule gagne (pas de double application).
- **Cumul RM+Audit, chemins nominaux** : rôle initial (`UserService.create` passe par `assignToUser`), `POST /roles/:id/assign` dans les deux sens ; `PUT /users/:id` ne modifie que le nom/département (pas de rôle) ; suspendu = toujours détenteur (bloqué). Tests B8bis couvrent les deux sens.
- **Élévation par un RM** : le groupe RM seedé ne contient ni `role.*`, ni `rolegroup.*`, ni `user.*` : un RM seul ne peut ni s'ajouter à Audit/Comité, ni se donner `rolegroup.audit.*`, ni éditer son propre groupe (SEC-002 bloque aussi l'édition d'un rôle détenu, y compris pour un admin RM).
- **Migration 051** (rien de deviné, SQL lu ligne à ligne) : exécutée dans `BEGIN/COMMIT` par le runner ; liste `audit_log_action_check` = liste de 048 + `READ` (aucune migration intermédiaire ne la modifie : seules 044, 048 la touchent) ; CHECK `notifications`/`notification_subscriptions` = liste de 025 + `MANAGEMENT` (noms par défaut `<table>_<colonne>_check`, `IF EXISTS`) ; les 3 tableaux de permissions (53, 26, 26 entrées) vérifiés par script contre `ALL_PERMISSIONS` : **aucune permission inconnue** ; `UPDATE ... WHERE permissions = '{}'` ne touche pas un groupe adopté en 049 (pas d'écrasement) ; l'`INSERT` du backfill respecte l'index partiel `user_roles_active_idx` (NOT EXISTS) ; aucune entrée utilisateur, pas de SQL dynamique ; `role_permission_changes` FK + CHECK de statut.

### Point signalé : `ActionPlanService` / `actionplan.validate`
**Formulation inexacte, mais résidu réel.** `ActionPlanService.close` exige `actionplan.validate` ET refuse `before.createdBy === actor.userId` (`ForbiddenError`, test `ActionPlanService.test.ts:771`). Le contrôle « le créateur ne clôt pas » existe. Ce qui manque : (i) le **responsable/exécutant** (`responsibleUserId`) peut clore sa propre action, (ii) l'évidence n'est contrôlée que comme existante et non supprimée dans le tenant (pas de lien avec l'action, pas d'exclusion d'une évidence téléversée par le clôturant), (iii) depuis B-8 bis tout le groupe RM détient `actionplan.validate` : un RM crée, un second RM (désigné responsable) clôt. Voir F-B8b-06.

### Constats
- **F-B8b-01 (MEDIUM, `AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:H/A:N` = 4,9, CONFIRMED par lecture)** — **Aucune limite sur les droits du groupe Audit.** `changeAuditGroupPermissions` accepte n'importe quelles permissions connues (103) : `risk.delete`, `role.assign`, `rolegroup.audit.update`... alors que q42 dit « Audit = lecture seule » et que A14 exige que toute extension d'écriture passe par le Comité. Dans la voie PENDING, un membre d'Audit peut valider l'élargissement des droits d'Audit lui-même. Même absence de garde-fou pour `rolegroup.audit.update/validate`, dont le commentaire de `permissions.ts` dit « jamais accordé à un rôle de l'équipe risque » sans que rien ne l'impose (un admin peut les mettre sur le groupe RM ou un rôle ordinaire). Scénario : admin (RM) propose Audit + `role.assign` ; un Audit valide ; les membres d'Audit gèrent les rôles. Reco A06 : liste blanche de lecture (`*.read`, `*.download`, `audit.*.read`, `rolegroup.audit.validate`) pour le groupe Audit ; refuser `rolegroup.audit.*` hors Comité/Audit-validate et hors admin ; toute permission d'écriture exige le Comité (A14). Test de régression : proposer `risk.delete` → 400.
- **F-B8b-02 (MEDIUM, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:H/A:N` = 4,4, CONFIRMED)** — **Indépendance du validateur non garantie.** `decideAuditPermissionChange` n'exige que « membre Audit ou Comité » + non-auteur. RM+Comité est autorisé (q43) : un membre RM+Comité, donc de l'équipe risque, valide le changement d'un admin RM, ce qui vide q45 (« jamais l'équipe risque ») de son sens. Il n'y a pas non plus de lecture du contenu côté Comité : le seed Comité n'a pas `audit.read`, et aucune route ne liste/détaille les changements `PENDING` ; le validateur approuve un `id` à l'aveugle (aucune notification non plus). Reco : validateur ne détenant pas RM ; route `GET /roles/permission-changes` (diff ancien/nouveau) pour détenteurs de `rolegroup.audit.validate` ; notification aux membres Audit/Comité ; motif obligatoire (q56, A14).
- **F-B8b-03 (MEDIUM, `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:L` = 4,3, CONFIRMED)** — **`GET /roles/grantors`** : (a) tout utilisateur authentifié obtient, à volonté, les noms d'affichage de tous les détenteurs de `role.assign` du tenant (la liste ne dépend pas de la permission demandée : le paramètre ne sert qu'à renvoyer vide ou non, d'où un petit oracle « un rôle actif porte-t-il cette permission ? ») ; la route ne vérifie pas que l'appelant a réellement été refusé (A14 : déclenchement par action refusée seulement, plafond de fréquence) ; (b) **chaque appel écrit une ligne `audit_log` append-only** : `authAttemptRateLimiter` ne compte pas les 2xx (`skipSuccessfulRequests`), donc aucun plafond, et un utilisateur ordinaire peut gonfler la table sans purge possible (le volume noie aussi les lignes utiles). Pas d'e-mail ni d'identifiant renvoyé : bon. Reco : limiteur dédié par utilisateur (ex. 20 par 15 min), rejet 403/liste vide si l'appelant détient déjà la permission, une ligne d'audit par (utilisateur, permission, heure) ; avis Privacy A15 sur la liste complète des admins.
- **F-B8b-04 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,7... retenu 3,4 avec I:L et AC:H sur PR:H, CONFIRMED)** — **Changements PENDING : multiples, sans péremption, application hors transaction.** (i) Aucun index unique partiel : N changements PENDING par rôle ; l'ordre d'approbation décide (« dernier approuvé gagne »), un ancien changement large peut être approuvé après un plus récent restrictif ; aucune comparaison avec l'état de base vu par l'auteur. (ii) Pas d'expiration ; un auteur suspendu ou ayant perdu `rolegroup.audit.update` voit son changement toujours applicable. (iii) `decide()` (claim) puis `roles.update` puis deux `audit.record` : trois écritures hors transaction ; si `roles.update` échoue, le changement est `APPROVED` sans être appliqué, non rejouable (statut ≠ PENDING) et non tracé comme échec ; si l'audit échoue après application, droits modifiés sans trace. Sens fail-closed pour les droits, mais perte d'intégrité de la preuve. Reco : un seul PENDING par rôle (index unique partiel `WHERE status='PENDING'`), ou invalidation des anciens à l'approbation ; transaction unique claim+update+audit (ou `UPDATE ... RETURNING` puis compensation) ; revérifier à l'approbation que l'auteur détient encore la permission ; expiration (ex. 14 jours).
- **F-B8b-05 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 3,4, CONFIRMED)** — **Cumul RM+Audit contournable en droits effectifs.** `FORBIDDEN_CUMUL` porte sur l'appartenance aux groupes fixes, pas sur les permissions. Contournements : (a) rôle ordinaire créé/édité (`role.create`/`role.update`) avec `audit.read`, `audit.mission.read`..., assigné à un RM ; ou `PATCH` du groupe Comité/RM pour y ajouter `audit.*` ; (b) course : deux `assign` concurrents (RM et Audit) par deux admins, lecture `listForUser` puis insertion sans verrou ni contrainte, passent tous deux ; (c) double appartenance antérieure à B-8 bis (groupes adoptés par nom en 049) non détectée ni signalée (A14 q58 : signaler, pas révoquer). Reco : contrôle sur les permissions effectives (aucun porteur de RM ne reçoit `audit.*` et inverse) dans `assign`, `create/update` de rôle ; verrou `FOR UPDATE` sur la ligne utilisateur ; requête de détection des cumuls existants à passer avant production.
- **F-B8b-06 (MEDIUM, `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` = 4,3, CONFIRMED par lecture + test)** — **Auto-validation résiduelle dans `ActionPlanService.close`** (détail ci-dessus). Le créateur est exclu, pas l'exécutant. Scénario : RM1 crée une action et désigne RM2 responsable ; RM2 la clôt avec une évidence quelconque du tenant. Reco A06 : refuser `actor.userId === responsibleUserId` (et, si le contrat le veut, l'auteur de l'évidence), vérifier le lien évidence-action ; décision A13/PO si un petit tenant doit pouvoir déroger (avec motif et trace, comme q60).
- **F-B8b-07 (INFO)** — Migration 051, points d'attention : (a) la bascule « Auditeur » → Audit ne laisse aucune ligne d'audit (retraits et ajouts d'appartenance via SQL) et un détenteur déjà RM perd `audit.read` sans notification ; un tenant sans groupe Audit perdrait ses Auditeurs sans remplacement (fail-closed ; 049 crée les groupes pour tous les tenants, donc cas théorique) ; (b) `.down.sql` : `UPDATE roles SET permissions='{}'` efface aussi les droits modifiés par l'admin depuis, `deleted_at=NULL WHERE name='Auditeur'` réactive aussi un ancien rôle « Auditeur » désactivé avant la migration, le `ADD CONSTRAINT` échoue s'il existe une ligne `READ` (documenté) ; (c) `role_permission_changes` sans FK composite tenant (cohérence par le code seul), sans CHECK de tableau non vide, sans index sur `role_id`. Aucun SQL dangereux.
- **F-B8b-08 (INFO)** — Constat Dev Backend « tout membre RM voit tous les risques » confirmé comme fait (pas de scoping) ; décision q66, hors périmètre de ce constat. Suspension sans motif : aucune obligation q44 pour `suspend` (écart à qualifier par A14, pas un défaut de sécurité technique). Motif absent aussi sur `PUT /audit-group/permissions` (`reason: null`, contraire à q56/A14).

### Chaînes d'attaque
1. **Affaiblissement du 3e niveau de contrôle** : admin-RM propose `Audit + role.assign` (F-B8b-01) → un collègue RM+Comité valide à l'aveugle (F-B8b-02) → les membres d'Audit gèrent les rôles. Prérequis : un admin RM et un complice Comité, deux comptes privilégiés ; effet : perte d'indépendance, non d'accès externe.
2. **Cumul par permissions** : rôle ordinaire `audit.read` sur un RM (F-B8b-05) → même personne saisit et audite ; prérequis : admin.
3. **Bruit d'audit** : boucle sur `/roles/grantors` (F-B8b-03) → table `audit_log` gonflée par un simple utilisateur.
Aucune de ces chaînes n'est exploitable sans compte déjà privilégié, hors F-B8b-03/06 (PR:L).

### Statut
F-B8b-01, 02, 03, 06 REMEDIATION_REQUIRED (MEDIUM, A06 ; arbitrage A13/A14/PO pour 01, 02, 06). F-B8b-04, 05 REMEDIATION_REQUIRED (LOW, A06 ; 05 : requête de détection des cumuls existants avant la production). F-B8b-07, 08 INFO. Migration 051 : revue SQL PASS, à rejouer sur staging ; avant production, compter les rôles adoptés en 049 dont les permissions ne sont pas `{}` et les détenteurs simultanés RM+Audit. À tracker (7bis) : F-B8b-01..06. Non rejoué sur base réelle : la concurrence de F-B8b-04/05 est raisonnée.

### Complément — exception q48 et `/roles/grantors` vs fenêtre frontend (`f739854`/`a654e8b`)
**Verdict : l'exception q48 est respectée par le frontend, TROP LARGE côté serveur** (aggrave F-B8b-03, qui reste MEDIUM 4,3, pas d'escalade). Faits : `client.ts` n'appelle le dialogue que sur un 403 `Missing permission: x` d'une requête non-GET, et la fenêtre appelle `grantors(permission)` seulement alors ; le garde-fou n'existe donc que dans le navigateur, et tout client (curl, jeton valide) appelle `/roles/grantors?permission=<n'importe laquelle des 103>`. Le serveur ne vérifie ni que l'appelant lui manque la permission, ni qu'un refus a eu lieu, ni la sensibilité de la permission (DECISION-011/q02) ; la liste renvoyée (tous les détenteurs de `role.assign`) est identique quelle que soit la permission, donc la fuite est « qui sont les admins », pas « qui détient X ». Le message 403 exposait déjà le nom de la permission : pas de nouvelle fuite de ce côté.
**Garde-fou minimal recommandé (A06, serveur)** : (1) refuser (ou renvoyer vide) si `actor` détient déjà la permission demandée ; (2) limiteur dédié par utilisateur (~20 par 15 min) ; (3) une ligne d'audit par (utilisateur, permission, heure) ; (4) liste blanche de permissions « demandables » excluant les permissions d'administration/gouvernance (`role.*`, `rolegroup.*`, `user.*`, `audit.*`) pour lesquelles le nom des admins n'apporte rien à l'utilisateur. Option plus forte : jeton de refus signé court émis par le 403 et exigé par `/grantors` (lie l'appel à un refus réel). Côté frontend : l'`regex` sur le message 403 est fragile mais sans danger (nom affiché en texte React, échappé). Avis Privacy A15 à demander.

## Revue B-8 ter + quater — 2026-10-11 (A10, revue statique de `923a7f1` et `5d4c9c7`, tête `3484b77`)

**Escalade HUMAN : aucune** (max CVSS 4,4). Verdict : **PASS avec réserves**. Les 6 findings B-8 bis sont corrigés ou réduits à un résidu LOW/INFO ; aucun bloquant. Limites : revue statique du code et des migrations 053/054 (non appliquées), vitest rejoué sur `B8ter`, `B8quater`, `B8bis` (42 tests verts), pas de base Postgres réelle (concurrence raisonnée, non mesurée). CVSS 3.1 estimé, risque métier laissé au Risk Manager. Un test vert ne vaut pas retest d'attaque : les contournements ci-dessous ont été cherchés dans le code.

### Retest des findings B-8 bis
| Finding | Résultat | Détail |
|---|---|---|
| F-B8b-01 (liste blanche Audit) | **RETEST_PASS** | `changeAuditGroupPermissions` refuse toute permission hors `.read`/`.download`/`dashboard.executive`/`rolegroup.audit.validate` ; `rolegroup.audit.update` n'est portable par aucun rôle ; `.validate` seulement par Audit et Comité ; `RoleService.update` refuse `permissions` sur le groupe Audit (endpoint dédié) ; RM et Comité ne portent pas `audit.*`. Contournement cherché : `PATCH` du groupe, création de rôle ordinaire, corps de route (pas de `systemGroup` client) : fermé. Résidu : voir F-B8t-03 (liste blanche non revérifiée à l'approbation). |
| F-B8b-02 (validateur indépendant) | **RETEST_PASS** | Validateur ayant le groupe RM refusé (`ForbiddenError`), motif obligatoire (zod + service, 500 max), `GET /roles/permission-changes` sous `rolegroup.audit.validate` avec diff avant/après, tenant-scopé, notification aux porteurs de `.validate`. Un RM+Comité ne valide plus. |
| F-B8b-03 (`/roles/grantors`) | **RETEST_PASS, résidu INFO** | Limiteur 20/15 min par (tenant, user) monté après `authMiddleware`, regex `NOT_REQUESTABLE` (`role|rolegroup|user|audit`), permission déjà détenue = liste vide, une ligne d'audit par (user, permission, heure) : le gonflement est borné (~100 lignes/h/user). Résidu F-B8t-05. |
| F-B8b-04 (PENDING multiples) | **PARTIEL** | Un seul PENDING par groupe (contrôle service + index unique `053`), compensation `reopen` si l'application échoue. Pas de transaction, pas d'expiration, auteur non revérifié : F-B8t-03/04. |
| F-B8b-05 (cumul par permissions) | **PARTIEL** | `assertNoCumul` couvre groupes + `audit.*` effectifs à l'assignation, et les règles de groupe empêchent d'ajouter `audit.*` aux groupes RM/Comité. Restent : `RoleService.update` (F-B8t-01), course sans verrou (`assignToUser` = `INSERT` nu, vérifié), `users.roles` legacy ignoré (F-B8t-02). |
| F-B8b-06 (clôture ActionPlan) | **RETEST_PASS, résidu INFO** | `responsibleUserId === actor.userId` refusé (`ForbiddenError`). Résidu : l'auteur de l'évidence et le lien évidence-action ne sont pas contrôlés ; le créateur peut désigner un responsable fantoche juste avant la clôture (limite inhérente au modèle, décision A13). |

Migration 053 : `ADD COLUMN reason` + index unique partiel `WHERE status='PENDING'`, rien de dynamique ; échoue (transaction du runner) s'il existe des doublons PENDING, `B8-predeploy-checks.sql` n°3 le détecte. Down atomique. PASS. `PostgresTenantRepository.create` : permissions des groupes passées en paramètres typés `$3..$5::text[]` depuis la constante TS, pas d'interpolation : PASS (nouveaux tenants ne naissent plus avec des groupes vides).

### Revue B-8 quater
**Sans écart** :
- `PUT /config/committee-audit-cumul` : `requirePermission(config.cumul.set)` en premier dans le service, permission dédiée absente de `config.update` ; le `PUT /config` générique n'écrit que ses champs zod explicites (pas de mass assignment vers `committeeAuditCumulAllowed`) ; corps `{allowed: boolean, reason 1..500}` ; motif revérifié après `trim` ; `updatedBy = actor.userId` ; audit old/new + motif ; tenant = `actor.tenantId`.
- Migration 054 : `ADD COLUMN ... boolean NOT NULL DEFAULT true`, un seul littéral, down atomique : PASS.
- `GET /cartography/scale` : `cartography.read` + `ratingScales.list(actor.tenantId)` : pas de fuite inter-tenant, retourne `null` sans échelle active.
- Notifications `ADMIN_RISK_MANAGER_CUMUL` / `COMMITTEE_MEMBER_ADDED` : destinataires issus de `listWithPermission(actor.tenantId, ...)` (filtre tenant, `deleted_at IS NULL`), message statique, `triggeredBy = actor.userId`, `resourceId` = id du collègue du même tenant, échec journalisé sans annuler l'action déjà auditée. Pas de fuite inter-tenant.
- `ADMIN_PERMISSIONS` (q63) : le calcul `createsAdminRiskManagerCumul` ne se déclenche que sur la transition (pas de re-demande de motif), motif obligatoire et borné, `UserService.create` passe aussi par `assertAssignable` (rôle initial couvert, `held = []` mais le rôle seul peut être admin+RM).
- Attribution : aucun champ `...By` client dans les nouveaux corps zod.
- Réglage de cumul : modifiable uniquement par un porteur de `config.cumul.set` (aucun rôle seedé ne le porte, vérifié dans le seed dev), motif et trace obligatoires, effet pour les assignations futures seulement. Défaut `true` (cumul Comité+Audit permis) : choix PO q58, fail-open assumé ; RM+Audit n'est jamais levé par ce réglage (test).

### Constats
- **F-B8t-01 (MEDIUM, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:H/A:N` = 4,4, CONFIRMED par lecture)** — **`RoleService.update` contourne q43 et q63** (le gap connu, gravité évaluée). `assertAssignable` seul porte `assertNoCumul` et le calcul q63 ; `update` ne les rejoue pas. Cas (a) : un admin ajoute `audit.read` à un rôle ordinaire déjà détenu par un RM → cumul RM+Audit effectif, règle « jamais » (q43) violée sans refus. Cas (b), plus lourd : `assertRolePermissionRules` n'interdit pas les `ADMIN_PERMISSIONS` au groupe RM (ni à un rôle détenu par un RM) ; un admin non-RM ajoute `role.assign` au groupe RM, donc **tout RM devient admin+RM** sans motif q63, sans notification Audit/Comité ; seule reste une ligne d'audit `PERMISSION_CHANGE` avec `reason: null`. Prérequis : `role.update` (admin) ; SEC-002 empêche l'auto-édition d'un rôle détenu, donc deux comptes ou un admin non-RM. Gravité : le garde-fou contourné est un contrôle de gouvernance (réserve + notification), pas une barrière d'accès, et l'admin peut obtenir l'effet par `assign` avec motif ; mais le cas (a) viole une interdiction absolue et le cas (b) élargit à toute l'équipe risque. Reco A06 : dans `update`, quand `permissions` change, pour chaque porteur actif du rôle (`listWithPermission`/assignations) rejouer `assertNoCumul` et le calcul q63 (motif + notification) ; interdire `ADMIN_PERMISSIONS` sur le groupe RM ; mutualiser dans une fonction commune. Test de régression : `update` d'un rôle détenu par un RM avec `audit.read` → 400 ; groupe RM + `role.assign` → 400.
- **F-B8t-02 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,7, CONFIRMED)** — Angle mort `users.roles` legacy et course. `isAdministrator`/`isAuditor` ne lisent que les rôles RBAC (`roles.listForUser`), alors que le résolveur d'identité unit `users.roles` (permissions legacy) ; un administrateur ou auditeur issu de ce canal n'est pas vu par q43/q63. La course (deux `assign` simultanés RM / Audit) reste ouverte : `assignToUser` = `INSERT` nu, aucun verrou ni contrainte. `isAdministrator` ignore aussi `config.cumul.set` et `rolegroup.audit.validate` (choix de définition à confirmer par A13). Reco : compter `users.roles` dans les prédicats (ou migrer les legacy vers des rôles), `FOR UPDATE` sur la ligne `users` dans l'assignation.
- **F-B8t-03 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,7, CONFIRMED par lecture)** — Approbation d'un changement PENDING sans revalidation. `decideAuditPermissionChange` applique `change.permissions` tel que stocké : (i) la liste blanche F-B8b-01 n'est pas revérifiée (un PENDING créé avant B-8 ter avec `risk.delete` serait appliqué ; `B8-predeploy-checks.sql` n°4/5 contrôlent `roles`, pas `role_permission_changes`) ; (ii) l'auteur peut avoir perdu `rolegroup.audit.update` ou être suspendu ; (iii) aucune expiration. Reco : revérifier `isAuditGroupPermission` à l'approbation, ajouter à `B8-predeploy-checks.sql` un contrôle des lignes PENDING hors liste blanche (ou les rejeter avant la production), expiration 14 jours.
- **F-B8t-04 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,7, PROBABLE)** — Compensation `reopen` incohérente. Si `roles.update` réussit puis `audit.record` échoue, `reopen` remet le changement en PENDING alors que les droits sont déjà appliqués et sans trace ; un second validateur peut alors le REJETER : statut REJECTED, droits appliqués. Si un nouveau PENDING a été créé entre-temps (le claim a libéré l'index unique), `reopen` viole l'index, l'erreur est seulement journalisée. Fenêtre étroite, sens plutôt fail-open sur l'intégrité de la preuve. Reco : transaction unique claim+update+audit dans un repository dédié (ou audit écrit avant l'application).
- **F-B8t-05 (INFO)** — `/roles/grantors` : le serveur ne vérifie toujours pas qu'un refus réel a eu lieu ; les noms des porteurs de `role.assign` restent visibles de tout utilisateur authentifié pour toute permission non administrative portée par un rôle actif (décision q48, avis Privacy A15 toujours à obtenir). Limiteur et dédoublonnage en mémoire par instance : le plafond réel est multiplié par le nombre d'instances Cloud Run, reste borné.
- **F-B8t-06 (INFO)** — Hors bornes zod : `reason` du réglage de cumul vérifié non vide mais stocké non « trimmé » ; `ADMIN_PERMISSIONS` n'inclut pas `config.manage`/`config.update` (administration de la configuration) : à confirmer par A13 que « administrateur » q63 se limite aux rôles/utilisateurs.

### Chaînes d'attaque
1. **F-B8t-01(b)** : admin non-RM → `PATCH` groupe RM + `role.assign` → les RM gèrent les rôles → l'un d'eux (via un second admin) obtient des droits sans la réserve q63. Prérequis : un compte `role.update` ; effet : érosion de la séparation, pas d'accès externe.
2. **F-B8t-01(a) + F-B8t-02** : rôle ordinaire détenu par un RM + `audit.read` ajouté par `update` → même personne saisit et audite, sans refus ni alerte.
Aucune chaîne exploitable sans compte privilégié `role.update`.

### Statut
F-B8b-01, 02, 03, 06 : RETEST_PASS (CLOSED côté sécurité, résidus INFO). F-B8b-04, 05 : RETEST_FAIL partiel, résidus portés par F-B8t-01..04 (REMEDIATION_REQUIRED : F-B8t-01 MEDIUM avant la production du lot ; F-B8t-02..04 LOW). F-B8t-05, 06 INFO. B-8 quater : PASS (config, migration 054, cartographie, notifications). À rejouer sur staging : 053 et 054, puis `B8-predeploy-checks.sql` (ajouter le contrôle des PENDING). À tracker (7bis) : F-B8t-01..04 (A06 ; F-B8t-01 et définition de « administrateur » : A13/A14).

## Retest B-8 quinquies — 2026-10-11 (A10, retest statique + vitest de `fbf96f9`, tête `dc0b9a2`)

**Escalade HUMAN : aucune** (max CVSS 2,7). Verdict : **F-B8t-01 RETEST_PASS, F-B8t-03 RETEST_PASS (résidu INFO), F-B8t-04 RETEST_PASS avec résidu LOW**. Aucun bloquant. Limites : lecture de `RoleService.ts`, `PostgresRoleRepository.ts`, `PostgresRolePermissionChangeRepository.ts`, `roles.routes.ts`, `fixedGroupPermissions.ts`, migrations 051/053 ; vitest `B8quinquies`, `B8ter`, `QA-B8quater` (106 verts) ; pas de base Postgres réelle (concurrence raisonnée). Un test vert ne vaut pas attaque : les contournements ont été cherchés dans le code. CVSS 3.1 estimé ; le risque métier reste au Risk Manager.

### Contournements cherchés (F-B8t-01)
| Scénario | Résultat |
|---|---|
| Ajout `audit.read` à un rôle ordinaire détenu par un RM | Bloqué : `assertNoCumul(resulting, others)` rejoué par porteur actif, tout-ou-rien (la boucle précède `roles.update`). |
| Ajout de `role.assign` (ou autre `ADMIN_PERMISSIONS`) au groupe RM | Plus silencieux : motif obligatoire (zod + service), notification Audit/Comité par porteur, motif tracé dans l'audit. **Non interdit** : choix q63 (cumul admin+RM permis avec réserve), pas un défaut. |
| Retrait puis ajout en deux appels | Bloqué : la détection compare à `before` à chaque appel ; le 2e appel voit `p` absent de `before`, donc rejoue. Et `previous` contient l'état courant, donc la transition est bien recalculée. |
| Édition d'un rôle non assigné puis assignation | Bloqué : `assertAssignable` rejoue `assertCumulRules` à l'assignation (le rôle peut être admin ou auditeur seul). `ConflictError` sur doublon. |
| Permission admin ajoutée au Comité / Audit | Audit : whitelist lecture seule. Comité : **aucune règle** (INFO, cf. F-B8q-02). |
| Réactivation de rôle désactivé | Pas de route d'enable, `listForUser` exclut les rôles désactivés : fermé. |
| Porteurs suspendus | `listAssignments` ne joint pas `users` : les suspendus sont rejoués (conservateur, correct au retour de `user.reactivate`). |
| Deux `PATCH` concurrents | `permissions` est un remplacement complet ; le dernier gagne, aucun cumul combiné nouveau. |
| `reason` sans besoin | Accepté, stocké `trim`, borné 500 : sans effet de sécurité. |

### Constats
- **F-B8q-01 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,7, PROBABLE par lecture)** — Course `update` / `assignToUser` sans verrou. `update` lit `listAssignments` puis écrit ; `assignToUser` lit le rôle puis `INSERT` nu. Deux administrateurs simultanés (ajout `audit.read` au rôle X pendant l'assignation de X à un RM) passent chacun leur contrôle sur un instantané périmé. Fenêtre de quelques ms, deux comptes `role.*`. Reco A06 : `SELECT ... FOR UPDATE` sur la ligne `roles` dans les deux chemins (déjà fait pour `revokeFromUser`), ou revérification après écriture. Même classe que le résidu de F-B8t-02 (course), non traité par ce lot.
- **F-B8q-02 (INFO)** — Définition « administrateur » : (i) `rolegroup.audit.update` figure dans `ADMIN_PERMISSIONS` mais `rolegroupAuditPermissionAllowedOn` interdit à tout rôle de la porter : seul le canal legacy `users.roles` peut la détenir, et `isAdministrator` ne lit que le RBAC ; l'entrée est donc inopérante et l'angle mort legacy de **F-B8t-02 reste ouvert** (non couvert par ce lot) ; (ii) les groupes Comité (validateur des droits Audit) et ordinaires peuvent recevoir des permissions d'administration sans règle de cumul admin+Comité ; (iii) l'élargissement de `ADMIN_PERMISSIONS` (`config.*`) est rétroactif sans contrôle : tout porteur existant de `config.cumul.set` + RM devient admin+RM sans motif (aucun rôle seedé ne la porte) ; ajouter au `B8-predeploy-checks.sql` la détection des doubles admin+RM existants ; (iv) l'audit du `PATCH` ne liste pas les utilisateurs touchés (reconstruction par `user_roles`, perdue après révocation). À arbitrer par A13/A14.
- **F-B8q-03 (LOW, `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N` = 2,7, PROBABLE)** — Résidu de F-B8t-04, voir ci-dessous.

### F-B8t-03 — RETEST_PASS
`approve=true` revérifie `isAuditGroupPermission` avant le claim : un PENDING hors liste blanche renvoie 400 et reste PENDING, sans claim orphelin ; il reste rejetable (le message l'indique). Contrôle 6 ajouté à `B8-predeploy-checks.sql` (SQL fixe, équivalent de la liste blanche). Non traités (reco inchangée, INFO 2,0) : auteur non revérifié (perte de `rolegroup.audit.update`, suspension), pas d'expiration, `assertKnownPermissions` non rejoué à l'approbation. Effet de bord : un PENDING hors liste blanche bloque tout nouveau changement (index unique) tant qu'il n'est pas rejeté ; fail-closed.

### F-B8t-04 — événement d'audit manquant : évaluation
Séquence actuelle : claim `decide` ; si `getById`/`update` échoue, `reopen` (rien n'est appliqué, correct) ; si l'application réussit, deux `audit.record` (Role `PERMISSION_CHANGE` avec avant/après, puis `RolePermissionChange` `APPROVE`) ; en cas d'échec d'audit : `console.error` avec changeId + requestId, erreur renvoyée, statut reste APPROVED. L'incohérence « droits appliqués, statut PENDING/REJECTED » de F-B8t-04 est fermée.
- **Ce qui est perdu** si l'audit échoue : la ligne `audit_logs` et surtout l'instantané « avant » des permissions du groupe (`roles.update` écrase, `role_permission_changes` ne garde que l'« après »). Le qui/quand/pourquoi survit dans `role_permission_changes` (`requested_by`, `reason`, `decided_by`, `decided_at`, `permissions`) et dans le log applicatif. Le client reçoit 500 et un rejeu donne « already decided » : **personne ne peut réémettre l'événement**, et rien ne signale l'écart sauf le log.
- **Exploitabilité** : l'attaquant ne contrôle pas l'échec d'insertion (reason de longueur fixe, `entity_type` sans CHECK, `action` APPROVE/REJECT/PERMISSION_CHANGE/READ dans la CHECK de 051) ; seule une panne transitoire (Neon, timeout, pool) l'induit. Un validateur indépendant malveillant ne peut pas la provoquer à volonté ; l'effet sur les droits est de toute façon celui qu'il a le droit d'approuver. Risque = perte de preuve, pas élévation.
- **Résidus** (F-B8q-03) : (a) échec ambigu — `roles.update` validé côté base mais réponse perdue (timeout réseau) : `reopen` remet PENDING alors que les droits sont appliqués, un second validateur peut REJETER (REJECTED + droits appliqués) ; (b) inverse : l'application échoue et un nouveau PENDING a été créé pendant la fenêtre (le claim libère l'index unique) : `reopen` viole l'index, erreur seulement loggée, statut APPROVED sans droits appliqués. Reco A06 (une des deux) : écrire l'audit AVANT l'application (statut intermédiaire), ou claim+update+audit dans une transaction d'un repository dédié ; requête de réconciliation « APPROVED sans ligne audit_logs correspondante » dans `B8-predeploy-checks.sql` ; alerte sur le log `audit write failed`. Aligner avec A23 (Audit & Observability) : Security Control ≠ Audit Evidence ≠ Detection.

### Chaînes d'attaque
Aucune nouvelle. F-B8q-01 + F-B8t-02 (legacy/course) exigent deux comptes privilégiés et ne donnent qu'un cumul de gouvernance, pas d'accès externe.

### Statut
F-B8t-01 RETEST_PASS (CLOSED côté sécurité). F-B8t-03 RETEST_PASS (CLOSED, résidus INFO). F-B8t-04 RETEST_PASS, résidu F-B8q-03 REMEDIATION_REQUIRED (LOW, A06). F-B8t-02 inchangé (LOW, ouvert), F-B8q-01 LOW (A06), F-B8q-02 INFO (A13/A14). À tracker (7bis) : F-B8q-01, F-B8q-03 (A06), F-B8q-02 (A13/A14). Rejouer le contrôle 6 de `B8-predeploy-checks.sql` sur staging.

## Revue B-8 sexies + EVD-2 — 2026-10-11 (A10, `7c29441` et `aed8ec1`, tête `2cf4f48`, statique + PoC mesurés hors dépôt)

**Escalade HUMAN : aucune.** Max CVSS 3.1 = 4,3 (F-EVD2-01 ; 6,5 si le conteneur est <= 512 Mo, toujours < 7). Aucun code modifié.

### Verdict
- **B-8 sexies : PASS avec résidu.** F-B8q-03 RETEST_PASS (résidu INFO). F-B8q-01 **RETEST_FAIL partiel** : le verrou ordonne l'INSERT et l'UPDATE mais ne ferme pas la fenêtre check-then-act (résidu signalé par A06 : confirmé, voir F-B8s-01).
- **EVD-2 : PASS avec réserves.** Bombe, XXE, macros, formules, lookup tenant : sans écart. Réserves : mémoire (F-EVD2-01), exposition des exemples (F-EVD2-02), absence d'audit (F-EVD2-03).

### B-8 sexies
**F-B8s-01 — LOW 2,2 (AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N), CONFIRMED par lecture, non rejoué sur Postgres.** `assignToUser` (service) appelle `assertAssignable` (lit `held` + `role`, rejoue `assertCumulRules`) AVANT `roles.assignToUser`, qui prend `FOR UPDATE` sur la seule ligne du rôle assigné. Deux fenêtres restent ouvertes :
1. deux affectations simultanées de rôles DIFFÉRENTS au même utilisateur (ex. Risk Manager et Audit) verrouillent deux lignes `roles` distinctes, lisent chacune `held` sans l'autre, passent `assertNoCumul`, puis insèrent : cumul interdit créé. L'index `user_roles_active_idx` ne couvre que le MÊME rôle (c'est le 409 q65-02, correct) ;
2. `update` (élargissement de droits) rejoue le cumul sur les titulaires lus avant son UPDATE ; une affectation concurrente du même rôle lit l'ancien rôle avant verrou : le verrou ne fait que sérialiser l'écriture, la décision a déjà été prise sur un état périmé.
Exploitabilité : deux actions privilégiées (`role.assign`/`role.update`) dans la même fenêtre, ou un double-clic ; aucun gain externe, uniquement un cumul de gouvernance (même plafond que F-B8q-01 initial, la fenêtre est réduite mais pas supprimée). Reco A06 : exécuter la vérification SOUS verrou, soit verrouiller la ligne `users` de la cible (`FOR UPDATE`, un seul verrou commun à tous les rôles) puis relire `held` et rejouer `assertCumulRules` dans la transaction du repository, soit `pg_advisory_xact_lock(hashtext(tenant||user))`. Ordre de verrous fixe (user puis role) pour éviter un deadlock avec `update`. Test de régression : deux `assignToUser` parallèles (RM + Audit) sur un vrai Postgres, un seul doit réussir. Le garde `deleted_at IS NULL` + NotFound est correct (rôle désactivé entre-temps refusé).
Points vérifiés OK : `ROLLBACK` dans le `catch` puis `release` en `finally` ; le 409 ne mappe que `user_roles_active_idx`, message fixe, sans fuite ; `COMMIT` avant la lecture de `rows[0]`, pas d'effet partiel.

**F-B8q-03 — RETEST_PASS, résidu INFO 2,0.**
- (a) échec ambigu : l'état stocké est relu et comparé en ensemble (longueur + inclusion) ; s'il égale le changement, APPROVED est conservé et l'audit est écrit. `before` a été lu avant l'UPDATE, donc l'instantané « avant » survit ; un faux positif (changement identique à l'état courant) est inoffensif (droits identiques). Si le `getById` initial lui-même échoue, `before` reste `null` et l'instantané est perdu (cas rare, INFO).
- (b) `reopen` gardé par `NOT EXISTS` autre PENDING du même rôle, `false` loggé, erreur d'origine renvoyée : plus de violation d'index. Contournement tenté : un PENDING créé pendant la fenêtre ne peut plus écraser ni être écrasé. Résidu : le changement reste APPROVED sans droits appliqués et aucun chemin API ne le rejoue (`decide` exige PENDING). Fail-closed (aucun droit élargi à tort). La requête 7 de `B8-predeploy-checks.sql` le détecte (pas de ligne `APPROVE` en audit), mais aucune alerte automatique : à brancher avec A23 sur le log `could not be reopened`.
- Requête 7 : SQL fixe, jointure sur `tenant_id`, attendue à 0 ligne ; à rejouer sur staging. Note : elle ne distingue pas « droits appliqués » de « non appliqués » ; l'opérateur doit comparer `roles.permissions`.

Statut : F-B8q-01 -> REMEDIATION_REQUIRED (F-B8s-01, A06, LOW). F-B8q-03 -> CLOSED côté sécurité, résidu INFO suivi avec A23.

### EVD-2 — `POST /api/v1/evidences/:id/analysis`
Chaîne réelle : auth -> limiteur `costlyOperationRateLimiter` (30 / 15 min, clé IP par défaut, magasin mémoire par instance) -> `requirePermission("evidence.import")` -> `getOwnedOrThrow` (`WHERE tenant_id = $1 AND id = $2`, DELETED = 404) -> contrôles mimeType / sha256 présent / `fileSize <= 5 Mo` -> **seulement alors** `storage.getContent` (plafond Drive 25 Mo) -> SHA-256 recalculé (409 si différent) -> `analyzeXlsx` (plafond 5 Mo, `assertSafeXlsxArchive`, exceljs en mémoire, 50 feuilles / 20 000 lignes / 50 colonnes).

**Passes sans écart (rejoués sur le vrai `analyzeXlsx`)**
- Lookup tenant avant Drive : PASS. Un id d'un autre tenant donne 404 avant tout appel Drive ; `driveFileId` n'est jamais pris du client.
- Bombe de décompression : PASS. Le garde lit le répertoire central, plafonne 20 Mo décompressés au total, 10 000 entrées, ratio 100 au-delà de 1 Mo, refuse Zip64, noms dupliqués, disposition ambiguë JSZip/garde, et inflate réellement chaque entrée avec `maxOutputLength = déclaré + 1` (taille déclarée mensongère détectée). PoC : feuille de 23,8 Mo décompressés -> 400 en 1 ms.
- XXE / entités : PASS. Tout `<!DOCTYPE ... ENTITY>` (interne, `SYSTEM file:///etc/passwd`, expansion imbriquée type « billion laughs ») -> 400 « workbook could not be read », en ~20 ms ; le même classeur sans DOCTYPE est lu normalement (témoin). Aucune entité externe résolue, aucun contenu de fichier local dans la réponse.
- Macros : `xl/vbaProject.bin` refusé (comparaison insensible à la casse) ; rien n'est exécuté de toute façon. Hyperliens et relations externes jamais suivis (aucun accès réseau dans le chemin).
- Formules : PASS. `toScalar` lit `result` (valeur en cache), une formule sans résultat donne `null` ; test PoC : `HYPERLINK(...)` avec `<v>42</v>` rendu `42` de type number, aucune évaluation. Limite INFO : une cellule texte commençant par `=`/`+`/`@` est renvoyée telle quelle ; sûr en JSON/React, à neutraliser si un export CSV/xlsx de ces exemples est un jour ajouté.
- Event loop : PoC, retard max mesuré 47-50 ms même sur le pire fichier (exceljs/sax cèdent la main) : pas de blocage comme le DoS zod.

**F-EVD2-01 — MEDIUM 4,3 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L ; 6,5 avec A:H si conteneur <= 512 Mo), CONFIRMED (PoC).** Les plafonds lignes/colonnes sont testés APRÈS `workbook.xlsx.load` (le plafond « avant parcours » protège le parcours, pas le chargement). Le garde d'archive laisse passer 20 Mo de XML décompressé (ratio <= 100 avec contenu non répétitif). Mesures sur la fonction réelle :
| fichier | taille | durée | mémoire |
|---|---|---|---|
| 7 000 x 50 cellules texte (18,4 Mo XML) | 1,75 Mo | 1,46 s | heap 223 Mo, RSS 367 Mo |
| 55 x 16 000 cellules vides stylées (17,4 Mo XML) | 2,28 Mo | 2,56 s | heap 310 Mo, RSS 473 Mo |
Une seule requête amplifie ~140 à 200 fois ; 2 à 4 en parallèle (le limiteur est par IP, 30 par fenêtre et par instance) dépassent un conteneur de 512 Mo -> OOM de l'instance (disponibilité de tout le tenant). Préconditions : `evidence.import` (accordé par SQL par HUMAN, donc peu de comptes) + une évidence xlsx déjà stockée (`evidence.upload`, contrôle de type = magic bytes seulement). Reco A06 : (1) plafond décompressé spécifique à l'analyse (8 Mo au total, plafond par entrée) via un paramètre de `assertSafeXlsxArchive` ; (2) sémaphore global de 1 à 2 analyses simultanées par processus (503/429 sinon) ; (3) limiteur par utilisateur en plus de l'IP. Test de régression : le fichier « sparse » ci-dessus doit être refusé en 400 ; 5 appels parallèles ne dépassent pas N analyses actives. Confirmer la mémoire du service Cloud Run/Render (A09/A16).

**F-EVD2-02 — MEDIUM 4,3 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N), CONFIRMED par lecture.** Contournement du contrôle `evidence.download` : `evidence.import` suffit à lire noms de colonnes et jusqu'à 3 valeurs distinctes x 50 colonnes x 50 feuilles (jusqu'à 7 500 valeurs de 100 caractères, pour un fichier dont le téléchargement est audité et soumis à `evidence.download`). Atténuants : `evidence.import` n'est dans aucun groupe fixe (HUMAN l'accorde), le périmètre est un seul tenant, le flux est tenant-scopé. Aggravants : aucun indicateur confidentiel n'existe, les preuves peuvent contenir des données personnelles (clients Djamo), et la lecture n'est pas auditée (F-EVD2-03). Voir la réponse (a).

**F-EVD2-03 — LOW 3,1 (AV:N/AC:L/PR:L/UI:R/S:U/C:L/I:N/A:N), CONFIRMED par lecture.** Le contenu d'une preuve est lu depuis Drive et partiellement restitué sans trace, alors que `getUrl` journalise `DOWNLOAD` avant de libérer l'URL (fail-closed). Voir la réponse (b).

**INFO** : `:id` non validé en uuid (id mal formé -> 500 générique via cast Postgres, comme les autres routes) ; `getContent` peut lire jusqu'à 25 Mo avant le refus à 5 Mo si `fileSize` est null (le cas est exclu par `fileSize !== null`, mais la valeur est celle déclarée à l'upload, pas celle de Drive : la vérification SHA-256 la rattrape) ; `fileName` renvoyé tel que stocké (React échappe).

### Réponses aux questions d'A06
**(a) Gravité et masquage : MEDIUM 4,3. Oui, masquer dès maintenant, sans attendre EVD-3.** Reco ferme : `analyze` ne renvoie des `examples` que si l'acteur détient AUSSI `evidence.download` (lecture du contenu = même niveau d'exposition que le téléchargement) ; sinon `analyzeXlsx(content, false)` (`examples: []`, déjà supporté par le code). Coût : une ligne, aucun indicateur à inventer, le flux d'import (types, en-têtes, nombre de lignes) reste utilisable. Quand EVD-3 apportera le flag, les exemples ne seront renvoyés que si `download` ET non confidentiel ; le flag restreint, il ne remplace pas la permission. Tant que le flag n'existe pas, `evidence.import` ne doit être accordé qu'à des titulaires de `evidence.download`. Test : acteur `import` seul -> `examples` vide ; `import`+`download` -> 3 exemples.
**(b) Audit : oui, requis.** Inscrire `audit.record` AVANT de renvoyer la réponse (fail-closed comme `getUrl`), `entityType: "Evidence"`, `action: "READ"` (déjà dans l'union TS et la CHECK de la migration 051, aucune migration), `newValue: { fileName, sha256, sheetCount, examplesReturned: boolean }`, jamais les valeurs ; `requestId` comme les autres. Placement : après le contrôle SHA-256 et avant l'analyse (une lecture refusée par le garde est aussi un signal à garder). « Aucune écriture » du cadrage vise les données métier, pas la piste d'audit append-only. Distinguer ainsi `DOWNLOAD` (fichier) de `READ` (contenu analysé). Test : l'audit est écrit ; si `audit.record` échoue, pas de réponse ni d'exemples.

### Chaînes d'attaque
F-EVD2-02 + F-EVD2-03 : un compte `import` lit le contenu partiel d'une preuve sans `download` et sans trace. F-EVD2-01 + limiteur par IP : OOM de l'instance depuis un seul compte privilégié. Pas de chaîne vers l'extérieur.

### Statut et tracker (7bis)
F-B8s-01 (A06, LOW) ; F-EVD2-01 (A06, MEDIUM, + A09/A16 pour la mémoire du conteneur) ; F-EVD2-02 (A06, MEDIUM, reco (a)) ; F-EVD2-03 (A06, LOW, reco (b)) : REMEDIATION_REQUIRED. Retest attendu : fichier sparse/dense 400 ou refus de concurrence, `examples` vides sans `download`, ligne `READ` en audit, deux affectations parallèles RM + Audit sur Postgres réel. Non rejoué sur une vraie base ni avec Drive réel.

### Retest EVD-2 bis — 2026-10-12 (A10, correctif `d22abf9` fusionné en `74c8993`, tête `f520794`)

**Escalade HUMAN : aucune.** Max CVSS du résidu = 3,1. Aucun code modifié. Méthode : relecture du diff, vitest (4 suites, 74 verts), PoC xlsx rejoués sur le vrai `analyzeXlsx` (fichiers générés hors dépôt, supprimés), et pour la première fois **rejeu sur un vrai Postgres 16** (instance jetable, migrations 001-054 + seed dev, supprimée après) avec les vrais `PostgresRoleRepository`/`PostgresUserRepository`/`RoleService`.

| Finding | Verdict | Résidu |
|---|---|---|
| F-B8s-01 | **RETEST_PASS** | nouveau F-EVD2b-01 LOW 2,2 (deadlock avec `suspend`) |
| F-EVD2-01 | **RETEST_PASS avec résidu** | LOW 3,1 (AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L) |
| F-EVD2-02 | **RETEST_PASS** | aucun |
| F-EVD2-03 | **RETEST_PASS** | aucun |

**F-B8s-01 — RETEST_PASS (Postgres réel).**
- Témoin (ancien comportement : contrôle hors verrou, repository sans `recheck`) : cumul RM + Audit créé **20/20**. Le harnais détecte donc bien la course.
- Correctif, `RoleService.assignToUser` RM et Audit en parallèle sur un utilisateur neuf : cumul **0/50**, 50 refus « Risk Manager + Audit » (le verrou `users` sérialise les deux rôles différents).
- `update` élargissant un rôle C à `audit.read` en parallèle de `assignToUser(C -> titulaire RM)` : cumul **0/40** sur deux exécutions ; soit l'affectation lit les droits élargis sous verrou et est refusée, soit `update` voit le nouveau titulaire et lève le 409 « retry ». Le rejeu se fait sur la ligne `roles` relue `FOR UPDATE` (READ COMMITTED relit la dernière version) : pas d'état périmé.
- Utilisateur suspendu : `assignToUser` -> `NotFoundError("User")` (404), vérifié en base. Comportement correct (aucun droit attribué à un compte suspendu) ; `revokeFromUser` ne filtre pas sur l'utilisateur, le nettoyage des rôles d'un suspendu reste possible. Message limité à l'id fourni par l'admin, tenant-scopé : pas d'énumération.
- Ordre des verrous : `assignToUser` users -> roles ; `updateUnderLock` users triés par id -> roles ; `revokeFromUser` roles seul (aucun cycle possible, rejoué : revoke || assign même rôle, sans erreur) ; chemins `roles.update` sans `recheck` (groupe Audit, application d'un changement approuvé) : une seule instruction, aucun cycle. Pas de deadlock entre ces chemins. **Exception : `PostgresUserRepository.suspend`** (voir F-EVD2b-01).
- `rollbackQuietly` : une erreur de ROLLBACK ne masque plus l'erreur d'origine (OK). INFO : dans `updateUnderLock`, un titulaire révoqué entre les deux lectures reste évalué (refus éventuel à tort, fail-closed) et peut être notifié comme cumul q63 à tort.

**F-EVD2-01 — RETEST_PASS avec résidu LOW 3,1.**
| fichier PoC | XML décompressé | résultat | durée | pic RSS (base ~100 Mo) | retard event loop |
|---|---|---|---|---|---|
| dense 7 000 x 50 (PoC d'origine) | 19,5 Mo | **400** « decompressed size exceeds » | 4 ms | 107 Mo | 0 |
| sparse 55 x 16 000 (PoC d'origine) | 17,4 Mo | **400** | 5 ms | 103 Mo | 0 |
| dense sous plafond (6,2 + 1,9 Mo) | 8,1 Mo | 200 | 0,9 s | 209 Mo | 325 ms |
| sparse sous plafond | 7,7 Mo | 200 | 1,3 s | 281 Mo | 395 ms |
| cellules sans `r`, entropie juste au-dessus du ratio 100 | 8,1 Mo | 400 après chargement | 1,5 s | 345 Mo | ~1 s |
| idem x 2 en parallèle (= sémaphore) | | | 1,8 s | **362 Mo** | 1,05 s |
| idem x 3 en parallèle (hors sémaphore, témoin) | | | 3,7 s | 828 Mo | 2,4 s |
Plafond 8 Mo / 6 Mo par entrée appliqué avant `xlsx.load` (OK) ; sémaphore : test de la limite et `activeAnalyses++` synchrones (aucun `await` entre les deux, pas de course), `--` dans `finally` couvrant Drive, SHA, audit et analyse : **pas de fuite sur exception** (vérifié aussi par le test 409 puis libération). Les refus avant le `++` (permission, lookup, taille) ne prennent pas de place. `perUserRateLimiter` (20 / 15 min, clé `tenant:user`) monté après `authMiddleware` : clé jamais anonyme. Résidu : (1) chaque analyse sous plafond bloque encore l'event loop jusqu'à ~1 s (GC + sax), mesure plus haute que la revue précédente (47-50 ms, autre forme de fichier) ; un compte `evidence.import` dégrade donc la latence de toute l'instance par à-coups, borné par les limiteurs ; (2) pic ~360 Mo par processus : tient dans 512 Mo mais sans marge, confirmer la mémoire du conteneur (A09/A16, déjà au tracker) ; (3) INFO : aucun délai maximal sur `analyzeXlsx` ; un chargement exceljs qui ne se terminerait jamais garderait sa place et 2 cas suffiraient à rendre l'analyse indisponible jusqu'au redémarrage (SUSPECTED, non reproduit) ; 409 au lieu de 429/503 pour la saturation (sémantique). Reco non bloquante A06 : `Promise.race` avec délai (ex. 15 s) qui libère la place.

**F-EVD2-02 — RETEST_PASS.** `withExamples = actor.roles.includes("evidence.download")`, même source que `requirePermission` de `getUrl` ; `analyzeXlsx` n'a qu'un appelant. Test : `import` seul -> `examples` vides ; `import`+`download` -> exemples. Pas de contournement trouvé.

**F-EVD2-03 — RETEST_PASS.** `audit.record` `READ` après le contrôle SHA-256 et avant l'analyse, `await` sans `catch` (fail-closed : pas d'analyse ni de réponse si l'écriture échoue, testé) ; `newValue` = `fileName`, `sha256`, `examplesReturned`, jamais de valeurs de cellules ; `requestId` transmis par la route. Insertion `READ` acceptée par le vrai schéma (CHECK de la migration 051). `sheetCount` absent (connu seulement après l'analyse) : acceptable.

**F-EVD2b-01 — LOW 2,2 (AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:N/A:L), CONFIRMED (Postgres réel, entrelacement forcé).** `PostgresUserRepository.suspend` verrouille la ligne `roles` du groupe RM (`FOR UPDATE OF r`) PUIS met à jour `users` ; `updateUnderLock` (et `assignToUser`) verrouillent `users` PUIS `roles`. `suspend(U)` en parallèle de `roles.update(RM, élargissement)` avec U titulaire : **deadlock 3/3**, Postgres annule `suspend` (40P01) après ~1 s, `update` réussit. Même cycle possible avec `assignToUser(U, RM)` si U est déjà RM (qui aurait fini en 409). Impact : une action d'administration échoue (500 générique, aucune correspondance de 40P01), à rejouer ; aucun droit ni état incohérent (rollback complet). Fenêtre naturelle étroite (deux actions privilégiées simultanées). Reco A06 : dans `suspend`, verrouiller d'abord `users` (`SELECT ... FOR UPDATE` sur U) puis la ligne du groupe RM, pour respecter l'ordre users -> roles posé par F-B8s-01 ; optionnel : mapper 40P01 en 409 « retry ». Test de régression : `suspend(U)` || `update(RM)` sur Postgres, aucune 40P01.

### Statut et tracker (7bis)
F-B8s-01, F-EVD2-02, F-EVD2-03 : **CLOSED** côté sécurité. F-EVD2-01 : **CLOSED avec résidu LOW** (délai maximal d'analyse recommandé, mémoire conteneur A09/A16). Nouveau : F-EVD2b-01 (A06, LOW) REMEDIATION_REQUIRED. Limite : Drive réel non rejoué.

## Revue centre de notifications — 2026-10-12 (A10, `20e703d` backend + `de605e4` frontend, tête `e1765ec`, statique + vitest 7 verts)

**Escalade HUMAN : aucune.** Max CVSS 3.1 = 5,4 (F-NOTIF-01). Aucun code modifié.

### Verdict
**PASS avec réserves.** Isolation tenant/utilisateur, types obligatoires, attribution, rendu frontend : sans écart. Réserves : inondation sans plafond (F-NOTIF-01), types d'escalade désactivables par leurs destinataires (F-NOTIF-02), contenu KRI visible sans `kri.read` (F-NOTIF-03).

### Points vérifiés sans écart
- **IDOR / isolation** : `GET /notifications`, `/unread-count`, `POST /read-all`, `PATCH /:id/read` passent tous `actor.tenantId` + `actor.userId` (jamais un id client). `user_id` autre que `me`/soi = 400. `markAsRead` : lookup tenant-scopé, puis destinataire différent = même 404 qu'inexistant (pas d'oracle), et l'UPDATE refiltre `tenant_id AND id AND recipient_user_id`. `read-all` : `WHERE tenant_id AND recipient_user_id AND read_at IS NULL`. SQL paramétré partout (filtres `resourceType` enum zod, `eventType` lié en paramètre).
- **Types obligatoires** : les 4 types `MANAGEMENT` sont émis par `UserService`/`RoleService` via `record()` (pas `emit()`), qui ne lit jamais les abonnements : aucun opt-out stocké, quelle que soit sa forme, ne peut les supprimer. `emit()` (`NotificationService.ts:178`) ne consulte l'abonnement que pour un type non obligatoire. Tentatives : casse différente (`rights_lost_on_reactivation`, accepté et stocké mais sans effet, recherche exacte), `resourceType` différent (`RISK` + `RIGHTS_LOST_ON_REACTIVATION`, stocké, sans effet), type inconnu (stocké, sans effet), autre route : seul `PostgresNotificationSubscriptionRepository` écrit `notification_subscriptions`, seule route `POST /notification-subscriptions` (scopée à l'acteur, zod retire tout champ `userId`). Aucun contournement.
- **Attribution** : `triggeredBy = actor.userId` et destinataire dérivé côté serveur (`action.responsibleUserId`, `risk.ownerId/superiorOwnerId` lus tenant-scopés) aux deux nouveaux points d'appel ; aucun champ `...By` exposé.
- **boundedArray** : aucune entrée tableau dans ces routes. Sans objet.
- **Frontend** : `message`, titres et libellés rendus en texte React (aucun `dangerouslySetInnerHTML`, aucun `href` issu du backend) ; la navigation passe par une table fixe `resourceType -> vue`, aucune URL ni id client utilisé ; `encodeURIComponent` sur l'id. Pas de XSS ni de lien externe.

### Findings
**F-NOTIF-01 — MEDIUM 5,4 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L), CONFIRMED par lecture.** Inondation de la boîte d'un tiers. `POST /action-plans/:id/escalate` (`ActionPlanService.ts:324`, persistance `:353`) crée une notification `ACTION_OVERDUE` + une ligne d'audit à CHAQUE appel tant que l'action est en retard, sans déduplication ni limiteur (le seul limiteur global, `authAttemptRateLimiter`, ne compte que les échecs d'authentification). Même chose pour `KriMeasureService.record` (`:90`, `:97-103`) : chaque mesure au-delà du seuil persiste une notification au propriétaire ET au propriétaire supérieur du risque (et une mesure append-only qui pollue l'historique KRI). Préconditions : `actionplan.update` ou `kri.create`. Impact : boîte et compteur du destinataire noyés (alertes légitimes enfouies, `limit` 50 côté frontend), croissance non bornée de `notifications`/`audit_logs`. Le destinataire ne peut s'en protéger qu'en se désabonnant, ce qui supprime aussi les vraies alertes (voir F-NOTIF-02). Correctif attendu (A06) : déduplication par `(tenant, destinataire, resourceType, resourceId, eventType)` sur une fenêtre (ex. une `ACTION_OVERDUE` non lue existante = pas de nouvelle ligne ; une par jour au plus), et limiteur par utilisateur sur `/escalate`. Test de régression : 2 escalades successives = 1 notification.

**F-NOTIF-02 — LOW 3,1 (AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N), CONFIRMED par lecture, arbitrage PO/A13.** `ACTION_OVERDUE` et `KRI_THRESHOLD_BREACH` sont `mandatory: false` (`notificationCatalog.ts:20-21`) : le responsable d'une action en retard, et les deux propriétaires d'un risque dont le KRI franchit le seuil, peuvent désactiver l'alerte qui les concerne. L'escalade `ACTION_OVERDUE` n'est adressée qu'au responsable lui-même (supérieur non câblé, `ActionPlanService.ts:116`) : s'il se désabonne, l'escalade in-app n'atteint plus personne. Le canal `Notifier` externe reste émis (atténuation partielle). Correctif attendu : décision PO/A13 sur le caractère obligatoire de ces deux types (au moins pour le supérieur hiérarchique), ou câbler un destinataire de contrôle non désabonnable.

**F-NOTIF-03 — LOW 3,1 (AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N), CONFIRMED par lecture.** Le message KRI (`KriMeasureService.ts:90`) contient le libellé et la valeur mesurée ; il est lisible avec la seule permission `notification.read` (dans `BASE_PERMISSIONS`), sans `kri.read` ni `risk.read`. Un propriétaire (ou supérieur) de risque qui n'a pas ces permissions lit des données KRI hors de ses droits ; la notification persiste aussi après réassignation du risque ou retrait du rôle. Même classe, plus faible, pour `ACTION_PLAN` (titre + échéance, destinataire = responsable). Correctif attendu : message minimal (« Seuil KRI dépassé », sans libellé ni valeur ; le détail se lit dans le module sous ses propres permissions), ou n'émettre qu'aux destinataires détenant `kri.read`.

**INFO**
- F-NOTIF-04 : `subscribe` accepte tout `eventType` (<= 100 caractères) et toute casse, hors catalogue : lignes mortes sans effet + une ligne d'audit chacune, non bornées par utilisateur (impact équivalent à tout endpoint d'écriture authentifié). Fragilité latente : si `emit` normalisait un jour la casse ou si la colonne passait en collation insensible, un opt-out stocké en minuscules deviendrait actif. Reco : valider `(resourceType, eventType)` contre `NOTIFICATION_CATALOG` à l'abonnement, `.max(100)` dans le zod.
- F-NOTIF-05 : `PATCH /notifications/:id/read` sans `.uuid()` : id mal formé -> 500 générique (cast Postgres), sans fuite. `eventType` en filtre de liste sans `.max()` (paramétré).
- F-NOTIF-06 : notifications KRI émises aussi pour un risque archivé (`getById` sans filtre de statut) ; sans impact sécurité.

### Chaînes d'attaque
F-NOTIF-01 + F-NOTIF-02 : un compte `actionplan.update` noie la boîte du responsable, qui se désabonne ; les vraies escalades suivantes ne sont plus persistées. Gouvernance dégradée, pas d'accès externe ni d'élévation.

### Statut et tracker (7bis)
F-NOTIF-01, F-NOTIF-03 (A06) : REMEDIATION_REQUIRED. F-NOTIF-02 : décision PO/A13 (owner HUMAN). INFO : à A06 au prochain passage. Retest attendu : double escalade = 1 notification, message KRI sans libellé/valeur ou destinataire filtré, abonnement hors catalogue = 400.
