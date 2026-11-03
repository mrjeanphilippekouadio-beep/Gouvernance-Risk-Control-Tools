# Revue Sécurité A10 — lot V4 visibilité des ressources : cas de l'administrateur (2026-11-03)

- Cible : `git diff origin/staging...origin/feat/r1-visibility-v4` (HEAD `a1bcbe6`), 26 fichiers.
- Références : DECISION-103 (q197 A3, q200), DECISION-104 (q202), spec `RM-V1-Visibilite-Ressources-spec.md` §4, SEC-rights-lines-2026-10-28 (SEC-RL-04/05), SEC-visibility-v3.
- Méthode : analyse statique, `npx vitest run` de `visibility-v4`, `visibility-v3`, `q200-sensitive-view`, `QA-visibility-v3`, `QA-visibility-v2bis` (34 verts, 74 ignorés : suites PostgreSQL sans base). PoC SQL sur un PostgreSQL 16 local jetable (migrations 001 → 084 appliquées, puis down 084 et re-up). Aucun accès Neon. Aucun code de production modifié.

**Escalade HUMAN : aucune** (CVSS maximal 4,3). **Verdict : ORANGE.** Le circuit est solide pour l'élévation directe : pas d'auto-attribution, pas de pose sur un rôle, confirmation par un tiers non administrateur, rejeu d'une demande expirée refusé, SQL cohérent avec le TS, `search_path` pinné partout. Un constat MEDIUM reste ouvert (V4-01 : une attribution neutralisée ressuscite sans nouvelle confirmation). La correction est simple et doit passer avant la livraison en production.

## 1. Élévation de privilège

| Vecteur | Résultat | Détail |
|---|---|---|
| S'auto-attribuer | **PASS** | Service : `canonicalId(userId) === canonicalId(actor.userId)` → 403, insensible à la casse (SEC-ID-01). Base : `svg_not_for_self_check` (`requested_by <> user_id`), prouvé par le PoC. |
| Contourner la confirmation | **PASS** | Le trigger 084 n'accepte qu'un INSERT `PENDING` sans décision. `decide` exige `rolegroup.audit.validate`, un siège réel au Comité ou à l'Audit (`fixedGroupsOf`, jamais la permission seule), pas de siège RM. Il refuse l'auteur et le bénéficiaire (service + `svg_maker_checker_check`) et, pour `RESOURCE_READALL`, tout administrateur par rôle (q202). Il revérifie le bénéficiaire à l'approbation. Réserve : V4-02, l'administrateur reconnu par une permission directe. |
| `resource.readall` sur un rôle | **PASS** | `assertRolePermissionRules` refuse en création et en modification. `governance-rights` ne bouge que les 4 droits de décision. Le circuit Audit est limité à la liste blanche (`.read`, `.download`… : `resource.readall` n'y entre pas). Surtout, le SQL ne lit **jamais** la permission : PoC, un rôle portant `resource.readall` donne `visibility_sees_everything = false`. |
| Permission directe (`users.roles`) | **PASS (inerte)** | Aucun écrivain applicatif de `users.roles`. Si la chaîne y figurait (bootstrap ou seed), `filterKnownPermissions` la garderait dans `actor.roles`, mais aucun code ne teste `actor.roles.includes("resource.readall")` et le SQL l'ignore. PoC : `false`. INFO-03 : elle remonterait dans `/users/me/permissions` (affichage seulement). |
| Rejouer une demande expirée | **PASS** | `decide` revérifie `expires_at > now()` dans l'UPDATE (même transaction). Une demande PENDING expirée du même `kind` est retirée (REVOKED, auditée) avant la nouvelle. `expires_at` est immuable (trigger). |
| Changer le type d'une attribution | **PASS** | `kind` rejoint le contenu immuable du trigger (PoC : UPDATE `kind` → 42501). `svg_kind_check` refuse une valeur inconnue (PoC). |
| Injection | **PASS** | `revokeLiveOf` interpole `kind` dans le SQL, mais par un ternaire sur deux littéraux, jamais par le texte du client. `kind` est validé par `z.enum`, et `.strict()` est maintenu sur le corps. |

## 2. Cohérence SQL `visibility_sees_everything` / TS : PASS

- `visibility_is_administrator` reprend `ADMIN_PERMISSIONS` à l'identique (15 chaînes, vérifié à la main, et le test `visibility-v4` compare les deux listes). Il lit les rôles actifs (`revoked_at IS NULL`, `deleted_at IS NULL`, jointure sur `tenant_id`), comme `ROLES_OF_USER_SQL` côté TS (`isAdministrator(roles)`).
- Effet SQL = attribution `APPROVED` + `kind = RESOURCE_READALL` + compte actif + toujours administrateur par rôle. TS (`holdsReadallGrant`) suit la même règle. Le cas du compte suspendu est traité en amont par `getEffectivePermissions` → `[]`.
- Les 5 fonctions `*_visible_to` passent toutes par `visibility_sees_everything` (082 réécrite en 084 ; 083 le faisait déjà). `hiddenCounts` et `listRestricted` utilisent la même fonction.
- Écart sans risque : `VisibilityResolver` (TS) ne met `all: true` que pour les 3 groupes fixes. Le titulaire de `resource.readall` lit donc avec `{ all: false, userId }`, et chaque ligne est décidée par les fonctions SQL, qui l'admettent. Le résultat de lecture est identique. Côté création (`assertCreation`, `creatorWouldSee`), il n'est pas « voit tout », donc plus strict (échec fermé, INFO-04 fonctionnel).
- PoC (tenant T1, admin X, Comité C) : avant approbation `f` ; approuvée `t` ; autre tenant `f` ; rôle sans droit d'admin `f` ; rôle supprimé `f` ; compte suspendu `f`.

## 3. Migration 084 : PASS

- Les 4 fonctions redéfinies (`sensitive_view_grants_guard`, `visibility_is_administrator`, `visibility_sees_everything`, `risk_visible_to`) portent `SET search_path = pg_catalog, public, pg_temp`, répété par `ALTER FUNCTION`. Vérifié dans `pg_proc.proconfig` : aucune n'est `SECURITY DEFINER`.
- Tenant : chaque jointure filtre `tenant_id` (attributions ↔ users, user_roles ↔ roles). PoC : autre tenant → `false`.
- Idempotente : 084 rejouée deux fois sans erreur. Aucune suppression. Garde DELETE intacte (PoC : 42501).
- **Down** : il restaure 079, 082 et 083 avec le `search_path` pinné, puis supprime `visibility_is_administrator`. Il refuse dès qu'une ligne `RESOURCE_READALL` existe, quel que soit son statut (PoC : refus et COMMIT non atteint, colonne conservée). Sur un clone sans ces lignes : COMMIT, fonctions restaurées, re-up OK. Ce refus est voulu (sinon une attribution deviendrait une vue q200), mais il rend le down inutilisable dès la première demande (INFO-05, à documenter dans le runbook).

## 4. Fuite de contenu en A1 (`GET /restricted-resources`) : PASS

- Sans `resource.readall`, un administrateur reçoit `type`, `id`, `visibility`, `accessCount` et `updatedAt`. Le `label` est lu en base mais retiré avant la réponse. Ni `lastChange`, ni motif, ni auteur. Lecture limitée au tenant de l'acteur, pagination bornée (500).
- Un non-administrateur reçoit toujours 403 (inchangé). L'`id` ne donne rien de plus : toute route par id répond comme pour un id inconnu (V1-04, V3). Seul reste l'oracle V3-02 déjà posé au PO (q215/q216).
- `updatedAt` n'est pas dans la liste de la spec A1 (« niveau, nombre d'ayants droit, identifiants »). C'est une métadonnée d'activité sans contenu (INFO-06 : le PO valide ou retire).
- q215 : l'aperçu du motif à 140 caractères n'est servi qu'aux groupes qui voient tout. PASS.

