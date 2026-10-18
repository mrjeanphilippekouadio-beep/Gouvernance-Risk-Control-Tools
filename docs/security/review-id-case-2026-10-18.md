# Revue sécurité A10 : comparaison d'identifiants sensible à la casse (classe QA-B6d-01), 2026-10-18

Périmètre : point ouvert dans `ACTION_ITEMS.md` (« Même classe que QA-B6d-01 hors B-6d »), sur le code au commit `4e43770`. Aucun code applicatif n'a été modifié.

Méthode : les PoC passent par les vrais services (`RoleService`, `UserService`) et les vrais dépôts Postgres, sous `grc_app_runtime`. Ils tournent sur la base PG16 jetable `grc_qa_a10` (tag `rt9` ; script hors dépôt `scratchpad/b6d/rt9.mts`). Une revue statique complète les PoC. L'utilisateur suspendu par le PoC a été réactivé ensuite, et aucune transaction n'est restée ouverte.

**Cause racine.** `actor.userId` vient de la base : c'est la forme canonique, en minuscules. Les identifiants envoyés par le client arrivent bruts : `req.params[...] as string` (105 occurrences dans `api/`), `z.string()` sur des champs `*Id` (42) ou `z.guid()` (8), qui accepte les majuscules sans les normaliser. PostgreSQL convertit en `uuid` sans tenir compte de la casse, donc `9F…` et `9f…` désignent la même ligne en base, alors qu'en TypeScript `===` les trouve différents. **Toute garde « pas soi-même » ou « pas ce même objet » qui compare un id du client à un id lu en base se contourne en passant l'id en majuscules.**

## SEC-ID-01 : contournement du maker-checker RBAC (auto-attribution, auto-modification, auto-révocation, auto-suspension)

**Gravité MEDIUM. CVSS 3.1 = 6,7 (`CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:L`). Confiance : CONFIRMED (PoC). Owner : A06.** Pas d'escalade HUMAN obligatoire (< 7), mais **ce point bloque la production**.

Acteur : un administrateur qui détient `role.assign`, `role.update` et `user.delete`.

| Garde (ACT-093/113, maker-checker) | Id en minuscules | Id en MAJUSCULES |
|---|---|---|
| `RoleService.assignToUser` : groupe Comité à soi (`POST /roles/:id/assign`) | refusé (403) | **accepté** |
| `RoleService.assignToUser` : groupe Audit à soi | — | **accepté** |
| `RoleService.update` : permissions de son propre rôle (`PATCH /roles/:id`, `:id` en majuscules), ajout de `riskframework.activate` | refusé (403) | **accepté** |
| `RoleService.revokeFromUser` : son propre rôle Audit | refusé (403) | **accepté** |
| `UserService.suspend` : soi-même (`PATCH /users/:id/suspend`) | refusé (403) | **accepté** |

État final : l'administrateur détient `Admin+activate` et le groupe `RISK_COMMITTEE`. Les permissions sont relues en base à chaque requête (`GoogleIdentityProvider`), donc le gain est immédiat. Le groupe Risk Manager suit exactement le même chemin (même garde, l. 414), avec un motif q63 obligatoire, que l'attaquant fournit sans difficulté. Il n'a pas été rejoué.

- **Impact.** L'administrateur s'attribue n'importe quel droit métier ou n'importe quel groupe fixe : il vote au Comité, active des Dispositifs, lit l'audit trail via le groupe Audit. C'est exactement ce que la séparation administrateur ≠ acteur GRC (ACT-093/113, q63/q80/q104) devait empêcher. L'auto-suspension ou l'auto-révocation peut aussi priver le tenant de son seul administrateur (A:L).
- **Ce qui tient encore.** Les règles de cumul (RM ≠ Audit, RM ≠ Comité) relisent les rôles en base et restent appliquées. L'audit enregistre l'acteur, et la cible apparaît sous sa forme canonique dans `newValue.userId`, ce qui rend l'auto-attribution détectable après coup. Personne n'est notifié en dehors des cas de cumul q63.
- **Pourquoi PR:H et non plus haut.** Il faut déjà être administrateur. Le score reste sous 7 parce que c'est un administrateur qui franchit une séparation de pouvoirs. Si le PO estime que cette séparation est l'actif principal du produit, une revue HUMAN est recommandée, même sans seuil atteint.
- **Régression.** Pour chacune des 5 lignes du tableau, la variante en MAJUSCULES doit être refusée comme la minuscule, en test unitaire et en test pg.

