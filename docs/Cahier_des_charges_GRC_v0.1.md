# Cahier des charges fonctionnel et logique — Plateforme GRC / ERM

**Version :** 0.1  
**Statut :** Document de cadrage initial  
**Source :** Structuration de l’échange fourni  
**Périmètre :** Gestion des risques, contrôle interne, incidents/anomalies, plans d’action, audit, indicateurs et gouvernance

---

## 1. Contexte et origine du besoin

Le besoin part d’un retour formulé à la suite d’une présentation du dispositif de gestion des risques.

Le retour met notamment en évidence la nécessité de disposer d’un **dictionnaire des risques** permettant de définir les risques, leurs causes, leurs impacts et les références du dispositif existant, ainsi que d’un dispositif formalisé de **plans d’action / mitigation**.

Il souligne également plusieurs besoins concernant le manuel de contrôle interne :

- formaliser une version 2 ;
- mieux distinguer les activités de première et de deuxième ligne de défense ;
- documenter les contrôles avec des informations systématiques ;
- préciser notamment les tailles d’échantillonnage, postes en charge, fréquences et pièces justificatives ;
- rattacher la première ligne à la plateforme des procédures opérationnelles ;
- clarifier les critères de rattachement à la deuxième ligne.

L’échange a ensuite étendu le besoin vers une plateforme GRC intégrée permettant également :

- les commentaires configurables sur les objets ;
- la déclaration d’anomalies et d’incidents ;
- la collecte et le rattachement des évidences ;
- l’exécution des contrôles au moyen de checklists ;
- le suivi des plans d’action, de leurs délais et de leur persistance ;
- le calcul de métriques temporelles comme la vélocité à partir de l’incident ;
- le rattachement des risques aux responsables, exécutants, processus, KRI et KPI ;
- la gestion des responsabilités selon une approche RACI simplifiée ;
- un accès transverse de l’audit aux risques et au dispositif ;
- une séparation entre IAM technique et responsabilités métier.

Le document ci-dessous transforme cet échange en **cahier des charges fonctionnel et logique**, sans modifier la nature des besoins exprimés.

---

# 2. Vision du produit

## 2.1 Finalité

La plateforme doit constituer un **socle GRC/ERM intégré** permettant de centraliser et de relier :

> **Référentiel des risques → Évaluation → Contrôles → Exécutions → Évidences → Incidents/Anomalies → Constats → Plans d’action → Suivi → Réévaluation**

L’objectif n’est donc pas de construire uniquement un outil de scoring des risques.

Le cœur du produit doit être un **référentiel GRC interconnecté**, sur lequel viennent se greffer les moteurs d’évaluation, de contrôle, d’incident, d’audit et de suivi.

## 2.2 Principes structurants

La plateforme doit respecter les principes suivants :

1. **Référentiel avant évaluation**  
   Un risque doit pouvoir être défini et documenté indépendamment d’une campagne d’évaluation.

2. **Interconnexion native des objets**  
   Les risques, contrôles, processus, indicateurs, incidents, constats, actions et documents doivent pouvoir être reliés.

3. **Fonctionnalités transverses**  
   Commentaires, évidences, RACI et historique/audit trail ne doivent pas être conçus comme des fonctionnalités propres à un seul module.

4. **Configuration plutôt que développement spécifique**  
   Les éléments variables d’une organisation ou d’une méthodologie doivent être configurables.

5. **Séparation IAM / responsabilités métier**  
   Les droits d’accès sont gérés par l’IAM ; les responsabilités sur les objets GRC sont gérées par le RACI.

6. **Traçabilité**  
   Les actions, changements, exécutions, validations et pièces justificatives doivent être historisés.

---

# 3. Objectifs fonctionnels

La plateforme doit permettre de :

- constituer un dictionnaire exhaustif des risques ;
- définir les causes et impacts associés aux risques ;
- rattacher les risques aux organisations, départements et processus ;
- rattacher un risque à un responsable et/ou à un exécutant ;
- définir les responsabilités métier au moyen d’un RACI simple ;
- évaluer les risques selon une méthodologie configurable ;
- distinguer risque inhérent, contrôles et risque résiduel ;
- rattacher des KRI et KPI aux risques et aux processus ;
- définir, exécuter et documenter des contrôles ;
- utiliser une checklist comme rappel opérationnel pour chaque contrôle ;
- collecter les preuves et pièces justificatives ;
- déclarer et suivre des anomalies ;
- déclarer et suivre des incidents ;
- relier les incidents aux risques ;
- mesurer notamment la vélocité et la persistance à partir des événements temporels ;
- produire et suivre des plans d’action ;
- rattacher les actions à différentes sources : risque, contrôle, incident, anomalie, audit, recommandation, etc. ;
- permettre à l’audit de consulter transversalement le dispositif ;
- ajouter des commentaires uniquement sur les objets configurés comme commentables ;
- conserver un historique exploitable lors des audits ;
- supporter des workflows centralisés ou participatifs ;
- faire évoluer les méthodologies sans modifier le modèle métier principal.

