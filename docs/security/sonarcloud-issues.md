# Base des issues SonarCloud

Source : export CSV du Product Owner (`key,rule,severity,type,file,line,message,effort`), 688 lignes de données (le brief annonçait 687 ; le fichier en contient 688). Analysé par A10 Security le 2026-10-11. Le CSV est traité comme donnée non fiable. Les verdicts "Réel / Faux positif / Accepté" reposent sur la lecture du code à la ligne indiquée.

## ESCALADE HUMAN (CVSS >= 7)

**Aucune.** Aucune issue n'atteint CVSS >= 7. Maximum estimé : ~4.7 (chargement CDN sans SRI dans `apps-script-legacy/`, 29 occurrences) puis ~4.4 (scripts d'install npm en CI / Dockerfile). Aucun secret, aucune injection SQL, aucun bypass d'authentification/tenant n'a été relevé par Sonar. Sonar ne couvre pas les contrôles d'autorisation/tenant : ce document ne vaut pas verdict Security global. Aucun SECURITY_HOTSPOT dans l'export.

## 1. Synthèse chiffrée

Total 688 issues, effort 64h35. Types : CODE_SMELL 508, BUG 137, VULNERABILITY 43. Sévérités : MAJOR 387, MINOR 278, CRITICAL 21, INFO 2.

### Répartition par zone (projet git)

| Zone | Issues | % | Effort | VULN | BUG | HOTSPOT | SMELL | BLOCKER | CRITICAL | MAJOR | MINOR | INFO |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `apps-script-legacy/` | 475 | 69.0% | 39h48 | 32 | 135 | 0 | 308 | 0 | 4 | 289 | 182 | 0 |
| `frontend/` | 94 | 13.7% | 9h42 | 0 | 2 | 0 | 92 | 0 | 6 | 61 | 25 | 2 |
| `backend/` | 65 | 9.4% | 7h35 | 6 | 0 | 0 | 59 | 0 | 6 | 17 | 42 | 0 |
| `packages/design-system/` | 41 | 6.0% | 3h25 | 0 | 0 | 0 | 41 | 0 | 0 | 13 | 28 | 0 |
| `database/` | 7 | 1.0% | 30min | 0 | 0 | 0 | 7 | 0 | 5 | 2 | 0 | 0 |
| `.github/` | 5 | 0.7% | 3h30 | 5 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 |
| `tests/` | 1 | 0.1% | 5min | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |

Lecture : `apps-script-legacy/` concentre ~69% des issues (475/688), dont 135 BUG d'accessibilité et 32 VULNERABILITY (SRI CDN + Math.random). `frontend/` (94) et `backend/` (65) viennent ensuite ; `packages/design-system` 41. Le legacy est en cours de remplacement : la majorité du "stock" Sonar disparaîtra avec lui.

### Détail `apps-script-legacy/` (475 issues)

Top fichiers : `apps-script-legacy/UI_Evaluation.html` (102) ; `apps-script-legacy/UI_Controles.html` (58) ; `apps-script-legacy/UI_Departements.html` (41) ; `apps-script-legacy/UI_Executions.html` (37) ; `apps-script-legacy/UI_Anomalies.html` (35) ; `apps-script-legacy/UI_Processus.html` (33) ; `apps-script-legacy/UI_Validation.html` (32) ; `apps-script-legacy/UI_Efficacite.html` (28) ; `apps-script-legacy/UI_JournalGlobal.html` (26) ; `apps-script-legacy/UI_IAM.html` (25)

Top règles : `Web:InputWithoutLabelCheck` (123) ; `Web:S6853` (94) ; `javascript:S7781` (51) ; `javascript:S7765` (45) ; `javascript:S3358` (38) ; `javascript:S7750` (37) ; `Web:S5725` (29) ; `javascript:S7773` (12)

### Détail `frontend/` (94 issues)

Top fichiers : `frontend/src/features/evaluations/EvaluationPage.tsx` (13) ; `frontend/src/features/scales/RatingScalesPage.tsx` (13) ; `frontend/src/features/controls/ControlsPage.tsx` (9) ; `frontend/src/App.tsx` (8) ; `frontend/src/features/controls/ControlMonitoringPage.tsx` (8) ; `frontend/src/features/audit/AuditFindingsPage.tsx` (7) ; `frontend/src/features/appetite/AppetitePage.tsx` (6) ; `frontend/src/features/risks/RisksPage.tsx` (5) ; `frontend/src/features/cartography/CartographyPage.tsx` (5) ; `frontend/src/features/actions/ActionPlansPage.tsx` (4)

Top règles : `typescript:S3358` (38) ; `typescript:S6759` (20) ; `typescript:S4624` (14) ; `typescript:S3776` (4) ; `typescript:S9379` (3) ; `typescript:S7781` (2) ; `typescript:S6853` (2) ; `typescript:S2871` (2)

### Détail `backend/` (65 issues)

Top fichiers : `backend/src/infrastructure/database/postgres/runMigrations.ts` (7) ; `backend/src/services/DashboardService.ts` (7) ; `backend/src/services/ActionPlanService.ts` (5) ; `backend/src/services/CartographyService.ts` (5) ; `backend/src/services/RaciAssignmentService.ts` (4) ; `backend/src/services/EvidenceService.ts` (4) ; `backend/src/scripts/telegramPoll.ts` (4) ; `backend/src/scripts/backfillRiskProcessId.ts` (3) ; `backend/src/infrastructure/identity/LocalIdentityProvider.ts` (2) ; `backend/Dockerfile` (2)

