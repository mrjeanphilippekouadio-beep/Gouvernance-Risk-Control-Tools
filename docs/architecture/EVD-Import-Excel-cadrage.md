# EVD — Import Excel d'évidences : cadrage face à l'existant

**Statut** : PROPOSITION de l'Architecte (A05), 2026-10-08. Ni code ni migration.
**Source** : `docs/specs/CDC-module-evidences-excel.md` (CDC). Consigne ponytail.

## 1. Écart avec l'existant

| Exigence CDC | Existant | Manque |
|---|---|---|
| Fichier original conservé (§3.1) | `EvidenceService.upload` (`backend/src/services/EvidenceService.ts:29`) vérifie l'exécution dans le tenant (`:50-55`), puis Drive, puis la ligne en base, puis l'audit, avec compensation (`:75-117`) | Rien sur ce flux. Il est réutilisé tel quel |
| Isolation tenant avant tout accès au stockage | `getOwnedOrThrow` (`EvidenceService.ts:174`), `EvidenceRepository.getById(tenantId, id)` | — |
| Type de fichier | `validateEvidenceFile` (`services/evidenceFileValidation.ts:3-7`) n'autorise que PDF, PNG et JPEG, avec contrôle de la signature | Ajouter xlsx : MIME OOXML, extension `.xlsx`, signature ZIP `PK\x03\x04`, et ouverture réussie par le parseur |
| SHA-256, taille, MIME (§3.1, AC-03, AC-14) | **Absents** : la table `evidences` (`migrations/003_risks.sql:41-53`) et l'entité (`domain/entities/Evidence.ts:7-19`) n'ont ni `sha256`, ni `file_size`, ni `mime_type` | Colonnes plus calcul serveur avec `node:crypto` (aucune dépendance) |
| Lien évidence → exécution → contrôle | FK `evidences.control_execution_id` (`008_control_executions.sql:29-31`), `control_executions.control_id` (`:9`) | Le lien est **nullable** (`003:44`). Il devient obligatoire pour une évidence Excel |
| Permissions | `evidence.read`, `evidence.upload`, `evidence.delete` (`domain/permissions.ts:14-16`, `:200-202`) | `evidence.download` et `evidence.import`, voir §3 |
| Audit des consultations et téléchargements (§22, §23) | `getUrl` (`EvidenceService.ts:122-127`) **ne journalise rien** | Journaliser `EVIDENCE_DOWNLOADED` |
| Lister les évidences d'une exécution | `listForControlExecution` existe (`EvidenceRepository.ts:11`) mais aucune route ne l'expose (`api/v1/evidences.routes.ts`) | Une route GET |
| Relire le fichier pour le parser | `DocumentStorage` ne propose que `upload`, `getUrl` et `delete` (`infrastructure/storage/DocumentStorage.ts:12-21`) | `getContent(storageFileId)` : une méthode, `files.get alt=media` côté Drive |
| Parseur xlsx | **`exceljs` est déjà une dépendance** (`backend/package.json:22`), utilisé par `RiskImportService` (`services/RiskImportService.ts:43-84`) avec le même schéma prévisualisation/validation (re-parse au commit, plafond de lignes `:15`) | Rien à ajouter |
| Dataset, schéma, version, import, record, lineage | Rien | Le cœur du module |
| Conservation (§3.1, AC-15) | `GoogleDriveStorage.delete` envoie le fichier à la corbeille (`GoogleDriveStorage.ts:81-84`). **Drive vide la corbeille au bout de 30 jours** : l'original finit donc détruit | Point Compliance, voir décision 5 |

**Choix du parseur : `exceljs`, déjà présent.** C'est la solution ponytail, puisqu'aucune dépendance n'est ajoutée. Côté sécurité, il n'exécute pas de macros et n'évalue pas les formules : une cellule à formule est lue comme `{formula, result}`. On ne stocke que `result`, la valeur mise en cache par Excel, et on marque la cellule. Si `result` est absent, la valeur est `null` et un avertissement est émis. Les liens externes ne sont jamais suivis. On écarte SheetJS (`xlsx` sur npm) : la version publiée sur npm n'est plus maintenue et elle reste exposée à la pollution de prototype CVE-2023-30533. Risque résiduel d'`exceljs` : il n'y a pas de plafond de taille décompressée (bombe ZIP). On le limite par la taille du fichier, un plafond de lignes et de colonnes, et un traitement en mémoire borné. Le risque est à accepter par A10. L'override `uuid` (`package.json:45`) reste à maintenir.

