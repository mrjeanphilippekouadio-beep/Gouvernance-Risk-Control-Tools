# q217 / q237 : conservation des motifs de visibilité, du nom et des rôles

Date : 2026-11-08. Auteur : A05 (Architecte). Statut : **cadrage, aucun code**. À valider par A15 (section 6), puis questions au PO (section 4).
**Mise à jour 2026-11-11** : réponses PO (DECISION-120) intégrées, découpage en lots et questions restantes en **section 8**. Les sections 2 à 4 restent comme historique des options.

Décisions de départ :
- **q217** (DECISION-110) : les motifs de visibilité sont conservés **un an**, durée configurable.
- **q237 A** (DECISION-116) : la durée de conservation du nom et des rôles d'un compte est **alignée sur celle du journal d'audit**, à fixer avec le DPO. Le texte R5 actuel dit « aucune durée n'est fixée à ce jour ».

Sources lues : CLAUDE.md, ACT-072 (`docs/architecture/ACT-072-cadrage-propose.md`), PRIV-VIS-V3/V4, texte R5, migrations 004, 038, 044, 066, 080, 084, 085, le code d'audit, de visibilité et de purge R3.
Limite : je n'avais pas d'accès git. La copie principale s'arrête à la migration 084. Le code de 085/086 et les fichiers de suivi les plus récents ont été lus dans les worktrees `.claude/worktrees/agent-aa01625b780ee7c38` (code) et `agent-a4a2d174766260cf7` (ACTION_ITEMS, DECISION-110 à 117). L'orchestrateur doit les rapprocher de `origin/chore/suivi-r1-f7s3`.

---

## 1. État actuel

### 1.1 Où vivent les motifs de visibilité

Un même motif est copié **à deux endroits**, parfois trois :

| Stockage | Colonne | Écrit par | Protection |
|---|---|---|---|
| `audit_log` | `reason` (texte libre ≤ 500) | `resourceVisibility.set` (`PERMISSION_CHANGE`), `applyPerimeterChange`, et les ouvertures avec motif (RACI, propriétaire de processus, groupe de département, désignation du propriétaire de risque, q212) | Ajout seul strict : trigger 038 (UPDATE/DELETE/TRUNCATE refusés), REVOKE |
| `resource_access_grants` (080) | `grant_reason` NOT NULL, `revoke_reason` | `changeVisibility` (ressources et risques) : même texte que l'audit | Garde 080 : contenu immuable, révocation une seule fois, aucun DELETE |
| `sensitive_view_grants` (079/084) | `reason`, `decision_reason`, `revoke_reason` | Demande de droit `resource.readall` | Garde 084 : contenu immuable |

Points à noter :
- `PERMISSION_CHANGE` est **aussi** utilisé par `RoleService` (changements de rôles). On ne peut donc pas repérer un « motif de visibilité » à partir de l'action seule. Aujourd'hui, aucune colonne ne marque un motif comme « motif de visibilité ».
- `grant_reason` sert aussi de **clé technique** : `PostgresRiskRepository.listCreationAccess` cherche `grant_reason = CREATION_GRANT_REASON` (constante, pas un motif saisi). Effacer ou pseudonymiser cette valeur casserait cette lecture. Il faut donc l'exclure de toute purge.
- `old_value` et `new_value` des lignes de visibilité ne contiennent que le niveau, la liste d'identifiants et `widening` : **aucun motif**.

### 1.2 Qui lit les motifs

- `GET /audit-logs` (`AuditLogService`, `audit.read`, réservé au groupe Audit depuis 081) : texte complet.
- `listRestricted` (`PostgresResourceAccessRepository`, liste des ressources restreintes) : dernier `PERMISSION_CHANGE` lu **dans `audit_log`**, aperçu de 140 caractères (q215 A). Lecteurs : groupes RM, Comité et Audit (`seesEverything`).
- `grant_reason` et `revoke_reason` : aucune lecture API trouvée, hormis la clé technique ci-dessus.

### 1.3 Où vivent le nom et les rôles

- `users.display_name`, `users.email` (002), `users.roles text[]` (attributions directes historiques), `users.deleted_at` (fin du compte, R3).
- `user_roles` (013) : `granted_at`/`revoked_at`, jamais supprimé ; `roles` porte les noms de rôles.
- **Contrainte structurante** : `audit_log.user_id` est `NOT NULL REFERENCES users (id)`. Comme le journal n'est jamais purgé (ACT-072 option C, décision finale du PO), **la ligne `users` ne peut jamais être supprimée**. Pour limiter la durée du nom, il faut donc le pseudonymiser dans `users`, pas supprimer la ligne.
- Lecteurs : annuaire (id + nom, q183/F7-S3), écran Audit (auteur des lignes), droits effectifs (`role.read` : administration, Audit, RM).
- Le texte R5 parle du « nom affiché » et des rôles. **L'e-mail n'est pas cité**, alors qu'il est conservé de la même façon (point A15).

### 1.4 Durée du journal d'audit aujourd'hui

- ACT-072 option C : **aucune purge**, seulement du masquage à l'affichage. Le cadrage parle de « ≥ 10 ans BCEAO » sans article vérifié.
- DECISION-038 n° 8 : « conservation 10 ans confirmée, configurable ». Le contexte est celui des évidences (EVD §33 n° 5). **Je ne sais pas si cette durée vaut pour le journal** : question PO.
- Conséquence pour q237 A : tant que le journal n'a pas de durée, « aligné sur le journal » veut dire **sans limite**.

