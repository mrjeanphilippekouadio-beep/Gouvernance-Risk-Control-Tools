# Transcription --- Échange sur l'architecture du GRC

> Transcription des messages utilisateur et des réponses de l'assistant,
> dans l'ordre de l'échange.

------------------------------------------------------------------------

## Utilisateur

je me dis que pour les evidences on pourrais partir sur du drive avec
des liens ou s'il y avait la possibibilité d'encaspusler un drive
partage le reste des informations qui ne sont pas des politque , fichier
, etc typique a la base vont dans la base

Aussi je ne veux pas que le font gere tout ce qui est logique si je en
faire un saas apres sa peut faire l'objet de modification futur

je suis d'accord pour les etaats de transition

journal d'audit des le debuts

je ne voudrais pas que le frontend puisse directement faire toutes les
opérations métier sensibles.

------------------------------------------------------------------------

## Assistant

Oui, et avec ces précisions je modifierais légèrement l'architecture
proposée dans l'échange. Je pense même que tes choix rendent
l'architecture **plus propre pour une éventuelle transformation en
SaaS**.

### 1. Les evidences : je partirais bien sur Google Drive

Je séparerais clairement **les données métier** des
**documents/preuves**.

``` text
                    GRC
                     │
          ┌──────────┴──────────┐
          │                     │
     DONNÉES MÉTIER          DOCUMENTS
          │                     │
     PostgreSQL             Google Drive
          │                     │
     ┌────┴────┐          ┌─────┴─────┐
     │ Risques │          │ Evidences │
     │ Contrôles│         │ Rapports  │
     │ Audits  │          │ Politiques│
     │ KRI     │          │ Procédures│
     │ Actions │          │ Annexes   │
     └─────────┘          └───────────┘
```

C'est une bonne séparation.

Dans PostgreSQL, tu ne stockes pas le PDF ou le fichier Word lui-même.
Tu stockes par exemple :

``` text
evidence
-------------------------
id
control_execution_id
file_name
drive_file_id
drive_url
document_type
uploaded_by
uploaded_at
version
status
```

Et éventuellement :

``` text
drive_folder_id
```

pour savoir dans quel espace Drive le document est conservé.

### 2. L'idée du Drive partagé est particulièrement intéressante

Tu pourrais avoir une structure du type :

``` text
GRC/
│
├── 01_Risques/
├── 02_Controles/
├── 03_Audits/
├── 04_Incidents/
├── 05_Plans_Actions/
├── 06_KRI/
├── 07_Politiques_Procedures/
└── 08_Archives/
```

Mais je ne ferais **pas** dépendre la logique métier de la structure des
dossiers Drive.

Le GRC doit savoir :

> « cette preuve appartient à cette exécution de contrôle »

et non :

> « cette preuve se trouve dans le dossier X ».

C'est une distinction importante.

Le Drive devient donc **le stockage documentaire**, tandis que
PostgreSQL reste **le système de référence métier**.

------------------------------------------------------------------------

# 3. Et je suis d'accord avec toi sur le frontend

Je ne voudrais pas non plus une architecture :

``` text
React
   ↓
Supabase
   ↓
PostgreSQL
```

où React contient toute la logique :

``` text
if (...)
if (...)
if (...)
validate(...)
calculate(...)
changeStatus(...)
approve(...)
```

Ça deviendrait problématique si tu veux ensuite faire :

``` text
                 SaaS
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
     Web        API        Mobile
       │          │          │
       └──────────┼──────────┘
                  ▼
            Backend métier
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
   PostgreSQL           Google Drive
```

C'est exactement pour cette raison que je modifierais la proposition
précédente.

------------------------------------------------------------------------

# 4. Je mettrais une vraie couche Backend / API

Je partirais plutôt sur :

``` text
┌─────────────────────────────────────────┐
│              FRONTEND                   │
│                                         │
│        React + Vite + TypeScript        │
│                                         │
│  UI / formulaires / tableaux / graphiques│
└──────────────────┬──────────────────────┘
                   │
                   │ HTTPS / API
                   ▼
┌─────────────────────────────────────────┐
│             BACKEND MÉTIER              │
│                                         │
│              TypeScript                 │
│                                         │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ │
│  │  Risk   │ │ Control  │ │  Audit  │ │
│  │ Service │ │ Service  │ │ Service │ │
│  └─────────┘ └──────────┘ └─────────┘ │
│                                         │
│  Workflows / règles / permissions       │
│  validations / transactions / audit     │
└──────────────────┬──────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
┌─────────────────┐  ┌─────────────────┐
│   PostgreSQL    │  │   Google Drive  │
│                 │  │                 │
│ Données métier  │  │ Documents       │
│ Workflows       │  │ Evidences       │
│ Audit logs      │  │ Politiques      │
│ Permissions     │  │ Rapports        │
└─────────────────┘  └─────────────────┘
```

Et là, **Supabase peut toujours rester dans l'architecture**, mais je ne
le laisserais pas nécessairement devenir toute l'architecture backend.

------------------------------------------------------------------------

# 5. C'est là que je ferais une distinction importante

Il y a trois niveaux :

### Frontend

Responsable de :

-   affichage ;
-   navigation ;
-   formulaires ;
-   interactions utilisateur ;
-   présentation des données ;
-   validation ergonomique simple.

### Backend

Responsable de :

-   règles métier ;
-   workflows ;
-   transitions d'état ;
-   autorisations ;
-   validations ;
-   transactions ;
-   calculs métier ;
-   génération d'événements ;
-   journalisation ;
-   accès aux données ;
-   intégration Drive.

### Base de données

Responsable de :

-   persistance ;
-   relations ;
-   contraintes ;
-   intégrité ;
-   index ;
-   certaines protections au niveau DB ;
-   historique/audit selon le mécanisme retenu.

------------------------------------------------------------------------

# 6. Exemple concret avec ton GRC

Supposons qu'un Process Owner veuille clôturer une exécution de
contrôle.

Le frontend ne devrait pas faire :

``` text
if user.role == "process_owner"
    if evidence exists
        status = "CLOSED"
```

Le frontend devrait simplement demander :

``` text
POST /control-executions/123/submit
```

Le backend décide ensuite :