**Synchrone, pas de file d'attente.** L'offre Render gratuite (512 Mo de RAM, à revérifier) n'a pas de worker, et `exceljs` charge tout le classeur en mémoire. On reste en synchrone avec des plafonds stricts : 5 Mo et 20 000 lignes × 50 colonnes, proposés à la décision 2. L'import garde quand même un statut (`STARTED` → `COMPLETED`/`FAILED`/`CANCELLED`). Ainsi, passer plus tard à l'asynchrone ne changera pas le modèle.

**Incohérence du CDC à trancher dans le modèle.** §19.1 met `control_execution_id` sur le dataset. Or §7.3 montre un dataset qui regroupe plusieurs exécutions (Janvier, Février…). Proposition : le **dataset** porte `control_id` + période d'exercice + entité, et chaque **fichier** porte son `control_execution_id` (colonne déjà existante). On ajoute un invariant de service : `execution.controlId = dataset.controlId`.

## 2. MVP réduit

**Conservé (V1)** : upload `.xlsx`, choix de la feuille et de la ligne d'en-tête (en-tête en ligne 1 par défaut, modifiable, ce qui répond au risque R1), inférence basique (texte, nombre, date, booléen, colonne vide), mapping saisi par l'utilisateur, schéma versionné et immuable une fois utilisé (§13), validation des lignes (type, obligatoire, ligne vide), erreurs ligne/colonne/valeur/cause, persistance JSONB, historique des imports.

**Exigences de traçabilité, toutes conservées** : fichier immuable plus SHA-256, recalculé à la relecture pour détecter une altération côté Drive ; lineage record → import → fichier → exécution → contrôle, et fichier → dataset, par FK ; audit append-only par l'`AuditRepository` existant ; soft delete partout ; `tenant_id` sur chaque nouvelle table et dans chaque filtre ; attribution (`uploadedBy`, `initiatedBy`, `createdBy`) forcée à `actor.userId`.

**Reporté** :
- scores de confiance et les trois niveaux de mapping (§9, §10). En V1, une correspondance exacte d'en-tête normalisé propose le champ, le reste se mappe à la main ;
- comparaison fine des schémas (§12, cas B) : en V1, un même ensemble de colonnes donne la même version, sinon on propose une nouvelle version ;
- clé de rattachement (§11), doublon de clé, détection de doublons métier ;
- CSV, XLS, exports, règles de transformation, notifications, ingestion par API, toute la Phase 3.

**Simplifications de modèle** :
- pas de table `evidence_schema` distincte : en V1, un dataset a un seul schéma ;
- les champs vivent en JSONB dans la version (`evidence_schema_versions.fields`), car ils ne sont jamais interrogés un par un ;
- les erreurs sont stockées en JSONB sur l'import, bornées par le plafond de lignes.

## 3. Lots

| Lot | Périmètre | Taille | Dépend de | Permissions | Migration |
|---|---|---|---|---|---|
| **EVD-1 Socle preuve xlsx** | xlsx dans l'allowlist ; `sha256`, `file_size` et `mime_type` sur `evidences` ; détection de doublon par hash dans le tenant (409 avec l'évidence existante, ou nouvelle référence si le client le demande explicitement) ; exécution obligatoire pour un xlsx ; `getContent` sur `DocumentStorage` ; audit du téléchargement ; route de liste par exécution | S | Décisions 1, 2, 9 | `evidence.download` (nouvelle) remplace `evidence.read` sur `getUrl`. HUMAN doit l'accorder par SQL aux rôles qui ont `evidence.read`, sinon l'accès actuel se perd | 1 (ALTER) |
| **EVD-2 Analyse** | `POST /evidences/:id/analysis` : relecture par `getContent`, contrôle du SHA-256, puis feuilles, en-têtes, types, exemples et colonnes vides. Aucune écriture | S | EVD-1 | `evidence.import` (nouvelle) | — |
| **EVD-3 Dataset et versions de schéma** | `evidence_datasets` (control, période, entité, statut), `evidence_schema_versions` (n°, feuille, ligne d'en-tête, champs JSONB, figée dès qu'un import y fait référence) ; création d'une version | M | EVD-2, décisions 3, 4, 8 | `evidence.schema.create`. Pas de `.update` : on ne modifie jamais une version, on en crée une nouvelle. La lecture passe par `evidence.read` | 1 |
| **EVD-4 Import et lineage** | `evidence_imports` (append-only, statut, compteurs, erreurs JSONB) et `evidence_records` (n° de ligne source, payload JSONB) ; commit en **une transaction** (re-parse serveur, jamais de confiance dans la prévisualisation) ; audit `IMPORT_*`, une entrée par import et pas par ligne ; `GET /evidence-records/:id/lineage` | M | EVD-3, décisions 10, 11, 13 | `evidence.import`. Lire les **records** demande `evidence.download`, puisque c'est le contenu du fichier. Les métadonnées d'import restent sous `evidence.read` | 1 |
| **EVD-5 Assistant frontend** | 4 écrans : Fichier+Analyse, Mapping+Version, Validation, Résultat | M | EVD-4, maquette A04 | — | — |