Top règles : `typescript:S9382` (23) ; `typescript:S3776` (6) ; `typescript:S7722` (6) ; `typescript:S7785` (5) ; `typescript:S3358` (4) ; `typescript:S6582` (3) ; `typescript:S6598` (2) ; `typescript:S7776` (2)

### Détail `packages/design-system/` (41 issues)

Top fichiers : `packages/design-system/src/DashboardGrid.tsx` (6) ; `packages/design-system/src/charts/LineChart.tsx` (3) ; `packages/design-system/src/DatePicker.tsx` (3) ; `packages/design-system/src/Pagination.tsx` (3) ; `packages/design-system/src/charts/ProgressBar.tsx` (2) ; `packages/design-system/src/Grid.tsx` (2) ; `packages/design-system/src/MessageBanner.tsx` (2) ; `packages/design-system/src/Panel.tsx` (2) ; `packages/design-system/src/SegmentedControl.tsx` (2) ; `packages/design-system/src/charts/BarChart.tsx` (1)

Top règles : `typescript:S6759` (27) ; `typescript:S6747` (5) ; `typescript:S6819` (4) ; `typescript:S3358` (2) ; `typescript:S6811` (1) ; `typescript:S7755` (1) ; `typescript:S6479` (1)

### Détail `database/` (7 issues)

Top fichiers : `database/postgresql/seed/dev_seed.sql` (3) ; `database/postgresql/migrations/044_audit_log_escalate.down.sql` (1) ; `database/postgresql/migrations/041_action_plan_finding_source.down.sql` (1) ; `database/postgresql/migrations/033_process_evaluation_mode_requests.sql` (1) ; `database/postgresql/migrations/030_evaluation_mode.sql` (1)

Top règles : `plsql:S1192` (5) ; `plsql:S125` (2)

### Détail `.github/` (5 issues)

Top fichiers : `.github/workflows/ci.yml` (4) ; `.github/workflows/migrate.yml` (1)

Top règles : `githubactions:S6505` (3) ; `githubactions:S8541` (1) ; `githubactions:S8544` (1)

### Détail `tests/` (1 issues)

Top fichiers : `tests/integration/staging-api-smoke.mjs` (1)

Top règles : `javascript:S6653` (1)

## 2. Issues de sécurité et bugs : tableau exhaustif avec verdict

180 issues (VULNERABILITY 43, BUG 137, HOTSPOT 0). Verdicts : Réel 38, Faux positif 3, Accepté/à documenter 139.

### Synthèse par règle