``` text
1. L'utilisateur est-il autorisé ?
2. L'exécution existe-t-elle ?
3. Le statut actuel permet-il cette transition ?
4. Une preuve est-elle obligatoire ?
5. La preuve existe-t-elle ?
6. Les champs obligatoires sont-ils renseignés ?
7. La transition est-elle autorisée ?
8. Enregistrer la nouvelle situation
9. Créer l'événement d'audit
10. Retourner le résultat
```

Le frontend reçoit simplement :

``` json
{
  "status": "SUBMITTED",
  "message": "Control execution submitted successfully"
}
```

C'est **beaucoup plus sain**.

------------------------------------------------------------------------

# 7. Et ça prépare effectivement le SaaS

C'est là que ton raisonnement est très bon.

Aujourd'hui :

``` text
React
   ↓
Backend
   ↓
PostgreSQL
   ↓
Google Drive
```

Demain, si tu transformes ça en SaaS :

``` text
                   SaaS
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     Web App      API clients   Mobile
        │            │            │
        └────────────┼────────────┘
                     ▼
              Backend métier
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
     PostgreSQL             File Storage
```

Et tu peux remplacer progressivement :

``` text
Google Drive
```

par :

``` text
S3 / Cloud Storage / autre stockage
```

sans modifier tout ton modèle métier.

C'est exactement le genre de découplage que je rechercherais.

------------------------------------------------------------------------

# 8. Je rajouterais même une abstraction pour le stockage

Plutôt que de faire dans ton backend :

``` text
GoogleDrive.upload()
GoogleDrive.delete()
GoogleDrive.get()
```

partout, tu pourrais avoir :

``` text
DocumentStorage
      │
      ├── GoogleDriveStorage
      │
      └── FutureStorage
```

Ton métier dit simplement :

``` text
documentStorage.upload(...)
documentStorage.get(...)
documentStorage.delete(...)
```

Aujourd'hui :

``` text
DocumentStorage
       ↓
Google Drive
```

Demain :

``` text
DocumentStorage
       ↓
S3
```

ou :

``` text
DocumentStorage
       ↓
Google Cloud Storage
```

Le métier n'a pas besoin de savoir où le fichier est physiquement
stocké.

------------------------------------------------------------------------

# 9. Même chose pour l'authentification

Si tu penses SaaS dès maintenant, je ne ferais pas dépendre toute la
logique métier de :

``` text
Supabase Auth
```

Je définirais plutôt une abstraction :

``` text
Authentication
       │
       └── Supabase Auth aujourd'hui
```

Puis potentiellement demain :

``` text
Google Workspace
Microsoft Entra ID
SAML
OIDC
etc.
```

C'est particulièrement pertinent pour un GRC professionnel où un client
pourrait vouloir utiliser son propre SSO.

------------------------------------------------------------------------

# 10. Les transitions d'état : oui, mais dans le backend

Tu as dit que tu étais d'accord avec cette partie.

Je suis d'accord, mais avec une précision importante :

**les états ne doivent pas être uniquement des valeurs dans PostgreSQL ;
les règles de transition doivent être dans le backend.**

Par exemple :

``` text
CONTROL_EXECUTION

DRAFT
  │
  ▼
IN_PROGRESS
  │
  ▼
SUBMITTED
  │
  ▼
UNDER_REVIEW
  │
  ├───────────────┐
  ▼               ▼
EFFECTIVE      INEFFECTIVE
  │               │
  ▼               ▼
CLOSED        ACTION_REQUIRED
                  │
                  ▼
             REMEDIATED
                  │
                  ▼
             REASSESSED
```

Et le backend contrôle quelles transitions sont possibles.

------------------------------------------------------------------------

# 11. Journal d'audit : dès le départ

Là je suis totalement d'accord avec ta position.

Et je ne le limiterais pas aux connexions.

Je journaliserais notamment :

``` text
CREATE
UPDATE
DELETE
SUBMIT
VALIDATE
REJECT
APPROVE
CLOSE
REOPEN
ASSIGN
UNASSIGN
STATUS_CHANGE
ROLE_CHANGE
PERMISSION_CHANGE
```

Avec :

``` text
timestamp
user_id
tenant_id       ← important pour le futur SaaS
entity_type
entity_id
action
old_value
new_value
reason
request_id
```

Le `tenant_id` est justement un élément que j'ajouterais **dès
maintenant**, même si tu n'as qu'une seule entreprise aujourd'hui.

------------------------------------------------------------------------

# 12. Et là, je modifierais une chose majeure dans le modèle

Si tu veux réellement garder la porte ouverte au SaaS, je concevrais
PostgreSQL dès le départ comme potentiellement **multi-tenant**.

Aujourd'hui :

``` text
DJAMO
 ├── risques
 ├── contrôles
 ├── audits
 └── actions
```

Demain :

``` text
TENANT A
 ├── risques
 ├── contrôles
 └── audits

TENANT B
 ├── risques
 ├── contrôles
 └── audits

TENANT C
 ├── risques
 ├── contrôles
 └── audits
```

Donc beaucoup de tables pourraient avoir :

``` text
tenant_id
```

et les politiques d'accès s'appuieraient dessus.

**Tu n'as pas besoin de développer le SaaS maintenant.**

Mais concevoir la base pour ne pas rendre le multi-tenant impossible
plus tard est, à mon avis, très judicieux.

------------------------------------------------------------------------

## Donc je reformulerais maintenant l'architecture cible

``` text
                         GRC
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
        React + Vite              API / Backend
        TypeScript                  TypeScript
              │                       │
              │ HTTPS                 │
              └───────────┬───────────┘
                          ▼
                 ┌─────────────────┐
                 │  DOMAIN /       │
                 │ BUSINESS LOGIC  │
                 │                 │
                 │ Risks           │
                 │ Controls        │
                 │ Audit           │
                 │ KRI             │
                 │ Actions         │
                 │ Workflows       │
                 │ Permissions     │
                 └────────┬────────┘
                          │
             ┌────────────┴─────────────┐
             ▼                          ▼
      ┌───────────────┐          ┌──────────────┐
      │  PostgreSQL   │          │    Drive     │
      │               │          │              │
      │ Métier        │          │ Evidences    │
      │ Relations     │          │ Documents    │
      │ Audit         │          │ Politiques   │
      │ Workflows     │          │ Rapports     │
      │ Tenant        │          │              │
      └───────────────┘          └──────────────┘
```

### Et les principes deviennent :

**Frontend** → présentation, interaction, UX.

**Backend** → toute la logique métier et les opérations sensibles.

