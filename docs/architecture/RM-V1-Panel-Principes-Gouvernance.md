# RM V1 — Panel « Principes de gouvernance non respectés » : architecture du calcul

- Auteur : A05 (Architecte), 2026-10-18
- Statut : DRAFT, révisé le 2026-10-18 avec DECISION-074 (q135 à q144) — **la section « Révision DECISION-074 »
  en fin de document prime sur §1 à §8 en cas d'écart** (lots P0-P6 remplacés par D0-D7) ; questions résiduelles R-Q1
  à R-Q3 ; contenu métier par A13 en parallèle
- Origine : DECISION-073 (panel), DECISION-072 (`guard:noSelfValidation`, `riskappetite.update`, régimes hybrides),
  DECISION-066 (« ne jamais bloquer »), DECISION-068 (`docs/governance/droits-acces/architecture.json`)
- Aucun code, aucune migration écrite par ce document.

## 0. Résumé

Un service serveur unique, `GovernanceHealthService`, lit l'état courant du client (rôles, membres des groupes fixes,
permissions détenues, paramètres, décisions prises sans second regard), applique des **détecteurs TypeScript purs**
(un par principe) et renvoie en une réponse : la taille de l'organisation avec sa justification, la liste des
principes avec statut, objets en cause, conséquences et trois indications TPE / PME / GE dont une marquée « la plus
adaptée ». Le frontend affiche, il ne recalcule rien.

Une seule donnée nouvelle est indispensable : un **marqueur posé à l'insertion** sur `audit_log`
(`governance_exception`, colonne nullable) pour les actions exécutées « sans seconde validation ». Un paramètre
nouveau dans `config` porte le choix du client pour `noSelfValidation`.

## 1. Où vit le calcul

### 1.1 Couches

```
api/v1/governanceHealth.routes.ts   GET, aucune règle
services/GovernanceHealthService.ts requirePermission, charge les faits (repositories existants), appelle le domaine
domain/governance/
  catalog.ts        textes versionnés (principes, conséquences, indications TPE/PME/GE, règle de taille) — A13
  facts.ts          type GovernanceFacts (photo en lecture seule de l'état du client)
  detectors.ts      Record<PrincipleId, (facts) => Offender[] | "NOT_EVALUABLE">
  organizationSize.ts  (facts, rule) => { size, justification }
infrastructure/     rien de nouveau hormis la colonne audit_log (§3.5)
```

Toute la logique (détection, taille, surbrillance) est dans `domain/governance`, fonctions pures, testables sans base.
Le service ne fait que charger les faits et assembler. Règle permanente respectée : **aucun recalcul côté frontend**,
y compris le choix de l'indication surlignée (le serveur renvoie `highlighted`).

### 1.2 API

| Endpoint | Méthode | Permission | Effet |
|---|---|---|---|
| `/api/v1/governance-health` | GET | `governancehealth.read` | Calcul complet, pas d'écriture |
| `/api/v1/config/self-validation-policy` | PUT | `config.selfvalidation.set` | Choix du client pour `noSelfValidation` (§5) |

Pas de paramètre de tenant dans l'URL ni le corps : tout est filtré par `actor.tenantId`. Pas de pagination sur le
GET : la liste des principes est bornée par le catalogue ; la liste des actions « sans seconde validation » est
tronquée aux 50 plus récentes avec le total (`exceptions.total`) — le détail complet reste dans le journal
(`GET /audit-logs`, filtre ajouté §3.5) pour qui détient `audit.read`.

Forme de la réponse (contrat pour A06 et le frontend) :

