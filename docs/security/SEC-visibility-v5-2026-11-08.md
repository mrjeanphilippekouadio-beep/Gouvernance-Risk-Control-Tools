# Revue Sécurité A10 — lot V5 visibilité : expiration de l'accès nominatif (q225 A, DECISION-112) (2026-11-08)

- Cible : `git diff origin/staging...origin/feat/r1-visibility-v5` (code `4d3f2b6`, HEAD `02196c6` = mémoire dev-backend seule), 22 fichiers.
- Méthode : analyse statique ; `tsc --noEmit` propre ; `npx vitest run` de `visibility-v5` (15 verts, y compris la partie PostgreSQL), `QA-visibility-v3`, `QA-visibility-v2bis`. PoC SQL sur la base locale jetable `grc_sec_v5` (`tests/integration/qa-visibility-v1-setup.sh`, 127.0.0.1:55442, migrations 001 → 087) et sur un clone `grc_sec_v5_down` pour le rollback. Aucun accès Neon. Aucun code de production modifié.

**Escalade HUMAN : aucune** (CVSS maximal 3,1). **Verdict : VERT avec réserves.** Le contournement de `risk_visible_core` est bien fermé, et il n'en reste aucun autre : `visibility_granted` est désormais la seule fonction qui lit `resource_access_grants`. L'échéance et la clôture s'appliquent aux cinq ressources et aux niveaux hérités. La garde refuse de retirer l'échéance ou de la porter au-delà de 30 jours. La réouverture est impossible côté application. Les réserves portent sur la robustesse en base (rollback, invariant, raccourcissement silencieux) et sur la trace de l'expiration. Aucune n'ouvre de donnée dans le fonctionnement normal.

## 1. Points demandés

