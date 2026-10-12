## Principes (audit/anomalies)
- Réutiliser strictement `@djamo/design-system` (Table, Card, Modal, MessageBanner, Pagination, DatePicker, StatusBadge, FormField). Tokens `--gs-*` uniquement (ex. `--gs-bg-surface`, pas `--gs-surface`).
- Jamais de donnée inventée, jamais de règle métier recalculée côté front, jamais de champ `...By` envoyé au backend.
- Pas de parameter properties en frontend (`erasableSyntaxOnly`).
- Build : `npm run build -w @djamo/design-system` AVANT `npm run build -w @grc-tools/frontend` (worktree neuf : `npm install` à la racine ; restaurer `package-lock.json` ensuite avec `git checkout package-lock.json`).
- Pas de tests frontend dans le repo.

## 2026-10-12 — Journal d'audit (ACT-071) + Anomalies
- Écrans : `features/audit/AuditLogPage.tsx` (lecture seule, `GET /api/v1/audit-log`), `features/anomalies/AnomaliesPage.tsx`. Clients : `api/auditLog.ts`, `api/anomalies.ts`.
- 403 : `PermissionDeniedDialog` global (`features/errors`, déclenché par `api/client.ts` sur les écritures refusées) ; les pages n'ont pas de dialog local, elles affichent l'erreur en ligne (les GET 403 ne déclenchent pas la fenêtre). Mon worktree était parti d'un `main` en retard : toujours merger la branche de travail avant de commencer.
- Gaps backend : (1) aucun endpoint "mes permissions" (`/permissions` liste les permissions existantes, pas celles de l'utilisateur) -> impossible de masquer/désactiver les actions selon permissions, on s'appuie sur le 403 ; (2) pas de transitions possibles exposées par l'API anomalies -> UI propose tous les statuts sauf l'actuel, le backend refuse ; (3) audit-log : pas d'offset/total, max 500 -> pagination client sur 500 événements ; `entityId` seul est ignoré par la route (retombe sur "recent") -> UI désactive entityId sans entityType ; (4) pas de libellés lisibles pour userId/controlId/riskId (IDs bruts).
- Pas de QA navigateur faite (pas de backend/navigateur dans l'environnement) : build/tsc verts seulement.
# Mémoire — @dev-frontend

Créée le 2026-10-11 (vague 2 du design system). À lire en premier par tout agent Dev Frontend ; la mettre à jour en fin de tâche.

## Principes retenus

1. Après `git checkout -B <branche> origin/<branche>`, vérifier `git log -1` avant toute modification (le worktree peut rester sur `main`).
2. Le script `test` n'existe PAS dans `frontend/` ; les tests du design system sont dans `packages/design-system` (`npx vitest run`, jsdom + vitest-axe). Chaque composant/variante : test de comportement + `axe` sans violation, et une entrée dans `frontend/src/catalog/main.tsx` (données factices « Exemple »).
3. Le harnais refuse les commandes Bash composées (`cd` calculé, heredoc enchaîné) dans un worktree : séparer en appels simples, utiliser Write/Edit pour les fichiers.
4. Nouvelles variantes = prop optionnelle dont la valeur par défaut reproduit l'existant (Button `size="md"`, Modal `size="sm"` 340 px, Table sans sélection) : aucun écran existant ne change.
5. États « indisponible » : `aria-disabled` + raison masquée reliée par `aria-describedby` (pattern Button, repris pour Tabs) ; état « sélectionné » jamais par la couleur seule (bordure épaisse + texte masqué / `aria-selected`).
6. Jetons ajoutés vague 2 : `--gs-space-2-5: 12px`, `--gs-font-size-display: 30px`. Pas de nouvelle couleur.
7. Cartographie : ne jamais toucher.

## Historique

- 2026-10-11 — Vague 2 (`feat/ds-wave2`, DECISION-039 pt 4) : Button sm/md/lg, Modal sm/md/lg, Table compact/zébré/sélection/tri, Tabs désactivé, Card sélectionnée/désactivée, Checkbox `indeterminate`, BulkActionBar (M14), VersionComparison (M15), MatrixView (M4).

## Reste de l'inventaire (après vague 2)

M10 gabarit page de réglage, M11 liste « À faire », M12 panneau latéral, M13 vote de comité, M16 récapitulatif d'import, M17 centre de notifications ; E11 ligne cliquable au clavier, E13 responsive, E18-E22 (flèches Tabs/Panel/Menu, slot action MessageBanner), E23 Timeline annoncée, E24 FileUpload états, E25-E28 sidebar/ContextRail packagés ; rayons 2/4/8/16 (décision d'alignement non prise).

## 2026-10-11 — F-B8-06 fenêtre « Vous n'avez pas ce droit » (`wt/lostrights`)

- État réel du frontend : la fenêtre de refus DECISION-011 / masquage q02 n'EXISTE PAS encore côté frontend (ACTION_ITEMS ouvert) et il n'y a aucun centre de notifications (ni client API). Rien à recouvrir dans le code ; la fenêtre ajoutée est la seule gestion globale d'un 403.
- Le 403 ne porte la permission que dans le texte `Missing permission: x` : `ApiError.missingPermission` la parse (null sinon, jamais devinée). Déclenchement seulement sur écritures (non-GET) : les GET 403 dégradent volontairement (annuaires).
- `PermissionDeniedDialog` (Modal DS) dans `App.tsx`, via `onPermissionDenied` (abonné unique) dans `api/client.ts`. Les écrans qui gèrent déjà le 403 (RaciPanel readOnly) continuent de le faire en plus.
- Aucune suite de tests frontend ; `npm install` nécessaire dans un worktree neuf avant `npm run build` (plugin-react manquant sinon).

## Leçons correctifs vague 2 (QA/Sécu, branche `fix/ds-wave2`)

- Les types TS sont effacés à l'exécution : tout composant qui affiche une valeur venue de l'API doit tolérer un objet (jamais passer un non-scalaire à React comme enfant) -> `VersionComparison` affiche « (valeur complexe) ».
- Dans un composant, `{...rest}` va AVANT les props internes (`ref`) pour ne pas les écraser.
- Un état « désactivé » d'un conteneur doit bloquer réellement : `inert` + capture du clic (jsdom n'implémente pas `inert`).
- Ids ARIA dérivés de l'index, jamais d'une valeur libre (espaces = IDREF coupé).
- `.btn` inline-flex : garder un padding vertical, hauteurs en `min-height`.
- Les tests qui lisent le CSS avec `node:fs` exigent `/// <reference types="node" />` pour le typecheck du package.