**PostgreSQL** → source de vérité des données métier.

**Google Drive** → source documentaire pour les fichiers et preuves.

**Audit log** → présent dès la V1.

**Workflow** → défini dès la conception.

**RBAC** → défini dès la conception.

**Multi-tenant** → architecture préparée dès le départ, même si le
produit reste mono-client au début.

**Microservices** → à éviter au départ.

Pour moi, **cette version est nettement plus robuste que l'architecture
de l'échange initiale**, tout en restant relativement simple à
développer. Le point suivant que je travaillerais serait le **découpage
exact Backend / Domain / Repository / Infrastructure**, car c'est lui
qui va déterminer si ton application reste réellement évolutive lorsque
tu passeras de ton GRC interne à un éventuel SaaS.

------------------------------------------------------------------------

## Utilisateur

pour la base aussi il faut pouvoir la connecter a plusieurs base que sa
soit fire store de firebase , supabase, postgre et meme la possibilité
de distruibué les données si c'est remande dans pluseieurs base ou
pouvoir faire des replicat je veux une logique des le depart qui prends
en charge dans les config la base necessaire et nous donnes les script a
executer si cela ne cause pas de faille de securites

------------------------------------------------------------------------

## Assistant

Oui. Et là je pense qu'il faut faire évoluer encore d'un cran
l'architecture : **ne pas concevoir l'application autour de
Supabase/PostgreSQL, mais autour d'un contrat d'accès aux données
indépendant du moteur de base de données**.

Autrement dit, Supabase/PostgreSQL devient **une configuration
d'infrastructure**, et non une dépendance du cœur du GRC.

Je rajouterais donc ce point au document.

# 8. Architecture de persistance --- abstraction, multi-base, réplication et distribution des données

L'application GRC ne devra pas être conçue comme une application
dépendante d'un moteur de base de données particulier.

Le système devra disposer dès sa conception d'une **couche d'abstraction
de persistance** permettant de sélectionner, selon la configuration, le
ou les moteurs de données utilisés.

Les moteurs envisagés pourront notamment être :

-   PostgreSQL ;
-   Supabase / PostgreSQL ;
-   Firebase / Firestore ;
-   éventuellement d'autres moteurs compatibles dans le futur.

L'objectif n'est pas nécessairement de faire fonctionner simultanément
toutes les bases dans la première version, mais de faire en sorte que
**le cœur métier ne dépende pas directement d'une technologie de
stockage particulière**.

------------------------------------------------------------------------

## 8.1. Principe fondamental

Le domaine métier ne doit jamais contenir de code directement dépendant
de :

``` text
Supabase
Firestore
PostgreSQL
Firebase
```

Il doit communiquer avec une interface de persistance abstraite.

``` text
                 DOMAIN / APPLICATION
                         │
                         ▼
                Repository Interface
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        PostgreSQL   Firestore   Supabase
        Repository   Repository  Repository
```

Par exemple, le domaine pourra demander :

``` text
riskRepository.getById(id)
riskRepository.create(risk)
riskRepository.update(risk)
riskRepository.delete(id)
```

sans savoir si les données sont finalement stockées dans PostgreSQL,
Supabase ou Firestore.

------------------------------------------------------------------------

## 8.2. Séparation entre le modèle métier et le modèle de stockage

Le modèle métier devra rester indépendant du modèle physique des bases
de données.

Exemple :

``` text
Risk
 ├── id
 ├── process
 ├── description
 ├── inherentRisk
 ├── residualRisk
 └── status
```

Le repository sera chargé de traduire ce modèle vers le moteur utilisé.

### PostgreSQL

``` text
Risk
   ↓
PostgreSQLRiskRepository
   ↓
SQL
```

### Firestore

``` text
Risk
   ↓
FirestoreRiskRepository
   ↓
Firestore Document
```

### Supabase

``` text
Risk
   ↓
SupabaseRiskRepository
   ↓
Supabase API / PostgreSQL
```

Le reste de l'application ne doit pas avoir à connaître cette
différence.

------------------------------------------------------------------------

## 8.3. Configuration du moteur de données

Le moteur de persistance devra être configurable.

Exemple conceptuel :

``` yaml
database:
  provider: postgresql
  mode: primary

  postgresql:
    host: ${DB_HOST}
    port: ${DB_PORT}
    database: ${DB_NAME}
    ssl: true
```

Pour Firestore :

``` yaml
database:
  provider: firestore
  mode: primary

  firestore:
    projectId: ${FIREBASE_PROJECT_ID}
    credentials: ${FIREBASE_CREDENTIALS}
```

Pour Supabase :

``` yaml
database:
  provider: supabase
  mode: primary

  supabase:
    url: ${SUPABASE_URL}
    serviceRoleKey: ${SUPABASE_SERVICE_ROLE_KEY}
```

Les secrets ne devront **jamais** être stockés directement dans le code
ou dans un fichier de configuration versionné.

Ils devront être fournis par :

-   variables d'environnement ;
-   secret manager ;
-   coffre de secrets ;
-   mécanisme équivalent sécurisé.

------------------------------------------------------------------------

## 8.4. Ne pas exposer les credentials de base au frontend

Cette règle est fondamentale.

Le frontend ne devra jamais recevoir :

``` text
DB_PASSWORD
SERVICE_ROLE_KEY
DATABASE_URL
PRIVATE_FIREBASE_CREDENTIALS
```

Le frontend communique uniquement avec le backend.

``` text
Frontend
   │
   │ HTTPS
   ▼
Backend
   │
   ├── Credentials DB
   ├── Credentials Drive
   ├── Credentials Auth
   └── Credentials services externes
```

Les secrets restent exclusivement côté serveur.

------------------------------------------------------------------------

## 8.5. Support de plusieurs bases

L'architecture devra permettre de déclarer plusieurs connexions.

Exemple :

``` yaml
databases:

  primary:
    provider: postgresql
    purpose: operational

  analytics:
    provider: postgresql
    purpose: analytics

  documents_metadata:
    provider: postgresql
    purpose: metadata

  legacy:
    provider: firestore
    purpose: migration
```

Le système pourra ainsi disposer de plusieurs bases sans que le domaine
métier connaisse directement leur emplacement.

------------------------------------------------------------------------

## 8.6. Distribution des données

Il faudra distinguer trois mécanismes qui ne doivent pas être confondus
:

### 1. Réplication

La même donnée est copiée vers plusieurs systèmes.

``` text
                 PostgreSQL Primary
                       │
              ┌────────┴────────┐
              ▼                 ▼
         PostgreSQL Replica   Backup
```

### 2. Distribution fonctionnelle

Différents types de données sont stockés dans différents systèmes.

``` text
PostgreSQL
   ├── Risques
   ├── Contrôles
   ├── Audits
   └── Utilisateurs

Firestore
   └── Données temps réel / cas spécifiques

Drive
   └── Documents
```

### 3. Projection / synchronisation

Une source principale alimente une autre base destinée à un usage
particulier.

``` text
             PostgreSQL
                 │
          Event / Sync
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
   Firestore           Analytics DB
```

Ces mécanismes devront être traités comme des fonctionnalités
différentes.

------------------------------------------------------------------------

## 8.7. Source de vérité

Même lorsqu'il existe plusieurs bases, le système devra toujours
identifier une **source de vérité** pour chaque type de donnée.

Exemple :

``` yaml
data_domains:

  risks:
    primary: operational_db

  controls:
    primary: operational_db

  audits:
    primary: operational_db

  analytics:
    primary: analytics_db

  documents:
    primary: google_drive
```

Une donnée ne devra pas être modifiable arbitrairement dans plusieurs
bases.

Sinon, le système risque de créer :

``` text
Base A → valeur X
Base B → valeur Y
Base C → valeur Z
```

sans savoir quelle valeur est correcte.

------------------------------------------------------------------------

## 8.8. Réplication configurable

La réplication devra être déclarative.

Exemple :

``` yaml
replication:

  enabled: true

  rules:

    - source: operational_db
      target: analytics_db
      mode: asynchronous

    - source: operational_db
      target: backup_db
      mode: asynchronous
```

Le système pourra ainsi déterminer quelles données doivent être
répliquées et vers quelle cible.

La réplication ne devra toutefois être activée que lorsque le mécanisme
garantit :

-   intégrité ;
-   confidentialité ;
-   authentification ;
-   chiffrement ;
-   contrôle des accès ;
-   traçabilité ;
-   gestion des erreurs ;
-   reprise après incident.

------------------------------------------------------------------------

## 8.9. Distribution sélective des données

La distribution devra idéalement fonctionner au niveau du **domaine de
données**, et non uniquement au niveau de la base entière.

Exemple :

``` yaml
routing:

  risks:
    database: operational_db

  controls:
    database: operational_db

  audit_logs:
    database: audit_db

  analytics:
    database: analytics_db
```

Il pourrait également être nécessaire de distribuer certaines tables ou
projections :

``` text
Operational DB
       │
       ├── risks
       ├── controls
       ├── audits
       └── actions
              │
              ▼
        Analytics DB
              │
              └── risk_metrics
```

Cela permettra ultérieurement de séparer les charges opérationnelles et
analytiques.

------------------------------------------------------------------------

## 8.10. Attention à la réplication bidirectionnelle

La réplication bidirectionnelle ne devra pas être considérée comme le
comportement par défaut.

Une architecture comme :

``` text
PostgreSQL
    ↕
Firestore
```

introduit rapidement des problèmes de :

-   conflits ;
-   ordre des événements ;
-   concurrence ;
-   cohérence ;
-   suppression ;
-   rollback ;
-   résolution des versions.

Lorsque cela est possible, l'architecture privilégiera :

``` text
Source of Truth
      │
      ├──────► Replica A
      │
      ├──────► Replica B
      │
      └──────► Analytics
```

plutôt que plusieurs sources d'écriture concurrentes.

------------------------------------------------------------------------

## 8.11. Event-driven pour les synchronisations futures

Pour les besoins de distribution avancée, l'application pourra évoluer
vers une architecture événementielle.

Exemple :

``` text
Risk Updated
      │
      ▼
Event Bus
      │
 ┌────┼────┐
 ▼    ▼    ▼
DB   Analytics
     Search
     Notifications
```

Un événement pourrait être :

``` json
{
  "event": "risk.updated",
  "entityId": "RISK-001",
  "tenantId": "TENANT-001",
  "timestamp": "...",
  "version": 12
}
```

Cela permettrait d'alimenter plusieurs systèmes sans faire dépendre
directement le domaine métier de chacun d'eux.

Cette architecture ne devra toutefois être introduite que lorsque le
besoin réel le justifie.

------------------------------------------------------------------------

## 8.12. Génération des scripts d'installation

Le système devra prévoir un mécanisme permettant de générer ou fournir
les scripts nécessaires à l'installation de la base sélectionnée.

Par exemple, pour PostgreSQL :

``` text
/database/postgresql/
    001_extensions.sql
    002_tables.sql
    003_constraints.sql
    004_indexes.sql
    005_rls.sql
    006_functions.sql
    007_seed.sql
```

Pour Firestore :

``` text
/database/firestore/
    collections.md
    indexes.json
    security-rules
    seed/
```

L'application ou le dépôt devra donc pouvoir fournir les éléments
nécessaires à la création de l'environnement.

------------------------------------------------------------------------

## 8.13. Les scripts doivent être générés selon la configuration

La configuration choisie déterminera les scripts nécessaires.

Exemple :

``` yaml
database:
  provider: postgresql
```

entraîne :

``` text
PostgreSQL schema
PostgreSQL indexes
PostgreSQL constraints
PostgreSQL security policies
PostgreSQL seed
```

Alors que :

``` yaml
database:
  provider: firestore
```

entraîne :

``` text
Firestore collections
Firestore indexes
Firestore security rules
Firestore seed
```

Le système devra éviter de demander à l'utilisateur d'exécuter
manuellement des scripts inutiles.

------------------------------------------------------------------------

## 8.14. Vérification de sécurité avant génération/exécution

La génération de scripts devra intégrer une logique de sécurité.

Le système devra notamment détecter les configurations dangereuses
telles que :

``` text
Base exposée publiquement
      ↓
Mot de passe dans le code
      ↓
Connexion sans TLS
      ↓
Credentials administrateur utilisés par le frontend
      ↓
Service account trop permissif
      ↓
RLS désactivé lorsque nécessaire
      ↓
Firewall ouvert à Internet
```

Dans ces situations, l'installation devra produire un avertissement
explicite et, lorsque nécessaire, bloquer l'opération.

------------------------------------------------------------------------

