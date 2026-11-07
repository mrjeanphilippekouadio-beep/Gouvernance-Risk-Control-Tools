# Revue Sécurité A10 — lot D6 du panel de gouvernance + R3/R5 (2026-11-04)

- Cible : `git diff origin/staging...origin/feat/r1-governance-d6` (staging `513d1cc`, HEAD `e8e1ef9`), migration 085.
- Méthode : analyse statique, `npx vitest run` de `governance-health` et `privacy-r3-r5` (13 verts, 2 ignorés car il faut une base), `tsc --noEmit` propre. Aucun code modifié, aucune base.

**Escalade HUMAN : aucune** (CVSS maximal 3,8). **Verdict : VERT avec réserves.** Deux constats LOW sont à traiter avant la production : la purge irréversible déclenchable par un seul administrateur (D6-01), et le contenu du journal d'audit exposé sans `audit.read` (D6-02).

## 1. Ce qui tient : PASS

| Point | Résultat |
|---|---|
| Tenant | Chaque requête de `PostgresGovernanceHealthRepository` filtre `tenant_id = $1`, jointures comprises (`users`, `roles`, `user_roles`, auto-jointure `audit_log`). La purge filtre `tenant_id`. Les routes n'ont aucun paramètre : le tenant vient de l'acteur. |
| Lecture du panel | `governancehealth.read` est vérifié dans le service. Aucune écriture. |
| R-6.1 / q156 sans `audit.read` | Les offenders USER deviennent « Personne N » (`id: null`, pseudonyme valable pour cette réponse seulement). Auteurs des exceptions, `acceptedBy` et `confirmedBy` sont nuls. Aucun détail USER ne porte de date. Les comptages restent visibles. |
| Risques restreints | Le libellé n'est renvoyé que si `visibility = 'CLIENT'` (PERIMETRE aussi est masqué : échec fermé). Les détecteurs DECISION ne renvoient que `entityType id` + action + date du jour, jamais de contenu. |
| Instantané D5 | `offenderKeys` = `kind` + `id` seulement, aucun nom. |
| Purge R3 | `UPDATE … SET NULL`, jamais de DELETE. Filtre tenant + `deleted_at` + durée côté SQL, sans paramètre client. Idempotente. Audit par compte dans la même transaction (`runAudited`), sans copier la date effacée (`oldValue: null`). Limiteur de débit par utilisateur. |
| 085 | Ni fonction ni trigger : la règle `search_path` est sans objet. CHECK 1–3650. Idempotente. Le down retire les 2 colonnes sans DELETE métier ; un re-up refixe `governance_tracking_started_at` à la date du jour (perte de l'historique de suivi : INFO, voulu par q143). |
| `GET /privacy/notice` | Ouvert à tout compte connecté. Il ne renvoie que la durée de conservation du client (DPO toujours `null`), aucune donnée personnelle. |

## 2. Constats

### D6-01 — Un seul administrateur peut effacer d'un coup la seule trace de dernière connexion des comptes terminés (LOW, CVSS 3,8 `AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:L`, CONFIRMED par lecture)

- `last_seen_at` / `last_token_iat` sont la **seule** trace de la dernière connexion : `lastSeen.ts` n'écrit rien dans `audit_log`. Pour une enquête sur un ancien salarié, c'est une preuve.
- Le circuit des délais traite **raccourcir** comme un resserrement, donc applicable directement (`isLengthening`). Or, pour une durée de conservation, raccourcir est l'opération destructrice. Un administrateur (`config.governancedelays.set`) règle `lastSeenRetentionDays = 1`, puis appelle `POST /privacy/last-seen-purge` (`user.update`, qu'il détient). Toutes les dates des comptes suspendus depuis plus d'un jour sont effacées, de façon irréversible. Il n'y a ni seconde personne, ni marqueur, ni notification. Un compte suspendu temporairement est concerné aussi.
- **`user.update` pour la purge** : acceptable. La route n'applique que la politique du client (ni cible ni date au choix de l'appelant, idempotente). Le vrai point de contrôle est le **réglage** de la durée.
- **Correctif attendu (A06 ; plancher à fixer par HUMAN/Privacy)** : pour `lastSeenRetentionDays`, **inverser le sens** dans `setGovernanceDelays`. Raccourcir (ou passer d'une durée à une durée plus courte) = assouplissement, donc seconde personne q182 (`config.selfvalidation.approve`) ou marqueur `adminAlone` + notification. Ajouter un plancher (par exemple 365 j) dans le CHECK, la route et le service. Test : raccourcir → demande PENDING, purge sans effet tant que la demande n'est pas approuvée.

### D6-02 — Le panel expose du contenu du journal d'audit à des lecteurs sans `audit.read` (LOW, CVSS 2,7 `AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED par lecture)

- `exceptions.items` renvoie, pour chaque ligne marquée de `audit_log` : `reason` (texte libre saisi au moment de l'exception), `entityType`/`entityId`, `action` et l'horodatage exact. V0-03 a réservé `audit.read` au groupe AUDIT, parce que le journal est une seconde copie du contenu. Or ici le motif d'une auto-validation sur une évaluation ou une décision d'un risque NOMINATIF peut décrire ce risque.
- Ces données vont aux administrateurs (`governancehealth.read` par 066), qui n'ont droit qu'aux métadonnées A1. Elles vont aussi à **tout rôle ordinaire** auquel un administrateur pose `governancehealth.read` : la permission n'est pas verrouillée dans `assertRolePermissionRules`.
- Écarts mineurs du même ordre :
  - les offenders RISK donnent l'id d'un risque restreint et « propriétaire suspendu », plus que A1 (qui donne déjà l'id) ;
  - `acceptance.reason` (texte libre) est renvoyé sans `audit.read` ;
  - les détails des offenders USER (« membre d'Audit et Risk Manager », rôle auto-attribué) permettent souvent de réidentifier la « Personne N » via la matrice des droits. C'est inhérent, INFO.
- **Correctif attendu (A06)** : `reason` et l'horodatage exact (garder `ageDays`) seulement pour `audit.read` ou `governanceexception.review` (les relecteurs en ont besoin). Ids et `detail` d'un risque non CLIENT seulement pour un lecteur qui voit tout (`seesEverything`). Et, au choix de HUMAN : verrouiller `governancehealth.read` aux groupes fixes + administrateurs, ou l'accepter explicitement sur un rôle ordinaire.

## 3. Réponses aux questions

- **Les détecteurs lisent-ils hors du périmètre de visibilité ?** Oui : lecture au niveau client, sans scope, par nature (c'est un contrôle de gouvernance). Ils ne renvoient jamais le libellé d'un risque restreint. Ils renvoient en revanche les ids, l'état « sans propriétaire / propriétaire suspendu » et les motifs du journal (D6-02).
- **`user.update` pour un effacement irréversible ?** Oui pour l'exécution, non pour la décision : c'est le réglage de la durée qui doit passer par une seconde personne (D6-01).

| Constat | Sévérité | Owner | Statut |
|---|---|---|---|
| D6-01 | LOW 3,8 | A06 + HUMAN/Privacy (plancher) | REMEDIATION_REQUIRED (avant production) |
| D6-02 | LOW 2,7 | A06 + HUMAN (portée de `governancehealth.read`) | REMEDIATION_REQUIRED |
| INFO (réidentification par rôle, re-up de 085) | INFO | PO | Ouverts |

## Retest A10 (2026-11-07, HEAD `3a1416a`)

- Méthode : analyse statique du delta `e8e1ef9..3a1416a`. Vitest `governance-health`, `privacy-r3-r5`, `QA-governance-d6` et `RoleService` : 54 verts (43 ignorés car il faut une base). `tsc` propre. Aucun code modifié.
- **Verdict final du lot D6 : VERT.** Aucune escalade.

| Point | Résultat | Analyse |
|---|---|---|
| D6-01 | **RETEST_PASS** | Plancher de 365 j dans la route, le service et le CHECK de 085. `isRelaxation` inverse le sens pour `lastSeenRetentionDays` : raccourcir, ou passer de NULL à une durée, est un assouplissement, qui passe par la seconde personne q182 (ou par `adminAlone` marqué quand il n'y a aucun approbateur, comme les autres délais). Allonger ou passer à NULL reste direct (on conserve plus longtemps). Un admin seul ne peut donc plus effacer d'un coup. Chaque purge réelle laisse une trace `LastSeenPurge` (nombre et durée, même à zéro) dans la transaction de l'effacement, plus une ligne par compte, sans la date. Résidu INFO (classe V4-04) : 085 est modifiée en place. Une base qui a déjà la première version garde le CHECK 1–3650, et `PrivacyService` applique la valeur stockée sans la borner. À vérifier sur les bases déjà migrées, ou ajouter `Math.max(valeur, 365)` dans le service. |
| D6-02 | **RETEST_PASS** | `assertRolePermissionRules` n'accepte `governancehealth.read` hors groupe fixe que sur un rôle d'administration. Motif et heure exacte réservés à `audit.read` / `governanceexception.review` ; les autres ont le jour seulement et `reason: null`. Les offenders restreints (`restricted`) deviennent un simple compte pour qui n'est pas membre d'un groupe fixe, au sens de l'appartenance réelle dans `facts`. Résidu INFO : `entityId` d'une exception ou libellé DECISION portant sur un objet d'un risque restreint (une évaluation, par exemple) reste un id. C'est sans contenu, et A1 donne déjà les ids aux admins. |
| QA-D6-01 | **PASS** | Sans `audit.read`, tout uuid de compte dans `id`, `label`, `detail` ou `entityId` est remplacé par le pseudonyme « Personne N » de la réponse. Les uuid qui ne sont pas des comptes sont laissés. |
| QA-D6-02 | **PASS** | `offendersTotal` vient de `count(*)` tenant-scopés (risques, processus, exceptions par règle). Aucun libellé. |
| q231 B | **PASS** | `dpo_contact` : aucune route d'écriture (saisie à la mise en service), CHECK 1–300, renvoyé par `/privacy/notice` (information publique voulue). `retentionPurge` = date et ancienneté de la dernière purge, lues dans le journal du tenant. |
| `?dryRun=true` | **PASS (INFO)** | Il renvoie le nombre et les ids des comptes suspendus concernés, sans date ni nom ni écriture, sous `user.update`. Or `user.update` est une permission d'administration : son porteur gère déjà ces comptes (liste des utilisateurs, suspendus compris). Rien de plus n'est révélé que « suspendu depuis plus de N jours, avec une date de dernière activité ». Acceptable. Proposé : ne journaliser le dry run que si le PO veut tracer les consultations (pas nécessaire). |
| Down | **PASS** | Il retire aussi `dpo_contact`. Pas de fonction, `search_path` sans objet. |

| Constat | Statut |
|---|---|
| D6-01, D6-02 | **RETEST_PASS → CLOSED** (côté Security) |
| 085 modifiée en place (CHECK), ids d'objets de risques restreints | INFO (A07/A06) |
