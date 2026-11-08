# Revue Privacy — lot V5 (expiration des accès nommés, q225 A, DECISION-112)

ASSESSMENT_ID : PRIV-REV-V5-2026-11-08
DATE : 2026-11-08
ASSESSOR : A15 (Privacy / Data Protection)
REVIEWER : à désigner (Risk Manager, Compliance, Security, Audit pour les points marqués)
STATUT GLOBAL : GAP_IDENTIFIED — VERDICT : SOUS CONDITIONS

## 1. Périmètre et faits vérifiés

- Branche `feat/r1-visibility-v5` (worktree `.claude/worktrees/agent-a4229ef836cfb23a8/`).
- Fichiers lus : `database/postgresql/migrations/087_named_access_expiry.sql` (et `.down.sql`), `backend/src/services/resourceVisibility.ts`, `backend/src/infrastructure/database/postgres/namedAccess.ts`, `backend/src/api/v1/resourceVisibility.routes.ts`, `backend/src/services/RiskService.ts` (getAccess), `backend/test/visibility-v5.test.ts`.
- Non lu en détail (A15 sans Bash, périmètre limité) : `PostgresResourceAccessRepository.ts` et `PostgresRiskRepository.ts` (chemin de pose à la passage en NOMINATIF, appel de `stampNamedExpiry`), routes `risks.routes.ts`. Non exécuté : les tests PostgreSQL réels sont `skipIf` hors poste local.

Faits :
- F1. `resource_access_grants.expires_at` (timestamptz, NULL possible). Garde trigger : un accès vivant ne peut pas perdre son échéance ni la repousser au-delà de now() + 30 jours ; l'INSERT refuse une échéance au-delà de 30 jours ; aucune suppression physique ; révocation sans changement d'échéance. Conforme au principe de non-suppression (soft delete) et à la traçabilité.
- F2. Pose de l'échéance : `stampNamedExpiry` (passage en NOMINATIF, UPDATE sur les accès vivants sans échéance) ; renouvellement `renewGrants` (now + 30 j, refusé si aucune échéance posée, donc refusé sur un dossier PERIMETRE).
- F3. Lecture : `visibility_granted` ignore un accès échu ou à échéance dont le dossier est clos. `visibility_resource_closed` : RISK/CONTROL = ARCHIVED ou supprimé ; KPI = supprimé ; ANOMALY = CLOSED ; ACTION_PLAN = TERMINEE ; ressource introuvable = clos.
- F4. Liste PERIMETRE : `set` accepte des personnes nommées ; elles n'ont pas d'échéance (test « a PERIMETRE list (no expiry) is untouched »).
- F5. `getAccess` (RiskService l. 163-167 et équivalents des autres modules) : accessible à tout lecteur du dossier (`this.get` est scopé lecture) ; `withNames` ajoute `expiresAt` à chaque `accessUsers`. Les noms des personnes nommées sont déjà visibles des lecteurs (pré-existant, hors V5).
- F6. Renouvellement : audit `PERMISSION_CHANGE` dans la même transaction, `reason` (texte libre, 1 à 500 caractères, `isAcceptableReason`), `oldValue`/`newValue` avec userId et échéances, notification du groupe Risk Manager si le propriétaire renouvelle. Aucun audit ni notification à l'échéance (conforme à Q4).
- F7. Pas de planificateur : l'échéance est un état calculé à la lecture, la table garde la trace (aucune ligne supprimée).

## 2. Cadre applicable

- RGPD : GDPR_APPLICABILITY = NOT_ESTABLISHED (pas d'établissement UE ni de personnes ciblées dans l'UE établis par les pièces disponibles). Aucun article RGPD n'est cité ici.
- Droit local : loi n° 2013-450 et ARTCI, applicabilité et articles à confirmer par le juriste de Djamo (non vérifié par A15).
- Benchmarks internes : principes de minimisation, durée limitée et revue d'habilitation (recommandations V4 du 2026-11-03 : durée 90 jours non prolongeable, recertification trimestrielle, expiration des dossiers nommés à la clôture au plus 30 jours après).
- Compliance (CMP) reste compétente pour la qualification BCEAO / LBC-FT des dossiers fraude et RH.

## 3. Points de contrôle