---

# 4. Périmètre fonctionnel

La plateforme est structurée autour de **8 domaines fonctionnels**.

| Domaine | Objet principal |
|---|---|
| 1. Organisation | Entités, départements, processus, utilisateurs |
| 2. Référentiel | Risques, causes, impacts, documents |
| 3. Risk Management | Évaluations, matrices, scoring, KRI/KPI, risque résiduel |
| 4. Contrôle interne | Contrôles, checklists, exécutions, anomalies, évidences |
| 5. Incidents | Incidents, impacts, persistance, vélocité |
| 6. Plans d’action | Actions, responsables, échéances, suivi |
| 7. Audit | Missions, constats, recommandations, suivi |
| 8. Collaboration & Gouvernance | Commentaires, RACI, workflows, historique |

### Capacités transverses

Quatre capacités doivent être traitées comme transverses :

- **Commentaires**
- **Évidences / pièces justificatives**
- **RACI**
- **Historique / Audit trail**

---

# 5. Modèle conceptuel global

```text
                               ORGANISATION
                                     │
                 ┌───────────────────┼───────────────────┐
                 │                   │                   │
            DÉPARTEMENTS           USERS               ROLES
                 │                   │                   │
                 ▼                   │              PERMISSIONS
             PROCESSUS               │
                 │                   │
                 └────────────┐      │
                              ▼      ▼
                            RISQUES ◄── RACI
                              │
       ┌──────────────┬───────┼───────────┬──────────────┐
       │              │       │           │              │
       ▼              ▼       ▼           ▼              ▼
 ÉVALUATIONS       CONTRÔLES KRI/KPI   INCIDENTS     DOCUMENTS
                      │                   │
                      ▼                   ▼
                  CHECKLIST         RISK_INCIDENT
                      │                   │
                      ▼                   ▼
                 EXÉCUTIONS       VÉLOCITÉ / PERSISTANCE
                      │
                      ▼
                  ÉVIDENCES

 RISQUES / CONTRÔLES / INCIDENTS / AUDIT
                         │
                         ▼
                      CONSTATS
                         │
                         ▼
                    PLANS D’ACTION
                         │
                         ▼
                       SUIVI

 TOUS LES OBJETS
       │
       ├── COMMENTS
       ├── EVIDENCES
       ├── RACI
       └── AUDIT TRAIL
```

---

# 6. Module 1 — Organisation

## 6.1 Organisation / entité

La plateforme doit supporter plusieurs organisations/entités dans un même socle.

### Attributs principaux

- Identifiant
- Code
- Nom
- Statut
- Métadonnées de création et de modification

## 6.2 Département

Un département doit pouvoir posséder :

- un **pilote de risque** ;
- un **propriétaire du processus** ;
- plusieurs processus.

Le pilote de risque et le propriétaire du processus peuvent être :

- la même personne ;
- deux personnes différentes.

### Exemple

```text
Département Crédit
├── Pilote risque : Jean
└── Propriétaire processus : Jean

Département Finance
├── Pilote risque : Jean
└── Propriétaire processus : Marie
```

## 6.3 Processus

Un processus est rattaché à un département.

Il doit pouvoir disposer de :

- code ;
- nom ;
- description ;
- propriétaire du processus ;
- statut.

---

# 7. Module 2 — Référentiel des risques

## 7.1 Distinction fondamentale

Le système doit séparer :

### A. Le dictionnaire / catalogue du risque

Il décrit **ce qu’est le risque**.

### B. Le risque du registre

Il représente **le risque effectivement identifié dans un périmètre organisationnel**.

### C. L’évaluation

Elle représente **l’évaluation du risque à un instant donné selon une méthodologie donnée**.

```text
RISK_CATALOG
     │
     ▼
RISK
     │
     ▼
RISK_ASSESSMENT
```

Cette séparation évite de mélanger référentiel, instance de risque et historique d’évaluation.

---

## 7.2 Fiche du dictionnaire des risques

Chaque risque du catalogue doit au minimum pouvoir contenir :

| Champ | Description |
|---|---|
| Référence | Identifiant unique du risque |
| Nom | Nom normalisé |
| Définition | Définition du risque |
| Catégorie | Catégorie de risque |
| Statut | Actif, inactif, etc. |
| Causes | Causes associées |
| Impacts | Impacts descriptifs |
| Processus | Processus concernés |
| Références réglementaires | Référentiels applicables |
| Dispositifs existants | Procédures, politiques, notes, supports |
| Documentation | Documents liés |

### Exemple

```text
R-OP-001
Dysfonctionnement du processus de crédit

Définition :
Risque de perte d'opportunités de crédit et de revenus
lié à des dysfonctionnements empêchant certains clients
éligibles d'obtenir une offre de prêt.
```