Correspondance avec le §24 :
- `evidence.create` correspond à `evidence.upload`, déjà existante. On ne la renomme pas ;
- `evidence.update` n'est pas créée, puisque le fichier est immuable ;
- `evidence.schema.read` et `evidence.import.read` sont couvertes par `evidence.read`, ce qui évite d'ajouter des permissions sans usage distinct.

Migrations : le prochain numéro libre est **047** aujourd'hui. B-8, B-9 et B-6 en prendront probablement. Le numéro se revérifie donc au moment d'écrire et se corrige à la fusion des worktrees. Point à signaler à A07 : il existe **deux `044_`** (`044_risk_idempotency.sql`, `044_audit_log_escalate.sql`).

Gates : QA et Security après chaque lot. **Privacy** avant EVD-4, car le JSONB recopie dans Postgres les données personnelles du fichier. **Compliance** pour EVD-1 (conservation) et EVD-4 (lineage).

## 4. Les 15 décisions du §33

| # | Recommandation A05 | Qui tranche |
|---|---|---|
| 1 Formats | `.xlsx` seul. `.xlsm` refusé (macros). CSV en Phase 2 | A05 (fait), sauf si le PO veut le CSV en V1 |
| 2 Taille max | 5 Mo, 20 000 lignes, 50 colonnes. Ce sont des plafonds techniques en constantes, pas des réglages | A05/A10 ; PO s'il faut plus (il faudrait alors de l'asynchrone et un plan payant) |
| 3 Champs canoniques | Champs libres en snake_case dérivés de l'en-tête, sans liste fermée en V1 | **PO** |
| 4 Champs libres | Oui (« métier spécifique ») ; « ignorée » = la colonne n'est pas persistée | **PO** |
| 5 Conservation | Durée légale à fixer. La corbeille Drive purge à 30 jours, donc le soft delete ne doit **pas** envoyer le fichier à la corbeille Drive | **PO + A14 (Compliance)** |
| 6 Object storage | Google Drive existant via `DocumentStorage`. On en change seulement si la décision 5 l'impose (verrou de rétention : GCS) | A05 ; PO si la décision 5 l'exige |
| 7 Seuil auto-mapping | Sans objet en V1 (pas de score) | Reporté |
| 8 Qui crée une version | Le porteur d'`evidence.schema.create`. Proposé : l'exécutant, avec la création auditée | **PO** |
| 9 Qui supprime | `evidence.delete` existante, motif obligatoire, refus si un import a été commité (on ne supprime pas une preuve qui alimente des records) | **PO** |
| 10 Données personnelles | Minimisation : les colonnes « ignorée » ne sont jamais persistées ; records sous `evidence.download` | **PO + A24 (Privacy)** |
| 11 Contrôles métier à l'import | V1 : type, obligatoire, ligne vide. Lignes invalides : le choix « importer les valides » ou « annuler » est un réglage du tenant, dans l'esprit de DECISION-017 (configurable) | **PO** (valeur par défaut) |
| 12 Clé métier obligatoire | Reporté avec le §11 | **PO** (confirmer le report) |
| 13 Historiser les records transformés | Pas de transformation en V1, donc les records sont immuables. Un réimport crée un nouvel import et l'ancien passe `SUPERSEDED` | A05 |
| 14 Fichiers confidentiels | Un indicateur `confidential` sur le dataset, qui restreint la lecture des records : à confirmer | **PO + A24** |
| 15 Événements visibles par l'auditeur | Tous ceux du §23, via `audit.read` existant (`GET /audit-logs?entityType=…`) | A05 ; A23 confirme |

Points par domaine :
- **Security** (A10) : décisions 1 et 2, bombe ZIP, formules jamais évaluées, absence d'antivirus dans l'infrastructure (risque résiduel à faire accepter par HUMAN) ;
- **Privacy** (A24) : décisions 10 et 14 ;
- **Compliance** (A14) : décisions 5 et 9.

## 5. Place dans la séquence

Le module est **hors du chemin critique RM**. Il ne dépend que de ControlExecution et d'Evidence, qui existent déjà.
- **B-8** : pas bloquant. Les nouvelles permissions s'attribuent par les rôles existants, puis par les groupes quand B-8 sera livré.
- **DECISION-011** : pas bloquant. Le 403 portera la permission manquante, ce qui profite au module sans le conditionner.
- **DECISION-017** (notifications) : pas utile en V1, puisque l'import est synchrone et que le résultat s'affiche à l'écran.

Le module est inséré en étapes 11a à 11e de `RM-V1-Sequence-actions.md`. Il passe après le chemin critique s'il n'y a qu'un seul A06.