## 8.15. Principe "secure by default"

Les configurations générées devront privilégier :

``` text
TLS / SSL
Least Privilege
Private credentials
Network restrictions
Row Level Security
Encrypted storage
Audit logging
Secret management
```

Le système ne devra pas générer par défaut :

``` text
0.0.0.0/0
```

ou des comptes administrateurs destinés à être utilisés par le frontend.

------------------------------------------------------------------------

## 8.16. Migration entre moteurs

L'abstraction devra également faciliter une migration future.

Exemple :

``` text
V1
PostgreSQL
   ↓
Repository

V2
PostgreSQL + Supabase
   ↓
Repository

V3
Firestore
   ↓
Repository
```

L'objectif n'est pas de garantir qu'une migration sera toujours
automatique.

Le système devra plutôt garantir que le **domaine métier ne soit pas
réécrit** simplement parce que le moteur de persistance change.

------------------------------------------------------------------------

## 8.17. Architecture complète mise à jour

L'architecture globale devient :

``` text
                         GRC
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
      React + Vite                Backend API
      TypeScript                  TypeScript
             │                         │
             │ HTTPS                   │
             └────────────┬────────────┘
                          ▼
                ┌─────────────────────┐
                │   DOMAIN / CORE     │
                │                     │
                │ Risks               │
                │ Controls            │
                │ Audits              │
                │ KRI                 │
                │ Incidents           │
                │ Actions             │
                │ Workflows           │
                │ Permissions         │
                └──────────┬──────────┘
                           │
                    Repository Layer
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
       PostgreSQL      Firestore       Supabase
             │             │              │
             └─────────────┼──────────────┘
                           │
                    Data Infrastructure
                           │
              ┌────────────┴─────────────┐
              ▼                          ▼
        Google Drive               Analytics DB
        Documents                  / Replicas
        Evidences
```

Le système devra pouvoir fonctionner avec une seule base dans la
configuration standard :

``` text
React
  ↓
Backend
  ↓
PostgreSQL
```

tout en permettant ultérieurement :

``` text
React
  ↓
Backend
  ↓
Repository Layer
  ├── PostgreSQL
  ├── Firestore
  ├── Supabase
  ├── Analytics DB
  └── Replicas
```

------------------------------------------------------------------------

## 8.18. Principe directeur

La règle d'architecture à retenir est :

> **Le GRC ne doit pas être conçu autour d'une base de données. Il doit
> être conçu autour de son domaine métier, avec une couche de
> persistance interchangeable.**

Ainsi :

``` text
                 BUSINESS LOGIC
                       │
                       ▼
                Repository API
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
  PostgreSQL       Firestore         Supabase
```

Le choix du moteur devient alors une **décision d'infrastructure
configurable** et non une décision qui impose une réécriture du produit.

------------------------------------------------------------------------

## 8.19. Limite importante : ne pas surarchitecturer la V1

Cette capacité doit être conçue dès le départ, mais elle ne signifie pas
que tous les mécanismes doivent être développés immédiatement.

La V1 pourra parfaitement utiliser :

``` text
React + Vite
       ↓
Backend
       ↓
PostgreSQL
       ↓
Google Drive
```

avec :

-   Repository Pattern ;
-   configuration du provider ;
-   migrations ;
-   audit trail ;
-   abstraction du stockage ;
-   abstraction de l'authentification ;
-   tenant_id ;
-   interfaces d'intégration.

Les implémentations Firestore, réplication multi-base, event bus ou
analytics distribués pourront être ajoutées lorsqu'un besoin réel
apparaîtra.

L'objectif est donc :

> **Préparer les points d'extension dès le départ sans transformer la
> première version en infrastructure distribuée inutilement complexe.**

------------------------------------------------------------------------

## Utilisateur

oui par ce que des personnes voudrons uiliser leur propre infra je le
pense si on pars en saas vu la nature des informations

------------------------------------------------------------------------

## Assistant

Oui, et je pense que c'est même **une des raisons les plus importantes
de concevoir l'architecture comme tu viens de le faire**.

Pour un GRC, surtout lorsqu'il traite des **risques, incidents,
contrôles, audits, plans d'actions, données de conformité et pièces
justificatives**, un futur client SaaS peut parfaitement dire :

> « Je veux utiliser votre application, mais mes données doivent rester
> dans mon infrastructure. »

Il faut donc distinguer **le produit GRC** de **l'infrastructure sur
laquelle les données sont hébergées**.

### Je verrais le produit comme ceci

``` text
                    GRC PLATFORM
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ▼                                 ▼
   Application                       Data Layer
   métier GRC                           │
        │                               │
        │                    ┌──────────┼──────────┐
        │                    ▼          ▼          ▼
        │               PostgreSQL  Firestore   Supabase
        │
        └────────────── API / Backend
```

Et le client pourrait choisir :

### Mode 1 --- Infrastructure du fournisseur

``` text
Client
  │
  ▼
GRC SaaS
  │
  ├── Backend
  ├── PostgreSQL
  └── Storage
```

### Mode 2 --- Base du client

``` text
Client
  │
  ▼
GRC SaaS
  │
  ▼
Backend
  │
  ▼
Base du client
```

### Mode 3 --- Déploiement dans l'infrastructure du client

Et là, c'est encore plus intéressant :

``` text
┌────────────── CLIENT ──────────────┐
│                                    │
│       GRC Backend                  │
│            │                       │
│            ▼                       │
│       PostgreSQL                   │
│            │                       │
│            ▼                       │
│      Document Storage              │
│                                    │
└────────────────────────────────────┘
```

Le client pourrait donc demander :

> « Je ne veux aucune donnée GRC sortir de mon environnement. »

Et ton produit pourrait potentiellement être déployé **dans son propre
cloud ou son infrastructure interne**.

------------------------------------------------------------------------

## Ça change une chose importante dans la conception

Je ne construirais donc pas :

> **un SaaS qui possède les données des clients.**

Je construirais plutôt :

> **une plateforme GRC capable de fonctionner avec différentes
> architectures de données et différents modes de déploiement.**

C'est beaucoup plus puissant.

Ton produit pourrait avoir plusieurs modes :

``` text
GRC Platform
│
├── SaaS Managed
│     └── Infrastructure opérée par toi
│
├── Customer Database
│     └── Base opérée par le client
│
├── Customer Cloud
│     └── Déploiement dans AWS/GCP/Azure/etc.
│
└── On-Premise
      └── Infrastructure interne du client
```