---

# 8. Module 3 — Causes et impacts

## 8.1 Causes

Les causes doivent être des objets à part entière.

Motivation :

- un risque peut avoir plusieurs causes ;
- une même cause peut contribuer à plusieurs risques ;
- les causes doivent être réutilisables.

### Exemple

```text
Risque
├── Cause : erreur applicative
├── Cause : absence de contrôle
├── Cause : procédure insuffisante
└── Cause : dépendance à un tiers
```

La relation est de type **many-to-many** :

```text
RISK_CATALOG
      ↕
RISK_CATALOG_CAUSES
      ↕
RISK_CAUSES
```

## 8.2 Impacts

Le système doit distinguer :

### Impact descriptif du dictionnaire

Exemple :

> Une indisponibilité du système peut entraîner des pertes financières, une interruption du service et une insatisfaction client.

### Notation de l’impact dans une évaluation

Exemple :

```text
Financier       = 4
Opérationnel    = 5
Réputationnel   = 3
Réglementaire   = 2
```

Les dimensions d’impact doivent être configurables par méthodologie.

---

# 9. Module 4 — Référentiel documentaire

La plateforme doit permettre de rattacher les risques aux références du dispositif existant.

## Types de documents possibles

- Procédure
- Politique
- Note d’instruction
- Support de formation
- Manuel
- Documentation réglementaire
- Autre document configurable

## Informations minimales

- Référence
- Titre
- Type
- Version
- Statut
- URL ou emplacement
- Date d’entrée en vigueur
- Date de fin de validité

### Relation

```text
RISQUE
  │
  ├── Procédure Crédit v2
  ├── Politique Crédit
  ├── Note d'instruction 2026-04
  ├── Procédure de recouvrement
  └── Support de formation Crédit
```

---

# 10. Module 5 — Risk Management / Évaluation

Le module d’évaluation doit permettre au minimum de gérer :

- risque inhérent ;
- évaluation des contrôles ;
- risque résiduel ;
- risque cible ;
- matrices ;
- dimensions ;
- échelles ;
- règles de scoring ;
- versionnement de méthodologie.

## 10.1 Moteur de méthodologie

La méthodologie doit être externalisée du modèle métier.

```text
METHODOLOGY
     │
     ▼
METHODOLOGY_VERSION
     │
     ├── DIMENSIONS
     ├── SCALES
     ├── SCALE_LEVELS
     ├── MATRICES
     ├── SCORING_RULES
     └── WORKFLOW
```

### Dimensions pouvant être configurées

Exemples issus de l’échange :

- Probability
- Financial
- Regulatory
- Operational
- Velocity
- Persistence

### Exemple de configuration

```text
Vélocité
< 1h        = niveau 1
1h - 4h     = niveau 2
> 4h        = niveau 3
```

Une autre organisation doit pouvoir utiliser d’autres niveaux sans modification du modèle métier.

---

# 11. Module 6 — KRI / KPI

Le système doit disposer d’un objet générique **Indicator** supportant au minimum :

- KRI ;
- KPI.

## Attributs principaux

- Code
- Nom
- Type
- Description
- Unité
- Valeur cible
- Seuil d’alerte
- Seuil critique
- Responsable
- Statut

## Relations

Un indicateur peut être :

- rattaché à un risque ;
- rattaché à un processus.

```text
PROCESSUS
   │
   ├── KPI
   ├── KRI
   └── KRI
         │
         ▼
       RISQUE
```

---

# 12. Module 7 — Contrôle interne

## 12.1 Objet Contrôle

Un contrôle doit comporter notamment :

- référence ;
- nom ;
- description ;
- type ;
- fréquence ;
- nature ;
- responsable ;
- statut.

Le dispositif doit également pouvoir intégrer les informations demandées pour les fiches de procédures individualisées :

- taille de l’échantillon ;
- poste en charge ;
- fréquence ;
- nature des pièces justificatives ;
- éléments méthodologiques du contrôle.

## 12.2 Checklist obligatoire comme mécanisme de rappel

Un contrôle doit pouvoir disposer d’une checklist.

La checklist sert à rappeler de manière opérationnelle les actions à réaliser par l’exécutant.

### Exemple

```text
Contrôle : Revue des accès administrateurs

☐ Exporter la liste des administrateurs
☐ Vérifier les collaborateurs sortants
☐ Vérifier la date de dernière connexion
☐ Vérifier les droits attribués
☐ Documenter les anomalies
☐ Joindre les preuves
```

Chaque élément de checklist doit pouvoir être :

- ordonné ;
- obligatoire ou facultatif ;
- exécuté ;
- commenté ;
- associé à une anomalie ;
- associé à une évidence.

---

# 13. Module 8 — Exécution des contrôles

L’exécution d’un contrôle doit être historisée.

