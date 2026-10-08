# Cahier des charges — Module de gestion des évidences Excel

**Projet :** Outils GRC — Gouvernance, Risques & Contrôles  
**Module :** Evidence & Excel Data Ingestion  
**Version :** 1.0  
**Date :** 08 octobre 2026  
**Statut :** Proposition de cadrage

---

## 1. Objet du document

Ce cahier des charges définit les besoins fonctionnels et techniques d'un module permettant aux exécutants de contrôles de déposer des fichiers Excel comme **évidences de contrôle**, tout en permettant au système de :

- conserver le fichier original de manière traçable et immuable ;
- détecter automatiquement la structure du fichier ;
- proposer un schéma d'import sans exiger que le schéma soit connu à l'avance ;
- permettre à l'utilisateur de valider ou corriger le mapping ;
- persister les données structurées issues du fichier ;
- gérer l'évolution du format des fichiers au cours d'un exercice ;
- versionner les schémas ;
- relier plusieurs fichiers appartenant à une même collection logique d'évidences ;
- conserver la traçabilité complète entre une donnée, son fichier source et son exécution de contrôle ;
- permettre à un auditeur ou contrôleur de reconstituer l'origine d'une information.

Le module doit être conçu comme une **brique d'ingestion de données orientée GRC**, et non comme un simple système de stockage de pièces jointes.

---

# 2. Problématique métier

Les exécutants des contrôles utilisent fréquemment des fichiers Excel pour documenter leurs travaux.

Un même contrôle peut recevoir plusieurs fichiers :

- un fichier par exécutant ;
- un fichier par agence ;
- un fichier par période ;
- un fichier mensuel ou trimestriel ;
- plusieurs versions successives du même fichier ;
- des fichiers dont la structure évolue pendant l'année.

Exemple :

### Janvier

```text
Date | Client | Montant | Statut
```

### Juin

```text
Date opération | Référence client | Montant FCFA | Résultat | Agent
```

Le système ne doit donc pas supposer qu'un fichier possède toujours le même schéma.

Le besoin est de permettre une ingestion flexible **sans sacrifier la normalisation, la traçabilité et l'auditabilité**.

---

# 3. Principes directeurs

Le module doit respecter les principes suivants.

## 3.1 Le fichier original est une preuve

Le fichier uploadé doit être conservé tel quel.

Le système ne doit jamais remplacer silencieusement un fichier existant.

Chaque fichier doit posséder :

- un identifiant unique ;
- un nom original ;
- une taille ;
- un type MIME ;
- une empreinte cryptographique SHA-256 ;
- un horodatage ;
- un utilisateur ayant effectué l'upload ;
- une relation avec le contrôle et son exécution ;
- une version ;
- un statut.

---

## 3.2 Les données extraites ne remplacent jamais la preuve originale

Le système peut extraire les données Excel afin de les rendre exploitables.

Cependant :

```text
Fichier original
       +
Données extraites
```

doivent être conservés séparément.

La donnée structurée doit toujours pouvoir être reliée à son fichier source.

---

## 3.3 Le schéma doit pouvoir évoluer

Un changement de structure ne doit pas rendre les anciennes données invalides.

Le système doit permettre :

```text
Schema V1
   ↓
Schema V2
   ↓
Schema V3
```

tout en conservant les données et fichiers précédemment importés.

---

## 3.4 Le système doit assister l'utilisateur

L'utilisateur ne doit pas avoir à décrire manuellement l'intégralité du schéma.

Le système doit :

1. analyser le fichier ;
2. détecter les colonnes ;
3. inférer les types ;
4. comparer avec les schémas existants ;
5. proposer un mapping ;
6. demander une validation uniquement lorsque nécessaire.

---

# 4. Objectifs

## 4.1 Objectif principal

Permettre l'intégration de fichiers Excel comme évidences structurées de contrôles sans imposer un schéma fixe au préalable.

## 4.2 Objectifs secondaires

- améliorer la qualité des preuves de contrôle ;
- éviter les pertes de données ;
- faciliter les contrôles de deuxième niveau ;
- faciliter les audits ;
- permettre l'analyse transverse des contrôles ;
- conserver l'historique des fichiers ;
- gérer les changements de format ;
- préparer l'exploitation future par des KRI et analytics ;
- fournir une traçabilité de bout en bout.