### 1.5 Ce qui est déjà purgeable (085)

- `configs.last_seen_retention_days` : 1826 par défaut, CHECK 365–3650, NULL = jamais. Une réduction passe par une seconde personne (q232).
- `POST /api/v1/privacy/last-seen-purge` (`PrivacyService.purgeLastSeen`, permission `user.update`, lancement manuel q231 B, `dryRun`) : `UPDATE users SET last_seen_at = NULL, last_token_iat = NULL` pour les comptes finis depuis plus de N jours. Une trace `LastSeenPurge` plus une ligne `User` par compte sont écrites **dans la même transaction**. La date effacée n'est jamais recopiée dans le journal.
- Sauvegardes et PITR : disparaissent avec leur rotation normale (DECISION-114).
- **C'est le patron à réutiliser** : réglage par client, plancher, réduction par une seconde personne, purge manuelle tracée qui n'écrit **que des NULL ou des marqueurs**, jamais de DELETE.

---

## 2. Options pour q217 (motifs)

### Option A : motif stocké hors du journal (table dédiée, référencée par l'audit)

- **Base** : une migration (numéro suivant le dernier présent).
  - Nouvelle table `visibility_reasons` (`id`, `tenant_id`, `text` NULL, `created_at`, `effect_ended_at` NULL, `erased_at` NULL). Garde : INSERT avec texte ; un seul UPDATE permis (`text` vers NULL, `erased_at` posé, rien d'autre) ; pas de DELETE ni de TRUNCATE ; `search_path` pinné.
  - `audit_log.reason_ref uuid NULL` : ADD COLUMN nullable, sans réécriture, garde 038 **inchangée** (même approche que 066).
  - `resource_access_grants` : `grant_reason_ref` et `revoke_reason_ref` ; `grant_reason` devient nullable, sauf pour `CREATION_GRANT_REASON`. La garde 080 doit être reprise **en entier**, y compris les nouvelles colonnes dans la liste immuable.
  - `configs.visibility_reason_retention_days` : défaut 365 (valeur PO de q217), plancher selon Q3.
- **Code** :
  - Les points d'écriture (visibilité, périmètre, ouvertures q212, risques) insèrent le motif dans la table, puis l'audit avec `reason = NULL` et `reason_ref`.
  - `listRestricted` et `GET /audit-logs` font une jointure ; un motif effacé s'affiche « motif effacé le JJ/MM/AAAA (conservation) ».
  - Une purge sur le modèle de `last-seen-purge` (manuelle, `dryRun`, trace, même transaction).
  - Un test de garde qui échoue si une ligne de visibilité remet du texte dans `audit_log.reason`, sur le modèle de `boundedArray.test.ts`.
- **Ajout seul** : intact pour `audit_log`. La seule table effaçable est la table de motifs, et elle l'est explicitement.
- **Preuve d'audit** : la ligne garde qui, quand, quoi, l'avant et l'après, ainsi que la référence du motif. On sait qu'un motif a existé et quand il a été effacé, mais plus son texte.
- **Taille** : **M** (une migration, environ 6 points d'écriture, 2 lecteurs, une purge, des tests).
- **Risques** :
  1. **L'historique n'est pas couvert** : les lignes déjà écrites gardent `reason` en clair, et on ne peut les modifier sans exception. C'est acceptable seulement s'il n'existe aucun motif réel en production (H1, à vérifier). Les lots de visibilité sont fusionnés dans staging.
  2. Un futur point d'écriture pourrait réécrire le motif dans `reason`. Le test de garde le détecte.
  3. Il y a plus de jointures en lecture, mais les volumes sont faibles.

### Option B : exception étroite à l'ajout seul (pseudonymisation du seul champ `reason`)

- **Base** : une migration.
  - Colonne `audit_log.reason_retention text NULL` posée à l'INSERT (`'VISIBILITY'`), même approche que `governance_exception`.
  - Redéfinition de `audit_log_append_only_guard` (avec `search_path` pinné et répété). L'UPDATE n'est permis que si : toutes les colonnes sont identiques sauf `reason`, `NEW.reason` vaut un marqueur fixe, `OLD.reason` n'est ni NULL ni déjà le marqueur, la ligne est marquée `VISIBILITY`, et l'ancienneté dépasse la durée lue **en base** dans `configs`. DELETE et TRUNCATE restent toujours refusés.
  - Même exception sur la garde 080 pour `grant_reason`/`revoke_reason` (hors `CREATION_GRANT_REASON`).
  - Pour l'historique : les lignes non marquées ne sont éligibles que sur une liste explicite `entity_type` ∈ {Risk, Control, Anomaly, ActionPlan, Kpi, …} + `PERMISSION_CHANGE`. Cette liste est fragile.
- **Code** : une purge tracée (même patron que 085), et le marquage à l'INSERT. Les lecteurs ne changent pas : ils affichent le marqueur.
- **Ajout seul** : **première exception** sur le journal. Elle contredit l'invariant A23 (`update_audit_log` interdit) et CLAUDE.md (« append-only strict »). Il faut une décision HUMAN et les revues A23 et A10.
- **Preuve d'audit** : la ligne reste et l'exécution de la purge est tracée. En revanche, la base ne peut plus garantir qu'**aucune** ligne du journal n'a été modifiée. Un bug du trigger conditionnel ouvrirait une brèche dans l'intégrité.
- **Taille** : **S/M**. Elle couvre l'historique.
- **Risques** : précédent (« une exception de plus »), logique de garde complexe sur la table la plus sensible, ambiguïté de `PERMISSION_CHANGE` pour les lignes anciennes.

### Option C : supprimer le texte libre à la source (motif codifié)

- Le motif devient une liste fermée de catégories, comme le recommandait déjà Privacy pour V4. Le texte libre est supprimé ou passe par l'option A.
- Sans donnée personnelle, il n'y a rien à effacer, et le journal reste intact.
- **Mais** cette option revient sur q217 (un an) et q215 (texte libre visible du Comité). Elle ne couvre pas l'historique. Taille **S** (front + validation).
- C'est un complément possible à A, pas un substitut, sauf si le PO change d'avis.

*Écartée* : le chiffrement par motif avec destruction de la clé (crypto-shredding). Il ne touche pas au journal et couvre les sauvegardes, mais il exige une gestion de clés hors base (taille L), ce qui est disproportionné ici.

---

## 3. Options pour q237 (nom et rôles)

La ligne `users` ne peut pas disparaître (FK du journal). La seule durée possible est donc une **pseudonymisation de l'identité dans `users`**. Elle ne touche pas au journal.

- **Option A : durée D fixée avec le DPO.** À D après la fin du compte (`deleted_at`, même point de départ que R3), une purge manuelle met `display_name` à « Compte effacé n° … » et `email` à un pseudonyme unique (la contrainte `UNIQUE (tenant_id, email)` reste respectée).
  - `user_roles` et `users.roles` sont conservés, car sans nom ils ne désignent plus personne directement (à valider par A15).
  - La réactivation d'un compte pseudonymisé est refusée.
  - `configs.identity_retention_days` est **NULL par défaut** (= jamais, aucun nombre inventé), avec un plancher éventuel fixé par Compliance et une réduction par une seconde personne.
  - Le journal reste lisible : on voit « qui » sous forme de pseudonyme stable.
  - Taille **S/M** (calque de 085).
- **Option B : sans limite**, comme le journal (ACT-072 C). Rien à construire. Le texte R5 dit « conservés aussi longtemps que le journal d'audit, sans durée limitée ». Le DPO doit accepter explicitement une durée illimitée.

Lien avec q217 : l'auteur d'un motif (`audit_log.user_id`) reste visible après l'effacement du motif à un an, jusqu'à D.

---

## 4. Recommandation et questions au PO (format cockpit)

**Recommandation A05** :
- q217 : option A (motif hors du journal). Elle garde le journal en ajout seul strict et réutilise le patron 085. Condition : vérifier H1 (aucun motif réel en production). Si H1 est faux, revenir au PO pour une exception B limitée à l'historique.
- q237 : option A, avec une durée D fixée par le DPO (NULL d'ici là).
- Les deux purges se lancent à la main, dans un même écran « Conservation ».

Questions proposées. Les numéros sont indicatifs (q239 était le dernier utilisé au 2026-11-08) : l'orchestrateur les attribue.

1. **q240 — Conserver le motif un an sans modifier le journal d'audit**
   - A (reco) : motif dans une table à part, référencée par le journal et effacée à échéance (M).
   - B : exception étroite permettant d'effacer le seul champ motif du journal (S/M, première exception à l'ajout seul, revue A23/A10).
   - C : motif choisi dans une liste, sans texte libre (S, revient sur q215/q217).
   - Reco : **A**.
2. **q241 — Quels motifs sont concernés ?**
   - A (reco) : tous les motifs qui justifient un changement de qui lit une ressource restreinte (niveau, liste nominative, périmètre, ouvertures RACI/processus/département/désignation).
   - B : seulement le changement de niveau et de liste.
   - Les motifs des demandes de droit `resource.readall` restent conservés avec le journal dans les deux cas (avis A15 demandé).
   - Reco : **A**.
3. **q242 — Point de départ de l'année**
   - A : date de saisie du motif (lecture littérale de q217). Une restriction encore active peut alors perdre sa justification.
   - B (reco) : fin d'effet du motif (remplacé par un changement ultérieur, retour à « tout le client », ou accès révoqué). Pour une restriction active, la justification reste lisible.
   - Reco : **B** (+S).
4. **q243 — Plancher et réduction de la durée des motifs**
   - A (reco) : plancher égal à la durée décidée (365 jours) ; toute réduction passe par une seconde personne (comme q232).
   - B : autre plancher.
   - Reco : **A**.
5. **q244 — Durée du nom, de l'e-mail et des rôles après la fin du compte (q237)**
   - A (reco) : pseudonymisation du nom et de l'e-mail après une durée D **à fixer avec le DPO** (aucune purge tant que D n'est pas fixée) ; rôles conservés sans nom ; réactivation impossible ensuite.
   - B : sans limite, comme le journal ; le texte R5 le dit.
   - Reco : **A**.
6. **q245 — Durée du journal d'audit lui-même**
   - La « conservation 10 ans configurable » (DECISION-038 n° 8) vise-t-elle le journal (A) ou seulement les évidences (B) ?
   - Plancher réglementaire éventuel : à confirmer par Compliance (A14), aucun article n'est cité aujourd'hui.
   - Pas de reco : c'est une question de fait.

---

## 5. Ce qui dépend du DPO, et ce qui peut se faire sans lui

**Dépend du DPO (via le PO)** :
- La durée D du nom, de l'e-mail et des rôles (q244), et l'acceptation de la pseudonymisation comme fin de conservation.
- La confirmation qu'un an pour les motifs lui convient et que les sauvegardes suivent leur rotation normale (comme R3).
- Le texte R5 mis à jour : durée des motifs, durée de l'identité, mention de l'e-mail.
- Plancher réglementaire du journal : Compliance d'abord (q245), DPO informé.

**Faisable sans lui, après réponse du PO à q240–q243** :
- La vérification H1 : y a-t-il des motifs réels en production ? C'est une requête de lecture faite par l'orchestrateur ou DevOps.
- Toute la mécanique de l'option A : table, `reason_ref`, marquage, purge manuelle avec `dryRun` et trace, test de garde.
- La mécanique de q244 avec `identity_retention_days` à NULL : elle n'efface rien tant que la durée n'est pas fixée (fail-closed, même logique que 085).
- Les revues A10 et A23 de la garde de la nouvelle table.

---

## 6. À valider par A15 (Privacy)

1. **Équivalence** : une ligne d'audit qui garde l'auteur, la date et la référence d'un motif effacé satisfait-elle « motif conservé un an » ? Le texte effacé n'existe plus que dans les sauvegardes jusqu'à leur rotation.
2. **Périmètre (q241)** : faut-il inclure les motifs des demandes `resource.readall` (`sensitive_view_grants`), qui peuvent eux aussi nommer une personne ?
3. **Point de départ (q242)** : la saisie ou la fin d'effet ?
4. **Historique** : si H1 est faux, une exception B limitée aux lignes anciennes est-elle préférable à leur conservation en l'état jusqu'à la durée du journal ?
5. **Identité (q244)** : la pseudonymisation du nom et de l'e-mail suffit-elle, ou faut-il aussi retirer les rôles ? Les rôles et dates d'un pseudonyme peuvent-ils réidentifier dans une petite structure ?
6. **E-mail** : il est absent du texte R5 alors qu'il est conservé comme le nom. Faut-il l'ajouter ?
7. **Autres textes libres du journal** (motifs de rôles, désignations, profils) : ils peuvent nommer des personnes et sont conservés sans limite. Ils sont hors du périmètre q217 ; faut-il ouvrir un point séparé ?
8. **Exports déjà réalisés** du journal : ils échappent à toute purge. Faut-il une mention dans R5 ou une consigne ?

---

## 7. Hypothèses

- **H1** : aucun motif de visibilité réel n'est encore en production (lots V0–V4bis fusionnés dans staging). À vérifier avant de choisir A.
- **H2** : la fin du compte est `users.deleted_at`, comme pour R3 (`PostgresLastSeenRetentionRepository`).
- **H3** : les données de staging sont des données de test, sans obligation de purge (à confirmer par le PO).

---

## 8. Décisions du 11/11 et découpage en lots

Date : 2026-11-11. Auteur : A05. Source : DECISION-120 (`ACTION_ITEMS.md`), réponses PO q245 à q251. H1 est vérifiée (production à 046, aucun motif de visibilité en production). Documentation seulement, aucun code.

### 8.1 Réponses retenues

| Question | Réponse | Effet sur ce cadrage |
|---|---|---|
| q245 (libre) | « 10 ans, pas besoin du juriste ni du DPO ; mécanisme de soft delete utilisable directement en SQL » | Voir 8.2 (interprétation confirmée, avec précisions) |
| q246 A | Motif dans un espace séparé, référencé par le journal | Option A de la section 2 |
| q247 A | Tous les motifs, y compris les demandes de lecture élargie | `sensitive_view_grants` inclus (A15 C3) |
| q248 B | Départ = fin d'effet du motif, plus revue périodique des restrictions actives | `effect_ended_at` + lot de revue (L2c) |
| q249 A | Toute modification de durée (hausse ou baisse) par une seconde personne, tracée ; plancher 365 jours | Voir I-2 |
| q250 A | Pseudonymisation stable du nom et de l'e-mail après D fixée par le DPO ; rien tant que D est vide | Option A de la section 3, D = NULL |
| q251 A | Plus de nom ni d'e-mail dans les nouvelles lignes du journal | Lot L0, déjà en cours chez A06, non recadré ici |

### 8.2 q245 : interprétation confirmée, avec quatre précisions

L'interprétation de l'orchestrateur est **confirmée** : journal conservé 10 ans ; à l'échéance, aucune purge automatique ; marquage logique des lignes échues, déclenché à la main en SQL. Précisions :

1. **Rien n'est jamais supprimé physiquement.** Une ligne marquée reste en base. Elle disparaît seulement des écrans et des exports de l'application. Le texte R5 devra le dire (item DPO déjà ouvert, ligne 489 d'`ACTION_ITEMS.md`).
2. **Les 10 ans se comptent depuis `audit_log.created_at`.** Ce n'est pas un réglage de l'interface : le « configurable » de DECISION-038 n° 8 reste attaché aux évidences (lecture A14). Le PO a dit « directement avec du SQL », donc aucun écran, aucune route, aucune permission applicative.
3. **On ne peut pas marquer une ligne de moins de 10 ans.** La fonction refuse toute durée plus courte. C'est la seule protection contre une erreur de saisie dans une commande SQL lancée à la main.
4. **Le marquage n'est pas réversible par l'application.** Une correction passerait par une migration revue.

**Compatibilité avec l'ajout seul strict (CLAUDE.md, A23).** Une colonne `deleted_at` sur `audit_log` est impossible : la poser exige un UPDATE, que la garde 038 refuse. Solution retenue, la plus simple :

- Une **table de marquage séparée**, elle-même en ajout seul : `audit_log_retention_marks` (`audit_log_id` clé primaire et FK vers `audit_log`, `tenant_id`, `marked_at`, `marked_by` = rôle de base `current_user`, `run_id`). Garde : UPDATE, DELETE et TRUNCATE refusés, `search_path` pinné.
- Une **fonction SQL dédiée** `mark_expired_audit_log(p_tenant_id uuid, p_older_than interval DEFAULT '10 years')`. Elle refuse `p_older_than < '10 years'`, insère une marque pour chaque ligne du tenant plus ancienne et non encore marquée, puis renvoie le nombre de lignes et le `run_id`. `EXECUTE` est retiré à `PUBLIC` et au rôle d'exécution de l'application (043) : seul le propriétaire de la base peut la lancer. L'application ne peut donc pas masquer son propre journal.
- **`AuditRepository` ne change pas** : pas d'`update`, pas de `delete`. Seules les lectures de consultation de `PostgresAuditRepository` (`listForEntity`, `listRecent`, `search`) ajoutent `NOT EXISTS (marque)`. `audit_log` et sa garde 038 restent intacts.
- **Trace du marquage** : la table de marquage elle-même (qui, quand, quel lot). On n'écrit pas de ligne dans `audit_log`, car `user_id` y est NOT NULL et aucun utilisateur applicatif n'agit.
- Les lectures **techniques** du journal (dernier `PERMISSION_CHANGE` dans `listRestricted`, indicateurs de santé de la gouvernance) ne filtrent pas les marques. Ce sont des calculs, pas une consultation, et une restriction encore active ne doit pas perdre sa dernière trace.

### 8.3 Interprétations à confirmer en revue (pas des questions PO)

- **I-1** : la fin d'effet d'un motif est posée par l'événement qui y met fin, dans la même transaction (remplacement par un changement ultérieur, retour à « tout le client », révocation, refus d'une demande, expiration prévue d'un droit de lecture élargie). Un motif dont l'événement de fin n'est pas encore branché garde `effect_ended_at` NULL. Il n'est alors jamais effacé (fail-closed), mais il apparaît dans la revue périodique.
- **I-2** : q249 (seconde personne dans les deux sens, plancher 365 jours) s'applique aux **deux nouvelles durées** de ce chantier : motifs et D. Elle ne s'étend pas d'office à `lastSeenRetentionDays` (q232, réduction seulement), ni à la durée du journal, qui n'est pas un réglage (8.2).
- **I-3** : rôles conservés sans nom après pseudonymisation (q250 A, section 3). Je ne rouvre pas la réserve A15 : c'est une décision PO.

### 8.4 Lots

Les numéros de migration sont **indicatifs**. La PR #240 occupe 088 à 090. A07 revérifie le dernier numéro présent avant chaque lot (principe : jamais deviner).

**L0 : nom et e-mail hors des nouvelles lignes du journal (q251)**. En cours chez A06, non recadré.
- Migration : aucune. Taille : S.
- C'est un prérequis de L3 : sans lui, pseudonymiser `users` laisserait le nom dans les nouvelles lignes.

**L1 : marquage logique du journal à 10 ans (q245)**
- Contenu : table de marquage, fonction SQL, filtre sur les trois lectures de consultation (8.2), tests (fonction qui refuse moins de 10 ans, garde en ajout seul, lignes marquées absentes de `GET /audit-logs`, test de `search_path` QA-B6a11).
- Migration : **091** `audit_log_retention_marks` (+ `.down.sql`).
- Permissions : aucune permission applicative. Droit `EXECUTE` réservé au propriétaire de la base.
- Dépendances : aucune. Peut partir en parallèle de L0.
- Taille : **S**. Revues A23 et A10 (garde et droits d'exécution).

**L2a : motifs dans un espace séparé (q246, q247)**
- Contenu : table `visibility_reasons` (`id`, `tenant_id`, `source`, `text` NULL, `created_at`, `effect_ended_at` NULL, `erased_at` NULL, `reviewed_at` NULL) et sa garde (ajout, effacement unique du texte avec `erased_at`, `effect_ended_at` posée ou avancée, jamais reculée ni remise à NULL, aucun DELETE). `audit_log.reason_ref` nullable (même approche que 066, garde 038 inchangée). Références de motif sur `resource_access_grants` (motif d'ouverture, motif de révocation) et sur `sensitive_view_grants` (demande, décision, révocation). Les gardes 080 et 084 sont reprises **en entier**, avec les nouvelles colonnes dans la liste immuable. `grant_reason` ne garde que la constante `CREATION_GRANT_REASON`, qui sert de clé. Tous les points d'écriture (environ six, plus les demandes de lecture) écrivent le motif dans la table et la référence dans le journal. Lecteurs : `GET /audit-logs` et `listRestricted` font la jointure et affichent « motif effacé le JJ/MM/AAAA (conservation) ». Test de garde : aucune ligne de visibilité ne remet de texte dans `audit_log.reason`.
- Les textes déjà présents en staging dans les tables de droits sont déplacés vers `visibility_reasons` par la migration. Ceux de `audit_log.reason` restent en clair (H3, question Q-3).
- Migration : **092**.
- Permissions : aucune nouvelle.
- Dépendances : aucune (H1 vérifiée).
- Taille : **M**. C'est le plus gros lot.

**L2b : fin d'effet, durée et effacement des motifs (q248, q249)**
- Contenu : pose de `effect_ended_at` à chaque événement de fin (I-1). Réglage `configs.visibility_reason_retention_days` : défaut 365, minimum 365, NULL = jamais. Toute modification passe par le circuit de seconde personne de 076, en hausse comme en baisse. Effacement manuel avec `dryRun` sur le modèle de `last-seen-purge` (085) : texte mis à NULL, `erased_at` posé, trace dans la même transaction, jamais de DELETE.
- Migration : **093**.
- Permissions : nouvelle permission **`retention.purge`** (action terminale, donc pas `user.update` ni `config.update`). Le réglage de la durée reprend la permission et le circuit de `lastSeenRetentionDays`.
- Dépendances : L2a.
- Taille : **S/M**.

**L2c : revue périodique des restrictions actives (q248 B)**
- Contenu : liste des motifs encore actifs (`effect_ended_at` NULL) dont la dernière revue (ou la création) dépasse la période. Signal dans le panneau de santé de la gouvernance. Action « confirmer » qui pose `reviewed_at` et écrit une ligne d'audit. La revue ne prolonge rien et n'efface rien : elle force seulement une décision de maintien ou de retrait.
- Migration : **094** (réglage de la période, si Q-1 la rend configurable ; sinon pas de migration, `reviewed_at` étant créé en L2a).
- Permissions : `resourcevisibility.set` (existante ; la revue n'est pas une action terminale).
- Dépendances : L2a, et la réponse à **Q-1**.
- Taille : **S**.

**L3 : pseudonymisation du nom et de l'e-mail (q250)**
- Contenu : réglage `configs.identity_retention_days` NULL par défaut (rien n'est effacé), minimum 365 (I-2), seconde personne pour toute modification. `users.pseudonymized_at`. Pseudonyme aléatoire, non dérivé de l'identifiant : `display_name` « Compte effacé n° XXXX », `email` unique en `.invalid`. Point de départ `users.deleted_at` (H2). Réactivation refusée (service et garde). `user_roles` et `users.roles` conservés (I-3). Purge manuelle avec `dryRun` et trace dans la même transaction. La connexion Google se fait par e-mail : un e-mail pseudonymisé ne permet plus de rattacher le compte.
- Migration : **095**.
- Permissions : `retention.purge` (créée en L2b, ou ici si L3 passe avant).
- Dépendances : **L0 fusionné** (A15 C2). Indépendant de L1 et L2.
- Taille : **S/M**.

**Ordre recommandé** : L0 (en cours) et L1 en parallèle, puis L2a, L2b, L3, puis L2c dès que Q-1 est tranchée. L1, L2a et L3 touchent tous `permissions.ts` ou `server.ts` : un worktree par lot, fusion un par un.

### 8.5 Reste à fixer par le DPO (pas par le PO)

- **Durée D** de q250. Tant qu'elle est vide, L3 est livrable mais n'efface rien.
- Les autres points de la liste DPO d'A15 restent sur l'item déjà ouvert (ligne 489) : texte R5 (e-mail, copies dans le journal, lignes jamais supprimées physiquement après 10 ans), exports et sauvegardes.
- Le plancher juridique du journal n'est plus attendu (q245) : l'item ligne 488 est fermé.

### 8.6 Questions encore ouvertes pour le PO

Numéros à attribuer par l'orchestrateur.

**Q-1 : À quelle fréquence revoit-on une restriction d'accès encore active, et qui la revoit ?**
- A (reco) : tous les 12 mois, par le Risk Manager. Les restrictions en retard sont signalées dans la santé de la gouvernance, sans blocage.
- B : tous les 6 mois, par le Risk Manager ou par le propriétaire de la fiche, avec le même signalement.
- Reco : **A**. Elle s'aligne sur la durée d'un an des motifs (q217), et le Risk Manager voit déjà toutes les restrictions.

**Q-2 : Noms et e-mails déjà écrits dans le journal avant L0 : que fait-on ?**
- A (reco) : on les laisse tels quels. Ils sont masqués au bout de 10 ans comme le reste du journal, et le texte R5 dit que la pseudonymisation après D ne les couvre pas.
- B : on ouvre une exception à l'ajout seul pour pseudonymiser ces anciennes valeurs. Il faut alors une revue A23 et A10, et ce serait la première modification du journal.
- Reco : **A**. Elle est cohérente avec q245 (rien n'est jamais supprimé physiquement) et ne crée aucune brèche dans la garde 038.

**Q-3 : Les motifs de test déjà écrits dans le journal de staging peuvent-ils rester en clair ?**
- A (reco) : oui. Staging ne contient que des données de test, ce qui confirme H3, et la production n'a aucun motif (H1).
- B : non. Staging contient des données réelles ou une copie de la production : il faut traiter ces lignes comme en Q-2 B.
- Reco : **A**, sous réserve que le PO confirme qu'aucune donnée réelle n'a été saisie en staging.

---

## 9. Motifs libres hors visibilité (PRIV-L2A-03)

Date : 2026-11-13. Auteur : A05. Source : avis A15 `docs/privacy/PRIV-l2a-2026-11-13.md` (PRIV-L2A-03, condition C3), DECISION-120 (q245, q246 A, q247 A), DECISION-121 (q257), DECISION-129. Code lu dans `.claude/worktrees/agent-af8d5033fc01a3968/` (L2a), sans le modifier. Documentation seulement, aucun code. Aucune obligation légale n'est citée : le cadre applicable reste non établi (RGPD et loi ivoirienne : NOT_ESTABLISHED).

### 9.1 Règle de classement proposée

Le PO a décidé ce qui est effacé à un an : les motifs **de visibilité** (q246 A, q247 A, et q241 A pour leur définition). Il faut une règle, pas une liste, car le journal reçoit des motifs libres d'environ 40 services (environ 110 écritures `reason:` dans `services/`). Les cinq chemins cités par A15 n'ont rien de particulier par rapport aux autres : archivages, clôtures d'anomalie, confirmations de gouvernance, désignations, profils, etc.

- **Motif de visibilité** : l'acte porte sur le droit de lire **une ressource précise** (niveau, liste nominative, périmètre d'une ressource restreinte, ouverture RACI/processus/département/désignation, lecture élargie). Il va dans `visibility_reasons`. C'est déjà le cas en L2a (10 sources de `VisibilityReasonSource`).
- **Motif de décision de gouvernance** : l'acte porte sur une **fonction** (rôle, appartenance à un groupe fixe, exception de gouvernance) ou sur un **objet méthodologique** (Dispositif applicable, statut, archivage). Il reste dans `audit_log.reason`, 10 ans, puis il est masqué par L1 comme le reste du journal.
- **Texte commun aux deux** : il suit le régime le plus court. Une seule saisie sert parfois aux deux, par exemple un cumul avec une ouverture de groupe de département, ou un périmètre modifié en même temps que le Dispositif. Le texte est alors rangé comme motif de visibilité, avec une référence partagée. C'est ce que fait déjà la correction PRIV-L2A-01 visible dans le worktree (`RoleService.ts` l. 771-772, `RiskService.ts` l. 378-380), sous réserve des preuves A08. Conséquence acceptée : la justification du cumul ou du déplacement perd son texte en même temps que le motif de visibilité. La ligne d'audit garde l'acte, l'auteur, la date et la référence.

Un changement de rôle modifie bien qui lit, par exemple parce que les groupes RM, Comité et Audit voient tout. Mais cette lecture découle d'une règle de structure. Ce n'est pas l'objet du motif. Classer chaque changement de rôle comme motif de visibilité reviendrait à effacer à un an la preuve des décisions de gouvernance.

### 9.2 Classement des cinq chemins cités

| Chemin (worktree L2a) | Nature | Risque Privacy réel | Classement proposé |
|---|---|---|---|
| `RoleService.ts` l. 772, cumul seul (admin + RM/Comité/Audit, q63/q80/q104) | Motif d'une exception de gouvernance (cumul de fonctions), qui prévient un tiers | Faible à moyen : le texte parle d'une personne nommée par l'acte (pourquoi elle cumule). Il peut contenir un fait personnel (absence, départ) si la personne qui saisit l'écrit | Gouvernance, journal 10 ans |
| `RoleService.ts` l. 919 et 949, retrait d'un groupe fixe (motif obligatoire, `groupReason`) | Motif d'une décision sur une fonction | **Le plus élevé des cinq** : un retrait se justifie souvent par un fait sur la personne (départ, sanction, conflit d'intérêts, absence longue) | Gouvernance, journal 10 ans. C'est le cas qui justifie l'avertissement de saisie (9.3, option A) |
| `RoleService.ts` l. 919 + 933, retrait du dernier RM (`governanceException` q149) | Preuve d'une exception de gouvernance relue par la santé de la gouvernance | Comme la ligne précédente | Gouvernance, journal 10 ans. Effacer ce texte à un an affaiblirait la preuve de q149 |
| `ProcessService.ts` l. 225, déplacement d'un sous-processus vers un autre Dispositif (q257) | Motif méthodologique ; q257 l'a rendu obligatoire **pour la trace** | Faible : l'objet est un processus, pas une personne | Gouvernance, journal 10 ans |
| `RiskService.ts` l. 380, déplacement de Dispositif seul (q257) | Idem | Faible | Gouvernance, journal 10 ans |

Dans les cinq cas, le risque ne vient pas de la catégorie de l'acte. Il vient de **ce que la personne écrit** : un nom, ou un fait de santé ou de vie privée. Cela vaut aussi pour les quelque 100 autres motifs libres du journal.

### 9.3 Options pour le PO

**A — Laisser ces motifs dans le journal (10 ans puis masqués), le dire dans R5, et avertir à la saisie.**
- Construction : aucune côté serveur. Une ligne d'aide sous les champs « motif » concernés, au minimum le retrait d'un groupe fixe et le cumul : « Ce motif est conservé 10 ans dans le journal d'audit. N'y écrivez pas d'information personnelle (santé, vie privée) ». La phrase exacte est à valider par A15. Ajout au texte R5 (point 3 de la liste A15 Q4, rendu définitif). Taille **XS**.
- Ce que l'on garde : la preuve complète des décisions de gouvernance (q63, q149, q257) pendant toute la durée du journal, et la garde 038 intacte.
- Ce que l'on accepte : un fait personnel écrit malgré l'avertissement reste lisible par le groupe Audit (`audit.read`) jusqu'au masquage à 10 ans, puis en base sans limite (q245 : rien n'est jamais supprimé physiquement).

**B — Ranger aussi ces motifs dans l'espace séparé, effaçables comme les motifs de visibilité.**
- Construction : élargir `visibility_reasons` (renommage ou nouvelles valeurs de `source`, garde reprise en entier), environ 5 points d'écriture plus 2 lecteurs, tests PostgreSQL réels. Il faut aussi définir la « fin d'effet » d'un acte instantané (un retrait de rôle n'a pas de durée), donc une nouvelle règle de départ. Taille **S/M**, sur le chemin critique de L2b.
- Ce que l'on perd : le texte de la preuve des exceptions de gouvernance au bout d'un an, alors que le journal est gardé 10 ans pour servir de preuve (q245). La revue a posteriori de q266 et la santé de la gouvernance liraient « motif effacé ».
- Limite : cela ne couvre que 5 des quelque 110 écritures de motifs libres. Pour être cohérent, il faudrait soit tout migrer (taille L, et le journal n'aurait presque plus de motifs), soit accepter une frontière arbitraire.

**C — Remplacer le texte libre par une liste de motifs pour les rôles (et éventuellement les déplacements).**
- Construction : liste fermée (par exemple « changement de poste », « départ », « réorganisation », « autre ») plus un complément facultatif. Taille **S** (front + validation). La liste est à proposer par A13/A14, pas par l'architecte.
- Ce que l'on gagne : moins de texte personnel saisi.
- Ce que l'on perd : la nuance du motif. Le complément libre ramène le même risque. Cela s'éloigne aussi de la logique de q215/q257 (texte libre lisible).

### 9.4 Recommandation A05

**A**, avec l'avertissement de saisie. Raisons :
1. Ces motifs sont la preuve de décisions de gouvernance (exceptions q63/q149, déplacements q257). Le PO a fixé leur support et leur durée : le journal, 10 ans (q245). Les effacer à un an contredirait cette durée sans demande du PO.
2. Le risque Privacy ne dépend pas de la catégorie, il dépend du contenu saisi. Le traiter à la source (avertissement) couvre aussi les quelque 100 autres motifs libres, ce que B ne fait pas.
3. A ne crée aucune nouvelle durée, aucune nouvelle garde et aucune exception à l'ajout seul. B ajoute un lot sur le chemin critique de L2b pour une couverture partielle.
4. La règle 9.1 s'applique aux modules futurs sans nouvelle question. Elle est à ajouter à la recette « nouveau module » si le PO retient A.

Point à faire confirmer par A15 en suivi : si un fait personnel apparaît quand même dans un motif de gouvernance, A n'offre aucun moyen de l'effacer avant 10 ans (cohérent avec q270 A pour les noms anciens). Si le PO veut ce moyen, ce serait une exception à l'ajout seul (revues A23 et A10), pas l'option B.

### 9.5 Projet de question cockpit

**Titre** : Motifs saisis lors d'un changement de rôle ou d'un déplacement de Dispositif : combien de temps les garder ?

**Contexte** :
1. Les motifs qui ouvrent ou ferment l'accès à une fiche restreinte sont rangés à part et effacés au bout d'un an (votre décision q246/q247).
2. D'autres motifs sont saisis à la main et ne concernent pas l'accès à une fiche : retrait ou cumul d'un rôle (Risk Manager, Comité, Audit, administrateur), déplacement d'un risque ou d'un sous-processus vers un autre Dispositif.
3. Ils prouvent des décisions de gouvernance. Aujourd'hui, ils restent dans le journal d'audit 10 ans, puis ils sont masqués comme le reste du journal.
4. Le risque : une personne peut y écrire un fait personnel (par exemple une raison de santé pour un retrait de rôle), lisible par l'Audit pendant 10 ans.
5. Privacy demande que ce point soit tranché avant le lot d'effacement des motifs (L2b).

**Options** :
- **A (reco)** : on les garde dans le journal 10 ans, comme preuve. Un message sous le champ demande de ne pas y écrire d'information personnelle, et le texte de confidentialité (R5) le dit. Très petit travail.
- **B** : on les range avec les motifs d'accès et on les efface au bout d'un an. Lot moyen avant L2b. La preuve de ces décisions perd son texte après un an, et environ 100 autres motifs libres du journal restent non couverts.
- **C** : on remplace le texte libre par une liste de motifs (changement de poste, départ, réorganisation, autre) pour les rôles. Petit lot. Moins de détail sur le motif.

**Recommandation** : **A**. Ces motifs servent de preuve pendant toute la durée du journal, que vous avez fixée à 10 ans. Le vrai risque vient de ce qui est écrit, et le message de saisie le réduit pour tous les motifs, pas seulement pour ces cinq-là.
