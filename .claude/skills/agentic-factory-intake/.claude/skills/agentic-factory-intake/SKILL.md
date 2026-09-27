---
name: agentic-factory-intake
description: >
  Lit un fichier ACF_Project_Intake_v2.1.xlsx, applique les DECISION RULES,
  génère acf_project.yaml, puis produit PROJECT_MANIFEST.md et les fichiers
  .claude/agents/*.md — incluant A00 (Decision Router JEV, optionnel) qui
  arbitre les décisions structurées de l'ACF. v2.1 : JEV optionnel,
  Figma, Design/Charte graphique, SKILL REGISTRY (STATIC | JEV_DYNAMIC).
  Invoquer avec : /agentic-factory-intake [chemin_vers_le_xlsx]
---

# Skill — Agentic Factory Intake (v2.1 + JEV optionnel)

## Architecture de l'ACF

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENTIC CODE FACTORY                        │
│                                                                 │
│  Humain                                                         │
│    │                                                            │
│    ▼                                                            │
│  A01 (Intake) ── lit xlsx ──► acf_project.yaml                 │
│    │                                                            │
│    ▼                                                            │
│  A02 (Orchestrator) ◄──────────────────────────────────────┐   │
│    │                                                         │   │
│    │  "Quels agents activer ?"                               │   │
│    ▼                                                         │   │
│  A00 (Decision Router JEV) ◄── nœud de décision central    │   │
│    │                                                         │   │
│    │  { agents: [A10, A05], ordre: SEQUENTIEL,              │   │
│    │    supervision: APPROVE, confiance: 0.94 }             │   │
│    │                                                         │   │
│    ▼                                                         │   │
│  ┌─────────┬──────────┬──────────┬──────────┐               │   │
│  │  A05    │   A06    │   A10    │   A14    │               │   │
│  │Architect│   Dev    │Security  │Compliance│               │   │
│  └────┬────┴────┬─────┴────┬─────┴────┬─────┘               │   │
│       │         │          │          │                       │   │
│       │  "Action irréversible ?"      │                       │   │
│       ▼         ▼          ▼          ▼                       │   │
│     A00 (escalade) ── { escalade: true, → CISO } ────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**A00 intervient sur 3 nœuds :**
1. **ROUTING** — avant toute activation d'agents par A02
2. **RUNTIME RULES** — évaluation dynamique des règles en cours de projet
3. **ESCALADE** — décision de supervision humaine avant action irréversible

---

## Pipeline de génération

```
ACF_Project_Intake_v2.xlsx
        │
        ▼  Phase 1 — intake_reader.py
acf_project.yaml
        │
        ▼  Phase 2 — yaml_to_md.py
PROJECT_MANIFEST.md
.claude/agents/
  ├── a00_decision_router.md   ← NOUVEAU (encapsule JEV)
  ├── a01_intake.md
  ├── a02_orchestrator.md      ← MIS À JOUR (contrat JEV)
  ├── a03_pm.md
  ...
  └── a23_project_manager.md
.claude/skills/agentic-factory-intake/
  ├── jev_router.py            ← NOUVEAU (client JEV)
  ├── intake_reader.py
  └── yaml_to_md.py
```

---

## Étapes d'exécution

### 1. Identifier le fichier source

- Chemin fourni : `/agentic-factory-intake /path/to/ACF_Project_Intake_v2.xlsx`
- Pas de chemin → chercher `ACF_Project_Intake_v2.xlsx` dans le répertoire courant
- Introuvable → demander le chemin avant de continuer

### 2. Exécuter la Phase 1 — Lecture Excel + DECISION RULES

```bash
python .claude/skills/agentic-factory-intake/intake_reader.py \
  --input  <chemin_vers_le_xlsx> \
  --output acf_project.yaml
```

Afficher le résumé : nom projet, agents actifs, règles appliquées/ignorées.

### 3. Exécuter la Phase 2 — Génération des Markdown

```bash
python .claude/skills/agentic-factory-intake/yaml_to_md.py \
  --input  acf_project.yaml \
  --outdir .
```

### 4. Copier jev_router.py dans le projet

```bash
cp .claude/skills/agentic-factory-intake/jev_router.py \
   .claude/skills/agentic-factory-intake/jev_router.py
```

Le fichier est déjà au bon endroit si le skill est installé dans `.claude/skills/`.

### 5. Tester A00 en mode simulation

```bash
# Test routing (sans clé JEV — mode simulation automatique)
python .claude/skills/agentic-factory-intake/jev_router.py routing \
  --context "Projet paiement mobile PCI DSS criticité CRITIQUE" \
  --agents "A05,A06,A10,A13,A14"

# Test escalade
python .claude/skills/agentic-factory-intake/jev_router.py escalade \
  --action "Migration base de données production" \
  --confidence 0.65
```

### 6. Configurer la clé JEV (production)

```bash
export JEV_API_KEY="votre_clé_typesafe_ai"
# ou dans .env du projet :
echo "JEV_API_KEY=votre_clé" >> .env
```

Sans clé → mode SIMULATION (recommandé pour développement et tests).

### 7. Confirmer à l'utilisateur

```
✅ ACF initialisée :
   PROJECT_MANIFEST.md
   .claude/agents/
     ├── a00_decision_router.md    (JEV — arbitre des décisions)
     ├── a01_intake.md
     ├── a02_orchestrator.md
     └── ... (23 agents au total)
   .claude/skills/agentic-factory-intake/jev_router.py

   Mode JEV : SIMULATION (définir JEV_API_KEY pour les appels réels)
```

---

## Règles d'or pour les agents Claude

Les agents doivent respecter ces deux règles, documentées dans leurs contrats :

**Règle 1 — Routing multi-agents :**
> Avant d'activer 2 agents ou plus, A02 appelle A00.
> Si la confiance JEV < 70%, A02 décide lui-même mais le log l'indique.

**Règle 2 — Action irréversible :**
> Avant toute action irréversible (suppression, migration, déploiement prod),
> l'agent appelle A00 en mode ESCALADE.
> Si `escalade_requise: true` → STOP, notifier le destinataire indiqué.

---

## Dépendances

| Package   | Usage                        | Installation                              |
|-----------|------------------------------|-------------------------------------------|
| openpyxl  | Lecture du workbook Excel    | Préinstallé                               |
| pyyaml    | YAML intermédiaire           | Préinstallé                               |
| requests  | Appels API JEV               | `pip install requests --break-system-packages` |

---

## Variables d'environnement

| Variable      | Obligatoire | Description                          |
|---------------|-------------|--------------------------------------|
| JEV_API_KEY   | NON         | Clé API TypeSafe AI (mode simulation si absente) |

---

## Structure YAML produit (extrait)

```yaml
project:
  id: "ACF-2024-001"
  name: "Nom du projet"
  criticality: "CRITIQUE"

factory:
  scope: ["PM", "Dev", "Security"]
  max_effort: "HIGH"
  human_approval_required: true

agents:
  - agent_id: "A00"
    agent_name: "Decision Router"
    slug: "a00_decision_router"
    model: "jev-1.13"           # Modèle JEV, pas Claude
    agent_type: "DECISION_ENGINE"
    always_on: true
    # ...

applied_rules:
  - rule_id: "R-001"
    action: "REQUIRE"
    target_param: "security.scan_required"
    triggered_by: "project.criticality == CRITIQUE"
```