------------------------------------------------------------------------

# Et cela justifie encore plus les abstractions

On avait parlé de :

``` text
AuthenticationProvider
DocumentStorage
Repository
```

Je rajouterais maintenant explicitement :

``` text
Deployment
DatabaseProvider
StorageProvider
IdentityProvider
NotificationProvider
```

Par exemple :

``` text
DatabaseProvider
│
├── PostgreSQL
├── Supabase
├── Firestore
└── Future providers
```

``` text
StorageProvider
│
├── Google Drive
├── S3
├── Azure Blob
├── Google Cloud Storage
└── Local / On-Premise
```

``` text
IdentityProvider
│
├── Supabase Auth
├── Google Workspace
├── Microsoft Entra ID
├── OIDC
└── SAML
```

Le **moteur GRC ne dépend d'aucun de ces fournisseurs**.

------------------------------------------------------------------------

# Et il y a un autre avantage : la souveraineté des données

Pour certains clients, notamment :

-   banques ;
-   microfinances ;
-   fintechs ;
-   assurances ;
-   institutions publiques ;
-   grandes entreprises ;

la question ne sera pas seulement :

> « Votre application est-elle bonne ? »

mais :

> « Où sont mes données ? »

> « Qui peut y accéder ? »

> « Qui détient les clés ? »

> « Puis-je imposer mon propre stockage ? »

> « Puis-je utiliser mon propre fournisseur d'identité ? »

> « Puis-je conserver les documents dans mon propre environnement ? »

> « Que se passe-t-il si je quitte votre SaaS ? »

Ton architecture peut répondre à ces questions beaucoup plus facilement
si **le produit n'est pas intrinsèquement lié à ton infrastructure**.

------------------------------------------------------------------------

## Je rajouterais même une notion de « Data Residency »

Dans la configuration d'un tenant, on pourrait avoir conceptuellement :

``` yaml
tenant:
  id: tenant_001

  deployment:
    mode: customer_managed

  database:
    provider: postgresql
    location: customer_infrastructure

  storage:
    provider: google_drive
    location: customer_workspace

  identity:
    provider: microsoft_entra_id
```

Un autre client pourrait avoir :

``` yaml
tenant:
  id: tenant_002

  deployment:
    mode: managed_saas

  database:
    provider: postgresql

  storage:
    provider: s3

  identity:
    provider: oidc
```

**Le même produit**, mais deux infrastructures complètement différentes.

------------------------------------------------------------------------

## Mais attention à ne pas aller trop loin

Je ne chercherais pas à rendre **toutes les combinaisons possibles**
compatibles dès la V1.

Par exemple :

``` text
PostgreSQL
+
Firestore
+
Supabase
+
MongoDB
+
Oracle
+
MySQL
+
SQL Server
+
...
```

ce serait une énorme charge de développement.

Je définirais plutôt un **contrat d'extension**.

### V1

Support officiellement testé :

``` text
PostgreSQL
Google Drive
Supabase Auth
```

mais architecture préparée pour :

``` text
Firestore
autre PostgreSQL managé
S3
Entra ID
OIDC
```

Puis tu ajoutes progressivement les adaptateurs en fonction des demandes
commerciales.

------------------------------------------------------------------------

# Et surtout : les scripts deviennent un produit en eux-mêmes

Ton idée précédente de :

> « nous donner les scripts à exécuter »

devient très intéressante dans cette logique.

Un client pourrait sélectionner :

``` text
Database
[ PostgreSQL ▼ ]

Authentication
[ Microsoft Entra ID ▼ ]

Storage
[ S3 ▼ ]

Deployment
[ Customer Managed ▼ ]
```

et la plateforme pourrait générer un **package de déploiement** :

``` text
deployment/
│
├── database/
│   ├── schema.sql
│   ├── migrations/
│   ├── indexes.sql
│   └── security.sql
│
├── storage/
│   └── configuration.md
│
├── identity/
│   └── oidc-configuration.md
│
├── environment/
│   └── .env.example
│
├── security/
│   └── security-checklist.md
│
└── deployment.md
```

Mais **aucun secret réel ne doit être généré dans ces fichiers**.

On fournit :

``` text
DB_HOST=
DB_NAME=
DB_USER=
DB_PASSWORD=
```

mais jamais les credentials eux-mêmes.

------------------------------------------------------------------------

# Et ça colle parfaitement à ton idée de SaaS

Je pense qu'on arrive maintenant à une architecture beaucoup plus
intéressante :

``` text
                         GRC PRODUCT
                              │
                  ┌───────────┴───────────┐
                  │                       │
             GRC DOMAIN              PLATFORM CORE
                  │                       │
       ┌──────────┼──────────┐     ┌──────┼──────┐
       │          │          │     │      │      │
    Risks      Controls    Audits  Auth   Data   Storage
                                      │      │      │
                                      ▼      ▼      ▼
                                   Adapters / Providers
                                      │
                ┌─────────────────────┼──────────────────────┐
                ▼                     ▼                      ▼
             Customer             Managed SaaS          On-Premise
             Infra                    │
                │                     │
         ┌──────┼──────┐       ┌─────┼─────┐
         ▼      ▼      ▼       ▼     ▼     ▼
       PG     Drive   IdP     PG    S3    OIDC
```

Et **c'est cette architecture que je privilégierais maintenant**.

Elle te permet de commencer simplement avec :

> **React + Vite + TypeScript + Backend TypeScript + PostgreSQL + Google
> Drive + un fournisseur d'identité**

tout en ayant des frontières propres pour évoluer ensuite vers :

> **multi-tenant + customer-managed infrastructure + SSO + bases
> différentes + stockage différent + déploiement privé.**

C'est particulièrement pertinent pour un GRC parce que **la confiance,
la confidentialité et la maîtrise de l'infrastructure peuvent devenir
des critères d'achat aussi importants que les fonctionnalités
elles-mêmes**.

------------------------------------------------------------------------

## Utilisateur

d'autres aspect qu'on puet rajouter qui vont nous faire gagner du temps
dans le futur que tu vois ?

------------------------------------------------------------------------

## Assistant

Oui. Maintenant que tu raisonnes **produit + SaaS + infrastructure
client**, il y a plusieurs choses que je prévoirais dès le départ.
Certaines coûtent presque rien à mettre en place maintenant et peuvent
éviter énormément de refactoring plus tard.