## Constats

### V4-01 — Une attribution `resource.readall` neutralisée reste APPROVED et ressuscite sans nouvelle confirmation (MEDIUM, CVSS 4,3 `AV:N/AC:H/PR:H/UI:N/S:U/C:H/I:N/A:N`, CONFIRMED, PoC SQL)

- **Constat** : la fin définitive (calque SEC-RL-05) n'existe que dans `revokeAssignment` (retrait d'un rôle du compte) et dans `UserService.suspend`. Si le compte cesse d'être administrateur autrement, l'effet s'éteint mais la ligne reste `APPROVED` : c'est le cas quand `PATCH /roles/:id` retire les droits d'administration d'un rôle qu'il détient, ou en cas d'échec de l'appel `endSensitiveView`, qui suit la révocation hors transaction. Le droit reprend effet dès que le compte redevient administrateur.
- **Preuve (PoC)** : approuvée → `t` ; `UPDATE roles SET permissions='{risk.read}'` → `f`, statut toujours `APPROVED` ; `permissions='{risk.read,config.manage}'` → `t`, sans nouvelle demande ni confirmation.
- **Scénario** : X a été confirmé une fois. Un administrateur retire les droits d'admin du rôle de X : le Comité considère l'accès éteint. Plus tard, un second administrateur (pas X : la garde « pas sur son propre rôle » s'applique) remet un droit d'admin sur ce rôle ou en affecte un nouveau. X relit tous les contenus NOMINATIF et PERIMETRE sans que le Comité ou l'Audit ait reconfirmé. Rien n'est caché, mais la confirmation par un tiers (q200/q202) est contournée pour la remise en vigueur.
- **Correctif attendu (A06)** : oui, une fin définitive. À chaque écriture qui peut faire perdre la qualité d'administrateur (`RoleService.update` quand `permissions` change, pour chaque titulaire actif du rôle qui n'est plus administrateur après la modification ; tout futur chemin de désactivation d'un rôle détenu), appeler `endSensitiveView(..., "RESOURCE_READALL")`, idéalement dans la même transaction que l'écriture du rôle (`runAudited`). À défaut, juste après, avec un échec qui fait échouer la requête. Garder le filtre SQL `visibility_is_administrator` en défense en profondeur. Test de régression : rôle sans droits d'admin → attribution `REVOKED` ; droits remis → `visibility_sees_everything = false` et nouvelle demande requise.
- Même trou, hérité, sur `ROLE_READ_SENSITIVE` : non concerné, le groupe RM est fixe et ne se « désadministre » pas.

### V4-02 — La règle q202 « jamais un administrateur » ignore l'administrateur par permission directe (LOW, CVSS 2,2 `AV:N/AC:H/PR:H/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED par lecture, chemin déterministe)

- `decideSensitiveView` teste `isAdministrator(await this.roles.listForUser(...))`, donc les rôles seuls. Un compte administrateur par `users.roles` (bootstrap, typique d'une TPE) et assis au Comité ou à l'Audit peut confirmer une attribution `RESOURCE_READALL` demandée par un autre administrateur. q202 est alors violée. Il n'y a pas d'auto-attribution : le confirmateur ne peut être ni auteur ni bénéficiaire. Il faut aussi le siège au Comité ou à l'Audit, qu'aucun administrateur ne s'attribue seul.
- **Correctif attendu (A06)** : pour une règle d'**exclusion**, prendre la définition la plus large : `isAdministrator(roles) || actor.roles.some((p) => ADMIN_PERMISSIONS.includes(p))`. Test : confirmateur au Comité avec `role.assign` en direct → 403.

### INFO

- **INFO-01 (HUMAN)** : seul un administrateur (`role.assign`) peut révoquer une attribution `RESOURCE_READALL`. Le Comité ou l'Audit qui l'a confirmée ne peut pas y mettre fin. Proposé : ouvrir la révocation (resserrement) aux détenteurs de `rolegroup.audit.validate`.
- **INFO-02 (HUMAN)** : une attribution `APPROVED` n'a pas de durée ni de recertification. Pour un droit « tout lire », proposer une échéance figée à l'approbation (leçon F-SAD-02) ou une revue périodique.
- **INFO-03** : `resource.readall` présent dans `users.roles` remonterait dans `/users/me/permissions` sans effet serveur. Écarter ce droit individuel des sources directes dans `lookupMembership` et `getEffectivePermissions` (aucun écrivain aujourd’hui : défense en profondeur).
- **INFO-04** : le titulaire de `resource.readall` n'est pas « voit tout » pour la création restreinte (`VisibilityResolver`). Échec fermé : cohérent avec un droit de lecture, à confirmer côté produit.
- **INFO-05** : le down 084 est bloqué dès qu'une ligne `RESOURCE_READALL` existe (y compris REJECTED ou REVOKED). C'est voulu, à documenter.
- **INFO-06** : `updatedAt` est servi en A1 alors que la spec ne le cite pas.
- **INFO-07** : l'index `svg_live_idx` (une attribution vivante par compte, tous `kind` confondus) peut bloquer en 409 une demande de l'autre type si un administrateur `RESOURCE_READALL` entre ensuite au groupe RM. C'est fonctionnel, sans gain d'accès (PoC : clé dupliquée). `readallCandidates` fait une requête par utilisateur (N+1, borné par la taille du tenant).

## Avis sur les deux points du développeur

1. **Rôle qui perd ses droits d'administration ou désactivé** : **oui, une fin définitive est exigée**, comme pour SEC-RL-05. C'est V4-01 (MEDIUM 4,3), à corriger avant la production. La neutralisation SQL est une défense en profondeur, pas un mécanisme de fin : elle laisse un état `APPROVED` trompeur et une reprise d'effet sans tiers. Note : `RoleService.disable` refuse un rôle encore détenu, donc la désactivation n'est pas un chemin aujourd'hui. Le chemin réel est `PATCH /roles/:id`.
2. **Administrateur par permission directe et métadonnées A1** : **acceptable** (INFO, CVSS 0). A1 ne sert aucun contenu. `users.roles` n'a aucun écrivain applicatif. La matrice des droits classe déjà ces comptes parmi les administrateurs (droits directs inclus). Et l'octroi de `resource.readall` reste fermé pour eux, puisque le SQL ne reconnaît que les rôles. Règle à retenir : **les règles d'exclusion et de vue minimale prennent la définition la plus large de l'administrateur, les règles d'octroi la plus étroite**. Appliquer la même règle à la confirmation q202 conduit à V4-02.

## Statut

| Constat | Sévérité | Owner | Statut |
|---|---|---|---|
| V4-01 | MEDIUM 4,3 | A06 | REMEDIATION_REQUIRED (avant production), retest A10 |
| V4-02 | LOW 2,2 | A06 | REMEDIATION_REQUIRED |
| INFO-01, INFO-02 | INFO | HUMAN | REVIEW_REQUIRED (à porter dans ACTION_ITEMS) |
| INFO-03 à INFO-07 | INFO | A06 / PO | Ouverts |
