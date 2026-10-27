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
  → **Remplacée par la révision ci-dessous (R-4.2)** : le catalogue A13 a besoin du statut « revu par un tiers »
  (GOV, ligne 516 du JSON) et q139 demande toutes les données ; la revue par un tiers entre dans le lot D5.

---

## Révision DECISION-074 (2026-10-18, réponses PO q135 à q145)

Cette section prime sur §1 à §8. Ce qui n'y est pas repris reste valable (couches §1.1, forme de la réponse §1.2,
catalogue en code §2, marqueur `audit_log.governance_exception` §3.5, `selfValidationOutcome` §5.3).

Correction de nommage : la table des paramètres s'appelle **`configs`** (migration 024), pas `config` ; le réglage de
§5.1 est donc `configs.self_validation_policy`. Le journal reste `audit_log` (singulier).

### R-0. Ce qui change

| Réponse | Effet sur l'architecture |
|---|---|
| q135 | La taille ne vient plus des comptes : elle vient d'un **questionnaire de profil d'organisation** versionné (R-2). Les comptes réels servent à signaler les **écarts** questionnaire / réalité. |
| q136 | Les trois indications deviennent trois **niveaux d'exigence** (exige / recommande / informatif, légende du JSON A13). Le serveur renvoie le niveau applicable à la taille calculée ; aucun changement de structure au-delà du catalogue. |
| q137 | Nouvelle **désignation d'intérimaire** du Risk Manager ; `guard:notLastRiskManager` évolue (R-3). |
| q138 | Nouvelle entité **acceptation datée d'un principe** (R-5). |
| q139 | Toutes les données manquantes sont créées **avant** la livraison du panel (R-1 inventaire, R-8 lots). |
| q140 | Masquage des noms côté serveur sans `audit.read` (R-6.1). |
| q141 | Double confirmation proposée **seulement si aucune autre personne ne peut valider** — calcul serveur (R-4.1). |
| q142 | Statut affiché « Appliqué sans validation indépendante », distinct de « Validé » (R-4.2). |
| q143 | `trackedSince` par client (R-6.2). |
| q144 | Notification à l'attribution d'un rôle Audit ou Comité (R-6.3). |
| q145 | Hors de ce document (lot @dev-backend en cours, migration probablement 065). |

### R-1. Inventaire des données manquantes et modèle retenu