## Données principales

- Contrôle exécuté
- Exécutant
- Période contrôlée
- Date d’exécution
- Résultat global
- Statut
- Commentaires

Chaque ligne de la checklist doit produire un résultat d’exécution.

### Exemple

```text
Contrôle
   ↓
Checklist
   ↓
Exécution du 28/09
   ↓
1 ✓
2 ✓
3 ✗ → anomalie
4 ✓
5 ✓
```

Le résultat détaillé doit pouvoir être exploité pour mesurer l’efficacité du contrôle et alimenter les constats/écarts.

---

# 14. Module 9 — Évidences / pièces justificatives

La plateforme doit intégrer un **moteur d’évidence transversal**.

Une évidence peut être attachée à différents objets GRC.

## Objets potentiellement couverts

- Exécution de contrôle
- Incident
- Anomalie
- Plan d’action
- Recommandation d’audit
- Évaluation de risque
- Autres objets configurables

Une même évidence peut éventuellement être reliée à plusieurs objets.

## Métadonnées minimales

- Nom du fichier
- Emplacement de stockage
- Type MIME
- Taille
- Déposant
- Date de dépôt
- Description du rattachement

---

# 15. Module 10 — Anomalies

Une anomalie doit être distinguée d’un incident.

Une anomalie correspond à une situation constatée, notamment lors de l’exécution d’un contrôle, qui nécessite une qualification ou une action.

## Données principales

- Référence
- Titre
- Description
- Département
- Processus
- Date de détection
- Sévérité
- Statut
- Déclarant
- Responsable
- Évidences
- Commentaires
- Rattachements

---

# 16. Module 11 — Incidents

## 16.1 Définition fonctionnelle

Un incident représente un événement ayant réellement eu lieu ou ayant produit un impact.

## 16.2 Cycle temporel attendu

Le système doit pouvoir capturer notamment :

```text
Occurrence
    ↓
Détection
    ↓
Containment / Contention
    ↓
Résolution
```

## 16.3 Données principales

- Référence
- Titre
- Description
- Département
- Processus
- Date/heure d’occurrence
- Date/heure de détection
- Date/heure de confinement
- Date/heure de résolution
- Sévérité
- Statut
- Déclarant
- Responsable
- Évidences
- Commentaires

---

# 17. Module 12 — Relation Incident ↔ Risque

Un incident doit pouvoir être relié à un ou plusieurs risques.

```text
Risque R-001
   │
   ├── Incident INC-001
   ├── Incident INC-002
   └── Incident INC-003
```

Cette relation doit permettre de consolider l’historique des événements associés à un risque.

---

# 18. Module 13 — Vélocité et persistance

Les métriques de vélocité et de persistance ne doivent pas être uniquement saisies manuellement.

Le système doit conserver les **événements temporels sources**, puis calculer les métriques.

### Exemple

```text
Incident survenu       10:00
Incident détecté       10:15
Incident contenu       11:00
Incident résolu        15:00
```

Calculs :

```text
Vélocité = 15 min entre occurrence et détection
Persistance = 5 h entre occurrence et résolution
```

Les métriques calculées doivent pouvoir conserver leur valeur et le contexte de calcul.

---

# 19. Module 14 — Plans d’action / mitigation

Le système doit permettre de créer des plans d’action à partir de plusieurs sources.

## Sources possibles

```text
RISK
INCIDENT
ANOMALY
CONTROL
AUDIT_FINDING
AUDIT_RECOMMENDATION
```

## Informations principales

- Référence
- Titre
- Description
- Responsable
- Priorité
- Statut
- Date de début
- Échéance
- Date de réalisation
- Source
- Créateur
- Historique
- Évidences
- Commentaires

## Indicateurs calculés

Le système doit calculer au minimum :

- jours restants ;
- retard ;
- délai initial ;
- délai consommé ;
- pourcentage d’avancement.

Les données temporelles sources doivent rester conservées :

```text
start_date
due_date
completed_at
status
```

---

# 20. Persistance du problème et suivi temporel

Le suivi doit permettre de distinguer :

- date de création du problème ;
- date de détection ;
- date de début d’action ;
- échéance ;
- date de résolution ;
- date de clôture ;
- récurrence ou persistance.

L’objectif est de pouvoir répondre à des questions telles que :

- Depuis combien de temps le problème existe-t-il ?
- Depuis combien de temps est-il connu ?
- Combien de temps l’action a-t-elle pris ?
- Le problème se répète-t-il ?
- Le risque persiste-t-il malgré les actions ?

---

# 21. Module 15 — Audit

L’auditeur doit disposer d’une **vision transverse** du dispositif.

Au minimum, il doit pouvoir consulter les éléments pertinents relatifs aux :

- risques ;
- contrôles ;
- exécutions ;
- évidences ;
- incidents ;
- anomalies ;
- constats ;
- recommandations ;
- plans d’action.

