# SEC — Lot V2bis visibilité (q207 / q208, DECISION-107)

Agent : A10 Security. Date : 2026-11-01. Branche `feat/r1-visibility-v2bis`, diff `origin/staging...HEAD` (8cc19d6).
Rapport précédent : `docs/security/SEC-visibility-v2-2026-11-01.md` (constat V2-03).
Méthode : revue statique du diff backend, `tsc --noEmit` vert, vitest `visibility-v2bis` + `visibility-v2` (15 verts / 11 skip),
essais sur PostgreSQL 16 LOCAL (base `grc_sec_vv2b`, migrations 001..083, supprimée ensuite). Jamais Neon.

**Escalade HUMAN : aucune.** **Verdict : VERT.** V2-03 : RETEST_PASS.

## 9. Lot V2bis

### 9.1 Retest V2-03 (RACI et responsable de processus, q207 A)

| Écrivain | Résultat | Détail |
|---|---|---|
| RACI (`RaciAssignmentService.assign`) | **PASS** | `guardRaciOpening` : si la personne ne lit pas déjà la ressource (`canRead` = `<root>_visible_to`), un motif (1–500, `isAcceptableReason`) est exigé hors groupe RM. Vérifié en base : contrôle PERIMETRE, OUT non lecteur, auteur non RM sans motif → `ValidationError` ; avec motif → accepté. Après écriture, si la personne lit désormais : ligne `PERMISSION_CHANGE` (`widening: true`, `through: RACI`) sur l'entité, puis notification RM si l'auteur n'est pas RM. Le motif est aussi porté par la ligne CREATE. |
| Responsable de processus (`ProcessService.setResponsibilities`) | **PASS** | Seul écrivain de `processes.owner_user_id` (vérifié). `processOwnerGains` liste les risques, contrôles et KPI PERIMETRE du processus que le nouveau responsable ne lit pas encore. Vérifié en base : contrôle PERIMETRE et risque PERIMETRE remontés, contrôle NOMINATIF exclu (le processus n'ouvre pas ce niveau). Motif exigé hors RM, `PERMISSION_CHANGE` (`opened` = liste) dans la même transaction que la mise à jour (`writeAudited`), notification RM. Auto-désignation déjà refusée. Anomalies et plans héritent par leur parent ; le PERIMETRE propre d'un plan n'inclut pas le responsable de processus, donc rien à compter. |

Points signalés par l'orchestrateur, avis A10 :
- **« Lit déjà ? » avant / « lit désormais ? » après, hors verrou (RACI)** : INFO. Une bascule concurrente CLIENT→PERIMETRE
  entre les deux lectures peut laisser une ouverture sans motif ni `PERMISSION_CHANGE`. Cette bascule est elle-même faite
  par le RM ou le propriétaire, avec motif et audit, et la ligne RACI CREATE reste tracée. Fenêtre étroite, pas de gain pour l'auteur.
- **RACI sur patron compensatoire (pas de transaction)** : INFO, comportement déjà en place. Si la ligne `PERMISSION_CHANGE`
  échoue, l'affectation est retirée, mais la ligne CREATE déjà écrite reste (trace d'une affectation annulée). Aucune
  ouverture ne reste sans trace. Dette alignée sur F7S6-01 (`writeAudited` le jour où le dépôt RACI devient transactionnel).
- **Responsable de processus en `writeAudited`** : PASS. Seule la liste `opened` est calculée avant la transaction (même fenêtre INFO).
- INFO : sur une ressource NOMINATIF, le RACI n'ouvre rien mais le motif est quand même demandé (`canRead` faux avant).
  C'est plus strict que nécessaire, et fail-safe.

### 9.2 Notification de tout changement par un propriétaire (q208 A)

**PASS.** `ResourceVisibilityManager.set`, `applyPerimeterChange` et `RiskService` (`setVisibility`, changement de périmètre)
notifient le groupe RM pour tout changement fait hors RM. L'événement est `*_VISIBILITY_WIDENED` ou `*_VISIBILITY_RESTRICTED`
selon `widening`. Les messages ne contiennent ni titre ni contenu, seulement l'id de la ressource. L'envoi est best-effort et
n'annule jamais le changement. Les événements sont `mandatory` au catalogue. Destinataires = `listWithPermission("resourcevisibility.set")`,
auteur exclu.

### 9.3 `GET /api/v1/restricted-resources` (q208 A)

**PASS.**
- Route montée derrière `authMiddleware`. Le service refuse (403 `ForbiddenError`) tout acteur sans `resourcevisibility.set`.
  Vérifié : un acteur avec `audit.read`, `risk.read`, `control.read` et `raci.assign` est refusé.
- `RoleService.assertRolePermissionRules` interdit `resourcevisibility.set` hors groupe RISK_MANAGER. Aucun autre porteur
  possible : ni rôle ordinaire, ni Comité, ni Audit, ni admin.
- Réponse : type, id, libellé (160 caractères maximum), niveau, nombre de personnes nommées, date. Pas de liste nominative.
  Le RM voit déjà tout (§4 de la spec) : pas d'élargissement. SQL entièrement paramétré, tenant filtré sur chaque branche,
  `deleted_at` filtré là où la colonne existe.
- L'onglet frontend est cosmétique : c'est le serveur qui refuse.

### 9.4 Résidus et suivi

- INFO (hors périmètre V2-03, à noter pour le suivi) : un troisième écrivain de périmètre existe. Une appartenance à un
  groupe lié à un département (`role.assign`) ouvre aussi les ressources PERIMETRE du département, sans motif ni `widening`.
  Ce chemin est déjà soumis au maker-checker, à l'audit et à la garde « rôle détenu » (V1-01). Le PO peut l'aligner sur
  q207 s'il le souhaite. Ce n'est pas un constat.
- Statut : V2-03 **CLOSED (RETEST_PASS)**. Aucun nouveau constat ≥ LOW. CLOSED ne vaut pas validation Risk, Compliance
  ou Privacy.

## 10. Retest QA-V2B (commit 926a641, lecture de `git diff 917aead..926a641 -- backend/src`)

- **QA-V2B-01, RETEST_PASS.** Un verrou consultatif transactionnel (`pg_advisory_xact_lock`) est pris sur une clé qui contient le tenant. Il est libéré au COMMIT ou au ROLLBACK, donc limité à un client et à une requête. Une collision de `hashtext` ne ferait que sérialiser deux requêtes : le refus vient du `NOT EXISTS`, paramétré et filtré par tenant. Le 409 n'est atteint qu'après `assertEntityExists` en scope lecteur : une entité masquée répond toujours comme une entité inconnue, sans oracle nouveau (la RACI d'une entité lisible est déjà visible avec `raci.read`). Le motif n'est pas contourné : si l'affectation identique existe déjà, la personne lit déjà la ressource, donc rien ne s'ouvre et aucun motif n'est dû.
- **QA-V2B-02, RETEST_PASS.** `sameVisibilityState` ne supprime que la notification au RM, et seulement quand le niveau et la liste sont identiques avant et après (lus sous verrou). La ligne `PERMISSION_CHANGE` et son motif restent écrits. Tout changement réel est toujours notifié. Pas de régression.
- Verdict inchangé : **VERT**.