| Question Privacy | Constat |
| --- | --- |
| Nécessité et durée des accès nommés | Acceptable : 30 jours au plus, renouvelable avec motif, plafond en base (F1). |
| Accès échu | Lecture coupée sans suppression ni révocation (F3). Bon. |
| Exposition des dates | Insuffisante, voir PRIV-V5-01. |
| Personnes nommées sur dossier PERIMETRE | Hors q225, sans échéance, voir PRIV-V5-02 (Q1). |
| Réouverture | Accès qui revit sans renouvellement, voir PRIV-V5-03 (Q3). |
| Motif de renouvellement | Texte libre dans le journal append-only, voir PRIV-V5-05 (q246). |
| Preuve de l'échéance | Table `resource_access_grants` (non supprimée) ; pas d'audit à l'échéance (Q4). |
| Tests | Test texte migration et test de la logique sur PostgreSQL réel, non exécuté ici ; pas de test de l'exposition de `expiresAt` ni de la réouverture, voir PRIV-V5-06. |

## 4. Constats

**PRIV-V5-01 — Exposition de `expiresAt` à tout lecteur du dossier** (Moyen, condition de production sur les dossiers NOMINATIF à données sensibles, fraude ou RH).
- Constat : `getAccess` renvoie à tout lecteur du dossier la date d'échéance de chaque personne nommée (F5). La date par personne reste une donnée personnelle même si l'identité est visible (principe 10) ; ici elle révèle depuis quand et jusqu'à quand une personne lit un dossier sensible (indice d'une enquête ou d'une habilitation temporaire).
- Demande : n'exposer `expiresAt` qu'aux détenteurs de `resourcevisibility.set` et au propriétaire ; aux autres lecteurs, les noms seuls (comme avant V5). Test à ajouter : un lecteur simple ne reçoit pas `expiresAt`.
- Preuve requise : test de réponse API pour un lecteur simple, un Risk Manager, un propriétaire.

**PRIV-V5-02 — Listes nominatives d'un dossier PERIMETRE sans échéance** (Élevé pour la finalité, décision PO requise : Q1).
- Constat : F4. Une personne nommée sur un dossier PERIMETRE lit sans limite de temps. C'est le même risque que celui que q225 vise (personne nommée, accès durable), sans la borne de 30 jours.
- Statut : OPEN, arbitrage PO (question Q1 ci-dessous).

**PRIV-V5-03 — Réouverture : l'accès revit sans renouvellement** (Moyen, décision PO requise : Q3).
- Constat : `visibility_granted` redonne l'accès quand le dossier est rouvert tant que l'échéance n'est pas passée (au plus 30 jours après l'ajout ou le dernier renouvellement). Le texte de q225 A dit « expire à la clôture ». Le code ne suit pas ce texte. Pas de motif, pas d'audit, pas de confirmation à la réouverture.
- Statut : OPEN, arbitrage PO (Q3).

**PRIV-V5-04 — Défense en profondeur : la base n'impose pas l'échéance d'un accès NOMINATIF** (Faible, recommandation non bloquante).
- Constat : le garde contrôle qu'une échéance posée ne dépasse pas 30 jours, mais un INSERT sans `expires_at` sur un dossier NOMINATIF est accepté. La pose dépend uniquement du code applicatif (`stampNamedExpiry`, chemin d'ajout). Une nouvelle voie d'écriture pourrait créer un accès perpétuel sans que la base le refuse.
- Demande (Architecte / Dev DB) : contrôle en base (trigger sur la visibilité du dossier) ou test de non-régression sur chaque chemin d'ajout. Ne pas modifier le schéma par A15.

**PRIV-V5-05 — Motif de renouvellement dans le journal append-only** (Moyen, rattaché à q246, en attente du PO).
- Constat : le motif est un texte libre de 500 caractères stocké dans `audit_log.reason` (F6). Un journal append-only ne peut pas être épuré : un motif contenant un nom ou un fait sur une personne reste personnel tant que le journal existe (principe 14).
- Position A15 : liste codifiée de motifs de renouvellement (principe retenu en V4), ou, à défaut, avertissement de minimisation affiché à la saisie. Le texte libre n'est pas acceptable sans cette mesure. Ce point est dans q246 (motifs hors journal, PO) : pas de nouvelle question ici, seulement le lien.
- Le motif est conservé dans le journal uniquement (choix du développeur, à confirmer dans q246).