## Constats / Findings

Un constat doit pouvoir être rattaché à :

- un risque ;
- un contrôle ;
- un incident ;
- une anomalie ;
- une mission d’audit ;
- une recommandation.

### Chaîne logique

```text
Finding
   ↓
Action Plan
```

Un plan d’action ne naît donc pas nécessairement directement d’un risque.

---

# 22. Module 16 — Commentaires configurables

Les commentaires doivent constituer une fonctionnalité transverse.

L’administrateur doit pouvoir définir les objets pour lesquels les commentaires sont autorisés.

## Exemples d’objets commentables

- Risk
- Control
- Control Execution
- Incident
- Anomaly
- Action Plan
- Audit Recommendation
- Assessment
- Indicator

### Exemple de configuration

```text
Commentaires sur les indicateurs : NON
Commentaires sur les risques : OUI
Commentaires sur les contrôles : OUI
Commentaires sur les incidents : OUI
```

L’objectif est d’éviter de créer une table spécifique par objet :

```text
risk_comments
control_comments
incident_comments
action_plan_comments
...
```

Le système doit disposer d’un **moteur de commentaires générique**.

---

# 23. Module 17 — Gouvernance et lignes de défense

La plateforme doit modéliser les lignes de défense sans les déduire rigidement du département.

## Lignes proposées

```text
L1 → Première ligne de défense
L2 → Deuxième ligne de défense
L3 → Audit interne
```

## Principe

Ne pas imposer :

```text
Finance = L2
IT = L2
Juridique = L2
```

Le rattachement doit plutôt suivre :

```text
Fonction / Activité
        ↓
Rôle dans le dispositif
        ↓
Ligne de défense
```

Une même fonction peut avoir :

- des activités opérationnelles relevant de L1 ;
- des activités de supervision relevant de L2.

Ce principe doit être reflété dans le modèle fonctionnel et les droits de consultation/exécution.

---

# 24. Module 18 — IAM et RACI simplifié

## 24.1 IAM

Le système d’accès doit rester simple :

```text
User
  ↓
Role
  ↓
Permission
```

### Objets IAM

- Users
- Roles
- Permissions
- User/Role assignments
- Role/Permission assignments

Exemples de permissions :

```text
RISK_VIEW
RISK_CREATE
RISK_UPDATE
RISK_ASSESS
CONTROL_EXECUTE
CONTROL_VALIDATE
INCIDENT_CREATE
ACTION_PLAN_UPDATE
AUDIT_VIEW
...
```

## 24.2 RACI métier

Le RACI est séparé de l’IAM.

```text
Objet GRC
   ↓
RACI Assignment
   ↓
Utilisateur
```

Les valeurs supportées sont :

```text
R = Responsible
A = Accountable
C = Consulted
I = Informed
```

### Exemple — Risque

```text
A → Risk Manager
R → Risk Executor
C → Process Owner
I → Audit
```

### Exemple — Contrôle

```text
A → Control Owner
R → Control Executor
I → Risk Manager
```

### Exemple — Plan d’action

```text
A → Manager
R → Action Owner
C → Risk
I → Audit
```

---

# 25. Règle de responsabilité principale

Pour certaines tables, conserver un responsable principal directement sur l’objet peut être utile pour les requêtes, les affichages et les workflows.

Exemples :

```text
risks.owner_user_id
controls.owner_id
action_plans.owner_id
incidents.owner_id
```

Cependant :

> La vérité métier détaillée des responsabilités reste portée par les affectations RACI.

Ainsi, le champ `owner` représente le responsable principal, tandis que le RACI décrit l’ensemble des parties prenantes.

---

# 26. Parcours fonctionnel principal

Le parcours cible d’un risque est :

```text
1. Ouvrir le référentiel des risques
            ↓
2. Identifier / sélectionner un risque
            ↓
3. Identifier les causes et impacts
            ↓
4. Consulter le dispositif documentaire existant
            ↓
5. Évaluer le risque inhérent
            ↓
6. Identifier / rattacher les contrôles
            ↓
7. Exécuter / évaluer les contrôles
            ↓
8. Collecter les évidences
            ↓
9. Identifier les écarts, anomalies ou incidents
            ↓
10. Évaluer le risque résiduel
            ↓
11. Créer les plans d’action
            ↓
12. Suivre les actions et leurs échéances
            ↓
13. Mesurer la persistance / vélocité lorsque pertinent
            ↓
14. Réévaluer le risque
```

---

# 27. Parcours Audit

L’auditeur doit pouvoir entrer dans le système depuis plusieurs points :

```text
                 AUDIT
                   │
       ┌───────────┼───────────┐
       ↓           ↓           ↓
    Risques     Contrôles   Incidents
       │           │           │
       └───────────┼───────────┘
                   ↓
                Constats
                   ↓
             Recommandations
                   ↓
              Plans d’action
                   ↓
                 Suivi
```

