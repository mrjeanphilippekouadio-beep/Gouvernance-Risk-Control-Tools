# SEC — Lot V3 visibilité (éléments non visibles, liste Comité/Audit, q212)

Agent : A10 Security. Date : 2026-11-01. Branche `feat/r1-visibility-v3`, diff `origin/staging...HEAD` (76c80dc).
Méthode : revue statique du diff backend, `tsc --noEmit` vert, vitest `visibility-v3` + `visibility-v2bis` (10 verts / 4 skip),
essais sur PostgreSQL 16 LOCAL (base `grc_sec_vv3`, migrations 001..083, supprimée ensuite). Jamais Neon.

**Escalade HUMAN : aucune** (CVSS maximal 2,7). **Verdict : VERT avec réserves.** V3-01 est à corriger pour que q212 soit
complet (non bloquant). V3-02 et les INFO sont à acter par le PO.

## 1. `GET /api/v1/hidden-counts` (q196, q198, spec §6) : PASS

- **Vérifié en base**, compte OUT sans lien :
  - résultat `{ RISK: 1, CONTROL: 0, ANOMALY: 1, ACTION_PLAN: 1, KPI: 0 }` ;
  - le risque NOMINATIF et son anomalie ne sont pas comptés, le risque PERIMETRE et son anomalie le sont ;
  - avec `risk.read` seul : `{ RISK: 1 }` ;
  - membre Audit : `null`.
- **SQL** : paramétré, tenant filtré sur chaque branche, aucun filtre ni aucune ventilation venant du client. L'anomalie et le
  plan sont comptés sous le niveau qu'ils héritent réellement, avec les mêmes branches que `*_visible_to`.
- **Ce que le nombre révèle** : le volume de ressources PERIMETRE hors de portée du lecteur, par type, sur tout le client.
  C'est ce qu'a décidé q196. Aucune ressource NOMINATIF n'est comptée directement.