---

# 5. Périmètre fonctionnel

Le module couvre :

1. Upload de fichiers Excel ;
2. Validation des fichiers ;
3. Analyse automatique de structure ;
4. Détection des feuilles ;
5. Détection des en-têtes ;
6. Inférence des types ;
7. Détection des schémas existants ;
8. Proposition de mapping ;
9. Validation/correction du mapping ;
10. Création et versionnement des schémas ;
11. Import des données ;
12. Validation des données ;
13. Gestion des erreurs ;
14. Création d'un Evidence Dataset ;
15. Versionnement des fichiers ;
16. Data lineage ;
17. Consultation des données ;
18. Traçabilité et audit ;
19. Gestion des permissions.

---

# 6. Hors périmètre initial

Les éléments suivants sont volontairement exclus du MVP :

- modification automatique du fichier Excel original ;
- édition complète d'Excel dans l'application ;
- reconnaissance parfaite de tous les tableaux complexes ;
- OCR de documents PDF/scannés ;
- intelligence artificielle obligatoire pour tous les mappings ;
- synchronisation bidirectionnelle avec Excel ;
- remplacement automatique des anciennes versions ;
- calculs métiers complexes propres à chaque contrôle.

Ces fonctionnalités pourront être ajoutées ultérieurement.

---

# 7. Concepts métier

## 7.1 Evidence

Une preuve associée à l'exécution d'un contrôle.

Exemple :

```text
Evidence
  └── Controle mensuel caisse — Janvier 2026.xlsx
```

---

## 7.2 Evidence File

Le fichier physique original déposé par l'utilisateur.

Il est immuable.

---

## 7.3 Evidence Dataset

Une collection logique de fichiers appartenant à un même périmètre métier.

Exemple :

```text
CTRL-001
Exercice 2026
Agence Abidjan Plateau

Evidence Dataset
 ├── Janvier.xlsx
 ├── Février.xlsx
 ├── Mars.xlsx
 └── Juin.xlsx
```

---

## 7.4 Evidence Schema

Description logique des données contenues dans un fichier.

Exemple :

```text
Date
Client
Montant
Statut
Commentaire
```

---

## 7.5 Evidence Schema Version

Une version particulière d'un schéma.

Exemple :

```text
Schema V1
Date
Client
Montant
Statut

Schema V2
Date opération
Référence client
Montant FCFA
Résultat
Agent
```

---

## 7.6 Evidence Record

Une ligne structurée issue du fichier source.

Chaque record doit pouvoir être relié :

```text
Record
  ↓
Import
  ↓
Evidence File
  ↓
Evidence Dataset
  ↓
Control Execution
```

---

# 8. Parcours utilisateur cible

## Étape 1 — Sélection de l'exécution

L'utilisateur ouvre une exécution de contrôle.

Exemple :

```text
Contrôle : Vérification des opérations de caisse
Période : Janvier 2026
Exécutant : Jean Dupont
```

Il choisit :

**Ajouter une évidence**

---

## Étape 2 — Upload

L'utilisateur dépose :

```text
controle_caisse_janvier.xlsx
```

Le système vérifie :

- extension ;
- type MIME ;
- taille ;
- intégrité ;
- éventuels fichiers corrompus.

---

## Étape 3 — Analyse automatique

Le système affiche :

```text
Analyse terminée

1 fichier
2 feuilles
2 438 lignes potentielles
8 colonnes détectées
```

Il identifie notamment :

- les feuilles ;
- la ligne d'en-tête ;
- les colonnes ;
- les types ;
- les valeurs exemples ;
- les colonnes vides ;
- les colonnes potentiellement obligatoires.

---

# 9. Inférence du schéma

Le système doit proposer une structure.

Exemple :

| Colonne Excel | Champ proposé | Type | Confiance |
|---|---|---|---:|
| Date opération | operation_date | date | 99 % |
| Client | customer_reference | string | 95 % |
| Montant | amount | decimal | 98 % |
| Statut | control_result | enum | 87 % |
| Commentaire | comment | text | 99 % |

La confiance est indicative et ne constitue pas une preuve métier.

---

# 10. Mapping assisté

Le système doit distinguer trois niveaux.

## Niveau 1 — Automatique