---

# 28. Workflows et statuts

Les principaux objets doivent disposer de statuts configurables.

## Risque

```text
DRAFT → OPEN → UNDER_REVIEW → ACCEPTED / TREATED → CLOSED
```

## Contrôle

```text
DRAFT → ACTIVE → SUSPENDED / INACTIVE
```

## Exécution de contrôle

```text
PLANNED → IN_PROGRESS → COMPLETED → REVIEWED
```

## Incident

```text
OPEN → INVESTIGATING → CONTAINED → RESOLVED → CLOSED
```

## Anomalie

```text
OPEN → IN_REVIEW → TREATED → CLOSED
```

## Plan d’action

```text
OPEN → IN_PROGRESS → BLOCKED → COMPLETED → CLOSED
```

Les statuts ci-dessus constituent une proposition de modèle et doivent rester configurables.

---

# 29. Audit trail et historique

La plateforme doit historiser au minimum les événements significatifs :

- création ;
- modification ;
- changement de statut ;
- changement de responsable ;
- changement de RACI ;
- changement de scoring ;
- création/suppression d’une relation ;
- ajout/suppression d’une évidence ;
- validation ;
- clôture.

Pour chaque événement :

```text
Objet
Action
Utilisateur
Date/heure
Ancienne valeur
Nouvelle valeur
Contexte
```

L’objectif est de fournir une traçabilité utilisable lors des contrôles, audits et revues de gouvernance.

---

# 30. Relations métier clés

| Relation | Cardinalité attendue |
|---|---|
| Organisation → Département | 1:N |
| Département → Processus | 1:N |
| Processus → Risque | 1:N ou N:N selon le modèle retenu |
| Risk Catalog → Risk | 1:N |
| Risk → Cause | N:N |
| Risk → Document | N:N |
| Risk → Assessment | 1:N |
| Risk → Control | N:N |
| Risk → Indicator | N:N |
| Process → Indicator | N:N |
| Risk → Incident | N:N |
| Control → Checklist Item | 1:N |
| Control → Execution | 1:N |
| Execution → Checklist Result | 1:N |
| Evidence → Objet GRC | N:N via lien générique |
| Risk / Incident / Control / Audit Finding → Action Plan | N:N ou relation source selon le besoin |
| Objet GRC → Commentaire | N:N |
| Objet GRC → RACI | N:N |
| User → Role | N:N |
| Role → Permission | N:N |

---

# 31. Modèle de données logique proposé

## Entités cœur

```text
organizations
departments
processes
users

risk_catalog
risks
risk_causes
risk_catalog_causes
risk_documents
risk_indicators
risk_incidents

risk_assessments
methodologies
methodology_versions
dimensions
scales
scale_levels
matrices
scoring_rules

controls
control_checklist_items
control_executions
control_checklist_results

indicators

incidents
anomalies
event_metrics

findings
action_plans

documents
evidence_files
evidence_links

comments
commentable_objects

roles
permissions
role_permissions
user_roles
raci_assignments

audit_trail
```

---

# 32. Principales règles d’architecture

## 32.1 Référentiel ≠ évaluation

Le catalogue décrit le risque.

Le registre représente son occurrence organisationnelle.

L’évaluation représente l’état du risque à une date et selon une méthodologie.

## 32.2 Événements sources ≠ métriques calculées

Les dates d’occurrence, de détection, de confinement et de résolution doivent être conservées.

Les métriques comme la vélocité et la persistance sont calculées à partir de ces données.

## 32.3 Donnée métier ≠ permission technique

Le fait qu’une personne soit responsable d’un risque ne lui donne pas automatiquement tous les droits techniques sur le risque.

Les responsabilités métier sont RACI.

Les droits applicatifs sont IAM.

## 32.4 Fonction transverse ≠ table par objet

Les commentaires, évidences et historiques doivent être traités génériquement.

---

# 33. Exigences fonctionnelles synthétiques