- **Oracles par différence** (INFO, inhérents à un compteur, à acter par le PO) :
  - **Interrogation répétée** : le lecteur voit le rythme de création et de restriction des ressources PERIMETRE hors de son
    périmètre (« un risque restreint vient d'apparaître »).
  - **Baisse sans apparition** : le compte baisse sans qu'une ressource ne devienne visible. Cela signifie « archivée ou
    passée NOMINATIF ».
  - **Le niveau hérité départage ces deux cas.** Le `LEFT JOIN risks` du comptage des anomalies ne filtre pas
    `deleted_at`. Quand un risque PERIMETRE est archivé, ses anomalies restent comptées. Quand il passe NOMINATIF, elles
    sortent du compte. Un lecteur attentif peut donc conclure qu'un risque est devenu NOMINATIF, ce qui touche
    l'intention de q198.
  - Ce dernier oracle est étroit : il faut une anomalie sur le risque et une interrogation régulière. Il ne donne ni id ni
    contenu.
  - **Recommandation optionnelle (A06)** : choisir explicitement le traitement d'un parent archivé dans le comptage, ou accepter ce résidu.
- Le niveau hérité d'une anomalie ne révèle pas le niveau de son risque individuellement. Seul l'agrégat évolue (point précédent).

## 2. `GET /restricted-resources` ouvert au Comité et à l'Audit (q209) : PASS

- Le service accepte `resourcevisibility.set`, réservé au groupe RM par `RoleService`, ou `visibility_sees_everything`
  (appartenance active à RM, Comité ou Audit via `user_roles` et `system_group`). Vérifié : OUT est refusé
  (`ForbiddenError`), un membre Audit est autorisé.
- Ces trois groupes voient déjà tout (spec §4). Les libellés n'élargissent donc rien.
- **`lastChange`** (id de l'auteur, date, motif, `widening`) : extrait d'`audit_log` (PERMISSION_CHANGE de la ressource,
  tenant filtré). Le Comité, qui n'a pas `audit.read` (q203), reçoit donc l'auteur et le motif des changements de visibilité.
  C'est une exception étroite à q203 : seulement sur des ressources que le Comité voit, et sans les valeurs avant/après.
  INFO : à acter explicitement (R-1 CMP le demande). Le motif est un texte libre : la consigne « pas de détail
  d'enquête dans un motif » relève de la formation, pas du code.
- **Pagination** : `limit` de 1 à 500 et `offset` ≥ 0, validés par zod puis bornés à nouveau dans le dépôt, avec un tri stable
  (`updated_at`, `id`). Le `LATERAL` est limité à 1 ligne par ressource.

## 3. q212 : désignations et rôles de département

PASS pour `RoleService.assignToUser` (rôle lié à un département), `RiskService.assignOwner` et `assignSuperiorOwner`.
Pour chaque chemin :
- les ressources qui s'ouvriraient sont calculées en SQL : `departmentGroupGains` couvre risques, contrôles, KPI et plans
  à niveau propre, PERIMETRE seulement ; `canRead` couvre les risques ;
- un motif (`checkedReason`) est exigé hors groupe RM ;
- une ligne `PERMISSION_CHANGE` (`widening`, `through`) est écrite ;
- le RM est notifié avec l'id seul ;
- l'auto-attribution reste refusée (garde existante).

Les autres écrivains de `user_roles` (passation du dernier RM) sont internes au groupe RM, qui voit tout.

### SEC V3-01 — Lier un rôle à un département par `RoleService.update` n'est pas couvert (LOW, CVSS 2,7 `AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED par lecture)

- Changer `departmentId` d'un rôle qui a des membres leur ouvre à tous les ressources PERIMETRE du département. Ce
  changement se fait sans motif, sans `widening` et sans notification.
- La garde V1-01 empêche l'auteur de lier un rôle qu'il détient, mais pas d'ouvrir l'accès à des tiers. C'est exactement
  ce que q212 encadre pour `assignToUser`.
- **Réponse à ta question : oui, ce chemin doit être couvert.** C'est le même écrivain de périmètre, et en masse.
- Recommandation (A06) : dans `RoleService.update`, quand `departmentChanges` est vrai, faire l'union des
  `departmentGroupGains` sur les membres actifs ; motif hors RM ; `PERMISSION_CHANGE` dans la transaction de mise à jour
  (le dépôt verrouille déjà, `updateUnderLock`) ; notification RM.
- Statut : REMEDIATION_REQUIRED, non bloquant pour V3, à faire pour clore q212.

### SEC V3-02 — Le refus « motif requis » est un oracle d'existence pour un attributeur qui ne voit pas tout (LOW, CVSS 2,7 `AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N`)

- Le cas visé est un administrateur (`role.assign`, hors « voit tout », option A3) qui attribue sans motif un rôle de
  département. Une réponse 400 « motif requis » lui apprend que le département contient au moins une ressource PERIMETRE
  que la cible ne lit pas. Le message ne donne ni id ni nombre.
- Le même oracle existe pour le responsable de processus (V2bis) et les désignations, mais là l'auteur lit déjà le risque.
- La portée est un booléen par département, du même ordre que le compteur de q196. Recommandation : acceptation HUMAN, ou
  exiger le motif dès qu'un rôle lié à un département est attribué (réponse uniforme). Statut : REVIEW_REQUIRED (HUMAN).

### Points signalés par l'orchestrateur

- **« Lit déjà ? » mesuré avant l'écriture, sans verrou** : INFO, même classe que la fenêtre q213 acceptée. Dans
  `assignOwner`/`assignSuperiorOwner`, la ligne `PERMISSION_CHANGE` est écrite après la mise à jour, hors transaction
  (patron des modules historiques).
- INFO : `assignSuperiorOwner` sur un risque NOMINATIF exige un motif et trace « reads: true », alors que le N+1 n'ouvre pas
  ce niveau (I-3). C'est plus strict que nécessaire, mais la trace est inexacte. Recommandation : vérifier `canRead` après
  l'écriture, comme pour la RACI.
- **Journal d'audit (spec §6, « filtrage du journal »)** : **confirmé suffisant.**
  - `audit.read` est verrouillé au groupe AUDIT (`RoleService`, q203 A) et l'Audit voit tout.
  - Les autres lecteurs d'`audit_log` sont internes et ne restituent pas de contenu : contrôle du référent auto-désigné,
    contrôles du cadre de risque.
  - Seule exception : `lastChange` (§2), réservé aux groupes qui voient tout.
  - Si `audit.read` venait à être ouvert hors Audit, le filtrage deviendrait obligatoire. Les lignes Process/Role
    `PERMISSION_CHANGE` contiennent la liste `opened` des ids ouverts.

## 4. Statut

| Constat | Statut | Owner |
|---|---|---|
| V3-01 | REMEDIATION_REQUIRED (non bloquant) | A06 |
| V3-02 | REVIEW_REQUIRED | HUMAN |
| INFO (comptes et archivage, `lastChange` au Comité, N+1 NOMINATIF) | à acter | HUMAN / A06 |

Verdict : **VERT avec réserves.** CLOSED ne vaut pas validation Risk, Compliance ou Privacy.

## 5. Retest (lecture de `git diff 76c80dc..HEAD -- backend/src`, commits 97889be et 0275d24)

| Point | Résultat | Détail |
|---|---|---|
| SEC V3-01 `RoleService.update` | **RETEST_PASS** | Lier un rôle à un département déclenche maintenant la règle q212. Pour chaque membre actif, `guardDepartmentGroupOpening` est appelé : un motif est exigé hors groupe RM. Le refus a lieu avant toute écriture. La ligne d'audit porte `widening`, `through: DEPARTMENT_GROUP` et la liste `opened` par membre. Le motif (`cleanReason`) est le même texte que celui contrôlé par la garde. Le RM est notifié. Résidus INFO : (i) l'audit de `update` reste écrit après la mise à jour, hors transaction (patron historique des rôles, même classe que V2-04) ; (ii) la liste des membres est lue sans verrou. Une attribution concurrente au rôle encore non lié peut donc échapper à la trace (fenêtre étroite, même classe que q213). |
| PRIV-V3-01 accès à la liste | **RETEST_PASS** | Le contrôle d'accès repose maintenant uniquement sur `visibility_sees_everything`, c'est-à-dire l'appartenance réelle à RM, Comité ou Audit. Détenir `resourcevisibility.set` ne suffit plus. Ce n'est pas un resserrement fonctionnel : cette permission est déjà réservée au groupe RM. |
| PRIV-V3-05 auteur du dernier changement | **RETEST_PASS** | `userId` et `byName` ne sont rendus que si l'acteur détient `resourcevisibility.set` (groupe RM uniquement) ou `audit.read` (groupe Audit uniquement, q203). Pour le Comité, ces champs sont retirés ; il garde la date, le motif et `widening`. Le motif visible du Comité est posé au PO (q215/q216). |
| N+1 sur un risque NOMINATIF | **RETEST_PASS** | `designationOpening` renvoie null pour `superior owner` sur un risque NOMINATIF : pas de motif exigé, pas de `PERMISSION_CHANGE`, conforme à I-3. Pour le propriétaire, la règle q212 est inchangée. |
| QA-V3-03 attribution de rôle | **RETEST_PASS** | `PostgresRoleRepository.assignToUser` écrit `ROLE_CHANGE` et `PERMISSION_CHANGE` avant son COMMIT (`insertAuditEvent` sur le même client). Avec les faux dépôts des tests, ces lignes sont écrites juste après. La notification part après le COMMIT, en best-effort. |
| QA-V3-04 désignation | **RETEST_PASS** | `assignOwner` et `assignSuperiorOwner` passent par `runAudited` : `ASSIGN` et `PERMISSION_CHANGE` sont écrites dans la même transaction que la mise à jour. Le filtre tenant et `deleted_at` sont conservés. |

Restent ouverts : V3-02 et les INFO de comptage et de motif visible du Comité, posés au PO (q215, q216).
**Verdict après retest : VERT.**