## SEC-ID-02 : autres comparaisons de la même classe (revue statique, `grep` dans `services/` et `infrastructure/`)

| Site | Comparaison | Effet si contourné | Gravité |
|---|---|---|---|
| `RoleService.ts:231` (`update`) | `held.some(r => r.id === id)`, `id` = param | auto-modification de son rôle (SEC-ID-01, PoC) | inclus dans SEC-ID-01 |
| `RoleService.ts:270/281` (recheck des cumuls) | `r.id !== id` | `others` contient l'ancienne version du rôle modifié ; les cumuls restent évalués sur les rôles réels, effet faible | LOW (PROBABLE) |
| `RoleService.ts:511` (`revokeFromUser`) | `r.id === roleId` (« dernier rôle ») | un utilisateur se retrouve sans aucun rôle | LOW (code) |
| `RoleService.ts:352` (`assertAssignable`) | `r.id === roleId` (déjà détenu) | rattrapé par l'index unique `user_roles_active_idx` (409) | INFO |
| `RiskCategoryService.ts:62/68` | `input.parentId === id`, `c.parentId === id` | une catégorie devient son propre parent, ou une catégorie qui a des enfants devient sous-catégorie (profondeur 3) ; intégrité, `config.manage` requis | LOW (code) |
| `DepartmentService.ts:139` | `p.departmentId === id` | archivage d'un département qui a encore des processus rattachés | LOW (code) |
| `ProcessService.ts:270/278` | `r.processId === processId` | archivage d'un processus qui porte encore des risques ou contrôles actifs | LOW (code) |
| `ProcessEvaluationModeRequestService.ts:264` | `r.processId === processId` | destinataires de notification manquants | INFO |
| `AuditMissionService.ts:71`, `KriService.ts:176` | `new Set(ids)` / `rid !== before.riskId` | doublons qui diffèrent seulement par la casse : doublon ou 500 sur contrainte unique | INFO |

Comparaisons vérifiées et sans risque, parce que les deux côtés viennent de la base ou du serveur : toutes les autres `x === actor.userId` (`requestedBy`, `evaluatorId`, `decidedBy`, `responsibleUserId`, `superiorOwnerId`, `raisedBy`, `executedBy`, `proposedClosureBy`, `validatorId`…). Ce sont toutes des colonnes `uuid` ; la seule colonne `*_by` en `text`, `departments.risk_owner_designated_by`, est remplie côté serveur. `NotificationService.ts:221` échoue fermé : un id en majuscules donne 403, ce qui ne contourne rien. `PostgresRiskFrameworkRepository.ts:717` compare deux valeurs serveur. Le dossier `api/` ne contient aucune comparaison de ce type.

## Le correctif racine proposé suffit-il ?

**Oui, comme correctif racine, à quatre conditions :**

1. **Couvrir toutes les entrées.** Paramètres de chemin (les 105 `req.params[...] as string`, par exemple via un helper `idParam(req, "id")` ou `router.param`), corps, query, et tableaux (`boundedArray(Id, n)`). Remplacer aussi les 8 `z.guid()`/`z.uuid()` existants : ils acceptent les majuscules et laissent passer la valeur telle quelle.
2. **Ajouter un test de garde qui échoue sur le motif.** Comme `boundedArray.test.ts`, il échoue si `api/v1` contient `req.params[...] as string`, `z.guid()`, `z.uuid()` ou `z.string()` sur une clé `*Id`/`*Ids`/`*By`. Bonus : un id non-uuid donne alors 400 au lieu du 500 actuel (erreur pg `22P02`).
3. **Défense en profondeur sur les 4 gardes maker-checker de SEC-ID-01.** Résoudre la cible en base, puis comparer l'id renvoyé par la base (même schéma que le correctif QA-B6d-01) : un nouveau point d'entrée sans normalisation (import Excel `RiskImportService`, job, script) ne rouvrirait pas la faille. Le coût est d'une ligne par garde.
4. **Tests de régression des 5 cas du PoC.**

Sans les conditions 1 et 2, un schéma `Id` utilisé seulement sur les nouveaux champs ne ferme rien : la quasi-totalité des chemins d'aujourd'hui passent par des paramètres non parsés.

Limites de la revue : les ids stockés dans du jsonb puis relus et comparés (par exemple les justifications) n'ont pas été recensés de façon exhaustive, et le frontend n'a pas été examiné. Les lignes LOW/INFO de SEC-ID-02 n'ont pas été rejouées.