| ID | Exigence | Priorité |
|---|---|---|
| GRC-001 | Gérer plusieurs organisations / entités | Haute |
| GRC-002 | Gérer départements et processus | Haute |
| GRC-003 | Gérer un dictionnaire des risques | Critique |
| GRC-004 | Séparer catalogue, registre et évaluation | Critique |
| GRC-005 | Gérer les causes comme objets réutilisables | Haute |
| GRC-006 | Gérer impacts descriptifs et impacts scorés | Haute |
| GRC-007 | Rattacher les risques aux documents | Haute |
| GRC-008 | Évaluer les risques avec une méthodologie configurable | Critique |
| GRC-009 | Gérer KRI et KPI | Haute |
| GRC-010 | Rattacher les indicateurs aux risques et processus | Haute |
| GRC-011 | Gérer les contrôles | Critique |
| GRC-012 | Associer une checklist aux contrôles | Critique |
| GRC-013 | Historiser les exécutions de contrôles | Critique |
| GRC-014 | Collecter les évidences | Critique |
| GRC-015 | Déclarer des anomalies | Haute |
| GRC-016 | Déclarer et suivre les incidents | Critique |
| GRC-017 | Relier incidents et risques | Haute |
| GRC-018 | Calculer vélocité et persistance | Haute |
| GRC-019 | Créer et suivre des plans d’action | Critique |
| GRC-020 | Gérer les constats et recommandations d’audit | Haute |
| GRC-021 | Permettre les commentaires configurables | Haute |
| GRC-022 | Gérer les responsabilités par RACI | Critique |
| GRC-023 | Gérer IAM par rôles et permissions | Critique |
| GRC-024 | Donner une vision transverse à l’audit | Haute |
| GRC-025 | Maintenir un audit trail complet | Critique |
| GRC-026 | Versionner les méthodologies | Haute |
| GRC-027 | Configurer les lignes de défense | Haute |

---

# 34. Exigences transverses

## 34.1 Configurabilité

Doivent être configurables sans modification du cœur métier, lorsque pertinent :

- catégories de risques ;
- dimensions d’impact ;
- échelles ;
- matrices ;
- règles de scoring ;
- statuts ;
- fréquences ;
- types de contrôles ;
- types d’indicateurs ;
- objets commentables ;
- rôles RACI ;
- lignes de défense ;
- workflows.

## 34.2 Traçabilité

Toute donnée critique doit être historisable.

## 34.3 Réutilisabilité

Les causes, documents, indicateurs, contrôles et objets de référence doivent pouvoir être réutilisés dans plusieurs contextes lorsque leur nature le permet.

## 34.4 Multi-organisation

Le modèle doit permettre de conserver l’isolation logique des données par organisation.

---

# 35. Architecture fonctionnelle cible

```text
┌──────────────────────────────────────────────────────────────┐
│                         GRC PLATFORM                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ORGANISATION                                                │
│  Entités / Départements / Processus                          │
│                                                              │
│  RÉFÉRENTIEL                                                 │
│  Risques / Causes / Impacts / Documents                      │
│                                                              │
│  RISK MANAGEMENT                                             │
│  Assessments / Matrices / Scoring / KRI / KPI                │
│                                                              │
│  CONTRÔLE INTERNE                                            │
│  Contrôles / Checklists / Exécutions / Évidences / Anomalies │
│                                                              │
│  INCIDENTS                                                   │
│  Incidents / Liens Risques / Vélocité / Persistance          │
│                                                              │
│  AUDIT                                                       │
│  Missions / Findings / Recommandations                       │
│                                                              │
│  PLANS D'ACTION                                              │
│  Actions / Échéances / Suivi / Evidences                     │
│                                                              │
│  GOUVERNANCE & COLLABORATION                                 │
│  RACI / Commentaires / Workflow / Historique                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

# 36. Découpage recommandé pour le développement

## Lot 1 — Fondations

- Organisations
- Départements
- Processus
- Utilisateurs
- IAM
- Permissions
- Rôles

## Lot 2 — Référentiel

- Catalogue des risques
- Causes
- Impacts
- Documents
- Relations risque/processus/documents

## Lot 3 — Risk Management

- Registre des risques
- Évaluations
- Méthodologies
- Matrices
- Scoring
- KRI/KPI

## Lot 4 — Contrôle interne

- Contrôles
- Checklists
- Exécutions
- Résultats
- Évidences
- Anomalies

## Lot 5 — Incidents

- Déclaration
- Workflow
- Relations risques/incidents
- Timeline
- Vélocité
- Persistance

## Lot 6 — Audit et actions

- Missions
- Constats
- Recommandations
- Plans d’action
- Suivi
- Relances / échéances

## Lot 7 — Gouvernance transverse

- Commentaires configurables
- RACI
- Audit trail
- Workflows
- Gouvernance / lignes de défense

---

# 37. Points à arbitrer avant spécification détaillée

Les éléments suivants ressortent comme décisions de conception à formaliser avant de figer le modèle :

### A. Risque

- Un risque peut-il être rattaché à plusieurs départements ?
- Un risque peut-il être rattaché à plusieurs processus ?
- Quelle différence exacte doit être conservée entre `owner`, `executor`, `pilot` et les rôles RACI ?

### B. Contrôles

- Le contrôle de niveau 1 et le contrôle de niveau 2 doivent-ils utiliser le même objet ?
- La fréquence doit-elle être un référentiel configurable ?
- L’échantillonnage doit-il être statique ou calculé ?
- Quels résultats de checklist doivent générer automatiquement une anomalie ?

### C. Incidents

- Quels types d’incidents doivent être gérés ?
- Quelles dimensions d’impact doivent être communes à l’incident et au risque ?
- Quelle formule exacte doit être retenue pour vélocité et persistance ?
- Quelles métriques doivent être historiques versus recalculables ?

### D. Plans d’action

- Un plan d’action peut-il avoir plusieurs sources ?
- Un plan d’action peut-il contenir plusieurs tâches/sous-actions ?
- Quel est le mécanisme de validation et de clôture ?

### E. RACI

- Peut-on avoir plusieurs `A` ?
- Peut-on avoir plusieurs `R` ?
- Des règles de cohérence RACI doivent-elles être imposées selon le type d’objet ?

### F. Commentaires

- Quels objets sont commentables par défaut ?
- Les commentaires doivent-ils être modifiables ou seulement ajoutables ?
- Faut-il gérer les mentions, réponses ou fils de discussion ?

### G. Évidences

- Où sont stockées les pièces ?
- Quelle taille maximale ?
- Quelles extensions sont autorisées ?
- Faut-il versionner les preuves ?
- Faut-il gérer une date d’expiration de l’évidence ?

### H. Audit

- Quels objets sont visibles par défaut pour l’audit ?
- L’auditeur peut-il modifier certains objets ou uniquement constater/recommander ?
- Quels éléments doivent être obligatoirement disponibles dans les dossiers d’audit ?

---

# 38. Critères de réussite du produit

La plateforme pourra être considérée comme répondant au besoin de base lorsque l’utilisateur est capable de suivre un risque de bout en bout :

```text
Définition du risque
        ↓