Je les classerais par priorité.

### 1. Versionner le modèle métier

C'est probablement l'une des choses les plus importantes pour un GRC.

Une cotation de risque, un contrôle, un KRI ou une matrice peuvent
évoluer.

Il faut donc éviter de simplement faire :

``` text
risk.probability = 4
```

sans savoir ce qui existait avant.

Prévoir :

``` text
Risk
 └── RiskAssessment
       ├── version 1
       ├── version 2
       └── version 3
```

Même chose pour :

-   cartographies ;
-   échelles de cotation ;
-   contrôles ;
-   KRI ;
-   seuils ;
-   questionnaires ;
-   référentiels ;
-   workflows.

Cela permettra plus tard de répondre :

> « Quelle était la cartographie au 31/12/2025 ? »

sans avoir à reconstruire l'historique.

------------------------------------------------------------------------

### 2. Introduire une notion de `Effective Date`

Très utile pour ton domaine.

Une configuration peut avoir :

``` text
created_at
effective_from
effective_until
```

Exemple :

``` text
KRI PAR30
Seuil : 5 %

01/01/2026 → 30/06/2026 : 5 %
01/07/2026 → aujourd'hui : 4 %
```

Tu peux donc conserver l'historique **sans écraser les anciennes
règles**.

C'est extrêmement utile pour l'audit et la conformité.

------------------------------------------------------------------------

### 3. Un moteur de configuration plutôt que des valeurs codées en dur

Évite :

``` typescript
if (riskScore >= 15) {
   level = "HIGH";
}
```

dans cinquante endroits du code.

Prévoir plutôt des configurations :

``` text
Risk Scoring Configuration
├── scales
├── thresholds
├── impact
├── probability
├── calculation_method
└── version
```

Ainsi un client pourrait avoir :

``` text
Client A
→ matrice 5 × 5

Client B
→ matrice 4 × 4

Client C
→ matrice 5 × 5 avec pondération
```

sans modifier le code.

**C'est très important pour ton futur SaaS.**

------------------------------------------------------------------------

### 4. Un véritable moteur de permissions

Ne te limite pas à :

``` text
ADMIN
USER
```

Prévoir dès maintenant :

``` text
User
Role
Permission
Scope
```

Par exemple :

``` text
Permission
├── risk.read
├── risk.create
├── risk.update
├── risk.approve
├── control.execute
├── control.review
├── audit.create
├── audit.approve
└── action.close
```

Puis ajouter la notion de périmètre :

``` text
scope:
  tenant
  entity
  department
  process
```

Ainsi tu peux avoir :

> Jean peut modifier les risques de DJAMO FINANCES mais uniquement les
> consulter pour DJAMO Sénégal.

Ce niveau de granularité devient très compliqué à ajouter proprement
après coup.

------------------------------------------------------------------------

### 5. Prévoir les `custom fields`

Très intéressant pour le SaaS.

Un client voudra presque forcément ajouter :

> « Chez nous, les risques ont deux champs supplémentaires. »

Au lieu de modifier la base à chaque fois, prévoir éventuellement :

``` text
CustomFieldDefinition
CustomFieldValue
```

Par exemple :

``` text
Risk
├── name
├── description
├── inherent_score
└── custom_fields
       ├── regulatory_reference
       ├── business_owner
       └── local_classification
```

Mais attention : **il ne faut pas transformer toute la base en JSON
dynamique**.

Les données fondamentales restent dans PostgreSQL avec des colonnes
normales.

Les custom fields servent uniquement aux extensions.

------------------------------------------------------------------------

### 6. Un système de notifications abstrait

Ne code pas directement :

``` text
sendEmail()
```

partout.

Prévoir :

``` text
NotificationProvider
```

avec :

``` text
Email
Slack
Teams
Webhook
In-app
```

Ainsi un futur client pourra dire :

> « Nous utilisons Microsoft Teams, pas Slack. »

sans modifier le moteur GRC.

------------------------------------------------------------------------

### 7. Webhooks dès la conception

Je prévoirais une architecture :

``` text
Event
   ↓
Event Dispatcher
   ↓
Webhook
```

Exemples :

``` text
risk.created
risk.approved
control.submitted
control.failed
action.overdue
audit.closed
```

C'est extrêmement utile plus tard pour :

-   intégrations SIEM ;
-   ERP ;
-   ticketing ;
-   Jira ;
-   ServiceNow ;
-   Slack ;
-   Teams ;
-   systèmes internes du client.

------------------------------------------------------------------------

### 8. Une API publique versionnée

Même si personne ne l'utilise au début.

Prévoir :

``` text
/api/v1/
```

et plus tard :

``` text
/api/v2/
```

Ne pas exposer directement tes tables PostgreSQL comme API publique.

L'API doit être basée sur le **domaine métier** :

``` text
GET /api/v1/risks
POST /api/v1/risks
POST /api/v1/risks/{id}/approve
```

plutôt que :

``` text
POST /api/v1/table/risks
```

Cela te donnera beaucoup plus de liberté pour faire évoluer la base.

------------------------------------------------------------------------

### 9. `Idempotency keys`

C'est un petit détail qui peut sauver beaucoup de problèmes.

Pour certaines opérations :

``` text
POST /action-plans/123/close
```

si le réseau coupe puis que le frontend renvoie la requête, tu ne veux
pas effectuer deux fois l'opération.

Prévoir :

``` text
Idempotency-Key
```

pour les opérations sensibles.

Très utile lorsque tu auras :

-   mobile ;
-   API ;
-   intégrations ;
-   webhooks ;
-   traitements asynchrones.

------------------------------------------------------------------------

### 10. `Request ID` / `Correlation ID`

Chaque requête devrait pouvoir être suivie :

``` text
request_id = REQ-8F392A
```

Puis :

``` text
Request
 ↓
API
 ↓
RiskService
 ↓
Repository
 ↓
Database
 ↓
AuditLog
```

Tout porte :

``` text
REQ-8F392A
```

Quand quelque chose plante en production :

> « Montre-moi ce qui s'est passé pour cette opération »

tu peux retrouver toute la chaîne.

------------------------------------------------------------------------

### 11. Soft delete

Pour un GRC, je déconseille les suppressions physiques par défaut.

Au lieu de :

``` text
DELETE FROM risks
```

prévoir :