| Point | Résultat | Détail |
|---|---|---|
| Garde SQL 087 | **PASS** (réserve SEC-V5-03) | PoC : retirer l'échéance → 42501 ; la porter à +31 j → 42501 ; INSERT à +31 j → 42501 ; révocation qui change l'échéance → 42501 ; dé-révocation → 42501 ; DELETE et TRUNCATE inchangés (080). Le contenu (user, ressource, auteur, motif, date) reste immuable. Réserve : raccourcir l'échéance ou la mettre dans le passé est accepté (SEC-V5-03). |
| `search_path` | **PASS** | `pg_proc.proconfig` = `pg_catalog, public, pg_temp` sur la garde, `visibility_resource_closed`, `visibility_granted` et `risk_visible_core`, répété par `ALTER FUNCTION`. Aucune n'est `SECURITY DEFINER`. PoC : des tables temporaires `risks` et `resource_access_grants` créées en session ne changent rien (clôture lue dans `public`, accès fabriqué ignoré). |
| Contournement `risk_visible_core` corrigé | **PASS** | L'EXISTS en ligne de 084 est remplacé par `visibility_granted`. Inventaire en base après 087 : la seule fonction qui lit `resource_access_grants` (hors gardes) est `visibility_granted`, et les 5 `*_visible_core` l'appellent. Aucune vue ne lit la table. Côté TS, les lectures de la table (`listAccess`, `activeList`, `listCreationAccess`, `listExpiries`, `access_count`) servent l'affichage ou la gestion, jamais une décision de lecture. |
| Héritage anomalie / plan | **PASS** | Les `*_visible_core` hérités appellent `risk_visible_core` / `control_visible_core`, donc la règle d'échéance et de clôture du dossier parent. PoC : anomalie rattachée à un risque NOMINATIF, visible, puis invisible quand le risque est archivé, et invisible quand l'accès est échu. Contrôle archivé → `f`. |
| `resource.readall` | **PASS** | `visibility_reads_all` n'ouvre que le niveau effectif PERIMETRE (084) : la règle q225 ne le touche pas et il n'ouvre jamais un NOMINATIF. |
| Listes et compteurs | **PASS** | Les listes passent par `riskVisibilityClause` / `resourceVisibleExpr` → `*_visible_to` → `visibility_granted`. `hiddenCounts` idem. `access_count` de `/restricted-resources` exclut l'échu mais compte encore les accès d'un dossier clos (affichage, SEC-V5-04). |
| Auto-renouvellement | **PASS** | Le bénéficiaire ne se renouvelle jamais lui-même (`sameUserId`, insensible à la casse) ; seuls le groupe RM ou le propriétaire renouvellent, et le propriétaire voit sans accès nominatif. Le renouvellement est plafonné par la base à now() + 30 j. `stampNamedExpiry` ne touche que les échéances NULL : remettre le niveau NOMINATIF ne rallonge rien. Le rejeu idempotent de la création ne crée ni ne rallonge aucun accès. Chaque renouvellement est audité dans la même transaction, avec les échéances avant/après, et notifié au RM quand c'est le propriétaire. Résiduel voulu par q225 : un propriétaire peut renouveler indéfiniment, de façon visible. |
| Résurrection à la réouverture | **PASS application / INFO base** | Les états de clôture sont absorbants : risque et contrôle `ARCHIVED: []`, anomalie `CLOSED: []`, plan TERMINEE sans retour, et aucune restauration de `deleted_at` sur risque, contrôle ou KPI. Aucune route ne rouvre un dossier. En base, une réouverture SQL fait revenir un accès non échu (PoC : archivé `f`, `status = 'ACTIVE'` → `t`), borné à 30 jours (SEC-V5-05). |
| Ordre des vérifications de la route | **PASS** | Corps (zod, clés inconnues ignorées, aucun champ d'attribution lu : `userIds` = `boundedArray(guid, 50, 1)`, motif `reasonText(500)`) → `x.read` → lecture filtrée (404 si invisible, aucun oracle) → droit RM ou propriétaire (403) → héritage (400) → niveau NOMINATIF (400) → motif, pas soi-même, au moins une personne → compte actif → sous verrou de ligne : niveau revérifié, clôture (400), accès vivant requis par personne. Le 400 du corps ne dépend pas de l'id. Un lecteur non gestionnaire reçoit 403 avant toute règle métier (pas d'oracle V3-02 nouveau). |
| Trace à l'expiration | **Réserve** (SEC-V5-04) | Aucune écriture quand un accès tombe, à l'échéance comme à la clôture : la ligne reste « vivante » (`revoked_at` NULL). La reconstitution reste possible (échéance de la ligne + événement d'archivage dans `audit_logs`), mais elle est déduite. |

## 2. Constats

### SEC-V5-01 — Le rollback 087 rend permanents les accès échus ou clos (LOW, CVSS 3,1 `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED, PoC)

- **Constat** : `087_named_access_expiry.down.sql` restaure `visibility_granted` (083) et l'EXISTS de `risk_visible_core` (084), puis supprime `expires_at`. Tous les accès échus ou d'un dossier clos redeviennent valides, sans écriture ni trace. L'en-tête du down le dit (« deviennent permanents »), mais rien ne l'empêche.
- **Preuve** : clone `grc_sec_v5_down`, accès échu de la veille → `risk_visible_to = false` ; après le down → `true`, 2 accès vivants.
- **Scénario** : un rollback de 087 en production (incident sur un autre point du lot) rouvre à d'anciens nommés des dossiers « personnes nommées » qu'ils ne devaient plus lire, y compris les dossiers clos.
- **Correctif attendu (A07)** : avant de restaurer les fonctions, le down révoque les accès échus ou clos (`revoked_at = now()`, `revoked_by` = compte technique, `revoke_reason` = « q225 : échéance ou clôture, rollback 087 »), pendant que la garde 087 est encore en place. À défaut, refuser le down dès qu'un tel accès existe, comme le down 084 (V4). Test : accès échu, down, `risk_visible_to = false`.

### SEC-V5-02 — Aucun invariant en base : un accès NOMINATIF sans échéance est permanent et survit à la clôture (LOW, CVSS 2,2 `AV:N/AC:H/PR:H/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED, PoC)

- **Constat** : la base accepte un INSERT sans `expires_at` sur un dossier NOMINATIF. `visibility_granted` traite alors l'accès comme une liste PERIMETRE : pas d'échéance, et la clôture ne s'applique pas (`expires_at IS NULL OR (...)`). Aujourd'hui, les trois chemins d'INSERT de l'application posent l'échéance dans la même transaction (création de risque, `changeVisibility` risque et ressources). La garantie repose donc sur chaque futur écrivain, comme SEC-009 l'a montré pour l'attribution.
- **Preuve** : le jeu de données QA (inséré après 087) laisse l'accès du risque NOMINATIF sans échéance : visible, puis **toujours visible après archivage** ; un INSERT sans échéance sur ce risque → visible.
- **Correctif attendu (A07)** : faire porter la règle par la lecture, en échec fermé : dans `visibility_granted`, un accès sans échéance ne compte que si le dossier n'est pas NOMINATIF (ou : la clôture s'applique à tout accès d'un dossier NOMINATIF). Variante : trigger qui refuse un accès vivant sans échéance sur un dossier NOMINATIF. Test : INSERT sans échéance sur un NOMINATIF → `false` (ou 42501).

### SEC-V5-03 — La garde accepte de raccourcir ou d'antidater l'échéance sans auteur ni motif (LOW, CVSS 2,2 `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N`, CONFIRMED, PoC)

- **Constat** : sur un accès vivant, la garde contrôle seulement que la nouvelle échéance n'est ni NULL ni au-delà de now() + 30 j. `UPDATE ... SET expires_at = '2000-01-01'` passe : c'est une révocation qui n'en a pas l'air (pas de `revoked_at`, `revoked_by` ni motif), et l'échéance précédente est écrasée. Le contrat de 080 (« révoqué une fois, avec auteur et motif ») est contournable par le compte applicatif. Aucun chemin applicatif ne le fait aujourd'hui.
- **Correctif attendu (A07)** : sur un accès vivant, n'accepter que l'allongement : `NEW.expires_at >= OLD.expires_at` quand `OLD.expires_at` n'est pas NULL. Le renouvellement (now() + 30 j) le respecte toujours, et le raccourcissement passe par la révocation. Test : UPDATE vers une date antérieure → 42501.

### SEC-V5-04 — L'expiration ne laisse aucune trace et l'accès échu reste présenté comme présent (INFO, owner A23 / A06)

- Aucune ligne d'audit quand un accès tombe, ni à l'échéance ni à la clôture. Le snapshot d'audit de `setVisibility` (`accessUserIds`) liste les personnes échues comme présentes, sans échéance (seul le renouvellement trace les échéances). `/restricted-resources` compte les accès d'un dossier clos. `GET /visibility` montre bien `expiresAt`, mais sans dire « échu » ou « clos ».
- Proposé, sans cron (ponytail) : (1) ajouter les échéances au snapshot d'audit de `setVisibility` ; (2) calculer `access_count` avec `visibility_granted` ; (3) exposer un booléen `active` par personne. La reconstitution à date (« qui pouvait lire ce dossier le jour J ») reste faisable par l'Audit avec `expires_at` + l'événement d'archivage ; à confirmer par A23 si c'est suffisant pour ACT-071.

### SEC-V5-05 — Résurrection en base à la réouverture (INFO, owner A05 / A06, garde-fou pour la suite)

- Aucun chemin applicatif ne rouvre un dossier aujourd'hui (PASS). Mais la clôture est évaluée à la lecture : si une réouverture est un jour construite (ou faite en SQL), un accès non échu revient (PoC : `t` → `f` → `t`), au plus pour le reste de ses 30 jours.
- Règle à poser pour tout futur « rouvrir » : révoquer les accès nominatifs à la clôture, ou les révoquer dans la même transaction que la réouverture. À reporter dans la spec visibilité.

### SEC-V5-06 — Effets de bord fonctionnels, en échec fermé (INFO, owner A06 / PO)

- Passer un dossier NOMINATIF en PERIMETRE garde l'échéance (la garde interdit de la retirer) : la liste PERIMETRE expire alors à 30 jours et à la clôture, contrairement à « PERIMETRE inchangé ». Le renouvellement est refusé (niveau ≠ NOMINATIF).
- Ré-ajouter une personne dont l'accès est échu est un no-op silencieux (`before.accessUserIds.includes` → `continue`) : l'audit et la réponse montrent la personne, qui ne lit toujours rien. Il faut passer par le renouvellement, ou révoquer puis ajouter.
- Aucun n'ouvre de donnée. À trancher : message explicite (400 « accès échu : renouveler ») et règle de l'échéance au passage NOMINATIF → PERIMETRE.

## 3. Synthèse

| ID | Sévérité | CVSS | Owner | Bloquant prod |
|---|---|---|---|---|
| SEC-V5-01 | LOW | 3,1 | A07 | Recommandé avant prod (le rollback est le seul cas qui ouvre) |
| SEC-V5-02 | LOW | 2,2 | A07 | Non |
| SEC-V5-03 | LOW | 2,2 | A07 | Non |
| SEC-V5-04 | INFO | — | A23 / A06 | Non |
| SEC-V5-05 | INFO | — | A05 / A06 | Non (garde-fou futur) |
| SEC-V5-06 | INFO | — | A06 / PO | Non |

Statut : FINDING_IDENTIFIED. Retest A10 attendu sur SEC-V5-01 à 03 après correctif. Ce verdict n'est ni une acceptation de risque (A13), ni un avis Privacy (A15) sur l'exposition de `expiresAt` aux lecteurs du dossier.
