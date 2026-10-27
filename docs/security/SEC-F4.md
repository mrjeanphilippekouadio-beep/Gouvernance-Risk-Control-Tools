# SEC-F4 — Revue sécurité A10 du lot F4 (profil, désignations, comptes)

- Branche : `feat/f4-profil-designations-comptes`, diff `origin/staging...HEAD` (commits f7c06f5, 00b7338, cfeb823, 2dc9fdd, 7b920ba).
- Date : 2026-10-26. Méthode : revue statique du diff et des dépendances appelées (SelfValidationGate, PostgresGovernanceQueries, PostgresUserRepository, résolution d'identité dans server.ts, middleware D5), plus `vitest` D2b + UserService (35/35 verts) et `tsc --noEmit` (OK). Aucun PoC sur une base réelle.
- Verdict : **VERT avec réserves**. Aucune escalade HUMAN (CVSS max 2,7).

## Réponses aux points posés

### 1. `GET /users/me/permissions`: PASS
- `UserService.getSelfPermissions` (UserService.ts:164) renvoie `actor.roles` passé dans `filterKnownPermissions`, dédoublonné et trié. `actor.roles` est calculé à l'identification (server.ts, `lookupMembership`) : `BASE_PERMISSIONS`, puis `users.roles` hérités déjà filtrés, puis permissions RBAC des rôles non révoqués et non supprimés. Le second filtre retire aussi les chaînes inconnues venant de `roles.permissions`.
- Le résultat ne décrit que l'appelant, et `getSelf` relit la ligne par `(actor.tenantId, actor.userId)`. Un compte suspendu n'arrive pas jusqu'ici, car `lookupMembership` filtre `deleted_at IS NULL`. La route est déclarée avant `/:id`.
- Aucune fuite : l'appelant connaissait déjà ces droits, puisque chaque 403 les révèle un par un.

### 2. `GET /users/directory`: PASS, avec F4-03 INFO
- Garde (UserService.ts:174) : `user.read` OU `process.responsibility.assign` OU `designation.manage`. Elle utilise `actor.roles.includes`, avec la même sémantique que `requirePermission` (pas de joker). Le tenant vient de `actor.tenantId`, jamais du client : rien ne passe d'un tenant à l'autre.
- Données : `id` et `displayName` des comptes actifs, sans e-mail ni rôles. Ce qui est exposé reste proportionné : le Risk Manager et l'admin doivent pouvoir désigner, et `ownerCandidates` (D2b) exposait déjà id + nom à ces mêmes acteurs.
- Borne : `list(..., { limit: 500 })`. Par défaut, `list` exclut déjà les suspendus (`AND deleted_at IS NULL`), donc le filtre du service est redondant mais sans danger.

### 3. q166, exception à I-R1 (`ProcessService.setResponsibilities`): PASS, avec F4-01 LOW et F4-02 LOW
Ce qui tient :
- Périmètre limité au champion. Propriétaire et N-1 = soi restent refusés sans exception (ProcessService.ts:240). Les ids sont canonisés avant comparaison (classe SEC-ID-01 couverte).
- Sans gate : refus (`checkSelfValidation`). Avec une politique différente de `DOUBLE_CONFIRMATION` : refus. Si un autre détenteur actif existe (`existsOther`, qui exclut les suspendus et les rôles révoqués ou supprimés, avec la même union que l'identité) : refus, sans le nommer. Sans `governanceConfirmation { rule: "noSelfValidation", reason }` : 409. Le motif passe par `reasonText` et `isAcceptableReason`, qui refusent NUL, Cc et les surrogates isolés. Le client ne peut donc pas faire échouer l'insertion d'audit par le motif (vecteur SEC-PNL-01 fermé).
- L'audit porte `governanceException: "noSelfValidation"`, `newValue.selfValidation { otherValidatorExists: false, reason }` et `reason`. Le notifier D5 (monté sur tout `/api/v1`) émet `GOVERNANCE_EXCEPTION_RECORDED` vers les détenteurs de `governanceexception.review` et le RM.

**F4-01 LOW, CVSS 2,2 (AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N), CONFIRMED par lecture, owner A06**
- ProcessService.ts:266 (`processes.setResponsibilities`) puis :269 (`audit.record`) : deux requêtes sur le pool, hors transaction. Les autres chemins d'exception passent par `writeAudited` : effet et ligne d'audit marquée dans une seule transaction (DECISION-079, ex. ControlEffectivenessService.ts:101).
- Si l'insertion d'audit échoue après l'UPDATE (erreur transitoire, coupure Neon, arrêt d'instance), l'auto-désignation est committée sans marqueur, sans motif et sans notification. `forEntities` affichera « indépendant ».
- Le client ne contrôle pas ce déclenchement (motif filtré), d'où LOW.
- Recommandation : passer par `writeAudited` (ou une transaction effet + audit), au moins quand `selfChampion` n'est pas nul.
- Test de régression : un audit qui échoue doit laisser `risk_champion_user_id` inchangé.

**F4-02 LOW, CVSS 2,7, PROBABLE, owner HUMAN/A06 (classe SEC-PNL-04 déjà ouverte)**
- « Personne d'autre ne détient `process.responsibility.assign` » se lit sur l'état courant. Cette permission est détenue par le groupe RM et par les rôles d'admin (migration 069).
- Un admin qui veut se nommer champion doit d'abord faire disparaître les autres détenteurs : suspension (`user.delete`, silencieuse, sans motif, voir point 5), révocation de rôles, vacance RM (q160). La garde `assertNotLastRiskManager` impose le RM en titre ou la vacance déclarée.
- Chaque étape est auditée et l'exception finale est notifiée. Abus possible, mais visible : pas de nouvelle classe, c'est la leçon « tiers fabricable » déjà au tracker.
- Recommandation inchangée : fenêtre « tiers retiré depuis moins de N jours compte encore », ou notification des retraits.
- Note : l'erreur 409 `GOVERNANCE_CONFIRMATION_REQUIRED` révèle à l'acteur que personne d'autre ne détient la permission. Ce comportement est voulu (q140), INFO.

### 4. Front : PASS
- `usePermissions` (frontend/src/auth/usePermissions.ts) ne sert qu'à masquer des boutons. Pendant le chargement ou en cas d'erreur, il renvoie « vrai », donc le bouton reste visible et c'est le serveur qui décide (403). Il n'en sort aucune décision de sécurité : acceptable.
- Aucun champ `...By` n'est envoyé : `designatedBy`, `submittedBy`, `decidedBy` et `endedBy` sont des types de réponse uniquement. Les corps envoyés sont `{kind,userId,reason,validUntil}`, `{reason}`, les responsabilités avec `governanceConfirmation`, et `{email,displayName,roleId}`.
- Aucun `dangerouslySetInnerHTML` dans le diff. Le texte serveur est rendu par JSX (échappé).

### 5. `UserService.suspend` sans motif : dette existante, hors diff (F4-04 LOW, CVSS 2,2, CONFIRMED, owner A06/PO)
- UserService.ts:250 n'est pas modifié par le lot : l'audit enregistre `reason: null` et la route n'accepte pas de corps.
- Le lot F4 rend cette action accessible en un clic depuis l'IHM (UsersAdmin, bouton « Suspendre » sans champ motif).
- La suspension est réversible (`user.reactivate`) et gardée par une permission dédiée (`user.delete`, pas `user.update`) : ce n'est pas une violation SEC-013/014. En revanche, elle sert de levier à F4-02 / SEC-PNL-04.
- Recommandation : motif obligatoire (`reasonText`) au service et à la route, champ motif dans UsersAdmin. Non bloquant pour F4.

### F4-03 INFO, directory tronqué
- `list` trie par e-mail puis applique `LIMIT 500`, et le service retrie par nom : au-delà de 500 comptes actifs, la troncature est silencieuse et certains comptes ne peuvent pas être choisis.
- Effet fonctionnel seulement (échec fermé), sans portée sécurité. Recommandation : signaler la troncature ou passer à une recherche.

## Limites
- Revue statique, sans PoC sur PostgreSQL. F4-01 est établi par lecture du code (deux `pool.query` distincts), sans injection de panne.
- Les écrans OrganizationProfilePage et DesignationsPage n'ont été vérifiés que sur les corps envoyés. Les routes serveur correspondantes (D2c/D4) ont été revues lors des passages précédents.