``` text
deleted_at
deleted_by
deletion_reason
```

ou un mécanisme d'archivage.

Parce qu'en audit, quelqu'un peut demander :

> « Pourquoi ce risque n'existe plus ? »

Il faut pouvoir répondre.

------------------------------------------------------------------------

### 12. Archivage dès le départ

Ne mélange pas :

``` text
ACTIVE
```

et :

``` text
ARCHIVED
```

Un risque historique ne devrait pas nécessairement disparaître.

Même logique pour :

-   contrôles ;
-   KRI ;
-   audits ;
-   plans d'action ;
-   référentiels ;
-   utilisateurs.

------------------------------------------------------------------------

### 13. Feature flags

Très utile pour ton futur SaaS.

``` text
features:
  advanced_kri: true
  audit_module: true
  ai_assistant: false
  multi_entity: true
```

Cela permet de déployer une fonctionnalité sans nécessairement l'activer
pour tous les clients.

Et surtout :

``` text
Client A → feature ON
Client B → feature OFF
```

sans créer deux versions différentes du logiciel.

------------------------------------------------------------------------

### 14. Séparer les environnements dès maintenant

Tu l'avais déjà dans l'échange initial, mais je le renforcerais :

``` text
DEV
 ↓
STAGING
 ↓
PRODUCTION
```

et surtout **jamais de données de production utilisées directement pour
tester**.

Pour un futur SaaS :

``` text
Tenant A / PROD
Tenant B / PROD

mais

Test Tenant
Development Tenant
```

------------------------------------------------------------------------

### 15. Migrations de base de données versionnées

C'est indispensable.

Ne pas avoir :

``` text
database_final.sql
database_final_v2.sql
database_final_v3.sql
```

Prévoir :

``` text
migrations/
├── 001_initial_schema
├── 002_add_risk_versions
├── 003_add_audit_logs
├── 004_add_tenant_id
├── 005_add_custom_fields
└── ...
```

Ainsi ton système sait exactement comment passer :

``` text
DB version 12
      ↓
DB version 13
```

C'est particulièrement important si un client SaaS possède sa propre
infrastructure.

------------------------------------------------------------------------

### 16. Un mécanisme de `health checks`

Le backend doit pouvoir dire :

``` text
GET /health
```

et éventuellement :

``` text
GET /ready
```

pour vérifier :

``` text
Database       ✓
Storage        ✓
Authentication ✓
Queue          ✓
External APIs  ✓
```

Plus tard, cela facilite énormément le monitoring et le déploiement dans
les infrastructures clientes.

------------------------------------------------------------------------

### 17. Observabilité dès le début

Je prévoirais :

``` text
Logs
Metrics
Traces
```

et pas seulement des `console.log()`.

Par exemple :

``` text
API latency
Database latency
Error rate
Authentication failures
Storage failures
Queue failures
```

Avec les `request_id` dont on parlait.

------------------------------------------------------------------------

### 18. Moteur d'import/export

**Très important pour ton contexte actuel.**

Puisque tu viens de Google Sheets / Apps Script, prévois dès le début :

``` text
Import
Export
```

avec :

``` text
CSV
Excel
JSON
```

et éventuellement plus tard :

``` text
API
Google Sheets
```

Tu pourras ainsi migrer progressivement :

``` text
Google Sheets
      ↓
Import
      ↓
GRC
```

et permettre à un client de sortir ses données :

``` text
GRC
 ↓
Export
 ↓
JSON / CSV / Excel
```

C'est également très important pour éviter le **vendor lock-in**.

------------------------------------------------------------------------

### 19. Un mécanisme de sauvegarde/restauration indépendant

Je rajouterais un principe :

> **Un client doit pouvoir récupérer ses données sans dépendre de ton
> application.**

Prévoir conceptuellement :

``` text
Export complet
├── données
├── métadonnées
├── configuration
├── utilisateurs
├── workflows
└── références documentaires
```

Cela devient un argument commercial très fort pour un futur SaaS :

> « Vos données restent récupérables même si vous quittez la plateforme.
> »

------------------------------------------------------------------------

### 20. Et enfin : un système de `Tenant Configuration`

Je pense que ça peut devenir **le centre de ton futur SaaS**.

``` text
Tenant
│
├── Identity Configuration
├── Database Configuration
├── Storage Configuration
├── Notification Configuration
├── Risk Configuration
├── Workflow Configuration
├── KRI Configuration
├── Permission Configuration
├── Feature Configuration
└── Localization Configuration
```

Le produit devient alors :

``` text
                    GRC CORE
                       │
                 Tenant Config
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     Tenant A       Tenant B       Tenant C
        │              │              │
   Config A        Config B        Config C
```

Et le code métier reste commun.

------------------------------------------------------------------------

## Si je devais retenir les 10 choses à faire absolument maintenant

Je ne chercherais pas à tout développer tout de suite. Je verrouillerais
cependant **ces 10 fondations** :

  -----------------------------------------------------------------------
  Priorité                Fondation               Pourquoi
  ----------------------- ----------------------- -----------------------
  🔴 1                    **Backend séparé du     Évite de réécrire le
                          frontend**              métier pour le SaaS

  🔴 2                    **Repository / Data     Rend PostgreSQL,
                          Provider**              Firestore, Supabase
                                                  interchangeables

  🔴 3                    **Tenant ID dès le      Prépare le multi-tenant
                          départ**                

  🔴 4                    **RBAC + scopes**       Évite une refonte des
                                                  permissions

  🔴 5                    **Audit trail**         Essentiel pour un GRC

  🔴 6                    **Workflows / State     Évite les statuts
                          Machine**               bricolés

  🔴 7                    **Configuration /       Permet de personnaliser
                          Feature flags**         par client

  🔴 8                    **Versioning +          Indispensable pour les
                          migrations**            installations clientes

  🟠 9                    **Abstraction Auth +    Facilite SSO et
                          Storage**               infrastructures
                                                  clientes

  🟠 10                   **Import / Export +     Évite le vendor lock-in
                          sauvegarde**            
  -----------------------------------------------------------------------

Et derrière ces dix fondations, je mettrais une règle générale :

> **Tout ce qui risque d'être différent d'un client à l'autre doit être
> une configuration ou une extension, et non une modification du code
> métier.**

C'est probablement **la règle architecturale la plus importante** pour
le produit que tu es en train d'imaginer.
