# Revue Sécurité (A10) : matrice des droits par ligne de défense + circuit q200

- Périmètre : `git diff origin/staging...feat/r1-rights-lines` (HEAD `558fe68`), DECISION-098/101 (masquage), DECISION-103 (q200, migration 079).
- Méthode : analyse statique (routes, service, repository, migration, front) + `npx vitest run` sur les 11 fichiers touchés ou liés (204 verts, 9 ignorés `-pg`). Aucun accès Neon. Aucun code de production modifié.
- **Escalade HUMAN : aucune** (max CVSS 4,3).
- Verdict : **VERT avec réserves**. Le circuit q200 et la migration 079 tiennent. Le masquage, en revanche, se reconstruit par différence : il cache la composition des rôles Audit et administrateurs, mais pas qui en est membre (SEC-RL-01).

## PASS

- Classement fait côté serveur (`roleLine`/`accountLine`, ADMIN > AUDIT > LINE_2 > LINE_1). Il couvre aussi les droits directs `users.roles`. Le classement du lecteur (`restrictedReader`) lit `actor.roles`, issu du résolveur, puis le groupe Audit et la vérification de la grant. En échec fermé : sans repository, le lecteur reste restreint.
- `GET /roles`, `/roles?includeDisabled`, `/roles/matrix` et `/roles/accounts` sont filtrés. `GET /roles/:id` renvoie le même 404 pour un id inexistant et pour un rôle masqué. `/users/:userId/permissions` et `/permission-sources` donnent un 404 identique pour un compte inexistant et pour un compte masqué, y compris s'il est suspendu (le contrôle de visibilité passe avant le contrôle de suspension).
- Écrivains de `role.read.sensitive` : `create`/`update` passent par `assertRolePermissionRules`, qui refuse. Le groupe Audit est soumis à la liste blanche `isAuditGroupPermission` (`.sensitive` n'est pas `.read`). `setGovernanceRightGroups` ne déplace que les 4 droits de décision. Aucune route n'écrit dans `users.roles`. Le droit n'est jamais copié dans un rôle : il est lu dans `sensitive_view_grants`.
- Le circuit : demande sous `role.assign` + motif (`reasonText`). Le demandeur ne peut pas être le bénéficiaire, et le bénéficiaire doit être un membre actif du groupe RM. La décision, sous `rolegroup.audit.validate` (groupes Committee/Audit seulement, cf. `rolegroupAuditPermissionAllowedOn`), exclut l'auteur et le bénéficiaire en service ET en CHECK SQL. Le refus exige un motif. `expires_at` est figé à la demande et revérifié dans l'UPDATE. Un `UPDATE ... WHERE status='PENDING'` atomique empêche la double décision. L'audit (`runAudited`) est écrit dans la même transaction. Aucun champ `...By` n'est fourni par le client.
- Course entre la confirmation et la sortie du groupe : sans effet, car `holdsSensitiveGrant` revérifie l'appartenance au groupe RM à chaque lecture (voir cependant SEC-RL-05).
- Migration 079 : `tenant_id` présent, FK composites `(tenant_id, user_id)` sur les 4 colonnes d'identité. Les deux fonctions ont `search_path = pg_catalog, public, pg_temp`, dans la définition et en `ALTER`. Gardes DELETE (ligne) et TRUNCATE, `REVOKE DELETE, TRUNCATE`. Contenu immuable, transitions bornées (`PENDING→{APPROVED,REJECTED,REVOKED}`, `APPROVED→REVOKED` en conservant la décision). Insertion forcée en PENDING. Index unique partiel = une seule demande vivante par compte.
- Front : les badges de ligne sont calculés par le serveur. Aucun champ d'attribution n'est envoyé.

## Retrait sous `role.assign` (question SEC-013/014)

**Acceptable** (INFO). La règle CLAUDE.md vise un effet terminal rendu accessible par une permission *routinière* (`x.update`), ce qui élargit la population qui le déclenche. Ici :

- le retrait réduit les droits ;
- il passe par une route dédiée, avec motif obligatoire et audit dans la même transaction ;
- `role.assign` est la permission la plus étroite sur les attributions (déjà utilisée par `revokeFromUser`), et c'est la même population que celle qui demande.

À arbitrer par le PO, hors sécurité : les confirmateurs (Comité/Audit) ne peuvent pas mettre fin eux-mêmes à une vue élargie.

## Findings

### SEC-RL-01 : MEDIUM 4,3 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N), CONFIRMED (statique, chemin déterministe). Owner : HUMAN (portée), puis A06
- Acteur : un membre RM restreint (`role.read` + `process.responsibility.assign`).
- Observé : `GET /users/directory` (garde `DIRECTORY_PERMISSIONS`, qui inclut `role.read` depuis q187) liste **tous** les comptes actifs avec leur id et leur nom. `GET /roles/accounts` omet les comptes ADMIN/AUDIT. La différence `directory − accounts` donne donc la liste nominative exacte des administrateurs et des membres de l'Audit.
- Attendu (DECISION-098/101) : les comptes Audit/administrateurs ne sont pas visibles par ce lecteur.
- Ce qui reste caché : la composition des rôles masqués (permissions), et la distinction ADMIN/AUDIT.
- Recommandation : soit (a) le PO précise que la décision masque les *droits* et non les *identités*, et on accepte ; soit (b) l'annuaire applique le même filtre au lecteur restreint (attention aux sélecteurs RACI/responsabilités, qui doivent pouvoir nommer un admin).
- Test de régression : `directory(rmReader)` ⊆ `accounts(rmReader)` pour les ids.

### SEC-RL-02 : LOW 3,1, CONFIRMED (statique). Owner : A06
- `GET /roles/users/:userId` (`listForUser`) : un id inexistant renvoie **200 `[]`** (l'utilisateur est `null`, la liste de rôles est vide, donc LINE_1, donc visible). Un compte masqué renvoie **404**. On a donc un oracle « existe et est ADMIN/AUDIT », sur des ids que l'annuaire fournit. C'est redondant avec SEC-RL-01, mais l'oracle resterait si SEC-RL-01 était corrigé par (b).
- Recommandation : 404 pour un utilisateur inexistant dans `listForUser`, comme dans les deux routes voisines.

### SEC-RL-03 : LOW 3,1, CONFIRMED (statique, préexistant). Owner : A06/HUMAN
- `GET /roles/grantors?permission=<droit non détenu porté par un rôle>` (par ex. `config.manage`, hors `NOT_REQUESTABLE`) renvoie à **tout utilisateur authentifié** les noms des détenteurs de `role.assign`, c'est-à-dire des administrateurs. C'est une exception assumée de q48, mais elle contredit désormais le masquage de DECISION-098.
- Recommandation : accepter explicitement (PO), ou ne renvoyer qu'un compteur ou un libellé générique au lecteur restreint.

### SEC-RL-04 : LOW 2,7, PROBABLE. Owner : HUMAN/A06 (classe SEC-PNL2-02 / F4-02)
- Le confirmateur n'est exclu que s'il est l'auteur ou le bénéficiaire. Or le cumul administrateur + Comité ou + Audit est permis (motif + notification, q80/q104). Deux administrateurs suffisent donc : A place B au Comité, A demande, B confirme. Un administrateur déjà en cumul confirme aussi la demande d'un autre administrateur.
- Recommandation : refuser la décision à un détenteur de `ADMIN_PERMISSIONS` (en service, avec un test).

### SEC-RL-05 : LOW 2,2, CONFIRMED (statique). Owner : A06/A07
- Une grant APPROVED n'a pas de durée. Elle survit à la sortie du groupe RM et à la suspension. Elle est inerte pendant ce temps, mais **ressuscite** au retour dans le groupe ou à la réactivation, sans nouvelle confirmation. Elle bloque aussi toute nouvelle demande (index vivant) tant qu'un administrateur ne l'a pas retirée.
- Recommandation : passer la grant en REVOKED, dans la même transaction, lors de `revokeFromUser` (sortie du groupe RM) et de `suspend`. Ou bien exiger que l'affectation RM en cours soit antérieure à `decided_at`.
- Leçon déjà notée (F-SAD-02, SEC-077-02) : un droit conditionnel ne doit pas pouvoir revenir sans repasser par son circuit.

### INFO
- **INFO-06** : rien ne limite une nouvelle demande juste après un REJECTED. On peut ainsi chercher un confirmateur plus complaisant. C'est visible dans la liste, mais une nouvelle notification part vers tous les confirmateurs.
- **INFO-07** : une demande PENDING expirée n'est jamais matérialisée. Elle reste « vivante » dans l'index unique et bloque toute nouvelle demande jusqu'à un retrait manuel.
- **INFO-08** : `requestSensitiveView` compare `userId === actor.userId` sans `canonicalId`. Avec un UUID en majuscules, l'auto-demande passe le contrôle du service mais est arrêtée par le CHECK `svg_not_for_self_check` (23514, donc 500). Le système échoue fermé. Il faut appliquer `canonicalId` pour obtenir un 403 propre.
- **INFO-09** : le classement repose sur le groupe Audit seul. Un rôle ordinaire portant `audit.*` (un auditeur de fait, F-B8b-05) reste LINE_1, visible. `/roles/governance-rights` révèle aussi si le groupe Audit porte `governanceexception.review`, soit 1 bit de la composition de l'Audit.
- **INFO-10** : l'approbation et le retrait ne sont pas notifiés (ni au bénéficiaire, ni aux confirmateurs). La notification de demande part après le COMMIT et son erreur est ignorée. Dans ce cas la demande reste en attente, ce n'est pas un contournement.
- **INFO-11** (079) : le trigger ne force pas `decided_* = NULL` sur `PENDING→REVOKED`, ni `decided_at`/`revoked_at = now()`. L'expiration n'est appliquée que dans le repository, pas en SQL. Il n'y a pas de contournement par le runtime applicatif, qui écrit `now()`.
- **INFO-12** (fonctionnel) : `/users/me/permissions` n'affiche pas `role.read.sensitive` au bénéficiaire, qui ne sait donc pas qu'il a une vue élargie. `accounts()` fait N+1 `listAssignments` (un appel par rôle).

## Limites
Pas de PoC HTTP ni de base PostgreSQL pour 079 : la revue de la migration est statique. Les 9 tests `-pg` sont ignorés (aucune base configurée). Le comportement du résolveur d'identité n'a pas été modifié par le diff et n'a pas été revu à nouveau.