Mapping à haute confiance.

```text
Montant FCFA → amount
```

Aucune intervention nécessaire si les règles de confiance sont satisfaites.

## Niveau 2 — Validation utilisateur

Mapping probable.

```text
Résultat → control_result
```

Le système demande :

> Confirmez-vous ce mapping ?

## Niveau 3 — Mapping manuel

Le système ne comprend pas suffisamment la colonne.

L'utilisateur doit choisir le champ ou déclarer la colonne comme :

- informative ;
- ignorée ;
- métier spécifique ;
- non mappée.

---

# 11. Clé de rattachement

Le système doit demander comment les fichiers doivent être reliés lorsqu'une relation métier est nécessaire.

Exemples de clés :

```text
Référence opération
```

ou :

```text
Référence opération + Date
```

ou :

```text
Contrôle + Exercice + Entité
```

Le système peut proposer une clé détectée automatiquement.

L'utilisateur doit la confirmer.

---

# 12. Gestion de l'évolution du schéma

Lorsqu'un nouveau fichier est chargé, le système compare sa structure aux schémas connus.

## Cas A — Correspondance forte

```text
Nouveau fichier
      ↓
Schema V1
      ↓
Import
```

## Cas B — Correspondance partielle

Le système propose :

```text
87 % des colonnes correspondent.

3 colonnes nouvelles détectées.
1 colonne supprimée.

[Conserver Schema V1]
[Créer Schema V2]
```

## Cas C — Nouveau format

Le système propose :

```text
Aucun schéma existant ne correspond suffisamment.

Créer Schema V2 ?
```

L'utilisateur peut alors créer une nouvelle version.

---

# 13. Règle essentielle de versionnement

Une modification de schéma ne doit jamais modifier rétroactivement les imports historiques.

Exemple :

```text
Schema V1
 ├── Janvier
 ├── Février
 └── Mars

Schema V2
 ├── Avril
 ├── Mai
 └── Juin
```

Les anciens imports restent associés à V1.

---

# 14. Détection des doublons

Le système doit calculer le SHA-256 du fichier.

Si un fichier identique est déjà présent :

```text
Fichier déjà connu

SHA-256 :
ABC123...

Déposé le :
12/03/2026

Par :
Jean Dupont
```

Le système doit proposer :

- consulter l'évidence existante ;
- créer une nouvelle référence ;
- annuler l'upload.

Le système ne doit pas créer silencieusement une copie inutile.

---

# 15. Validation des données

Avant import définitif, le système doit effectuer des contrôles :

- type incorrect ;
- date invalide ;
- nombre invalide ;
- champ obligatoire absent ;
- doublon de clé ;
- valeur hors domaine ;
- ligne vide ;
- colonne inconnue ;
- format incohérent.

Exemple :

```text
2 438 lignes analysées

✓ 2 431 lignes valides
⚠ 7 lignes en erreur

[Voir les erreurs]
```

---

# 16. Gestion des erreurs

Chaque erreur doit être traçable.

Exemple :

```text
Ligne : 148
Colonne : Montant
Valeur : "N/A"

Erreur :
Valeur numérique attendue
```

L'utilisateur doit pouvoir :

- corriger le fichier et réimporter ;
- ignorer les lignes invalides si la politique du contrôle l'autorise ;
- annuler l'import.

Une ligne ignorée doit rester visible dans le journal d'import.

---

# 17. Workflow complet

```text
UPLOAD
   │
   ▼
VALIDATION FICHIER
   │
   ▼
ANALYSE STRUCTURE
   │
   ▼
SCHEMA INFERENCE
   │
   ▼
COMPARAISON SCHEMAS
   │
   ├── Match fort
   │      ↓
   │    Mapping existant
   │
   ├── Match partiel
   │      ↓
   │    Mapping assisté
   │
   └── Nouveau format
          ↓
      Schema Version
          │
          ▼
    VALIDATION UTILISATEUR
          │
          ▼
      DATA VALIDATION
          │
          ▼
        IMPORT
          │
          ├─────────────┐
          ▼             ▼
   ORIGINAL FILE     RECORDS
          │             │
          └──────┬──────┘
                 ▼
             DATA LINEAGE
```

---

# 18. Modèle de données conceptuel