## 2026-10-11 — DECISION-041 heatmap Cartographie suit l'échelle active (`wt/carto`)

- Précision de la règle « ne jamais toucher la Cartographie » : elle vise le VISUEL (couleurs, typo, disposition, légende), pas la logique de grille. La taille suit `GET /api/v1/cartography/scale` (`api/cartography.ts`) ; `data: null` => aucune grille + MessageBanner info (le DS n'a pas de composant EmptyState).
- Couleur d'une case = bande backend contenant `p*i` (plus de `ceil(x*y/5)`), bandes mappées par position sur la palette z1..z5 répartie linéairement (`round(1 + idx*4/(n-1))`) ; n≠4 accepté sans cas particulier.
- Plus aucun recadrage `Math.min(5,…)` des valeurs d'évaluation : un risque hors échelle est listé sous la grille (`cart-note`), jamais placé en silence sur la bordure.

## 2026-10-11 — Centre de notifications (`wt/notif`, DECISION-043 §1 / q70)

- `features/notifications/NotificationCenter.tsx` (cloche + compteur dans la topbar, Modal DS `md` avec Tabs Notifications / Abonnements) ; `api/notifications.ts`. Aucun nouveau composant ni jeton ; `.notif-*` n'utilise que des `--gs-*`.
- `apiRequest` déballe `{data}` : le `total` du backend est inaccessible. Compteur de non-lus = `GET ?read=false&limit=100` puis `length` (plafonné « 99+ »). Un échec affiche « inconnu », jamais 0.
- Gaps backend : pas de « tout marquer comme lu », pas de compteur de non-lus dédié, pas de catalogue des types d'événements (liste en dur des 4 types réellement persistés), abonnements non consultés à l'émission, notifications plans d'action/KRI non persistées (Telegram seulement), pas de deep-link par id (les écrans n'ouvrent pas un objet précis).
- Types réellement émis vers `notifications` : RIGHTS_LOST_ON_REACTIVATION, ADMIN_RISK_MANAGER_CUMUL, COMMITTEE_MEMBER_ADDED, AUDIT_RIGHTS_CHANGE_PENDING (tous MANAGEMENT). Type inconnu -> libellé « Notification ».
- Harnais : refuse les commandes Bash composées (heredoc + `&&`), utiliser Write.

