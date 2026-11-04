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