**PRIV-V5-06 — Preuves de test et de comportement** (Faible, preuve requise avant revalidation).
- Manque : test de l'exposition de `expiresAt` (PRIV-V5-01) ; test de réouverture (PRIV-V5-03) ; exécution des tests PostgreSQL réels de 087 (non exécutés par A15). Preuve à produire par QA (A08) et Security (A10).

**PRIV-V5-07 — Journal du renouvellement** (Information, pas un écart).
- Le renouvellement écrit `userId` et les échéances avant/après dans l'audit. Acceptable : les identifiants des personnes figurent déjà dans l'audit des ajouts. Aucune action.

## 5. Questions cockpit (PO)

**Q1 — Personnes nommées d'un dossier PERIMETRE : faut-il une échéance ?**
- Option A : oui, même règle que pour un dossier nominatif (30 jours, renouvelable avec motif). Recommandation : A.
- Option B : non, la liste PERIMETRE reste sans échéance ; documenter l'exception (PRIV-EXC à ouvrir, avec échéance de revue).
- Motif : F4 et PRIV-V5-02. La liste nominative est une exception à la portée du dossier ; sans échéance, la borne de q225 est contournée.

**Q3 — Réouverture d'un dossier clos : l'accès nominatif revient-il ?**
- Option A : l'accès ne revit pas. La clôture met fin à l'accès ; après réouverture, un renouvellement avec motif est requis. Recommandation : A (conforme au texte de q225 « expire à la clôture »).
- Option B : l'accès revit tant que son échéance (au plus 30 jours) n'est pas passée, sans motif (comportement actuel du code).
- Motif : PRIV-V5-03. Au plus 30 jours, mais l'accès revient sans décision ni trace de la réouverture.

## 6. Points « aucune décision PO nécessaire »

**Q2 — Dossier NOMINATIF repassé en PERIMETRE : garder les échéances ?**
- Aucune décision PO nécessaire. Garder les échéances est la solution la plus restrictive, et le code la suit (F1, aucun UPDATE de retrait). Condition de vérification : un renouvellement n'est plus possible sur un dossier PERIMETRE (F2), donc les accès déjà échus n'ont pas de voie de renouvellement sur ce dossier ; un re-ajout doit passer par une nouvelle ligne (la garde impose un accès créé vivant). À confirmer par QA (test à ajouter).
- Si Q1 est tranchée en A, ce cas ne se pose plus pour les listes nominatives.

**Q4 — Ni notification ni audit à l'expiration ; audit et notification au renouvellement seulement.**
- Aucune décision PO nécessaire pour Privacy. Ne pas journaliser l'échéance est minimisant ; la preuve de l'échéance reste la table `resource_access_grants` (aucune ligne supprimée, F7). Condition : Audit (A23) doit accepter cette table comme preuve de l'échéance et de la durée, sinon le point devient une question de gouvernance (non Privacy).

## 7. Conclusion et conditions

Verdict : **SOUS CONDITIONS**, pour le périmètre V5 (dossiers « personnes nommées » uniquement, hors listes PERIMETRE).

Conditions avant revalidation de production :
1. PRIV-V5-01 corrigé et testé (`expiresAt` réservé aux gestionnaires et au propriétaire).
2. Q3 tranchée par le PO ; à défaut, le comportement actuel est documenté comme écart accepté avec PRIV-EXC (échéance de revue, approbateur).
3. Preuves des tests PostgreSQL réels de 087 et du test de réouverture (PRIV-V5-06).

Recommandations non bloquantes : PRIV-V5-04 (contrôle en base), PRIV-V5-05 (motif codifié, lié à q246).

Limites : A15 n'a pas lu les dépôts Postgres ni les routes risques en détail, n'a pas exécuté les tests, n'a pas confirmé le cadre juridique (loi 2013-450 et ARTCI à confirmer par le juriste de Djamo). Aucune cotation du risque : elle relève du Risk Manager.

STATUS : GAP_IDENTIFIED (Q1 et Q3 ouvertes PO ; PRIV-V5-01 à corriger ; revalidation requise après correction).