Causes / Impacts
        ↓
Processus / Département
        ↓
Responsabilités RACI
        ↓
Évaluation
        ↓
Contrôles
        ↓
Checklist
        ↓
Exécution
        ↓
Évidence
        ↓
Anomalie / Incident
        ↓
Constat
        ↓
Plan d’action
        ↓
Suivi du délai
        ↓
Vélocité / Persistance
        ↓
Réévaluation
        ↓
Historique complet
```

La plateforme doit également permettre à l’auditeur de naviguer transversalement entre ces objets sans devoir reconstruire manuellement les liens.

---

# 39. Résumé architectural

La vision issue de l’échange peut être résumée ainsi :

> **Le cœur de la plateforme n’est pas le Risk Assessment.**
>
> Le cœur est un **Risk Repository connecté**, autour duquel s’organisent :
>
> **Risk Repository → Risk Assessment → Controls → Findings → Action Plans → Monitoring**
>
> avec des capacités transverses :
>
> **Comments + Evidences + RACI + Audit Trail**
>
> et un moteur de méthodologie configurable au-dessus du modèle métier.

Cette architecture permet d’évoluer d’un simple outil de gestion des risques vers une **plateforme GRC/ERM complète**, sans devoir recréer le modèle métier à chaque nouvelle fonctionnalité.

---

## 40. Annexe — Tables principales proposées

### Organisation

```text
organizations
departments
processes
users
```

### Référentiel

```text
risk_catalog
risks
risk_causes
risk_catalog_causes
documents
risk_documents
```

### Risk Management

```text
risk_assessments
indicators
risk_indicators
process_indicators
methodologies
methodology_versions
dimensions
scales
scale_levels
matrices
scoring_rules
```

### Contrôle

```text
controls
control_checklist_items
control_executions
control_checklist_results
```

### Incidents / Anomalies

```text
incidents
anomalies
risk_incidents
event_metrics
```

### Audit / Actions

```text
findings
action_plans
```

### Transverse

```text
evidence_files
evidence_links
comments
commentable_objects
raci_assignments
audit_trail
```

### IAM

```text
roles
permissions
role_permissions
user_roles
```

---

## 41. Annexe — Modèle logique simplifié

```text
ORGANIZATION
│
├── DEPARTMENT
│   ├── risk_pilot
│   ├── process_owner
│   └── PROCESS
│
├── USERS
│   └── ROLES
│       └── PERMISSIONS
│
├── RISK_CATALOG
│   └── RISK
│       ├── PROCESS
│       ├── OWNER
│       ├── RACI
│       ├── CAUSES
│       ├── DOCUMENTS
│       ├── ASSESSMENTS
│       ├── INDICATORS
│       ├── CONTROLS
│       ├── INCIDENTS
│       └── ACTION_PLANS
│
├── CONTROLS
│   ├── CHECKLIST
│   ├── EXECUTIONS
│   ├── RESULTS
│   └── EVIDENCES
│
├── INCIDENTS
│   ├── TIMELINE
│   ├── METRICS
│   ├── EVIDENCES
│   └── ACTION_PLANS
│
├── AUDIT
│   ├── FINDINGS
│   ├── RECOMMENDATIONS
│   └── ACTION_PLANS
│
└── TRANSVERSE
    ├── COMMENTS
    ├── EVIDENCES
    ├── RACI
    └── AUDIT_TRAIL
```

---

**Fin du cahier des charges v0.1**