Le modèle cible doit au minimum prévoir les objets suivants :

```text
Control
   │
   ▼
ControlExecution
   │
   ▼
EvidenceDataset
   │
   ├───────────────┐
   ▼               ▼
EvidenceFile    EvidenceSchema
   │               │
   │               ▼
   │        EvidenceSchemaVersion
   │               │
   └───────┬───────┘
           ▼
     EvidenceImport
           │
           ▼
     EvidenceRecord
```

---

# 19. Entités principales

## 19.1 evidence_dataset

Champs indicatifs :

```text
id
tenant_id
control_id
control_execution_id
name
description
business_period
business_entity
status
created_by
created_at
updated_at
```

---

## 19.2 evidence_file

```text
id
dataset_id
original_filename
storage_key
mime_type
file_size
sha256
uploaded_by
uploaded_at
version_number
status
```

---

## 19.3 evidence_schema

```text
id
dataset_id
name
description
current_version_id
created_by
created_at
```

---

## 19.4 evidence_schema_version

```text
id
schema_id
version_number
status
detected_sheet
header_row
created_by
created_at
```

---

## 19.5 evidence_schema_field

```text
id
schema_version_id
source_column
canonical_field
data_type
required
nullable
mapping_confidence
position
```

---

## 19.6 evidence_import

```text
id
file_id
schema_version_id
status
started_at
completed_at
total_rows
valid_rows
invalid_rows
imported_rows
error_count
initiated_by
```

---

## 19.7 evidence_record

```text
id
import_id
source_row_number
record_key
payload
created_at
```

Pour le MVP, `payload` peut être un `JSONB`, avec évolution ultérieure vers des structures plus fortement typées si nécessaire.

---

# 20. Data lineage

Le système doit pouvoir répondre à :

> D'où provient cette donnée ?

Exemple :

```text
KRI / résultat
      ↓
Evidence Record #18273
      ↓
Import #458
      ↓
Evidence File #82
      ↓
controle_caisse_juin.xlsx
      ↓
SHA-256
      ↓
Evidence Dataset 2026
      ↓
Control Execution #124
      ↓
Control CTRL-001
```

Cette traçabilité est une exigence majeure du module.

---

# 21. Stockage

L'architecture recommandée est de séparer :

### Base PostgreSQL / Neon

Pour :

- métadonnées ;
- schémas ;
- mappings ;
- imports ;
- erreurs ;
- records ;
- relations GRC ;
- audit trail.

### Object Storage

Pour :

- fichiers Excel originaux ;
- éventuellement exports générés.

Le chemin physique du fichier ne doit pas être utilisé comme identifiant métier.

---

# 22. Sécurité

Le module doit appliquer :

- authentification ;
- autorisation par tenant ;
- RBAC ;
- contrôle d'accès au contrôle/exécution ;
- chiffrement au repos du stockage ;
- chiffrement en transit ;
- journalisation des uploads ;
- journalisation des téléchargements ;
- hash d'intégrité ;
- limitation de taille ;
- validation du type de fichier ;
- protection contre les fichiers malveillants ;
- antivirus/antimalware si disponible dans l'infrastructure ;
- isolation des fichiers utilisateurs.

Les formules Excel doivent être traitées avec prudence lors de l'analyse et de la restitution.

---

# 23. Audit trail

Les événements suivants doivent être journalisés :

```text
EVIDENCE_UPLOADED
EVIDENCE_VIEWED
EVIDENCE_DOWNLOADED
EVIDENCE_DELETED
SCHEMA_CREATED
SCHEMA_VERSION_CREATED
SCHEMA_MAPPING_UPDATED
IMPORT_STARTED
IMPORT_COMPLETED
IMPORT_FAILED
IMPORT_CANCELLED
```

Les suppressions doivent idéalement être logiques/soft delete lorsque la politique de conservation l'exige.

---

# 24. Permissions

Prévoir au minimum :

```text
evidence.read
evidence.create
evidence.update
evidence.delete
evidence.download
evidence.import
evidence.schema.read
evidence.schema.create
evidence.schema.update
evidence.import.read
```

Les permissions doivent être intégrées au modèle RBAC existant du produit.

---

# 25. UX — Evidence Import Wizard

Le parcours recommandé :

