# Revue Sécurité (A10) — lot « suites des arbitrages 2 » (DECISION-095)

- Branche : `feat/r1-suites-arbitrages-2`, diff `git diff origin/staging...HEAD` (42 fichiers).
- Méthode : revue statique du code et de la migration 076, vitest `suites-arbitrages-2`, `QA-suites`, `D4` (73 verts, 8 sautés : suites PG). Pas de rejeu sur Postgres réel.
- Verdict : **VERT avec réserves**. **Aucune escalade HUMAN** (CVSS max 2,7). SEC-SA2-01 est à corriger avant la production : il contourne la règle q179/q185 que ce lot pose.

## 1. q182 : circuit d'assouplissement des délais (migration 076)

| Contrôle | Résultat |
| --- | --- |
| Maker-checker | PASS. Le service refuse l'auteur (`ConfigService.ts:416`) et la base le refuse aussi (`gdr_maker_checker_check`). L'exception `WITHDRAWN` ne concerne que le retrait, qui n'applique rien. |
| Expiration | PASS. `expires_at` est figé à la soumission (F-SAD-02 fermé) et revérifié deux fois : dans le service, puis dans l'UPDATE du claim (`AND ($3 <> 'APPLIED' OR expires_at > now())`), dans la même transaction que l'écriture des délais. |
| Marqueur `adminAlone` | PASS. Il n'est posé que si `existsOther(config.selfvalidation.approve)` est faux (`ConfigService.ts:335`). L'effet, le marqueur et l'audit sont écrits dans une seule transaction (`runAudited`). La notification aux relecteurs passe par la branche générique de `GovernanceNotifier`. |
| Découpage en petits pas | PASS. Chaque pas est un allongement, donc chaque pas passe par le circuit. Passer à null puis reconfigurer : le passage à null est lui-même un allongement. |
| Mélange allonger/raccourcir | PASS. Si une seule clé allonge, toute la demande est en attente (q184, fail-closed). |
| Retirer d'abord les autres détenteurs | **RÉSERVE**. C'est possible par suspension (classe SEC-PNL-04 / F4-02) et, nouveau, par `PATCH /roles/:id` (voir SEC-SA2-01). Les deux voies restent visibles : marqueur et notification. |
| Garde base | PASS. INSERT forcé en PENDING, contenu immuable, une seule transition PENDING vers un état final, DELETE et TRUNCATE refusés, `search_path` épinglé dans la définition et redit par ALTER, index unique partiel PENDING. |
| Concurrence | PASS. Deux soumissions : 23505, transformé en 409. Approbation en même temps qu'un retrait : un seul claim réussit. |

## 2. q179 : droits de décision réservés aux groupes fixes