```jsonc
{
  "catalogVersion": "2026-10-18.1",          // version du catalogue A13 embarqué dans le code
  "computedAt": "2026-10-18T12:00:00Z",
  "organizationSize": {
    "value": "PME",                           // "TPE" | "PME" | "GE" | null (règle absente ou faits insuffisants)
    "ruleVersion": "…",
    "justification": [ { "fact": "activeUsersWithRole", "label": "Personnes ayant au moins un rôle", "value": 7 }, … ]
  },
  "principles": [
    {
      "id": "P-SEP-01",                       // identifiant du catalogue A13
      "title": "…", "family": "COMPOSITION" | "CUMUL" | "PERMISSION" | "SETTING" | "UNREVIEWED_DECISION",
      "status": "NOT_RESPECTED" | "RESPECTED" | "NOT_EVALUABLE",
      "notEvaluableReason": null,             // ex. "Signal « même appareil » non collecté"
      "consequences": "…",                    // texte du catalogue
      "offenders": [
        { "kind": "ROLE" | "PERMISSION" | "USER" | "GROUP" | "SETTING" | "DECISION",
          "id": "…", "label": "…", "count": 1, "detail": "…" }
      ],
      "indications": { "TPE": "…", "PME": "…", "GE": "…" },
      "highlighted": "PME"                    // = organizationSize.value, null si taille indéterminée
    }
  ],
  "exceptions": {                             // actions exécutées sans seconde validation
    "total": 12,
    "items": [ { "auditId": "…", "at": "…", "userId": "…", "userLabel": "…", "rule": "noSelfValidation",
                 "entityType": "…", "entityId": "…", "action": "VALIDATE", "reason": "…" } ]
  }
}
```