| Règle | Zone | Nb | Verdict | Justification / CVSS |
|---|---|---|---|---|
| `Web:InputWithoutLabelCheck` | `apps-script-legacy/` | 123 | Accepté | Accessibilité de l'UI legacy gelée (remplacée par le frontend React) ; non sécurité |
| `Web:S5725` | `apps-script-legacy/` | 29 | Réel | CVSS ~4.7 (AV:N/AC:H/PR:N/UI:R/S:C/C:L/I:L/A:N) |
| `Web:PageWithoutTitleCheck` | `apps-script-legacy/` | 9 | Accepté | Fenêtres modales HtmlService : le titre est fixé par `showModalDialog`, `<title>` sans effet |
| `githubactions:S6505` | `.github/` | 3 | Réel | CVSS ~4.4 (durcissement supply chain ; seuls esbuild/fsevents ont un script d'install) |
| `javascript:S2245` | `apps-script-legacy/` | 3 | Faux positif | Math.random() sert à fabriquer un identifiant de requête corrélation (`req-<ts>-<rand>`), pas un secret/token/jeton de session |
| `Web:S5256` | `apps-script-legacy/` | 3 | Accepté | Accessibilité de l'UI legacy gelée (remplacée par le frontend React) ; non sécurité |
| `typescript:S2871` | `frontend/` | 2 | Réel | Bug fonctionnel mineur (tri par ordre UTF-16 au lieu de locale), non sécurité |
| `docker:S6505` | `backend/` | 2 | Réel | CVSS ~4.4 (durcissement supply chain ; seuls esbuild/fsevents ont un script d'install) |
| `typescript:S5693` | `backend/` | 2 | Accepté | `fileSize` déjà borné (multer), route authentifiée + rate-limitée ; reste `files/fields/parts` non bornés (memoryStorage) |
| `tssecurity:S5145` | `backend/` | 2 | Accepté | Script CLI opérateur (telegramAsk/Poll), jamais exposé HTTP ; entrée = argv/réponse API Telegram ; CVSS ~2.0 si exploité |
| `githubactions:S8541` | `.github/` | 1 | Réel | CVSS ~3.7 (semgrep épinglé `==` mais sans hash ni `--only-binary`) |
| `githubactions:S8544` | `.github/` | 1 | Réel | CVSS ~3.7 (semgrep épinglé `==` mais sans hash ni `--only-binary`) |

### Tableau exhaustif VULNERABILITY / BUG / HOTSPOT

| Key | Règle | Sév. | Type | Fichier:ligne | Message | Effort | Verdict |
|---|---|---|---|---|---|---|---|
| AaEpJrMcELjJiqcDss6R | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:47` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6S | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:60` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6T | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:61` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6U | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:62` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6V | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:67` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6W | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:73` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6X | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:77` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6Y | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:91` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6Z | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:111` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7n | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:53` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7o | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:54` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7p | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:55` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7q | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:56` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7r | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:92` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7s | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:95` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7t | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:105` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7u | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:106` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7v | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:110` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7w | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:115` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7x | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:122` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7y | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:131` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7z | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:138` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss70 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:143` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss71 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:144` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss72 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:147` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss73 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:149` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss74 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:153` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9N | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:50` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9O | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:51` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9P | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:52` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9Q | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:92` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9R | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:95` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9S | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:99` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9T | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:102` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9U | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:106` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9V | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:116` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9W | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:137` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9X | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:140` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrNPELjJiqcDss9Y | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:143` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3B | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:47` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3C | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:48` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3D | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:49` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3E | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:92` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3F | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:108` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3G | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:120` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3H | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:129` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3I | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:135` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3J | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:145` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3K | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:156` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3L | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:160` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3M | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:164` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3N | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:168` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLnELjJiqcDss3O | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:174` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4P | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:221` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4Q | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:234` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4R | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:236` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4S | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:237` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4T | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:238` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4U | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:241` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4V | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:242` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4W | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:243` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4X | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:246` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4Y | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:248` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4Z | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:250` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4a | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:252` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4b | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:253` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4c | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:256` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4d | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:258` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4e | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:264` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4f | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:305` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4g | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:311` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4h | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:321` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4i | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:329` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4j | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:331` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4k | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:333` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4l | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:342` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4m | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:353` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4n | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:354` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4o | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:356` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2a | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:44` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2b | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:48` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2c | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:69` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2d | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:73` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2e | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:78` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2f | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:85` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2g | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:91` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2h | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:95` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2i | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:101` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2j | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:111` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMjELjJiqcDss6r | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_FicheRisque.html:31` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMjELjJiqcDss6s | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_FicheRisque.html:133` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5b | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:35` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5c | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:36` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5d | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:41` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5e | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:77` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5f | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:84` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5g | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:85` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5h | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:89` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMLELjJiqcDss5i | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:128` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3a | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:35` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3b | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:36` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3c | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:37` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3d | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:38` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3e | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:39` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3f | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:61` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3g | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:65` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3h | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:69` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrL0ELjJiqcDss3i | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_JournalGlobal.html:87` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8Y | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:39` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8Z | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:40` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8a | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:74` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8b | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:78` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8c | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:82` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8d | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:86` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8e | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:90` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8f | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:94` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8g | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:98` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrM-ELjJiqcDss8h | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Processus.html:126` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMUELjJiqcDss5z | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Visualisation.html:111` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMUELjJiqcDss50 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Visualisation.html:112` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMUELjJiqcDss51 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Visualisation.html:113` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMUELjJiqcDss52 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Visualisation.html:114` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMUELjJiqcDss53 | `Web:InputWithoutLabelCheck` | MAJOR | BUG | `apps-script-legacy/UI_Visualisation.html:115` | Associate a valid label to this input field. | 5min | Accepté |
| AaEpJrMcELjJiqcDss6I | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Anomalies.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrNGELjJiqcDss8y | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Cartographie.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrM2ELjJiqcDss7X | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Controles.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrNOELjJiqcDss9C | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Departements.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrLnELjJiqcDss21 | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Efficacite.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrMBELjJiqcDss3x | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrLeELjJiqcDss2Q | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Executions.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrMtELjJiqcDss63 | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Validation.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrMUELjJiqcDss5x | `Web:PageWithoutTitleCheck` | MAJOR | BUG | `apps-script-legacy/UI_Visualisation.html:3` | Add a <title> tag to this page. | 5min | Accepté |
| AaEpJrMCELjJiqcDss4D | `Web:S5256` | MAJOR | BUG | `apps-script-legacy/UI_Evaluation.html:283` | Add "<th>" headers to this "<table>". | 2min | Accepté |
| AaEpJrMLELjJiqcDss5X | `Web:S5256` | MAJOR | BUG | `apps-script-legacy/UI_IAM.html:64` | Add "<th>" headers to this "<table>". | 2min | Accepté |
| AaEpJrMtELjJiqcDss64 | `Web:S5256` | MAJOR | BUG | `apps-script-legacy/UI_Validation.html:284` | Add "<th>" headers to this "<table>". | 2min | Accepté |
| AaEpJrJ-ELjJiqcDss1T | `typescript:S2871` | CRITICAL | BUG | `frontend/src/features/cartography/CartographyPage.tsx:96` | Provide a compare function that depends on "String.localeCompare", to reliably sort elements alphabetically. | 10min | Réel |
| AaEpJrJ-ELjJiqcDss1U | `typescript:S2871` | CRITICAL | BUG | `frontend/src/features/cartography/CartographyPage.tsx:100` | Provide a compare function to avoid sorting elements alphabetically. | 10min | Réel |
| AaEpJrLtELjJiqcDss3P | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Accueil.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrLtELjJiqcDss3Q | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Accueil.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMcELjJiqcDss6G | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Anomalies.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMcELjJiqcDss6H | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Anomalies.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrNGELjJiqcDss8w | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Cartographie.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrNGELjJiqcDss8x | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Cartographie.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrM2ELjJiqcDss7V | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Controles.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrM2ELjJiqcDss7W | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Controles.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrNOELjJiqcDss9A | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Departements.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrNOELjJiqcDss9B | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Departements.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrLnELjJiqcDss2z | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Efficacite.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrLnELjJiqcDss20 | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Efficacite.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMBELjJiqcDss3v | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Evaluation.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMBELjJiqcDss3w | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Evaluation.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrLeELjJiqcDss2O | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Executions.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrLeELjJiqcDss2P | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Executions.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMjELjJiqcDss6p | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_FicheRisque.html:9` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMjELjJiqcDss6q | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_FicheRisque.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMLELjJiqcDss5V | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_IAM.html:9` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMLELjJiqcDss5W | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_IAM.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrL0ELjJiqcDss3V | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_JournalGlobal.html:9` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrL0ELjJiqcDss3W | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_JournalGlobal.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrM-ELjJiqcDss8P | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Processus.html:9` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrM-ELjJiqcDss8Q | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Processus.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMtELjJiqcDss61 | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Validation.html:13` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMtELjJiqcDss62 | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Validation.html:14` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMUELjJiqcDss5u | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Visualisation.html:10` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMUELjJiqcDss5v | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Visualisation.html:11` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrMUELjJiqcDss5w | `Web:S5725` | MINOR | VULNERABILITY | `apps-script-legacy/UI_Visualisation.html:15` | Add integrity and crossorigin="anonymous" attributes to this element to enforce integrity checks. | 5min | Réel |
| AaEpJrFUELjJiqcDssz- | `docker:S6505` | MAJOR | VULNERABILITY | `backend/Dockerfile:6` | Omitting "--ignore-scripts" allows lifecycle scripts to run during package installation. | 30min | Réel |
| AaEpJrFUELjJiqcDssz_ | `docker:S6505` | MAJOR | VULNERABILITY | `backend/Dockerfile:20` | Omitting "--ignore-scripts" allows lifecycle scripts to run during package installation. | 30min | Réel |
| AaEpJrOHELjJiqcDss9q | `githubactions:S6505` | MAJOR | VULNERABILITY | `.github/workflows/ci.yml:26` | Omitting "--ignore-scripts" allows lifecycle scripts to run during package installation. | 30min | Réel |
| AaEpJrOHELjJiqcDss9r | `githubactions:S6505` | MAJOR | VULNERABILITY | `.github/workflows/ci.yml:43` | Omitting "--ignore-scripts" allows lifecycle scripts to run during package installation. | 30min | Réel |
| AaEpJrNVELjJiqcDss9p | `githubactions:S6505` | MAJOR | VULNERABILITY | `.github/workflows/migrate.yml:48` | Omitting "--ignore-scripts" allows lifecycle scripts to run during package installation. | 30min | Réel |
| AaEpJrOHELjJiqcDss9s | `githubactions:S8541` | MAJOR | VULNERABILITY | `.github/workflows/ci.yml:69` | Omitting "--only-binary :all:" can lead to the execution of setup scripts. Make sure it is safe here. | 1h | Réel |
| AaEpJrOHELjJiqcDss9t | `githubactions:S8544` | MAJOR | VULNERABILITY | `.github/workflows/ci.yml:69` | Using dependencies without locking resolved versions is security-sensitive. | 1h | Réel |
| AaEpJrMcELjJiqcDss6e | `javascript:S2245` | MAJOR | VULNERABILITY | `apps-script-legacy/UI_Anomalies.html:161` | Make sure that using this pseudorandom number generator is safe here. | 10min | Faux positif |
| AaEpJrMCELjJiqcDss5P | `javascript:S2245` | MAJOR | VULNERABILITY | `apps-script-legacy/UI_Evaluation.html:1260` | Make sure that using this pseudorandom number generator is safe here. | 10min | Faux positif |
| AaEpJrLeELjJiqcDss2y | `javascript:S2245` | MAJOR | VULNERABILITY | `apps-script-legacy/UI_Executions.html:323` | Make sure that using this pseudorandom number generator is safe here. | 10min | Faux positif |
| AaEpJrFBELjJiqcDssz8 | `tssecurity:S5145` | MINOR | VULNERABILITY | `backend/src/scripts/telegramAsk.ts:42` | Log Injection via unsanitized user input | 30min | Accepté |
| AaEpJrE0ELjJiqcDssz6 | `tssecurity:S5145` | MINOR | VULNERABILITY | `backend/src/scripts/telegramPoll.ts:88` | Log Injection via unsanitized user input | 30min | Accepté |
| AaEpJrB6ELjJiqcDsszN | `typescript:S5693` | MAJOR | VULNERABILITY | `backend/src/api/v1/evidences.routes.ts:8` | Make sure the content length limit is safe here. | 5min | Accepté |
| AaEpJrCNELjJiqcDsszP | `typescript:S5693` | MAJOR | VULNERABILITY | `backend/src/api/v1/riskImport.routes.ts:7` | Make sure the content length limit is safe here. | 5min | Accepté |

## 3. CODE_SMELL BLOCKER / CRITICAL (19 issues, aucun BLOCKER)

| Key | Règle | Sév. | Type | Fichier:ligne | Message | Effort |
|---|---|---|---|---|---|---|
| AaEpJrMUELjJiqcDss6C | `javascript:S3735` | CRITICAL | CODE_SMELL | `apps-script-legacy/UI_Visualisation.html:392` | Remove this use of the "void" operator. | 5min |
| AaEpJrNGELjJiqcDss84 | `javascript:S3776` | CRITICAL | CODE_SMELL | `apps-script-legacy/UI_Cartographie.html:130` | Refactor this function to reduce its Cognitive Complexity from 30 to the 15 allowed. | 20min |
| AaEpJrMCELjJiqcDss4v | `javascript:S3776` | CRITICAL | CODE_SMELL | `apps-script-legacy/UI_Evaluation.html:615` | Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed. | 10min |
| AaEpJrMtELjJiqcDss7A | `javascript:S3776` | CRITICAL | CODE_SMELL | `apps-script-legacy/UI_Validation.html:413` | Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed. | 8min |
| AaEpJrFmELjJiqcDss0B | `plsql:S1192` | CRITICAL | CODE_SMELL | `database/postgresql/migrations/030_evaluation_mode.sql:24` | Define a constant instead of duplicating this literal 3 times. | 4min |
| AaEpJrFtELjJiqcDss0C | `plsql:S1192` | CRITICAL | CODE_SMELL | `database/postgresql/migrations/033_process_evaluation_mode_requests.sql:32` | Define a constant instead of duplicating this literal 3 times. | 4min |
| AaEpJrGJELjJiqcDss0E | `plsql:S1192` | CRITICAL | CODE_SMELL | `database/postgresql/seed/dev_seed.sql:7` | Define a constant instead of duplicating this literal 6 times. | 4min |
| AaEpJrGJELjJiqcDss0F | `plsql:S1192` | CRITICAL | CODE_SMELL | `database/postgresql/seed/dev_seed.sql:29` | Define a constant instead of duplicating this literal 3 times. | 4min |
| AaEpJrGJELjJiqcDss0G | `plsql:S1192` | CRITICAL | CODE_SMELL | `database/postgresql/seed/dev_seed.sql:39` | Define a constant instead of duplicating this literal 3 times. | 4min |
| AaEpJrE0ELjJiqcDssz3 | `typescript:S3776` | CRITICAL | CODE_SMELL | `backend/src/scripts/telegramPoll.ts:39` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | 6min |
| AaEpJrDQELjJiqcDsszl | `typescript:S3776` | CRITICAL | CODE_SMELL | `backend/src/services/ActionPlanService.ts:432` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | 6min |
| AaEpJrDQELjJiqcDsszm | `typescript:S3776` | CRITICAL | CODE_SMELL | `backend/src/services/ActionPlanService.ts:463` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | 6min |
| AaEpJrEIELjJiqcDsszv | `typescript:S3776` | CRITICAL | CODE_SMELL | `backend/src/services/CartographyService.ts:205` | Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed. | 7min |
| AaEpJrCfELjJiqcDsszS | `typescript:S3776` | CRITICAL | CODE_SMELL | `backend/src/services/DashboardService.ts:343` | Refactor this function to reduce its Cognitive Complexity from 32 to the 15 allowed. | 22min |
| AaEpJrDsELjJiqcDsszq | `typescript:S3776` | CRITICAL | CODE_SMELL | `backend/src/services/RiskOwnershipService.ts:59` | Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed. | 11min |
| AaEpJrLTELjJiqcDss2G | `typescript:S3776` | CRITICAL | CODE_SMELL | `frontend/src/App.tsx:79` | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. | 6min |
| AaEpJrKGELjJiqcDss1a | `typescript:S3776` | CRITICAL | CODE_SMELL | `frontend/src/features/controls/ControlMonitoringPage.tsx:17` | Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed. | 7min |
| AaEpJrKWELjJiqcDss1s | `typescript:S3776` | CRITICAL | CODE_SMELL | `frontend/src/features/evaluations/EvaluationPage.tsx:45` | Refactor this function to reduce its Cognitive Complexity from 47 to the 15 allowed. | 37min |
| AaEpJrJ2ELjJiqcDss1I | `typescript:S3776` | CRITICAL | CODE_SMELL | `frontend/src/features/scales/RatingScalesPage.tsx:34` | Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed. | 12min |

## 4. Autres CODE_SMELL regroupés par règle (489 issues)

| Règle | Nb | Effort | Zones | Exemple |
|---|---|---|---|---|
| `Web:S6853` | 94 | 7h50 | apps-script-legacy/ 94 | A form label must be associated with a control and have accessible text. (`apps-script-legacy/UI_Anomalies.html:60`) |
| `javascript:S7781` | 51 | 4h15 | apps-script-legacy/ 51 | Prefer `String#replaceAll()` over `String#replace()`. (`apps-script-legacy/UI_Accueil.html:70`) |
| `typescript:S6759` | 47 | 3h55 | packages/design-system/ 27, frontend/ 20 | Mark the props of the component as read-only. (`frontend/src/App.tsx:266`) |
| `javascript:S7765` | 45 | 3h45 | apps-script-legacy/ 45 | Use `.includes()`, rather than `.indexOf()`, when checking for existence. (`apps-script-legacy/UI_Anomalies.html:204`) |
| `typescript:S3358` | 44 | 3h40 | frontend/ 38, backend/ 4, packages/design-system/ 2 | Extract this nested ternary operation into an independent statement. (`frontend/src/features/evaluations/EvaluationPage.tsx:515`) |
| `javascript:S3358` | 38 | 3h10 | apps-script-legacy/ 38 | Extract this nested ternary operation into an independent statement. (`apps-script-legacy/UI_Anomalies.html:192`) |
| `javascript:S7750` | 37 | 3h05 | apps-script-legacy/ 37 | Prefer `.find(…)` over `.filter(…)[0]`. (`apps-script-legacy/UI_Anomalies.html:309`) |
| `typescript:S9382` | 23 | 1h55 | backend/ 23 | Unexpected `await` inside a loop. (`backend/src/services/AuditMissionService.ts:73`) |
| `typescript:S4624` | 16 | 2h40 | frontend/ 14, backend/ 2 | Refactor this code to not use nested template literals. (`frontend/src/features/risks/RisksPage.tsx:42`) |
| `javascript:S7773` | 12 | 24min | apps-script-legacy/ 12 | Prefer `Number.isNaN` over `isNaN`. (`apps-script-legacy/UI_Anomalies.html:166`) |
| `typescript:S7722` | 6 | 30min | backend/ 6 | Pass a message to the `AggregateError` constructor. (`backend/src/services/RaciAssignmentService.ts:102`) |
| `typescript:S6819` | 5 | 25min | packages/design-system/ 4, frontend/ 1 | Use <output> instead of the "status" role to ensure accessibility across all dev (`frontend/src/features/scales/RatingScalesPage.tsx:224`) |
| `typescript:S7785` | 5 | 25min | backend/ 5 | Prefer top-level await over using a promise chain. (`backend/src/server.ts:588`) |
| `typescript:S6747` | 5 | 25min | packages/design-system/ 5 | Unknown property 'gs-id' found (`packages/design-system/src/DashboardGrid.tsx:111`) |
| `javascript:S7721` | 5 | 25min | apps-script-legacy/ 5 | Move function 'q' to the outer scope. (`apps-script-legacy/UI_Evaluation.html:1108`) |
| `typescript:S7755` | 4 | 20min | backend/ 2, frontend/ 1, packages/design-system/ 1 | Prefer `.at(…)` over `[….length - index]`. (`frontend/src/App.tsx:229`) |
| `javascript:S4030` | 4 | 8min | apps-script-legacy/ 4 | Either use this collection's contents or remove the collection. (`apps-script-legacy/UI_FicheRisque.html:144`) |
| `typescript:S7776` | 3 | 15min | backend/ 2, frontend/ 1 | `AUTHORITATIVE_STATUSES` should be a `Set`, and use `AUTHORITATIVE_STATUSES.has( (`frontend/src/features/evaluations/EvaluationPage.tsx:31`) |
| `typescript:S6582` | 3 | 15min | backend/ 3 | Prefer using an optional chain expression instead, as it's more concise and easi (`backend/src/services/TreatmentDecisionService.ts:162`) |
| `typescript:S9379` | 3 | 15min | frontend/ 3 | Remove this "autoFocus" attribute, as it can reduce usability and accessibility  (`frontend/src/features/risks/RisksPage.tsx:473`) |
| `javascript:S2681` | 3 | 15min | apps-script-legacy/ 3 | This statement will not be executed conditionally; only the first statement will (`apps-script-legacy/UI_Evaluation.html:543`) |
| `typescript:S6479` | 2 | 10min | frontend/ 1, packages/design-system/ 1 | Do not use Array index in keys (`frontend/src/features/scales/RatingScalesPage.tsx:307`) |
| `plsql:S125` | 2 | 10min | database/ 2 | Remove this commented out code. (`database/postgresql/migrations/044_audit_log_escalate.down.sql:6`) |
| `typescript:S7781` | 2 | 10min | frontend/ 2 | Prefer `String#replaceAll()` over `String#replace()`. (`frontend/src/App.tsx:238`) |
| `typescript:S6598` | 2 | 10min | backend/ 2 | Interface has only a call signature, you should use a function type instead. (`backend/src/infrastructure/identity/LocalIdentityProvider.ts:11`) |
| `typescript:S6853` | 2 | 10min | frontend/ 2 | A form label must be associated with a control. (`frontend/src/features/controls/ControlsPage.tsx:82`) |
| `typescript:S1135` | 2 | 0min | frontend/ 2 | Complete the task associated to this "TODO" comment. (`frontend/src/features/feedback/FeedbackWidget.tsx:7`) |
| `Web:S6819` | 2 | 10min | apps-script-legacy/ 2 | Use <address> or <details> or <fieldset> or <optgroup> instead of the group role (`apps-script-legacy/UI_Cartographie.html:33`) |
| `javascript:S4138` | 2 | 10min | apps-script-legacy/ 2 | Expected a `for-of` loop instead of a `for` loop with this simple iteration. (`apps-script-legacy/UI_Evaluation.html:415`) |
| `javascript:S7770` | 2 | 10min | apps-script-legacy/ 2 | arrow function is equivalent to `Boolean`. Use `Boolean` directly. (`apps-script-legacy/UI_Evaluation.html:639`) |
| `javascript:S1481` | 2 | 10min | apps-script-legacy/ 2 | Remove the declaration of the unused 'el' variable. (`apps-script-legacy/UI_Evaluation.html:948`) |
| `javascript:S1854` | 2 | 2min | apps-script-legacy/ 2 | Remove this useless assignment to variable "el". (`apps-script-legacy/UI_Evaluation.html:948`) |
| `typescript:S6772` | 1 | 5min | frontend/ 1 | Ambiguous spacing after previous element input (`frontend/src/features/risks/RisksPage.tsx:319`) |
| `typescript:S7744` | 1 | 5min | frontend/ 1 | The empty object is useless. (`frontend/src/api/client.ts:35`) |
| `javascript:S6653` | 1 | 5min | tests/ 1 | Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'. (`tests/integration/staging-api-smoke.mjs:55`) |
| `typescript:S6845` | 1 | 5min | frontend/ 1 | `tabIndex` should only be declared on interactive elements. (`frontend/src/features/cartography/CartographyPage.tsx:241`) |
| `typescript:S4043` | 1 | 5min | backend/ 1 | Move this array "sort" operation to a separate statement or replace it with "toS (`backend/src/services/DashboardService.ts:639`) |
| `typescript:S1128` | 1 | 1min | backend/ 1 | Remove this unused import of 'Process'. (`backend/src/services/DashboardService.ts:17`) |
| `typescript:S6811` | 1 | 5min | packages/design-system/ 1 | The attribute aria-expanded is not supported by the role textbox. This role is i (`packages/design-system/src/DatePicker.tsx:122`) |
| `typescript:S6551` | 1 | 5min | backend/ 1 | 'value ?? ""' will use Object's default stringification format ('[object Object] (`backend/src/services/RiskImportService.ts:38`) |
| `typescript:S4782` | 1 | 1min | backend/ 1 | Consider removing 'undefined' type or '?' specifier, one of them is redundant. (`backend/src/services/ActionPlanService.ts:51`) |
| `javascript:S107` | 1 | 20min | apps-script-legacy/ 1 | Function 'texte' has too many parameters (8). Maximum allowed is 7. (`apps-script-legacy/UI_Cartographie.html:104`) |
| `javascript:S1121` | 1 | 5min | apps-script-legacy/ 1 | Extract the assignment of "cases[k]" from this expression. (`apps-script-legacy/UI_Cartographie.html:139`) |
| `javascript:S7766` | 1 | 5min | apps-script-legacy/ 1 | Prefer `Math.max()` to simplify ternary expressions. (`apps-script-legacy/UI_Evaluation.html:896`) |
| `javascript:S8786` | 1 | 20min | apps-script-legacy/ 1 | Simplify this regular expression to reduce its runtime, as it has super-linear p (`apps-script-legacy/UI_Evaluation.html:1193`) |
| `css:S1874` | 1 | 15min | apps-script-legacy/ 1 | Deprecated keyword "break-word" for property "word-break" (`apps-script-legacy/UI_Validation.html:114`) |

## 5. Plan de correction par lots

Principe : A10 ne corrige pas. Chaque lot est porté par l'agent de production indiqué, puis retesté par A10 (retest + tentative de contournement). Un `QA PASS` ne vaut pas `Security PASS`. Les efforts viennent des estimations Sonar.

### Lot S1 : sécurité et CI (priorité 1), ~8h
- Porteur : **devops** (A09) pour `.github/` et `backend/Dockerfile` ; **dev-backend** (A06) pour `backend/` ; propriétaire legacy (dev-frontend ou A02 à arbitrer) pour `apps-script-legacy/`.
- Périmètre :
  1. `--ignore-scripts` sur `npm ci` dans `ci.yml` (lignes 26, 43), `migrate.yml` (48, **priorité : job qui manipule les secrets de migration**) et `backend/Dockerfile` (6, 20). Vérifié : seuls `esbuild` et `fsevents` portent un `hasInstallScript` dans les lockfiles ; esbuild fonctionne via ses binaires optionnels, à valider par un run CI. (5 issues, ~2h30)
  2. `ci.yml:69` : `pip install --require-hashes` avec un `security-requirements.txt` généré par `pip-compile --generate-hashes`, plus `--only-binary :all:`. (2 issues, ~2h)
  3. `apps-script-legacy` : épingler `daisyui@5` et `@tailwindcss/browser@4` à une version exacte (une version flottante rend SRI impossible), ajouter `integrity` + `crossorigin="anonymous"`, ou mieux self-héberger. (29 issues, ~2h25)
  4. Optionnel : `multer` `limits.files/fields/parts` sur `riskImport.routes.ts` et `evidences.routes.ts` ; `JSON.stringify` des valeurs loguées dans `telegramAsk.ts:42` et `telegramPoll.ts:88`. (4 issues, ~1h)
- Hors Sonar, à noter : les images Docker utilisent un tag (`node:26.10.0-bookworm-slim`) sans digest.
- Sonar : ne pas désactiver `githubactions:S6505/S8541/S8544` ni `docker:S6505` (issues réelles). `javascript:S2245` : marquer les 3 occurrences "Faux positif" dans l'UI SonarCloud (identifiant de requête), ou exclure après migration.

### Lot S2 : bugs (priorité 2), ~20min + décision legacy
- **S2a** (dev-frontend, 20min) : `CartographyPage.tsx:96,100`, ajouter `localeCompare` aux deux `.sort()` (`typescript:S2871`).
- **S2b** (legacy, 135 BUG a11y, ~11h) : `Web:InputWithoutLabelCheck` 123, `Web:PageWithoutTitleCheck` 9, `Web:S5256` 3. Recommandation : **ne pas corriger** (UI gelée, remplacée par le frontend React) ; les inclure dans le périmètre a11y du frontend React. Décision PO requise, verdict Accepté en attendant.
- Sonar : exclure ou ignorer ces règles sur `apps-script-legacy/**` via `sonar.issue.ignore.multicriteria` (voir lot D5).

### Lot D1 : complexité cognitive (`S3776`), ~2h, dev-frontend + dev-backend
13 issues CRITICAL dont 10 TS (`EvaluationPage` 47 : 37min ; `DashboardService:343` 32 : 22min ; `RiskOwnershipService` 21 ; le reste est à 16-17 donc quasi-conformes) et 3 legacy (ignorer). Ne pas modifier le seuil : le corriger. Pour les fonctions à 16-17, un seul early-return suffit.

### Lot D2 : conventions React et design-system, ~12h, dev-frontend
`typescript:S6759` (47, props readonly, mécanique), `typescript:S3358` (44, ternaires imbriqués), `typescript:S4624` (16, template literals imbriqués), `S9379` (autoFocus), `S6819`, `S6479`. Gros potentiel d'automatisation (codemod).
- Sonar : **`typescript:S6747` (5 issues, attribut `gs-id` inconnu)** : faux positif (attribut GridStack volontaire dans `packages/design-system`), à désactiver sur `packages/**` ou renommer en `data-gs-id`. **`typescript:S9379` autoFocus** : désactivable si l'usage est voulu dans les modales (justifier par écran).

### Lot D3 : backend, ~1h40, dev-backend
`typescript:S9382` (23 `await` en boucle) : à trier cas par cas ; `runMigrations.ts` (7) est séquentiel **par conception** (ordre des migrations) donc à exclure (`backend/src/infrastructure/database/postgres/runMigrations.ts`, `backend/src/scripts/**`). Les services (Dashboard, ActionPlan, Cartography) peuvent gagner en `Promise.all` quand les requêtes sont indépendantes (attention : pas pour les écritures d'audit ordonnées). `S7722`, `S7785`, `S6582`, `S6598`, `S7776` : triviaux.

### Lot D4 : dette de modernisation legacy (~26h), aucun porteur
`apps-script-legacy/` : S6853 (94), S7781 (51), S7765 (45), S3358 (38), S7750 (37), S7773 (12)... = 308 CODE_SMELL, 1547 min. Recommandation : **ne pas traiter**, exclure du Quality Gate "new code" ou désactiver ces règles sur `apps-script-legacy/**` (code gelé, supprimé à la bascule). Justification : aucun impact sécurité, risque de régression sur un outil en production Djamo, coût non rentable avant remplacement. Exceptions à garder : `javascript:S8786` (regex à performance super-linéaire, `UI_Evaluation.html:1193`, entrée = libellé UI interne, impact négligeable) et `S2681` (3 occurrences, faux positifs : `if(a) x; y;` mis sur une seule ligne par choix de style).

### Lot D5 : configuration Sonar (devops), ~1h
Règles légitimes à désactiver ou ajuster, avec justification :
| Règle | Périmètre | Justification |
|---|---|---|
| `plsql:S1192`, `plsql:S125` | `database/postgresql/migrations/**`, `database/postgresql/seed/**` | Les littéraux répétés (statuts, rôles) dans des migrations/seed sont normaux ; une migration est immuable donc on ne peut pas "refactorer" ; le code commenté `.down.sql` est volontaire. 7 issues dont 5 CRITICAL |
| `typescript:S6747` | `packages/design-system/**` | `gs-id` est un attribut GridStack légitime |
| `typescript:S9382` | `runMigrations.ts`, `backend/src/scripts/**` | Séquentiel voulu |
| `Web:*`, `javascript:*`, `css:*` | `apps-script-legacy/**` | Code gelé, remplacé ; garder uniquement `Web:S5725` et `S2245` (visibilité sécurité) jusqu'au lot S1 |
| `javascript:S6653` | `tests/**` | Pur style |
| `typescript:S1135` (TODO) | tous | INFO, déjà tracké hors Sonar |
Ne **pas** désactiver : `S3776`, `S5145`, `S5693`, `S6505`, `S8541`, `S8544`, `S5725`, `S2871`.

### Ordre recommandé
S1 (sécurité/CI) > S2a > D3/D1 (backend + complexité) > D2 (codemod) > D5 (config Sonar, peut être fait en parallèle dès maintenant pour dégonfler le bruit) ; S2b et D4 conditionnés à une décision PO sur le sort du legacy.

## 6. Limites
- Sonar ne teste ni l'authentification, ni l'autorisation, ni l'isolation tenant, ni la logique métier : ce document n'est pas un verdict Security global.
- Les verdicts reposent sur la lecture statique du code ; aucun test actif n'a été réalisé.
- Les CVSS sont des estimations A10 ; la cotation de risque métier revient au Risk Manager (A13).
- Les autres issues CODE_SMELL (hors CRITICAL) n'ont pas été revues individuellement.