## 2026-10-12 — q97 abonnements en lecture seule (`wt/q97`, DECISION-045 pt 2)

- Le code gérait déjà `mandatory` (badge « Obligatoire », bouton masqué). Ajouts : MessageBanner info « notifications obligatoires » (affichée si au moins un type `mandatory`) et état vide « Aucun type de notification reçu ». Le comportement des types `mandatory:false` (Activer/Désactiver) est conservé. Aucune règle recalculée côté front.
# Mémoire — @dev-frontend

## Principes
- Réutiliser strictement `@djamo/design-system` (Table, Card, Modal, FormField, StatusBadge, MessageBanner, LineChart) ; pas de nouveau composant générique.
- Jamais de règle métier recalculée côté front (statut/seuils) : afficher `status` renvoyé par le backend ; sinon bannière de gap + signalement A06.
- Jamais de champ d'attribution (`recordedBy`…) envoyé par le client.
- `erasableSyntaxOnly` : pas de parameter properties. Build : `npm install` à la racine (workspace), builder `packages/design-system` puis `frontend` (`npm run build`). Ne pas commiter `package-lock.json` modifié par l'install.
- `apiRequest` ne renvoie que `payload.data` : l'enveloppe de pagination (`total`) est perdue (ex. `/kri-measures`).

## Lot KRI / KPI (2026-10-12)
- Écrans : `features/indicators/KriPage.tsx`, `KpiPage.tsx`, helpers + `FormModal` dans `shared.tsx`, client `api/indicators.ts`. Navigation : vues `kri` / `kpi` dans `App.tsx` (+ type `View` de `ContextRail.tsx`).
- Correction orchestrateur : `PermissionDeniedDialog` existait bien (`features/errors`), le worktree partait d'un `main` en retard ; le doublon a été retiré à l'intégration, le dialogue global s'ouvre seul sur un 403 d'écriture.
- Masquage par permission impossible : aucun endpoint « mes permissions » sans `role.read` (`/roles/users/:id/permissions`). Actions toujours visibles, 403 -> dialogue.
- Pas de QA navigateur faite (pas de backend/login dans le worktree) : à faire en staging.

## 2026-10-12 — Référentiels : Processus, Départements, Catégories de risque
- Écrans : `features/referentials/{ProcessesPage,DepartmentsPage,RiskCategoriesPage}.tsx` + `ArchiveModal.tsx` (motif obligatoire, erreur serveur affichée telle quelle). Clients : `api/processes.ts`, `api/riskCategories.ts`, `api/departments.ts` (étendu : `listFull`, create/update/designateRiskOwner/archive ; `list` inchangé). Navigation : groupe Administration, vues `processes` / `departments` / `riskcategories` (App.tsx + type `View` de ContextRail).
- Contrats : création processus => `departmentId` obligatoire ; edit n'envoie un département que s'il est choisi (jamais de détachement) ; `evaluationMode` jamais envoyé (route + droit dédiés) ; catégories : PUT (pas PATCH), pas de route d'archivage, désactivation = `active:false` sous `config.manage` ; départements : `riskOwner` seulement à la création, ensuite `designate-risk-owner`.
- Ordre d'affichage en arbre (processus, catégories) = présentation seulement ; toute validation de niveau/parent reste serveur.
- Gaps A06 : (1) pas de "mes permissions" ; (2) valeur d'`evaluationMode` héritée effective non exposée (`resolveEvaluationMode` n'a pas de route) ; (3) pas de lien département -> processus ni compteur de références (archivage refusé par message texte) ; (4) catégories sans archivage dédié (règle CLAUDE.md "terminal = permission dédiée" : désactivation sous `config.manage`), sans indication d'usage, non référencées par risques/évaluations/appétence ; (5) `riskOwnerDesignatedBy` est un id brut sans libellé ; (6) pas de pagination/total sur les listes ; (7) `GET /departments` exige `department.read` (annuaire du formulaire Processus dégradé avec bannière).
- Pas de QA navigateur (build/tsc verts seulement).