Base : `donneesDisponibles.manquent` et les `donneesManquantes` par principe du JSON A13 (version 0.1, A13 la met à
jour en parallèle — toute donnée ajoutée par A13 après cette révision repasse par l'architecte avant développement).

Règles communes à toutes les lignes : `tenant_id NOT NULL` + filtre `actor.tenantId` dans chaque requête ; aucune
suppression physique ; chaque écriture passe par le service propriétaire avec `AuditRepository.record` (même
transaction quand le module suit déjà q90) ; aucun champ d'attribution (`…By`) accepté du client ; toute valeur qui
nomme un compte est un `uuid` vérifié dans le tenant de l'acteur par le service avant écriture.

| # | Donnée | Modèle | Service propriétaire | Permission(s) | Lot |
|---|---|---|---|---|---|
| 1 | Marqueur « sans seconde validation » | `audit_log.governance_exception text NULL` (§3.5) + index partiels `(tenant_id, "timestamp" DESC)` et `(tenant_id, entity_type, entity_id)` `WHERE governance_exception IS NOT NULL` | Chaque service qui décide la dérogation ; point d'insertion unique `insertAuditEvent` | — | D1 |
| 2 | Choix du client pour `noSelfValidation` | `configs.self_validation_policy text NOT NULL DEFAULT 'REFUSE' CHECK IN ('REFUSE','DOUBLE_CONFIRMATION')` | `ConfigService` | `config.selfvalidation.set` (ADMIN) | D1 (colonne), D4 (route) |
| 3 | Revue par un tiers d'une action sans seconde validation | Table `governance_exception_reviews` (id, tenant_id, audit_log_id FK `audit_log`, reviewed_by, reviewed_at, comment NOT NULL) ; **ajout seul**, unique `(tenant_id, audit_log_id)`, pas de `deleted_at` (une revue ne s'annule pas, elle se complète par une autre trace du journal). Garde service : `reviewed_by ≠ audit_log.user_id`. | `GovernanceExceptionService` (nouveau) | `governanceexception.review` (RM, Audit, Comité ; pas admin seul) | D5 |
| 4 | Dernière activité (q175 : libellé, chaque nouveau jeton compte) | `users.last_seen_at timestamptz NULL`, mise à jour **au plus une fois par heure** par la résolution d'identité (`UPDATE … WHERE last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour'`), hors transaction de la requête, échec journalisé (Pino) sans faire échouer la requête. Pas d'entrée `audit_log` (télémétrie technique, sinon une ligne par heure et par personne). `NULL` = « pas vu depuis la mise en service de la colonne ». | `UserRepository` (infrastructure), appelé depuis le résolveur d'identité partagé par `GoogleIdentityProvider` / `LocalIdentityProvider` | Lecture : `user.read` | D2a |
| 5 | Propriétaire de processus = compte | `processes.owner_user_id uuid NULL` FK `users`. `processes.owner` (texte libre) **conservé** en lecture seule comme libellé hérité, jamais rapproché automatiquement d'un compte (pas de correspondance devinée par nom) : le panel liste « propriétaire non rattaché à un compte » tant que `owner_user_id` est NULL. | `ProcessService` (mise à jour en place, `buildUpdateSet`) | `process.responsibility.assign` (dédiée : la relation ouvre des droits, DECISION-064 / DECISION-072 `risk.owner.assign`) ; jamais `process.update` | D2b |
| 6 | Champion de risque par processus | `processes.risk_champion_user_id uuid NULL` FK `users` | idem | idem | D2b |
| 7 | N-1 désigné par processus (DECISION-064) | `processes.deputy_user_id uuid NULL` FK `users` | idem | idem | D2b |
| 8 | Gérant désigné (DECISION-066 §5) | Table `governance_designations` (id, tenant_id, kind CHECK IN ('MANAGER','RISK_MANAGER_INTERIM'), user_id, reason NOT NULL, valid_until timestamptz NULL, activated_at NULL, activated_ref uuid NULL, designated_by, created_at, ended_at, ended_by, end_reason) ; unique partiel `(tenant_id, kind) WHERE ended_at IS NULL`. Fin = `ended_at` (soft), jamais `DELETE`. V1 : le gérant est **informé** seulement (notifications R-6.4) ; « gérant qui statue » n'est pas stocké tant qu'aucun code ne sait l'appliquer (principe 2 mémoire A05). | `GovernanceDesignationService` (nouveau) | `designation.manage` (ADMIN_PERMISSIONS : la désignation d'intérimaire ouvre des droits RM) | D2c |
| 9 | Intérimaire du Risk Manager (q137) | Même table, `kind = 'RISK_MANAGER_INTERIM'` ; `valid_until` = date de fin d'intérim prévue (affichée, dépassement signalé dans le panel, **jamais** de retrait automatique : il viderait le groupe). Le **suppléant** = deuxième membre du groupe RISK_MANAGER : donnée existante (`user_roles`), rien à créer. | idem + `RoleService` (R-3) | `designation.manage` | D2c |
| 10 | Régime « structure à une personne » (DECISION-059) | `tenants.single_person_regime_declared_at`, `…_lifted_at`, `…_lift_ref uuid` (NULL = non déclaré). Levée **mémorisée** par trigger AFTER sur `user_roles` / `users` (deuxième personne active ayant un rôle), sous `FOR NO KEY UPDATE` du tenant, garde set-once BEFORE UPDATE sur `tenants` — même modèle que 062, **fonction distincte** de `risk_framework_bootstrap_end_mark` (ne pas redéfinir celle de 062). Déclaration : par l'éditeur seulement ; aucun compte éditeur n'existe dans l'application → opération d'exploitation hors API, mécanisme à définir avec A09 (journalisée). Tant qu'il n'existe pas : colonne NULL, régime non déclaré. | Lecture : `TenantService` / `GovernanceHealthService` | aucune permission client (q117 : jamais par le client) | D2d |
| 11 | Profil d'organisation (q135) | R-2 | `OrganizationProfileService` (nouveau) | `orgprofile.read`, `orgprofile.submit`, `orgprofile.approve` | D3 |
| 12 | Acceptation datée d'un principe (q138) | R-5 | `GovernancePrincipleAcceptanceService` (nouveau) | `governanceprinciple.accept`, `governanceprinciple.acceptance.confirm`, `governanceprinciple.acceptance.revoke` | D5 |
| 13 | Notifications de gouvernance obligatoires | Pas de table : nouveaux types dans le catalogue de notifications, émis par `NotificationService.emit` **après commit**, hors abonnement (non désactivables) | Services émetteurs (R-6.3, R-6.4) | — | D5 |
| 14 | Déclaration d'un auditeur externe | Une question du questionnaire (R-2), pas de donnée séparée | `OrganizationProfileService` | — | D3 |
| 15 | Date de début de suivi (q143) | `tenants.governance_tracking_started_at timestamptz NOT NULL DEFAULT now()` posée par la migration du lot D6 | `GovernanceHealthService` | — | D6 |
| 16 | Lien contrôle → processus → propriétaire | Existe (`controls.process_id`, 031) + ligne 5 : c'est une mesure de couverture, rien à créer | — | — | — |
| 17 | Deux comptes d'un même humain | **Aucune donnée collectable sans choix PO** (signal d'appareil = donnée personnelle, A15) → R-Q2 | — | — | après R-Q2 |
| 18 | Entité Analyse, droit `risk.analysis.update`, historique par auteur (DECISION-064) ; votes nominatifs du Comité (B-12) | Données **d'une fonctionnalité** non livrée (refonte Risques, B-12), pas de données de gouvernance → R-Q3 | lots propriétaires | — | après R-Q3 |

Pourquoi des colonnes sur `processes` et non le RACI (position du 2026-10-18 « partir du RACI A / R » révisée) :
propriétaire, champion et N-1 sont **à valeur unique** par processus et ouvrent des droits ; une colonne FK l'impose
sans code, `raci_assignments` n'a ni `Process` dans son `CHECK` ni unicité du `A`, et « champion » n'est pas une lettre
RACI. Le RACI reste la responsabilité informative (C / I) sur les risques, contrôles et plans.

Interprétations (à confirmer, non bloquantes) :
- **I-R1** : auto-désignation interdite pour les lignes 5 à 9 (`designated_by ≠ user_id`) — même famille que
  `guard:noSelfRoleAssign`, sans dérogation, car ces relations ouvrent des droits.
- **I-R2** : le propriétaire, le champion et le N-1 doivent être des comptes actifs du tenant au moment de la
  désignation ; une suspension ultérieure ne vide pas la colonne, le panel la signale (objet `USER`, « compte suspendu »).

### R-2. Questionnaire de profil d'organisation (q135)

**Stockage** : table `organization_profiles` (une ligne par **version** de réponses, ajout seul pour le contenu) :
`id, tenant_id, questionnaire_version text NOT NULL, answers jsonb NOT NULL, reason text NOT NULL, status CHECK IN
('PENDING','ACTIVE','SUPERSEDED','REJECTED'), submitted_by, submitted_at, decided_by NULL, decided_at NULL,
decision_reason NULL, regime CHECK IN ('ALONE','CONFIRMED') NULL`. Unique partiels `(tenant_id) WHERE status =
'ACTIVE'` et `(tenant_id) WHERE status = 'PENDING'`. Garde de base : `answers`, `questionnaire_version`, `submitted_*`
immuables après insertion (trigger BEFORE UPDATE avec `search_path` épinglé) ; seules les colonnes de décision
changent, une fois.

- **Contenu** (questions, réponses permises) : rédigé par A13, validé en cockpit (DECISION-074 : « repassera en
  cockpit avant développement »). Il vit **en code** (`domain/governance/organizationQuestionnaire.ts`, version +
  schéma zod), recopié du JSON A13 avec test de synchronisation, comme le catalogue (§2.1). `answers` est validé
  contre le schéma de la version déclarée ; une version ancienne reste lisible.
- **Classement** : fonction pure `classifyOrganization(answers, rule) → { value, ruleVersion, justification[] }`,
  recalculée à chaque lecture (pas de taille mémorisée : elle suit la réponse active et la règle en vigueur). Seuils =
  ceux d'A13 validés en cockpit ; tant qu'aucun profil n'est actif ou que la règle n'est pas validée : `value: null`,
  aucune surbrillance.
- **Écarts** : `profileGaps[]` dans la réponse du panel — pour chaque question qui a un fait observable en
  correspondance (table de correspondance dans le catalogue A13, ex. « personnes dans la fonction risque » ↔ membres
  actifs du groupe RISK_MANAGER, « audit interne » ↔ groupe AUDIT peuplé), `{ questionId, declared, observed, label }`.
  Le serveur ne corrige jamais le profil à partir des comptes.
- **Qui modifie (règle hybride DECISION-072)** : `orgprofile.submit` (administrateur, Risk Manager) soumet une
  nouvelle version avec motif. Si **aucun tiers** n'existe (aucun membre actif RM, Audit ou Comité autre que le
  soumetteur) : la version devient ACTIVE immédiatement, `regime = 'ALONE'`, audit avec `governance_exception =
  'orgprofile.adminAlone'`. Sinon : PENDING ; un détenteur de `orgprofile.approve` (RM, Audit, Comité), **différent
  du soumetteur**, approuve (l'ancienne passe SUPERSEDED dans la même transaction) ou rejette, motif obligatoire.
  Pas de modification en place d'une version : on en soumet une nouvelle.
- `orgprofile.read` : mêmes porteurs que `governancehealth.read`.
- **Nombre de personnes de la fonction risque** (déclencheur q137) = `max(déclaré, observé)` (lecture la plus
  exigeante, fail-closed) — **I-R3**, à confirmer.

### R-3. Intérim du Risk Manager et `guard:notLastRiskManager` (q137)

- **À la désignation** : le serveur ne bloque pas l'attribution du rôle Risk Manager. Quand la fonction risque compte
  plus d'une personne (I-R3) et qu'il n'y a ni deuxième membre RM ni intérimaire désigné, le panel affiche l'action
  « désigner un intérimaire ou un suppléant » (principe du catalogue A13, objet `GROUP`). Le frontend enchaîne la
  proposition de désignation après l'attribution (`POST /governance-designations`), sans couplage dans
  `POST /roles/:id/assign`.
- **Garde actuel** (`RoleService.revokeFromUser`, `assertNotLastRiskManager` + garde atomique de
  `UserRepository.suspend` / `revokeFromUser({ minRemaining: 1 })`) : refuse de retirer ou suspendre le dernier RM.
- **Évolution** : si le retrait ou la suspension viderait le groupe **et** qu'un intérimaire actif est désigné
  (compte actif, différent du partant et **différent de l'acteur** — l'activation lui attribue le rôle, I-R1), une
  méthode de dépôt dédiée `handOverLastRiskManager(tenantId, roleId, leavingUserId, interimUserId, …)` fait, dans
  **une** transaction sous le verrou du tenant (ordre users → roles → tenants) : (1) retrait du partant, (2)
  attribution à l'intérimaire, (3) `activated_at` / `activated_ref` sur la désignation, (4) deux entrées d'audit
  `ROLE_CHANGE` avec le motif. **Ordre retrait puis attribution obligatoire** : le trigger AFTER INSERT de 062
  (`risk_framework_bootstrap_end_mark`) compte les membres RM à chaque insertion ; attribuer avant de retirer ferait
  compter 2 RM un instant et **terminerait l'amorçage définitivement** à tort. Le garde `minRemaining` ne s'applique
  pas à cette méthode, qui garantit elle-même 1 membre en fin de transaction (contrôle avant COMMIT).
- **Sans intérimaire** : voir R-Q1 (refus maintenu, ou groupe vide autorisé avec dérogation).
- Fin d'intérim : quand un nouveau RM est nommé, l'administrateur retire l'intérimaire par le chemin ordinaire (le
  garde ne se déclenche plus) et clôt la désignation (`ended_at`).

### R-4. Auto-validation (q141, q142)

#### R-4.1 « Personne d'autre ne peut valider » — calcul serveur

`selfValidationOutcome(policy, isSelf, otherValidatorExists, confirmation?)` (§5.3, un paramètre de plus) :
`DOUBLE_CONFIRMATION` n'est proposé que si `otherValidatorExists = false` ; sinon refus 403 comme aujourd'hui, avec le
message « un autre validateur existe » (sans le nommer si l'acteur n'a pas `audit.read`).

`otherValidatorExists` est fourni par un port de domaine `EligibleValidatorQuery.existsOther(tenantId, actorId,
permission, scope)` implémenté en une requête SQL dans `infrastructure/` : existe-t-il un compte **actif**
(`deleted_at IS NULL`), différent de l'acteur, qui détient la permission de validation concernée — par `user_roles`
non révoqués × `roles.permissions` (rôle non supprimé), ou par `users.roles` (permissions héritées, même union que
le résolveur d'identité, sinon le calcul diverge de ce que `requirePermission` accepte) — **et** dont la portée couvre
l'objet (rôle de département : même `department_id` que l'objet quand le module est scopé). L'exactitude de la portée
est la partie à risque : A06 réutilise le résolveur de portée existant (`DashboardScopeResolver` / règles du module)
plutôt qu'une seconde implémentation.

- Calcul au moment de la décision, sans verrou (un validateur ajouté entre le contrôle et le COMMIT ne rend pas
  l'action illégitime) ; le fait est mémorisé : `newValue.otherValidatorExists = false` dans l'entrée d'audit marquée.
- **I-R4** : un compte actif mais dormant (ligne 4) compte comme validateur possible : on mesure la capacité, pas la
  présence. Le panel signale le compte dormant ; la double confirmation n'est pas ouverte pour autant.
- Les services concernés : ceux qui portent aujourd'hui une garde d'auto-validation (exécution de contrôle,
  efficacité, évaluation de risque, décision de traitement, clôture de plan d'action, clôture de constat, demande de
  mode d'évaluation) — **inventaire exact à établir par A06** (grep des refus d'auto-validation) avant le lot D4.

#### R-4.2 Statut « Appliqué sans validation indépendante »

- **Source de vérité** : le marqueur `audit_log.governance_exception` posé à l'insertion (ligne 1), éventuellement
  complété par une revue (ligne 3). **Aucune colonne ni valeur de statut ajoutée aux tables des modules** : la ligne
  métier garde son statut `VALIDATED` (ou équivalent), ce qui évite (a) de toucher les gardes d'immuabilité
  (`same_content`) de tables append-only comme `risk_evaluations`, (b) de casser chaque lecteur qui filtre sur
  `VALIDATED` (efficacité, scores, tableaux de bord, rapports).
- **Exposition** : chaque réponse d'API d'un objet validable porte `validationIndependence: "INDEPENDENT" |
  "WITHOUT_INDEPENDENT_REVIEW" | "REVIEWED_BY_THIRD_PARTY"`, calculé **côté serveur** par un helper unique
  `GovernanceExceptionLookup.forEntities(tenantId, entityType, ids[])` (une requête sur l'index partiel
  `(tenant_id, entity_type, entity_id)` + jointure aux revues). Libellé affiché « Appliqué sans validation
  indépendante » pour la 2e valeur ; jamais « Validé ». Exports et rapports utilisent le même helper.
- **I-R5** : un acte « appliqué sans validation indépendante » **compte** dans les calculs comme un acte validé
  (« appliqué » : il produit ses effets ; sinon une TPE n'aurait jamais de contrôle efficace), avec le libellé
  distinct partout où il apparaît. À confirmer ; si le PO veut l'exclure des calculs, chaque lecteur devra appeler le
  helper — lot nettement plus large.
- Modules : les mêmes que R-4.1, plus les régimes hybrides de DECISION-072 exécutés par l'administrateur seul
  (`riskappetite`, `config.cumul.set`, `config.committeeenforcement.set`, `rolegroup.audit.update`,
  `process.evaluationmode.set`) — marqueur posé par le lot qui implémente chaque régime (ex-P5), et le Dispositif dont
  les décisions BOOTSTRAP / FALLBACK sont déjà marquées dans `risk_framework_change_requests` (lu tel quel, pas de
  doublon).

### R-5. Acceptation datée d'un principe non respecté (q138)

Table `governance_principle_acceptances` : `id, tenant_id, principle_id text, catalog_version text, offenders_snapshot
jsonb NOT NULL, reason text NOT NULL, expires_at timestamptz NOT NULL, status CHECK IN ('PENDING','ACTIVE','REJECTED',
'REVOKED'), regime CHECK IN ('ALONE','CONFIRMED') NULL, accepted_by, accepted_at, confirmed_by NULL, confirmed_at
NULL, ended_by NULL, ended_at NULL, end_reason NULL`. Unique partiel `(tenant_id, principle_id) WHERE status IN
('PENDING','ACTIVE')`. Contenu immuable après insertion (trigger, `search_path` épinglé) ; transitions validées dans le
service (`VALID_TRANSITIONS`), motif obligatoire pour REJECTED / REVOKED.

- **Durée** : `expires_at` obligatoire, futur. Aucune durée maximale au contrat → aucune n'est inventée (I-R6, A13
  peut en proposer une par gravité). L'expiration n'est **pas** un état stocké : à la lecture, `expires_at < now()`
  ⇒ le principe redevient `NOT_RESPECTED` (pas de tâche planifiée).
- **Portée** : l'acceptation couvre les objets en cause **au moment de l'acceptation** (`offenders_snapshot`). Un
  nouvel objet en cause après coup refait passer le principe en `NOT_RESPECTED` (fail-closed) ; le panel montre
  « accepté le … jusqu'au … » pour les anciens.
- **Seconde confirmation (hybride)** : `governanceprinciple.accept` (administrateur, Risk Manager). Si aucun tiers
  (membre actif RM, Audit ou Comité autre que l'acteur) : ACTIVE directement, `regime = 'ALONE'`, marqueur
  `governance_exception = 'principle.acceptance.alone'`. Sinon PENDING, confirmation ou rejet par un détenteur de
  `governanceprinciple.acceptance.confirm` (RM, Audit, Comité) **différent de l'acceptant**.
- **Fin anticipée** : `governanceprinciple.acceptance.revoke` (dédiée : état terminal, règle CLAUDE.md), RM, Audit,
  Comité, administrateur.
- Statut nouveau dans la réponse du panel : `ACCEPTED`, avec `acceptance { reason, expiresAt, regime, acceptedBy*,
  confirmedBy* }` (* masqués selon R-6.1).

### R-6. Panel : visibilité, suivi, notifications

#### R-6.1 Visibilité et masquage (q140)

- `governancehealth.read` : administrateurs, groupes RISK_MANAGER, RISK_COMMITTEE, AUDIT (I-P1 confirmée).
- **Noms visibles seulement avec `audit.read`.** Sans `audit.read`, le service remplace avant sérialisation tout
  champ qui identifie une personne (`offenders[kind=USER].id/label`, `exceptions.items[].userId/userLabel`, auteur
  d'un paramètre, `acceptance.*By`, `profileGaps` ne contient pas de nom) par `null` + libellé générique
  « Personne 1, 2… » **stable dans la seule réponse** (aucune table de pseudonymes, pas de réidentification d'une
  réponse à l'autre). Les comptages restent visibles. Test de non-régression : aucune réponse sans `audit.read` ne
  contient un `userId` ou un e-mail.
- Information (pas une question) : dans une très petite structure, un comptage « 1 membre RM » identifie de fait la
  personne ; le masquage protège la liste, pas l'inférence.

#### R-6.2 « Suivi depuis » (q143)

`trackedSince = tenants.governance_tracking_started_at` dans la réponse (ligne 15), posée par la migration du lot D6
(donc après toutes les migrations de données : la date est prudente, jamais antérieure à une donnée qui n'existait
pas). Aucune reconstitution. `last_seen_at NULL` s'affiche « pas de connexion depuis le <trackedSince> ».

#### R-6.3 Notification à l'attribution Audit / Comité (q144)

Dans `RoleService.assignToUser`, **après commit**, si le rôle appartient au groupe AUDIT ou RISK_COMMITTEE et qu'il
existe au moins une action marquée **non revue** depuis `trackedSince` : `NotificationService.emit` type
`GOVERNANCE_EXCEPTIONS_TO_REVIEW` au nouveau membre, texte = nombre d'actions + lien vers le panel, **aucun nom**
(le destinataire Comité n'a pas forcément `audit.read`). Échec d'envoi journalisé, sans annuler l'attribution
(principe 8 mémoire). Dépendance `Notifier` en paramètre de constructeur **optionnel** (`this.notifier?.…`).

#### R-6.4 Gérant informé (DECISION-066 §5)

À chaque insertion d'une entrée marquée `governance_exception`, après commit, notification
`GOVERNANCE_EXCEPTION_RECORDED` au gérant désigné s'il existe et s'il n'est pas l'auteur. Émise par le service qui
pose le marqueur via un helper commun (pas dans `insertAuditEvent`, qui ne doit pas dépendre des notifications).

### R-7. Permissions nouvelles (récapitulatif)

| Permission | Porteurs par défaut | `ADMIN_PERMISSIONS` |
|---|---|---|
| `governancehealth.read` | admin, RM, Comité, Audit | non |
| `config.selfvalidation.set` | admin | oui |
| `orgprofile.read` | admin, RM, Comité, Audit | non |
| `orgprofile.submit` | admin, RM | non |
| `orgprofile.approve` | RM, Comité, Audit | non |
| `process.responsibility.assign` | admin, RM | oui (ouvre des droits) |
| `designation.manage` | admin | oui |
| `governanceexception.review` | RM, Comité, Audit | non |
| `governanceprinciple.accept` | admin, RM | non |
| `governanceprinciple.acceptance.confirm` | RM, Comité, Audit | non |
| `governanceprinciple.acceptance.revoke` | admin, RM, Comité, Audit | non |

Chaque lot qui ajoute une permission met à jour `Permission`, `ALL_PERMISSIONS`, `FIXED_GROUP_PERMISSIONS`,
`ADMIN_PERMISSIONS` si applicable, **et** la migration de rattrapage des tenants existants dans la même migration
(test de synchronisation 051). `isAuditGroupPermission` : vérifier que `orgprofile.approve`,
`governanceexception.review`, `governanceprinciple.acceptance.confirm` / `.revoke` sont acceptées pour le groupe
Audit (elles ne sont pas en `.read`) — sinon décision A13/A10 à prendre dans le lot, pas d'élargissement implicite.

### R-8. Lots dans l'ordre d'implémentation (remplace §6)

Migrations : **numéros indicatifs à partir de 066** (065 probablement prise par q145) ; l'orchestrateur renumérote au
merge selon l'ordre réel. Chaque migration a son `.down.sql`.

| Lot | Agent(s) | Contenu | Migration indicative | Dépend de |
|---|---|---|---|---|
| D0 | A13 → PO (cockpit) | Catalogue v1 (principes, niveaux d'exigence par taille), questionnaire + règle de classement + correspondance questions ↔ faits, types de notifications, durée max d'acceptation éventuelle | — | — (en cours) |
| D1 | A06 (+A07) | ex-P1 : marqueur + 2 index partiels, `configs.self_validation_policy`, `governancehealth.read` / `config.selfvalidation.set` + rattrapage ; `AuditEvent.governanceException?` ; filtre `search` ; déplacement des prédicats de groupe dans `domain/fixedGroupPermissions.ts` | 066 | — |
| D2a | A06 | `users.last_seen_at` + écriture limitée à 1/h dans le résolveur d'identité | 067 | — |
| D2b | A06 (+A07) | Responsabilités de processus (lignes 5-7), `process.responsibility.assign`, route `PUT /processes/:id/responsibilities` | 068 | D1 (prédicats) |
| D2c | A06 (+A07) | `governance_designations`, `designation.manage`, routes `/governance-designations`, `handOverLastRiskManager` (R-3) | 069 | D1, R-Q1 |
| D2d | A07 (+A06 lecture) | Régime structure à une personne : colonnes `tenants` + trigger de levée + garde set-once ; mécanisme de déclaration éditeur avec A09 | 070 | — |
| D3 | A06 (+A07) | `organization_profiles`, questionnaire en code, `classifyOrganization`, routes `/organization-profile` (GET, POST submit, POST approve/reject) | 071 | D1, **D0 validé** |
| D4 | A06 | `PUT /config/self-validation-policy`, `EligibleValidatorQuery`, `selfValidationOutcome` dans les gardes existantes, `validationIndependence` + `GovernanceExceptionLookup` | — (index en D1) | D1 |
| D5 | A06 (+A07) | `governance_exception_reviews`, `governance_principle_acceptances`, leurs permissions et routes, notifications R-6.3 / R-6.4 | 072 | D1, D2c (gérant), D4 |
| D6 | A06 | `GovernanceHealthService` + `GET /governance-health` (détecteurs sur toutes les données ci-dessus, `profileGaps`, `ACCEPTED`, masquage R-6.1), `tenants.governance_tracking_started_at` | 073 | D1 à D5, D0 validé |
| D7 | A04 → dev-frontend | Panel + écrans de saisie (questionnaire, désignations, responsabilités de processus, acceptation, revue) | — | D6 (panel) ; écrans de saisie dès leur lot serveur |
| — | A08, A10, A14 | QA + Sécurité après D2c (garde RM), D4 (auto-validation), D6 (masquage) ; Compliance après D4 et D6 (séparation des fonctions, données personnelles `last_seen_at` → A15) | — | — |

**Parallélisme.** Tous les lots serveur sauf D2a et D2d touchent `domain/permissions.ts` (et la plupart
`server.ts`) : en parallèle **uniquement en worktrees**, fusion un par un par l'orchestrateur (conflit attendu et
trivial : blocs ajoutés en fin d'union / de tableau). Réellement sans conflit sur ces deux fichiers : **D0, D2a
(une ligne dans le résolveur d'identité, pas dans `permissions.ts`), D2d**. Vague recommandée :
1. D0 ‖ D1 ‖ D2a ‖ D2d ;
2. après D1 : D2b ‖ D2c (si R-Q1 tranchée) ‖ D4 ; D3 dès D0 validé ;
3. D5 ; 4. D6 ; 5. D7 (les écrans de saisie peuvent suivre chaque lot serveur).
Les migrations des lots parallèles touchent des tables distinctes, sauf D2d et D6 (`tenants`, colonnes distinctes)
et D1 / D2a / D2b (`configs`, `users`, `processes` : distinctes) — pas de conflit de schéma.

### R-9. Questions d'architecture au PO (cockpit)

#### R-Q1 — Départ du dernier Risk Manager sans intérimaire désigné
- **Contexte** : avec un intérimaire, il prend le rôle automatiquement au départ du dernier RM. Sans intérimaire,
  l'outil refuse aujourd'hui le départ. L'administrateur ne peut pas se désigner lui-même intérimaire : ce serait
  s'attribuer un rôle, ce que vous avez exclu sans exception.
- **Options** : (1) refus maintenu, avec un message qui demande de désigner un intérimaire (une autre personne) ;
  (2) départ accepté avec seconde confirmation et motif : le groupe Risk Manager devient vide, signalé en tête du
  panel, et les actions réservées au Risk Manager attendent un nouveau titulaire.
- **Recommandation** : option 2 — c'est le seul cas où le refus bloque vraiment (une démission ne s'empêche pas) ;
  conforme à « ne jamais bloquer ».

#### R-Q2 — Deux comptes d'une même personne : que collecter ?
- **Contexte** : rien ne permet aujourd'hui de détecter qu'une personne a deux comptes. Le détecter automatiquement
  demande de collecter des signaux sur l'appareil, des données personnelles.
- **Options** : (1) déclaration : l'administrateur indique que deux comptes appartiennent à la même personne,
  le panel le montre ; (2) collecte d'un signal d'appareil, avec avis Privacy ; (3) ne pas traiter ce principe.
- **Recommandation** : option 1, aucune donnée nouvelle sur les personnes.

#### R-Q3 — Données qui appartiennent à des fonctions pas encore construites
- **Contexte** : deux principes ont besoin de données qui naissent avec une fonction entière : l'étape Analyse des
  risques et ses auteurs, et les votes nominatifs du Comité. « Toutes les données avant le panel » ferait attendre le
  panel jusqu'à la fin de ces deux chantiers.
- **Options** : (1) le panel attend ces deux fonctions ; (2) le panel sort avec toutes les autres données, ces deux
  principes affichés « évaluable à la livraison de <fonction> », jamais « respecté ».
- **Recommandation** : option 2.
