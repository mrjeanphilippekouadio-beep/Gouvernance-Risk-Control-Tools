# q217 / q237 : conservation des motifs de visibilité, du nom et des rôles

Date : 2026-11-08. Auteur : A05 (Architecte). Statut : **cadrage, aucun code**. À valider par A15 (section 6), puis questions au PO (section 4).

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