| Voie d'écriture | Résultat |
| --- | --- |
| `POST /roles` (création) | PASS. `assertRolePermissionRules(null, …)` refuse les 4 droits. |
| `PATCH /roles/:id` sur un rôle ordinaire | PASS. Le refus s'applique à la liste complète, donc un rôle ordinaire déjà porteur ne peut que se voir retirer le droit. |
| `PATCH /roles/:id` sur Risk Manager / Comité | **FAIL : SEC-SA2-01**. Ni motif ni règle « au moins un groupe ». |
| Circuit Audit | PASS. Liste blanche lecture (`isAuditGroupPermission`) et q157 appliqué (Audit = revue seule). |
| Rattrapage SQL / `users.roles` legacy | **SEC-SA2-02 corrigé par 077** (q186, DECISION-096). `users.roles` n'est écrit par aucune route, mais il reste compté par `existsOther` et par la résolution d'identité. |
| `PUT /roles/governance-rights` | Permission : `role.update` (plus `rolegroup.audit.update` si l'Audit change). Ce n'est pas une permission dédiée. Une permission dédiée n'aurait d'effet qu'avec SEC-SA2-01 fermé, puisque `PATCH /roles/:id` offre le même pouvoir sous `role.update`. Motif obligatoire (`reasonText`), audit par groupe modifié, refus si l'administrateur appartient à un groupe modifié, « l'Audit ne décide jamais » respecté (`governanceRightAllowedOn`). Non atomique : SEC-SA2-03. |

## 3. q181 : « renouvelé sans revue »

PASS. Le marqueur n'est posé que si `existsOther(governanceexception.review)` est faux (`GovernancePrincipleAcceptanceService.ts:96-97`). Dès qu'un relecteur existe, la création est refusée (400). Contournements vérifiés :
- Revoir soi-même l'acceptation précédente : bloqué par D5 (`GovernanceExceptionService.ts:38`).
- Une revue `CONTESTED` ne compte pas comme revue.
- Un précédent encore ouvert : l'accès concurrent est géré par le 409 du dépôt.

Résiduel : l'absence de relecteur peut être fabriquée par suspension ou par SEC-SA2-01. Cas fail-closed : si le seul autre relecteur est l'auteur du précédent, le renouvellement reste bloqué (disponibilité, INFO).

## 4. q178 : vacance du Risk Manager

PASS. Le message est fixe et ne contient ni nom ni id de personne. `resourceId` est l'id de la ligne d'audit. Les destinataires sont l'Audit et le Comité ; l'auteur est exclu. Les 2 alertes ne s'additionnent pas : la vacance est exclue de la branche générique. La vacance n'est marquée que sur `revokeFromUser` (la suspension du dernier membre reste refusée, F-B8-01). `GET /governance-designations` : la vacance (`since`, `maxDays`, `overdue`) n'est visible qu'avec `designation.manage` (administrateurs). C'est une date, pas une identité : aucune fuite. Voir SEC-SA2-05 pour la visibilité.

## 5. q183 : annuaire ouvert à `audit.mission.create`

PASS sur la sécurité : id et nom seulement, comptes actifs, tenant de l'acteur, plafond 500. Aucune migration ne donne `audit.mission.create` : le droit s'attribue par RBAC. La proportionnalité (révéler tout l'annuaire à quiconque peut créer une mission) relève de Privacy. INFO : cette lecture n'est pas auditée (comme pour F4).

## Findings

### SEC-SA2-01 — LOW 2,7 (CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N), CONFIRMED (lecture du code), owner A06
- **Composant** : `PATCH /roles/:id` (`backend/src/api/v1/roles.routes.ts:188-192`), puis `RoleService.update` (`backend/src/services/RoleService.ts:238-262`).
- **Attendu** : q179/q185 imposent qu'on ne déplace un droit de décision qu'avec un motif obligatoire et que chaque droit garde au moins un groupe fixe (`RoleService.ts:768`).
- **Observé** : `update` sur le groupe Risk Manager ou Comité accepte qu'on ajoute ou retire l'un des 4 droits avec `role.update` seul. Le motif est optionnel (`reason: reasonText().optional()`) et la règle « au moins un groupe » n'est pas appliquée. Les règles de `setGovernanceRightGroups` ne protègent donc que la route qui les porte.
- **Scénario** : un administrateur, hors des groupes, envoie 2 PATCH sans motif et retire `config.selfvalidation.approve` des groupes Risk Manager et Comité. `existsOther` renvoie alors faux, et l'administrateur peut ensuite, seul : allonger les délais (`adminAlone`), assouplir la politique q158, et faire passer seules les acceptations et les profils d'organisation. Le même procédé appliqué à `governanceexception.review` (Audit via son circuit) rend tous les marqueurs impossibles à revoir et ouvre « renouvelé sans revue ».
- **Atténuation** : chaque PATCH laisse une trace `PERMISSION_CHANGE`, et chaque action faite seul est marquée et notifiée, mais aux relecteurs, qui peuvent ne plus exister.
- **Recommandation** : dans `update`, pour un groupe fixe dont l'ensemble des droits de décision change, refuser et renvoyer vers `/roles/governance-rights`, ou appliquer les mêmes gardes : motif obligatoire, au moins un groupe par droit, notification.
- **Test de régression** : un PATCH qui retire `config.selfvalidation.approve` du dernier groupe porteur doit répondre 400. Un PATCH qui change un droit de décision sans motif doit répondre 400.

### SEC-SA2-02 — LOW 2,2, PROBABLE, owner HUMAN q186 puis A07
Les rôles ordinaires créés avant ce lot et les entrées `users.roles` qui portent déjà l'un des 4 droits restent effectifs. Ils sont comptés par `existsOther` (`backend/src/infrastructure/database/postgres/PostgresGovernanceQueries.ts:23-27`) et par la résolution d'identité. Un porteur ordinaire peut donc encore approuver un allongement ou une politique. Recommandation : avant la production, lancer une requête de contrôle sur `roles` (`system_group IS NULL`) et sur `users.roles`, puis faire la migration de nettoyage si q186 la retient.

### SEC-SA2-03 — INFO, owner A06
`setGovernanceRightGroups` (`RoleService.ts:784`) écrit groupe par groupe, sans transaction. L'ordre est celui des noms : Audit d'abord. Si l'Audit est appliqué puis qu'un `update` Risk Manager ou Comité échoue (par exemple sur une règle de cumul), le droit reste à moitié déplacé et peut n'être porté par aucun groupe. Le commentaire du code (« jamais à moitié déplacé ») ne couvre que les refus pré-contrôlés.

### SEC-SA2-04 — INFO, owner A06
Pour q182, `before` est lu hors transaction (`ConfigService.ts:317-335`). 2 écritures concurrentes peuvent allonger un délai par rapport à une valeur intermédiaire, mais jamais au-delà de la valeur d'origine. Par ailleurs, tout détenteur de `config.governancedelays.set` peut retirer (`WITHDRAWN`) la demande en attente d'un autre administrateur, en soumettant n'importe quel changement. Ce retrait est tracé (`CLOSE`).

### SEC-SA2-05 — INFO, owner PO / D6
La vacance du Risk Manager (`since`, `overdue`) n'est lisible qu'avec `designation.manage`, c'est-à-dire par l'administrateur qui a pu créer la vacance. L'Audit et le Comité sont notifiés mais ne voient pas le dépassement avant le panel D6. Il n'y a pas de fuite, seulement une lacune de surveillance.

### SEC-SA2-06 — INFO, owner Privacy / A06
q183 : la lecture de l'annuaire n'est pas auditée, et la liste est tronquée à 500 sans signal (déjà F4-03).

## Traçabilité (7bis)
SEC-SA2-01 (A06, avant production), SEC-SA2-02 (HUMAN q186, puis A07), SEC-SA2-03/04 (A06, non bloquants), SEC-SA2-05 (PO/D6), SEC-SA2-06 (Privacy). La fabrication de l'absence par suspension reste rattachée à SEC-PNL-04.

## Statut après correctifs (2026-10-27)

- **SEC-SA2-01 : CORRIGÉ.** `RoleService.update` refuse (400) tout ajout ou retrait d'un des 4 droits de décision sur n'importe quel rôle ; seule `PUT /roles/governance-rights` les déplace (motif, au moins un groupe).
- **SEC-SA2-03 : CORRIGÉ.** Tous les refus avant écriture ; groupes changés directement + lignes d'audit en une transaction.
- SEC-SA2-02 : **corrigé** par la migration 077 (q186 tranché, DECISION-096) : les 4 droits de décision quittent les rôles ordinaires actifs et `users.roles` (comptes actifs et suspendus), une ligne `audit_log` `PERMISSION_CHANGE` par rôle/compte, acteur = compte technique suspendu « Système (migration 077) » (`migration-077@system.invalid`, créé seulement si un tenant a quelque chose à retirer). Test `q186-cleanup.test.ts`. SEC-SA2-04 à 06 : INFO, inchangés.