```text
1. Fichier
2. Analyse
3. Mapping
4. Clé de rattachement
5. Validation
6. Import
7. Résultat
```

## Écran 1 — Fichier

```text
Déposer un fichier Excel
ou
[Choisir un fichier]
```

---

## Écran 2 — Analyse

Afficher :

- nombre de feuilles ;
- nombre de lignes ;
- nombre de colonnes ;
- feuilles détectées ;
- éventuelles anomalies.

---

## Écran 3 — Mapping

Afficher :

| Excel | Champ système | Type | Confiance |
|---|---|---|---:|
| Date | operation_date | date | 99 % |
| Client | customer_reference | string | 95 % |
| Montant | amount | decimal | 98 % |

---

## Écran 4 — Clé

Question :

> Comment identifier une même donnée entre les différents fichiers de ce dataset ?

Propositions automatiques + choix manuel.

---

## Écran 5 — Validation

Afficher :

```text
2 438 lignes
2 431 valides
7 invalides
```

---

## Écran 6 — Import

Afficher la progression.

---

## Écran 7 — Résultat

```text
Import terminé

Fichier :
controle_caisse_juin.xlsx

Schéma :
Evidence Schema V2

Lignes importées :
2 431

Erreurs :
7

Evidence :
EV-2026-00482
```

---

# 26. MVP

Le MVP doit se concentrer sur :

### Fonctionnel

- upload `.xlsx` ;
- sélection d'une feuille ;
- détection des en-têtes ;
- lecture des lignes ;
- inférence basique des types ;
- création d'un schéma ;
- mapping utilisateur ;
- validation des données ;
- persistance ;
- versionnement des schémas ;
- conservation du fichier original ;
- hash SHA-256 ;
- traçabilité vers l'exécution du contrôle ;
- historique des imports.

### Technique

- Node.js / TypeScript ;
- PostgreSQL / Neon ;
- stockage objet ;
- JSONB pour les records ;
- API REST ;
- RBAC existant ;
- audit trail existant.

---

# 27. Phase 2

Prévoir ensuite :

- reconnaissance automatique améliorée ;
- suggestion de mapping basée sur l'historique ;
- détection avancée des changements de schéma ;
- rapprochement automatique entre fichiers ;
- détection de doublons métier ;
- imports CSV ;
- imports XLS ;
- règles de transformation ;
- validation métier configurable ;
- preview avancée ;
- exports ;
- API d'ingestion ;
- notifications.

---

# 28. Phase 3 — Intelligence

À terme, le module pourrait proposer :

- apprentissage des mappings précédemment validés ;
- détection automatique des anomalies ;
- suggestion de clés métier ;
- détection de ruptures de séries ;
- détection de changements suspects dans les fichiers ;
- rapprochement avec les contrôles précédents ;
- génération de synthèses ;
- aide à la revue du contrôle.

L'IA ne doit cependant jamais remplacer la preuve originale ni l'audit trail.

---

# 29. Règles de gouvernance des données

Le système doit distinguer :

```text
RAW
   ↓
PARSED
   ↓
NORMALIZED
   ↓
VALIDATED
   ↓
ANALYTICS
```

Le fichier RAW doit rester inchangé.

Une transformation ne doit pas détruire l'information source.

---

# 30. Critères d'acceptation

## AC-01 — Upload

Un utilisateur autorisé peut charger un fichier Excel valide.

## AC-02 — Conservation

Le fichier original peut être téléchargé à l'identique.

## AC-03 — Intégrité

Le système calcule et conserve le SHA-256.

## AC-04 — Détection

Le système détecte les feuilles, colonnes et types de base.

## AC-05 — Mapping

L'utilisateur peut corriger les mappings proposés.

## AC-06 — Schéma

Un schéma peut être créé à partir d'un fichier.

## AC-07 — Versionnement

Un nouveau format peut créer une nouvelle version sans modifier les anciennes.

## AC-08 — Import

Les lignes valides sont persistées.

## AC-09 — Erreurs

Les lignes invalides sont identifiées avec leur numéro de ligne et la cause.

## AC-10 — Traçabilité

Chaque record peut être relié à son fichier source.

## AC-11 — Dataset

Plusieurs fichiers peuvent appartenir au même Evidence Dataset.

## AC-12 — Audit

Les opérations importantes sont journalisées.

