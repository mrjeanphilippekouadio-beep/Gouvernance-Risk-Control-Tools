# Passage Compliance (A14) — lot B-8 « groupes fixes »

Date : 2026-10-11. Branche `feat/b8-groups`, commit `efefbb1` (worktree `agent-a176e0f873c66d12d`). Lecture seule, aucun test exécuté (pas de Bash). Statut : recommandation ; les arbitrages reviennent au PO.

Périmètre lu : `049_fixed_groups.sql`, `RoleService.ts`, `ProcessService.ts` (create/update), `PostgresRoleRepository.ts`, `PostgresTenantRepository.ts` (create), extrait de `UserService.suspend`. Contrat : `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §10 et invariants, `RM-V1-Contrat-etape2-PROJET.md` (point 3, §3.2, §7.7). Limites : tests, `PostgresProcessRepository`, routes et frontend non relus.

## Verdict : CONFORME AVEC RÉSERVES

Aucun bloquant pour le merge de B-8 en tant que socle (groupes, invariant « jamais vide » côté `RoleService`). Les réserves doivent être levées avant la mise en production d'un lot qui s'appuie sur ces groupes pour valider ou approuver (B-9 et suivants).

## Constats

### C-1 — Cumul Risk Manager + Audit : non interdit par le contrat, aucune garde — À SUIVRE (question PO)
- Le contrat ne dit rien d'un cumul des groupes Risk Manager / Audit (grep sur les deux documents : seule mention d'Audit comme approbateur, avec « avertissement sur l'indépendance d'Audit »). Il n'est donc pas interdit.
- Le code n'a aucune garde : `assignToUser` accepte n'importe quel utilisateur dans n'importe quel groupe fixe, et aucun index n'empêche d'être membre de deux groupes fixes.
- Risque : un utilisateur à la fois 2e ligne (Risk Manager) et 3e ligne (Audit) annule la séparation des lignes de défense. Concrètement : Audit est notifié ou approbateur des changements de paramètres que Risk Manager demande (§7.7) ; l'invariant 1 (« on ne valide jamais ce qu'on a saisi ») serait contourné si la même personne tient les deux casquettes. Même remarque pour Risk Committee, qui vote avec les règles du §8 (auteurs exclus du vote) : un membre Risk Manager + Committee est auteur potentiel et votant.
- Recommandation (sans trancher) : pour Risk Manager vs Audit, interdire le cumul (refus à l'assignation, message explicite, test). Pour Risk Manager vs Committee, deux options : interdire, ou autoriser avec cumul « marqué » (invariant 6) et exclusion du vote déjà prévue. Si le PO préfère ne pas interdire, il faut au minimum un marquage visible et un indicateur (principe 10 de ma mémoire : le cumul est une exception déclarée). Une garde ne remplace pas un contrôle d'audit interne sur échantillon.
- Une garde simple à écrire dans `RoleService.assignToUser` (lire `listForUser(userId)` et refuser si `systemGroup` AUDIT et RISK_MANAGER se croisent). Ne pas la mettre en CHECK SQL (inter-lignes). Prévoir aussi la garde symétrique : un membre Audit déjà affecté ne rejoint pas Risk Manager.

### C-2 — Traçabilité des affectations et retraits — CONFORME avec points à suivre
Conforme : `assignToUser` et `revokeFromUser` écrivent un événement `ROLE_CHANGE` append-only avec acteur, tenant, `requestId`, rôle, utilisateur ; `grantedBy` est forcé à `actor.userId` côté serveur (pas de champ client) ; maker-checker auto-assignation et auto-révocation bloquées ; `user_roles` garde `revoked_at` (soft delete, pas de DELETE) ; renommage, rattachement département et désactivation d'un groupe fixe refusés.
À suivre :
- `reason: null` sur toutes les affectations et retraits. Le contrat (invariant 5) exige un motif pour toute désignation et tout changement de paramètre ; pour l'appartenance à Risk Manager, Committee et Audit (groupes qui votent, approuvent, auditent), un motif obligatoire est recommandé, au moins pour les trois groupes fixes.
- Aucun « approbateur » distinct : l'affectation d'un membre à un groupe fixe est faite par un seul acteur (`role.assign`). Le contrat ne l'impose pas pour l'appartenance de groupe (seulement pour les désignations RO/Délégué/Exécuteur) ; à confirmer avec le PO si l'appartenance à Risk Manager doit être approuvée par un autre membre.
- L'audit est écrit après l'action, hors transaction (`roles.revokeFromUser` puis `audit.record`). L'invariant 7 exige que l'action soit bloquée si l'audit échoue. Écart hérité du pattern existant, non propre à B-8, mais plus sensible ici ; à traiter dans un lot transverse.
- L'événement d'affectation ne porte pas l'identité de l'utilisateur concerné dans `entityId` (c'est le rôle) : le filtre par personne passe par `newValue`/`oldValue`. Acceptable.
- Le retrait n'enregistre pas l'auteur du retrait dans `user_roles` (seulement `revoked_at`) : l'auteur n'est retrouvable que dans `audit_logs`. Acceptable tant que l'audit est append-only.

### C-3 — Invariant « Risk Manager jamais vide » — CONFORME pour le retrait, CONTOURNEMENT RÉEL par suspension — À SUIVRE (fort), à lever avant B-9
Conforme : double contrôle (service pour le message, repository atomique sous `SELECT ... FOR UPDATE` avec `minRemaining`), donc robuste à la concurrence. Désactivation du groupe refusée. Committee et Audit peuvent être vides.
Écart confirmé (signalé par A06) : `UserService.suspend` met `deleted_at` sur l'utilisateur sans révoquer ses `user_roles` ; `countActiveAssignments` compte les lignes `user_roles` non révoquées sans regarder le statut de l'utilisateur. Donc un Risk Manager suspendu compte comme membre actif : le groupe peut être « non vide » en base alors qu'aucun membre n'est utilisable. L'invariant porte sur une équipe risque en mesure d'agir ; la lecture « ligne présente » le vide de sens.
Recommandation : (a) compter seulement les membres dont l'utilisateur est actif (jointure `users.deleted_at IS NULL`), dans `countActiveAssignments` ou une méthode dédiée ; (b) refuser la suspension du dernier Risk Manager actif d'un tenant (dans `UserService.suspend`, sous le même verrou), avec message explicite ; (c) regarder le même cas pour toute désactivation d'utilisateur par un autre chemin (changement de tenant, désactivation du tenant). Bloquant ? Non pour B-8 (aucun consommateur de l'invariant encore livré), oui avant tout lot qui s'appuie sur « l'équipe risque est joignable » (validation, suppléance du Comité, première activation du Dispositif). Je l'enregistre comme préalable de B-9, pas comme bloquant de merge.
Point voisin : à la création d'un tenant ou à la migration, Risk Manager démarre vide. Cela contredit « jamais vide » par construction ; le contrat traite ce cas par la première activation (§10 : créer d'abord un utilisateur du groupe risque, sinon admin différent du demandeur, une fois, avec motif et trace). Conforme à condition que cette règle soit bien livrée avant que le premier Dispositif soit activable. Le premier membre peut aujourd'hui être assigné par un admin `role.assign` (non-auto-assignation) : acceptable.

### C-4 — Groupes créés avec zéro permission — CONFORME à l'esprit du contrat ; recommandation (non tranchée)
Le contrat dit que Risk Manager a « des droits sur tous les risques, les contrôles et l'administration » (point 3 / §10), que le responsable du service risque est l'ayant droit, et que Risk Committee et Audit existent sans préciser leurs droits (Audit : « Audit vote avec les règles du Comité » seulement s'il est approbateur choisi). Zéro permission au départ est le choix sûr (moindre privilège, pas d'élargissement implicite), et la migration adopte (sans les modifier) les rôles déjà nommés ainsi, ce qui évite de retirer des droits existants.
Attention : `assertKnownPermissions` exige au moins une permission pour `create`, mais `update` ne l'applique que si `permissions` est fourni, et les groupes fixes sont insérés directement avec `'{}'` ; un groupe sans permission reste cohérent. Mais une mise à jour `permissions: []` sur un groupe fixe est refusée (longueur zéro) : le PO ne pourra pas « revider » un groupe fixe. Détail mineur.
Recommandation au regard du contrat (le PO tranche) :
- Risk Manager : droits larges sur risques, contrôles, évaluations, Dispositif, administration des groupes de risque, mais sans cumul avec les permissions qui permettraient de s'auto-approuver (invariant 1) ; la séparation « le responsable de la fonction risque » doit s'exprimer par une permission ou un attribut distinct du simple membre, car le contrat distingue « responsable » et « équipe ». Exclure : toute permission d'administration des utilisateurs si le PO veut conserver l'admin client comme autorité différente du demandeur.
- Risk Committee : lecture (risques, évaluations, rapports) + permission de vote/décision sur les évaluations au-delà du seuil (§8), rien d'autre. Pas de droit d'écriture sur les risques.
- Audit : lecture seule transverse (risques, contrôles, `audit.read`, preuves), aucune écriture ni décision ; l'approbation d'un changement de paramètre n'est ajoutée que si le Dispositif l'exige. Cohérent avec le rôle « Auditeur » déjà seedé (limité à `audit.read`).
- Aucun de ces droits ne doit être accordé avant décision explicite du PO ; en attendant, le comportement actuel (aucun droit par appartenance) est conforme.

### C-5 — Rattachement Processus → département — À SUIVRE
Le contrat : « Chaque Processus est rattaché à un département ». Le code : colonne `processes.department_id` nullable (rattrapage F-11 annoncé), `create` et `update` n'exigent pas le département, `update` accepte `departmentId: null` (détachement). Existence du département et appartenance au tenant : vérifiées (`assertDepartmentExists`, tenant-scopé). Le nullable temporaire est acceptable pendant le rattrapage, à condition que :
1. le rattrapage soit un item trackable avec owner et échéance (règle 7bis) ; je recommande de l'ajouter à `ACTION_ITEMS.md` (owner HUMAN pour la décision de rattachement des processus existants, A07 pour la migration) ;
2. un processus sans département soit visible (KRI ou liste d'anomalies de données) ;
3. à terme `NOT NULL` en base et refus du détachement à `null` dans `update` une fois le rattrapage clos ;
4. d'ici là, un processus sans département n'ait aucune règle de visibilité ou de désignation (direction de département, approbation de désignation RO) qui échoue silencieusement.
Aucun contrôle ne vérifie qu'un département archivé reste valide comme rattachement (`departments.getById` suppose un département actif : à confirmer). Non bloquant.

### C-6 — Autres constats
- Conforme : unicité d'un seul groupe actif par `system_group` et par département (index partiels) ; contrainte `system_group` et `department_id` exclusives ; création de tenant et migration alignées (mêmes trois groupes) ; `tenant_id` filtré dans toutes les requêtes lues ; `revokeFromUser` et l'index d'unicité ne contournent pas le soft delete.
- À suivre (faible) : l'adoption par nom dans la migration (`name = 'Risk Manager'`) suppose qu'un rôle de ce nom existant a bien la sémantique du groupe fixe, avec ses membres et ses permissions actuels. À vérifier tenant par tenant avant la mise en production (données réelles Djamo) : aucun membre ne doit être placé dans un groupe fixe par effet de nom sans contrôle. Le `UPDATE` n'est pas filtré par tenant (normal) mais deux rôles actifs du même nom dans un tenant violeraient l'index unique, ce qui ferait échouer la migration plutôt que de corrompre : comportement sûr.
- À suivre (faible) : `listForUser`/`assignToUser` n'empêchent pas une double affectation active d'un même utilisateur au même rôle (pas d'index unique sur `user_roles` vu dans ce commit) ; sur Risk Manager, cela fausserait le compte `COUNT(*)` (une personne comptée deux fois, donc retrait de l'autre membre possible). À vérifier dans les migrations existantes ; sinon ajouter un index partiel `(tenant_id, role_id, user_id) WHERE revoked_at IS NULL`.
- À suivre : un membre de Risk Manager peut modifier les permissions du groupe fixe s'il détient `role.update` sans le détenir lui-même ; garde SEC-002 présente uniquement pour le rôle qu'il détient. Risque de glissement de droits du groupe Audit par l'équipe risque (2e ligne qui règle les droits de la 3e) : la modification des permissions d'Audit devrait relever d'une autorité distincte (admin client, avec motif et trace). Question PO ci-dessous.

## Synthèse par classe

| Classe | Constats |
|---|---|
| Bloquant pour le merge | Aucun |
| À suivre (avant B-9 / production) | C-1 cumul RM + Audit sans garde ; C-3 suspension contourne « jamais vide » ; C-2 motif nul et audit hors transaction ; C-5 rattrapage et NOT NULL du département |
| À suivre (faible) | adoption par nom en migration ; doublon `user_roles` actif ; permissions du groupe Audit modifiables par l'équipe risque |
| Conforme | trace ROLE_CHANGE, attribution serveur, maker-checker, atomicité du retrait, soft delete, tenant_id, groupes fixes non supprimables ni renommables, zéro permission par défaut |

## Questions pour le PO
1. Un utilisateur peut-il appartenir à la fois à Risk Manager et Audit ? (je recommande non.) Même question pour Risk Manager + Risk Committee : interdit, ou autorisé avec cumul marqué et exclusion du vote ?
2. Un membre suspendu compte-t-il dans l'invariant « jamais vide » ? (je recommande non, et refus de suspendre le dernier Risk Manager actif.)
3. Quels droits pour Risk Manager, Risk Committee et Audit (voir C-4) ? Le « responsable de la fonction risque » a-t-il une permission distincte du simple membre ?
4. Un motif est-il obligatoire à l'affectation et au retrait dans les groupes fixes, et un tiers doit-il approuver une entrée dans Risk Manager ?
5. Qui peut modifier les permissions du groupe Audit : l'équipe risque, ou une autorité distincte (admin client) ?
6. Calendrier du rattrapage « Processus → département » et passage à `NOT NULL` : qui décide du rattachement des processus existants ?

## Actions pour l'orchestrateur (règle 7bis)
Ajouter à `ACTION_ITEMS.md`, owner HUMAN : questions 1 à 6 ci-dessus. Owner A06 : garde de cumul (selon réponse), suspension et comptage des membres actifs. Owner A07 : index d'unicité éventuel sur `user_roles`, rattrapage département.