Tous les principes sont renvoyés avec leur statut (le panel montre par défaut les `NOT_RESPECTED` ; filtrer sur un
statut fourni par le serveur n'est pas un recalcul). `NOT_EVALUABLE` existe pour ne jamais afficher « respecté » faute
de donnée (fail-closed d'affichage).

### 1.3 Permissions à ajouter (`domain/permissions.ts`)

- `governancehealth.read` — préfixe distinct de `governance.*`, déjà pris par les cycles de revue
  (`governance.read/create/validate`) : réutiliser `governance.read` ouvrirait le panel à tous les détenteurs des
  revues et mélangerait deux objets.
- `config.selfvalidation.set` — assouplissement d'un contrôle : permission dédiée, jamais `config.update` ni
  `config.manage` (règle CLAUDE.md « terminal/assouplissement = permission dédiée », SEC-013/014).

Attribution par défaut (interprétation I-P1, à confirmer en cockpit avec le contenu A13) :

| Porteur | `governancehealth.read` | `config.selfvalidation.set` |
|---|---|---|
| Profil administrateur (constante prévue par DECISION-060, migration modèle 047) | oui (écran d'Administration) | oui |
| Groupe RISK_MANAGER | oui | non |
| Groupe RISK_COMMITTEE | oui (DECISION-072 : « dès qu'un membre d'Audit ou Comité arrive, il y a accès ») | non |
| Groupe AUDIT | oui (idem ; compatible `isAuditGroupPermission`, suffixe `.read`) | non |

`config.selfvalidation.set` entre dans `ADMIN_PERMISSIONS` (même nature que `config.cumul.set`) ;
`governancehealth.read` **n'y entre pas** (sinon tout lecteur du panel deviendrait « administrateur » au sens q63 et
déclencherait les règles de cumul). Mettre à jour `FIXED_GROUP_PERMISSIONS` et la migration de rattrapage des tenants
existants dans le même lot (le test de synchronisation 051 l'impose).

## 2. Forme des définitions de principes

### 2.1 Choix : catalogue de textes versionné en code + un détecteur TypeScript par principe

| Option | Verdict |
|---|---|
| Table `governance_principles` éditable | Rejetée : aucun besoin d'édition par client exprimé ; ajoute migration, CRUD, permissions, audit pour rien. |
| Règles déclaratives (DSL / JSON interprété) | Rejetée : abstraction spéculative ; les détections sont hétérogènes (comptage de membres, intersection de groupes, paramètre, journal). |
| **Textes en code + détecteurs TS** | **Retenue** : un principe = une entrée de catalogue + une fonction pure. Ajouter un principe = un commit relu, testé. |

Le serveur **ne lit jamais `docs/` à l'exécution** (non déployé sur Cloud Run). Le JSON d'A13
(`docs/governance/principes/principes-gouvernance.json`) est la source de rédaction ; il est recopié dans
`backend/src/domain/governance/catalog.ts` (constante typée), et un test vérifie :
1. que les deux sont identiques (même modèle que le test de synchronisation `fixedGroupPermissions` / migration 051) ;
2. que chaque principe du catalogue a un détecteur et réciproquement (le type `Record<PrincipleId, Detector>` le
   garantit à la compilation).

### 2.2 Contrat attendu du catalogue A13 (ce que le moteur accepte)

```ts
interface PrincipleEntry {
  id: string;                          // stable, jamais réutilisé
  family: "COMPOSITION" | "CUMUL" | "PERMISSION" | "SETTING" | "UNREVIEWED_DECISION";
  title: string;
  consequences: string;
  indications: { TPE: string; PME: string; GE: string };
}
interface SizeRule {                   // §4
  version: string;
  facts: Array<"activeUsersWithRole" | "populatedFixedGroups" | "riskManagers" | "committeeMembers" | "auditMembers" | "departmentsWithGroup">;
  thresholds: …                         // forme exacte fixée par A13, valeurs validées en cockpit
}
```

Si A13 a besoin d'un fait qui n'est pas dans la liste, il s'ajoute à `GovernanceFacts` (§3) ; le moteur n'a pas à
être générique au-delà.

### 2.3 Où vivent les indications TPE / PME / GE

Dans le catalogue (code), une chaîne par taille et par principe. Pas de personnalisation par client en V1 (aucune
demande). Si un jour l'éditeur veut les adapter par client, on ajoutera une surcharge en base ; pas avant.

## 3. Inventaire des données par famille de détection

Le service construit **une seule** photo `GovernanceFacts` par requête, à partir de repositories existants :

| Fait | Source existante | Manque |
|---|---|---|
| Utilisateurs actifs, permissions héritées `users.roles` | `UserRepository.list(tenantId)` (`deletedAt`, `roles`) | — |
| Rôles, groupe fixe, permissions | `RoleRepository.list(tenantId)` (`systemGroup`, `permissions`, `departmentId`) | — |
| Qui détient quel rôle | `RoleRepository.listAssignments(tenantId, roleId)` par rôle (le nombre de rôles d'un client est faible) | Optionnel : `listActiveAssignments(tenantId)` en une requête si la mesure le justifie, pas d'office |
| Est administrateur / membre RM / Comité / Audit | `ADMIN_PERMISSIONS` + `systemGroup` | Les prédicats `isAdministrator`, `isRiskManagerMember`… sont privés dans `RoleService.ts` : les **déplacer** dans `domain/fixedGroupPermissions.ts` (pas les dupliquer) |
| Paramètres (cumul Comité+Audit, passage Comité obligatoire, seuil Traitement) | `ConfigRepository.getByTenant` | `selfValidationPolicy` (§5) |
| Module AUDIT désactivé | `ModuleToggleRepository.list` | — |
| Dispositif : version en vigueur, décisions BOOTSTRAP / FALLBACK, ratification en attente | `RiskFrameworkRepository.listFrameworks`, `getActiveVersion`, `listRequests(tenantId, { regime })` | — (déjà marquées dans `risk_framework_change_requests`, pas de doublon dans le journal) |
| Changements des droits Audit en attente | `RolePermissionChangeRepository` | — |
| Régime « structure à une personne » (DECISION-059) | — | Lot DECISION-059 non livré : le détecteur répond `NOT_EVALUABLE` jusque-là |
| Actions « sans seconde validation » (noSelfValidation en double confirmation, régimes hybrides exécutés seul) | `audit_log` | **Marqueur à créer** (§3.5) |
| Deux comptes d'un même humain (signal « même appareil ») | — | Aucun signal d'appareil collecté ; « même e-mail » est impossible au sein d'un tenant (unicité). `NOT_EVALUABLE` en V1, hors périmètre |

### 3.1 Composition (groupes fixes)
Comptages de membres actifs par groupe fixe (0, 1, ≥ 2). Objets en cause : `GROUP` avec `count`.

### 3.2 Cumuls
Intersections par utilisateur : admin + RM, admin + Audit, admin + Comité, Comité + Audit (en signalant si
`committeeAuditCumulAllowed` l'autorise), RM + Comité. Objets en cause : `USER` (avec les rôles cumulés en `detail`).
I8 « cumul toujours visible » : ce panel en est la vue d'ensemble, il ne remplace pas l'affichage par écran.

### 3.3 Permissions
Ex. : un même rôle porte la création et la validation d'un même objet (`execution.create` + `execution.validate`) —
structurellement possible auto-validation ; permissions accordées hors RBAC via `users.roles` ; `audit.*` hors groupe
Audit. Objets : `ROLE`, `PERMISSION`, `USER`. La liste exacte des couples suit le catalogue A13.

### 3.4 Paramètres
Lecture de `config` et des modules. Objets : `SETTING` (clé, valeur, auteur et date du dernier changement lus dans le
journal par `listForEntity("config", id)`).

### 3.5 Décisions sans seconde validation — le marqueur

**Recommandation : nouvelle colonne nullable `audit_log.governance_exception text`**, valeur = identifiant de la
règle de gouvernance contournée (`noSelfValidation`, `riskappetite.adminAlone`, `config.cumul.adminAlone`,
`config.committeeenforcement.adminAlone`, `rolegroup.audit.adminAlone`, `process.evaluationmode.direct`…).
`NULL` = action ordinaire. Non nul = exécutée sans seconde validation.

Pourquoi pas une convention dans `new_value` / `old_value` (jsonb) :
- ces colonnes portent la photo de l'objet métier ; y glisser un drapeau mélange deux sens et chaque service l'écrirait
  à sa façon ;
- la requête du panel deviendrait un filtre jsonb sans index sur tout le journal.

Compatibilité append-only (I2) :
- le marqueur est posé **à l'INSERT**, jamais par UPDATE ; le garde 038 n'est pas touché ;
- `ALTER TABLE … ADD COLUMN … NULL` sans défaut volatil ne réécrit ni ne met à jour aucune ligne : le trigger
  `BEFORE UPDATE` ne se déclenche pas ;
- les lignes antérieures restent `NULL` : le panel ne marque rien rétroactivement (voir Q2) ;
- index partiel `(tenant_id, "timestamp" DESC) WHERE governance_exception IS NOT NULL`.

Pas de `CHECK` sur la liste des valeurs (elle évolue avec le catalogue) : type union `GovernanceExceptionRule` en TS
+ test. Côté code : `AuditEvent.governanceException?: string | null` **optionnel** (les faux-repositories des tests
existants compilent sans modification), un seul point d'insertion à adapter (`insertAuditEvent`,
`PostgresAuditRepository.ts` — il sert aussi aux audits transactionnels q90), et
`AuditSearchFilters.governanceExceptionOnly?: boolean` pour le journal.

Règle pour les lots suivants : **le marqueur est posé par le service au moment où il décide que l'action passe en
dérogation**, dans la même transaction que l'action quand le module suit déjà q90. Ce n'est pas un trigger : seul le
service sait qu'il est en régime hybride ou en double confirmation.

## 4. Taille de l'organisation (TPE / PME / GE)

- Fonction pure `computeOrganizationSize(facts, catalog.sizeRule)` → `{ value, ruleVersion, justification[] }`.
- Entrées : uniquement des faits dérivés des rôles assignés (DECISION-073) — personnes actives ayant au moins un rôle,
  groupes fixes peuplés et leur effectif, groupes de département. Les seuils et la règle sont **ceux d'A13 validés en
  cockpit** ; l'architecte n'en fixe aucun (principe 1 de la mémoire A05).
- Tant que la règle n'est pas validée, ou si un fait manque : `value: null`, `highlighted: null` sur chaque principe,
  le panel affiche les trois indications sans surbrillance (jamais de taille devinée).
- Justification affichable : chaque fait utilisé avec sa valeur et le seuil franchi, en texte prêt à afficher.
- Calculée à chaque lecture (état courant, pas un état « définitif ») : rien à mémoriser.

## 5. `noSelfValidation` paramétrable

### 5.1 Stockage
Colonne `config.self_validation_policy text NOT NULL DEFAULT 'REFUSE' CHECK (… IN ('REFUSE','DOUBLE_CONFIRMATION'))`
(table mono-ligne par tenant, mise à jour en place via `upsert` / `buildUpdateSet`). `DEFAULT_CONFIG` du
`ConfigService` prend `REFUSE`. Pas de table dédiée : un seul réglage, pas d'historique propre (l'historique est le
journal, comme les autres champs de `config`).

Un seul réglage pour toute la famille I5 « validation de sa propre saisie » (exécution, efficacité, évaluation de
risque, décision de traitement, mode d'évaluation, clôture de constat / de plan d'action). Une granularité par règle
s'ajoutera si un client la demande.

**Hors champ, jamais paramétrable** : `guard:noSelfRoleAssign` (auto-attribution de rôles, aucune dérogation —
DECISION-068 et réponse PO `guard:noSelfRoleChange`), et les invariants I1-I4, I6-I9.

### 5.2 Qui le change, comment
- `PUT /api/v1/config/self-validation-policy` `{ policy, reason }`, permission `config.selfvalidation.set`,
  motif obligatoire dans les deux sens, audit `UPDATE` sur `config` avec avant/après dans le même appel.
- Régime de décision : voir Q1 (administrateur seul tant qu'aucun tiers n'existe, sur le modèle des autres régimes
  hybrides de DECISION-072, ou autre).
- Le passage à `DOUBLE_CONFIRMATION` fait apparaître un principe `NOT_RESPECTED` de famille `SETTING` dans le panel
  (objet `SETTING`, auteur, date).

### 5.3 Application (lot séparé, §6 P4)
Une fonction de domaine unique, appelée par chaque garde d'auto-validation existante à la place du `throw` direct :

```
selfValidationOutcome(policy, isSelf, confirmation?) → "ALLOW" | "REFUSE" | "CONFIRMATION_REQUIRED"
```

- `REFUSE` : comportement actuel (403), message qui renvoie au principe du catalogue.
- `DOUBLE_CONFIRMATION` : 1er appel → 409 `GOVERNANCE_CONFIRMATION_REQUIRED` avec principe et conséquences ;
  2e appel avec `governanceConfirmation: { rule: "noSelfValidation", reason }` → l'action passe, audit avec
  `governance_exception = 'noSelfValidation'` et le motif. Sans état côté serveur (pas de jeton à stocker).
- Le libellé « validé » vs « appliqué sans validation indépendante » (proposition DECISION-068, non arbitrée à ma
  connaissance) reste à trancher avant ce lot ; le panel n'en dépend pas (il lit le marqueur du journal).

## 6. Découpage en lots

| Lot | Agent | Contenu | Dépend de |
|---|---|---|---|
| P0 | A13 → PO (cockpit) | Catalogue des principes, règle de taille, textes TPE/PME/GE | — (en cours) |
| P1 | A07 + A06 | Migration **065 ou le numéro libre suivant au moment du merge** : `audit_log.governance_exception` + index partiel ; `config.self_validation_policy` ; rattrapage `governancehealth.read` (groupes fixes + rôles administrateurs existants) et `config.selfvalidation.set` (rôles administrateurs). `.down.sql`. `Permission`, `ALL_PERMISSIONS`, `FIXED_GROUP_PERMISSIONS`, `ADMIN_PERMISSIONS`. `AuditEvent.governanceException?`, `insertAuditEvent`, filtre `search`. Déplacement des prédicats de groupe dans `domain/`. | — |
| P2 | A06 | `domain/governance/*` (faits, détecteurs, taille), `GovernanceHealthService`, `GET /governance-health`, câblage `server.ts`. Catalogue provisoire minimal tant que P0 n'est pas validé (taille `null`, détecteurs des familles 3.1, 3.2, 3.4, 3.5). Tests niveau 1. | P1 ; P0 pour le contenu final |
| P3 | A06 | `PUT /config/self-validation-policy` + audit | P1, Q1 |
| P4 | A06 | `selfValidationOutcome` dans les gardes existantes (≈ 7 services) + protocole de double confirmation + marqueur | P3, libellé §5.3 |
| P5 | A06 | Pose du marqueur dans les régimes hybrides de DECISION-072 quand l'admin agit seul (`riskappetite`, `config.cumul.set`, `config.committeeenforcement.set`, `rolegroup.audit.update`, `process.evaluationmode.set`) — à intégrer au lot qui implémente ces régimes, pas en retouche séparée | P1, lot DECISION-072 |
| P6 | A04 → dev-frontend | Panel dans l'Administration (maquette A04), affichage seul | P2 |
| — | A08, A10, A14 | QA + Sécurité après P2 et P4 ; Compliance (le panel touche la séparation des fonctions) | — |

Ordre : P1 → P2 (livrable seul, utile dès le départ) → P3 → P4 ; P5 suit le lot DECISION-072 ; P6 dès P2.

## 7. Questions d'architecture au PO (cockpit)

### Q1 — Le choix « double validation » s'applique-t-il toujours, ou seulement faute d'un autre validateur ?
- **Contexte** : votre réponse sur `guard:noSelfValidation` : refus par défaut, et on recueille si le client veut la
  double validation par la même personne. Si le choix vaut toujours, une personne pourra valider sa propre saisie même
  quand un collègue habilité existe ; le principe « ne jamais bloquer » (DECISION-066) vise le manque de rôles.
- **Options** :
  1. Le client active ; la double confirmation n'est proposée que si **aucune autre personne active** ne détient la
     permission de validation concernée. Sinon refus, comme aujourd'hui.
  2. Le client active ; la double confirmation est toujours proposée.
  3. Le client exprime seulement le souhait ; l'éditeur active (comme le régime « structure à une personne »).
- **Recommandation** : option 1, réglée par l'administrateur seul tant qu'aucun Risk Manager, Audit ou Comité
  n'existe, en circuit à deux dès qu'un tiers existe (même règle hybride que DECISION-072), motif et trace.

### Q2 — Actions passées : le panel ne peut pas les marquer rétroactivement
- **Contexte** : le journal est en ajout seul ; le marqueur « sans seconde validation » ne peut être posé que sur les
  actions futures. Les décisions de Dispositif en amorçage ou en repli sont déjà marquées et seront reprises.
- **Options** :
  1. Le panel affiche « suivi depuis le <date de mise en service> » et rien avant.
  2. Une requête ponctuelle reconstitue des cas passés (ex. validateur = auteur) et les affiche comme « reconstitués »,
     sans toucher au journal.
- **Recommandation** : option 1. Aucune action passée n'a pu contourner une garde d'auto-validation (elle refusait
  toujours) ; les réglages déjà assouplis par un administrateur seul restent visibles dans la famille « Paramètres »,
  avec auteur et date lus dans le journal.

### Q3 — Prévenir la première personne d'Audit ou de Comité qui arrive ?
- **Contexte** : vous voulez qu'un membre d'Audit ou de Comité, à son arrivée, voie les actions faites sans seconde
  validation. Le panel lui est ouvert ; rien ne lui signale qu'il doit le regarder.
- **Options** :
  1. Accès seul (il découvre le panel dans l'Administration).
  2. Une notification à l'attribution du rôle Audit ou Comité, si le panel contient des actions sans seconde
     validation, avec lien vers le panel.
- **Recommandation** : option 2 (une notification envoyée après l'enregistrement, sans nouvel état à stocker).

## 8. Interprétations à confirmer (non bloquantes pour P1/P2)

- **I-P1** : visibilité du panel = administrateurs, Risk Manager, Comité, Audit ; pas les autres utilisateurs.
- **I-P2** : un seul réglage `noSelfValidation` pour toute la famille I5 ; l'auto-attribution de rôles en est exclue.
- **I-P3** : la consultation du panel n'est pas tracée dans le journal (lecture sans donnée personnelle sensible
  au-delà des noms et rôles, déjà visibles dans l'Administration).
- **I-P4** : « réexaminer » une décision prise sans seconde validation (DECISION-066) n'est pas dans ce lot : le panel
  la liste ; l'acte de réexamen sera un lot à part s'il est demandé.