## AC-13 — Permissions

Un utilisateur ne peut accéder qu'aux évidences autorisées.

## AC-14 — Doublon

Le système détecte un fichier identique grâce au hash.

## AC-15 — Historique

Les anciennes versions restent consultables selon la politique de conservation.

---

# 31. Risques et limites

## R1 — Excel semi-structuré

Tous les fichiers Excel ne sont pas directement interprétables.

**Mitigation :** permettre la sélection manuelle de la feuille et de la ligne d'en-tête.

## R2 — Mauvais mapping

Un mapping automatique peut être incorrect.

**Mitigation :** niveaux de confiance + validation utilisateur.

## R3 — Ambiguïté métier

Deux colonnes peuvent avoir des noms similaires mais des significations différentes.

**Mitigation :** description du champ + exemples + validation humaine.

## R4 — Explosion des schémas

Un nouveau schéma pourrait être créé pour chaque variation mineure.

**Mitigation :** seuil de similarité et distinction entre variation de mapping et véritable changement de schéma.

## R5 — Gros fichiers

Les fichiers Excel peuvent être très volumineux.

**Mitigation :** limites de taille, traitement asynchrone, import par lots.

## R6 — Données sensibles

Les fichiers peuvent contenir des données personnelles ou financières.

**Mitigation :** RBAC, chiffrement, contrôle d'accès, politique de conservation et journalisation.

## R7 — Formules Excel

Certaines cellules peuvent contenir des formules ou des liens externes.

**Mitigation :** ne pas exécuter les macros/formules côté serveur ; traiter le fichier comme donnée non fiable.

## R8 — Fausses correspondances

Deux fichiers peuvent avoir une structure similaire sans représenter le même périmètre.

**Mitigation :** rattachement explicite au contrôle, à l'exécution, à la période et à l'entité métier.

---

# 32. Décision d'architecture recommandée

La recommandation est de ne pas construire :

```text
Excel → table SQL fixe
```

mais :

```text
Excel
  ↓
Immutable Evidence
  ↓
Evidence Dataset
  ↓
Schema Version
  ↓
Mapping
  ↓
Import
  ↓
Structured Records
  ↓
Data Lineage
  ↓
Control / Risk / KRI
```

Cette architecture permet de conserver la flexibilité des fichiers des exécutants tout en apportant une structure exploitable par le système GRC.

---

# 33. Décisions à prendre avant développement

Les décisions suivantes devront être arbitrées avant implémentation :

1. Quels formats Excel sont supportés au MVP ?
2. Quelle taille maximale de fichier ?
3. Quels champs canoniques sont disponibles ?
4. Le système autorise-t-il les champs totalement libres ?
5. Quelle politique de conservation des fichiers ?
6. Quel object storage utiliser ?
7. Quel seuil de confiance déclenche un mapping automatique ?
8. Qui peut créer une nouvelle version de schéma ?
9. Qui peut supprimer une évidence ?
10. Quelle politique de gestion des données personnelles ?
11. Quels contrôles métier doivent être exécutés à l'import ?
12. Quelle clé métier doit être obligatoire pour les datasets nécessitant un rapprochement ?
13. Les records doivent-ils être historisés après transformation ?
14. Quels fichiers doivent être considérés comme confidentiels ?
15. Quels événements doivent être visibles par l'auditeur ?

---

# 34. Conclusion

Le besoin ne doit pas être traité comme une simple fonctionnalité « Upload Excel ».

Il constitue une véritable brique de **gestion des évidences et d'ingestion de données GRC**.

Le principe architectural recommandé est :

> **Conserver toujours le fichier original comme preuve, extraire les données dans une structure indépendante, versionner le schéma lorsque le format évolue et maintenir une traçabilité complète entre la donnée, le fichier, l'exécutant et l'exécution du contrôle.**

Le système doit être **schema-flexible mais audit-ready**.

La priorité du MVP est donc :

```text
IMMUTABLE FILE
      +
SCHEMA INFERENCE
      +
USER VALIDATION
      +
SCHEMA VERSIONING
      +
STRUCTURED DATA
      +
DATA LINEAGE
```

Ce socle pourra ensuite alimenter les analyses de contrôles, KRI, reporting, cartographie et fonctions intelligentes du produit GRC.
