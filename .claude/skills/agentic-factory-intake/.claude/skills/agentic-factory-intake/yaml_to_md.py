#!/usr/bin/env python3
"""
yaml_to_md.py — Phase 2 du skill agentic-factory-intake
=========================================================
Lit acf_project.yaml et génère :
  - PROJECT_MANIFEST.md       (contexte global du projet)
  - .claude/agents/<slug>.md  (un fichier par agent actif)

Usage :
  python yaml_to_md.py --input acf_project.yaml --outdir /path/to/project
"""

import argparse
import sys
import re
import textwrap
from pathlib import Path
from datetime import date

try:
    import yaml
except ImportError:
    sys.exit("❌ pyyaml manquant — pip install pyyaml --break-system-packages")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def val(d, *keys, default="—"):
    """Navigation sûre dans un dict imbriqué."""
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, None)
        if d is None:
            return default
    return d if d is not None else default


def yn(v):
    """Booléen → Oui / Non."""
    if v is True:
        return "Oui"
    if v is False:
        return "Non"
    return str(v) if v else "—"


def lst(v, sep=", "):
    """Liste ou scalaire → chaîne."""
    if isinstance(v, list):
        return sep.join(str(x) for x in v if x)
    return str(v) if v else "—"


def slug_from_agent(agent):
    """Génère un slug depuis le nom ou l'ID de l'agent."""
    raw = agent.get("agent_slug") or agent.get("slug") or agent.get("agent_name") or agent.get("agent_id") or "unknown"
    slug = re.sub(r'[^a-z0-9_]', '_', str(raw).lower())
    slug = re.sub(r'_+', '_', slug).strip('_')
    return slug


def get(d, *keys):
    """Comme val() mais retourne None si absent."""
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
        if d is None:
            return None
    return d


# ─── PROJECT_MANIFEST.md ─────────────────────────────────────────────────────

def generate_manifest(data):
    """Génère le contenu de PROJECT_MANIFEST.md."""
    today    = date.today().isoformat()
    project  = data.get("project", {})
    regs     = data.get("regulations", {})
    dta      = data.get("data", {})
    sec      = data.get("security", {})
    infra    = data.get("infrastructure", {})
    arch     = data.get("architecture", {})
    team     = data.get("team", {})
    timeline = data.get("timeline", {})
    factory  = data.get("factory", {})
    rules    = data.get("applied_rules", [])
    agents   = data.get("agents", [])
    models   = data.get("models", [])

    # Compter les agents actifs
    active_agents = [a for a in agents if a]
    n_agents = len(active_agents)

    lines = [
        "# PROJECT MANIFEST",
        f"> Généré le {today} par le skill `agentic-factory-intake`",
        f"> Source : ACF Project Intake V2",
        "",
        "---",
        "",
        "## 📋 Informations générales",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **ID Projet** | {val(project, 'id')} |",
        f"| **Nom** | {val(project, 'name')} |",
        f"| **Type** | {val(project, 'type')} |",
        f"| **Criticité** | {val(project, 'criticality')} |",
        f"| **Statut** | {val(project, 'status')} |",
        f"| **Description** | {val(project, 'description')} |",
        f"| **Objectifs** | {val(project, 'objectives')} |",
        "",
        "---",
        "",
        "## ⚖️ Cadre réglementaire",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **Référentiels** | {lst(val(regs, 'frameworks'))} |",
        f"| **Supervision BCEAO** | {yn(val(regs, 'bceao_supervision'))} |",
        f"| **Juridictions** | {lst(val(regs, 'jurisdictions'))} |",
        f"| **Licence monnaie électronique** | {yn(val(regs, 'emoney_license'))} |",
        f"| **Traitement données perso** | {yn(val(regs, 'personal_data_processing'))} |",
        f"| **Contraintes KYC/AML** | {val(regs, 'kyc_aml_constraints')} |",
        "",
        "---",
        "",
        "## 🗄️ Données",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **Données personnelles** | {yn(val(dta, 'personal_data'))} |",
        f"| **Catégories** | {lst(val(dta, 'personal_data_categories'))} |",
        f"| **Données sensibles (art. 9 RGPD)** | {yn(val(dta, 'sensitive_data'))} |",
        f"| **Données financières** | {yn(val(dta, 'financial_data'))} |",
        f"| **Rétention** | {val(dta, 'retention_period')} |",
        f"| **Chiffrement au repos** | {yn(val(dta, 'encryption_at_rest'))} |",
        f"| **Chiffrement en transit** | {yn(val(dta, 'encryption_in_transit'))} |",
        "",
        "---",
        "",
        "## 🔐 Sécurité",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **Niveau de sécurité** | {val(sec, 'level')} |",
        f"| **Authentification** | {lst(val(sec, 'authentication_methods'))} |",
        f"| **Scan de code requis** | {yn(val(sec, 'scan_required'))} |",
        f"| **Tests de pénétration** | {yn(val(sec, 'pentest_required'))} |",
        f"| **Conformité PCI DSS** | {yn(val(sec, 'pci_dss'))} |",
        "",
        "---",
        "",
        "## 🏗️ Infrastructure & Architecture",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **Cloud provider** | {val(infra, 'cloud_provider')} |",
        f"| **Environnements** | {lst(val(infra, 'environments'))} |",
        f"| **CI/CD** | {val(infra, 'cicd_platform')} |",
        f"| **Conteneurisation** | {val(infra, 'containerization')} |",
        f"| **Style API** | {val(arch, 'api_type')} |",
        f"| **Langages & frameworks** | {val(arch, 'languages')} |",
        f"| **Intégrations externes** | {lst(val(arch, 'integrations'))} |",
        f"| **Codebase existant** | {yn(val(arch, 'existing_codebase'))} |",
        "",
        "---",
        "",
        "## 👥 Équipe & Factory",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **Taille de l'équipe** | {val(team, 'size')} |",
        f"| **Périmètre Factory** | {lst(val(factory, 'scope'))} |",
        f"| **Effort maximum** | {val(factory, 'max_effort')} |",
        f"| **Approbation humaine** | {yn(val(factory, 'human_approval_required'))} |",
        f"| **Format de sortie** | {val(factory, 'output_format')} |",
        f"| **Agents exclus** | {lst(val(factory, 'excluded_agents'))} |",
        "",
        "---",
        "",
        "## 🗓️ Timeline",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **Démarrage** | {val(timeline, 'start')} |",
        f"| **Livraison cible** | {val(timeline, 'deadline')} |",
        f"| **Contraintes** | {val(timeline, 'constraints')} |",
        "",
        "---",
        "",
        "## ⚙️ Règles appliquées ({n} règles)".format(n=len(rules)),
        "",
        "| Rule ID | Group | Action | Cible | Déclencheur |",
        "|---|---|---|---|---|",
    ]

    for r in rules:
        lines.append(
            f"| {r.get('rule_id', '')} | {r.get('group_id', '')} | "
            f"{r.get('action', '')} | {r.get('target_param', '')} | "
            f"{r.get('triggered_by', '')} |"
        )

    lines += [
        "",
        "---",
        "",
        f"## 🤖 Agents activés ({n_agents} agents)",
        "",
        "| Agent ID | Nom | Type | Modèle | Toujours actif |",
        "|---|---|---|---|---|",
    ]

    for a in active_agents:
        lines.append(
            f"| {a.get('agent_id', '')} | {a.get('agent_name', '')} | "
            f"{a.get('agent_type', '')} | {a.get('model', '')} | "
            f"{yn(a.get('always_on', False))} |"
        )

    lines += [
        "",
        "---",
        "",
        "## 📁 Structure PRODUCT_CONTEXT/",
        "",
        "```",
        "PRODUCT_CONTEXT/",
        "├── project_brief.md        # Résumé des réponses PROJECT BRIEF",
        "├── decision_log.md         # Règles appliquées et leurs effets",
        "├── architecture.md         # Décisions d'architecture",
        "├── security_policy.md      # Politique de sécurité du projet",
        "├── compliance_requirements.md  # Exigences réglementaires",
        "└── agent_contracts/        # Copie des contrats des agents actifs",
        "```",
        "",
        "---",
        "",
        "_Ce fichier est généré automatiquement. Ne pas modifier manuellement._",
        "_Pour le régénérer : `/agentic-factory-intake <chemin_xlsx>`_",
    ]

    return "\n".join(lines)


# ─── Agent .md ────────────────────────────────────────────────────────────────

HALLUCINATION_LEVEL_INSTRUCTIONS = {
    "LOW":      "Tu peux utiliser tes connaissances générales. Cite tes sources quand tu affirmes un fait précis.",
    "MEDIUM":   "Pour toute affirmation factuelle, cite explicitement la source (fichier, doc, URL). Ne généralise pas sans données.",
    "HIGH":     "Chaque affirmation doit être étayée par une preuve textuelle du contexte fourni. Ne produis rien de non sourcé.",
    "ZERO":     "Mode grounding absolu. Chaque ligne de ta réponse doit citer sa source exacte. Aucune inférence sans preuve.",
}

def generate_agent_md(agent, data):
    """Génère le contenu d'un fichier .claude/agents/<slug>.md."""
    today    = date.today().isoformat()
    project  = data.get("project", {})
    tools_mx = data.get("tools", [])

    # Champs de l'agent — on essaie plusieurs variantes de noms de clés
    def ag(key, *aliases, default="—"):
        for k in [key] + list(aliases):
            v = agent.get(k)
            if v is not None:
                return v
        return default

    agent_id   = ag("agent_id",   "Agent ID")
    agent_name = ag("agent_name", "Agent Name")
    agent_slug = slug_from_agent(agent)
    agent_type = ag("agent_type", "Agent Type", "Type")
    model      = ag("model",      "Model",      "Modèle")
    always_on  = ag("always_on",  "Always On",  "Toujours actif", default=False)
    max_iter   = ag("max_iterations", "Max Iterations", "Max_Iterations", default="50")
    max_tokens = ag("max_tokens",     "Max Tokens",     "Max_Tokens", default="8192")
    timeout    = ag("timeout_s",      "Timeout (s)",    "Timeout_s", default="300")
    authority  = ag("authority_level","Authority Level","Authority_Level", default="READ_ONLY")
    scope_perimeter = ag("scope_perimeter","Scope Perimeter","Scope_Perimeter", default="")
    hallucination_lvl = ag("hallucination_level","Hallucination Level","Hallucination_Level", default="MEDIUM")
    grounding  = ag("grounding_required","Grounding Required","Grounding_Required", default=False)
    evidence   = ag("evidence_required", "Evidence Required", "Evidence_Required", default=False)
    verification = ag("verification_required","Verification Required","Verification_Required", default=False)
    system_prompt = ag("system_prompt_base","System Prompt Base","System_Prompt_Base", default="")
    agent_contract = ag("agent_contract","Agent Contract","Agent_Contract", default="")
    human_escalation = ag("human_escalation_triggers","Human Escalation Triggers","Human_Escalation_Triggers", default="")
    blocked_tools = ag("blocked_tools","Blocked Tools","Blocked_Tools", default="")
    spawn_rights  = ag("spawn_rights", "Spawn Rights",  "Spawn_Rights", default="")
    sub_agents    = ag("sub_agents",   "Sub Agents",    "Sub_Agents", default="")
    memory_type   = ag("memory_type",  "Memory Type",   "Memory_Type", default="")
    shared_context= ag("shared_context_access","Shared Context Access","Shared_Context_Access", default="")

    # Permissions outils pour cet agent
    tool_perms = {}
    for tool in tools_mx:
        perm = tool.get("permissions", {}).get(agent_id)
        if perm and perm != "DENY":
            tool_perms[tool.get("tool_name", tool.get("tool_id", ""))] = perm

    # Instruction anti-hallucination
    hall_instruction = HALLUCINATION_LEVEL_INSTRUCTIONS.get(
        str(hallucination_lvl).upper(),
        HALLUCINATION_LEVEL_INSTRUCTIONS["MEDIUM"]
    )

    # Identité
    lines = [
        f"# {agent_name}",
        f"> Agent ID : `{agent_id}` · Slug : `{agent_slug}` · Projet : {project.get('name', '—')}",
        f"> Généré le {today} par `agentic-factory-intake`",
        "",
        "---",
        "",
        "## Identité",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **ID** | `{agent_id}` |",
        f"| **Nom** | {agent_name} |",
        f"| **Slug** | `{agent_slug}` |",
        f"| **Type** | {agent_type} |",
        f"| **Toujours actif** | {yn(always_on)} |",
        "",
        "---",
        "",
        "## Runtime",
        "",
        f"| Paramètre | Valeur |",
        f"|---|---|",
        f"| **Modèle** | `{model}` |",
        f"| **Max itérations** | {max_iter} |",
        f"| **Max tokens** | {max_tokens} |",
        f"| **Timeout** | {timeout}s |",
        "",
        "---",
        "",
        "## Autorité & Périmètre",
        "",
        f"| Paramètre | Valeur |",
        f"|---|---|",
        f"| **Niveau d'autorité** | `{authority}` |",
        f"| **Périmètre** | {scope_perimeter} |",
        f"| **Droits de spawn** | {spawn_rights} |",
        f"| **Sous-agents autorisés** | {sub_agents} |",
        "",
        "---",
        "",
        "## Outils autorisés",
        "",
    ]

    if tool_perms:
        lines.append("| Outil | Permission |")
        lines.append("|---|---|")
        for t, p in tool_perms.items():
            lines.append(f"| `{t}` | **{p}** |")
    else:
        lines.append("_Aucun outil autorisé (vérifier la TOOL & PERMISSION MATRIX)._")

    if blocked_tools and blocked_tools != "—":
        lines += [
            "",
            "**Outils bloqués :**",
            "",
            f"{blocked_tools}",
        ]

    lines += [
        "",
        "---",
        "",
        "## Mémoire & Contexte partagé",
        "",
        f"| Champ | Valeur |",
        f"|---|---|",
        f"| **Type de mémoire** | {memory_type} |",
        f"| **Accès contexte partagé** | {shared_context} |",
        "",
        "```",
        "PRODUCT_CONTEXT/              # Mémoire partagée en lecture",
        f"├── project_brief.md         # Contexte projet global",
        f"├── decision_log.md          # Règles et décisions",
        f"└── agent_contracts/         # Contrats des agents",
        "```",
        "",
        "---",
        "",
        "## Contrôles & Hallucination",
        "",
        f"| Paramètre | Valeur |",
        f"|---|---|",
        f"| **Niveau hallucination** | `{hallucination_lvl}` |",
        f"| **Grounding requis** | {yn(grounding)} |",
        f"| **Evidence requise** | {yn(evidence)} |",
        f"| **Vérification requise** | {yn(verification)} |",
        "",
        f"> **Instruction anti-hallucination :** {hall_instruction}",
        "",
    ]

    if human_escalation and human_escalation != "—":
        lines += [
            "**Escalade humaine déclenchée si :**",
            "",
            f"{human_escalation}",
            "",
        ]

    lines += [
        "---",
        "",
        "## System Prompt",
        "",
    ]

    if system_prompt and system_prompt != "—":
        lines += [
            "```",
            str(system_prompt),
            "```",
            "",
        ]
    else:
        lines += [
            "```",
            f"Tu es {agent_name}, agent spécialisé de l'Agentic Code Factory.",
            f"Projet : {project.get('name', '(à définir)')}",
            f"Criticité : {project.get('criticality', '(à définir)')}",
            "",
            f"Ton rôle est de {agent_type.lower().replace('_', ' ')} dans ce projet.",
            "",
            f"Niveau d'autorité : {authority}",
            f"Périmètre : {scope_perimeter}",
            "",
            "## Politique d'hallucination",
            hall_instruction,
            "",
            "## Contexte partagé",
            "Consulte PRODUCT_CONTEXT/ pour le contexte global du projet.",
            "Ne prends aucune décision critique sans vérifier ce contexte.",
            "",
            "## Escalade",
            "En cas de doute sur une action irréversible, remonte à A02 (Orchestrator) avant d'agir.",
            "```",
            "",
        ]

    lines += [
        "---",
        "",
        "## Contrat de l'agent",
        "",
    ]

    if agent_contract and agent_contract != "—":
        lines += [
            str(agent_contract),
            "",
        ]
    else:
        lines += [
            f"**Ce que {agent_name} reçoit en entrée :**",
            "- Instructions de l'orchestrateur (A02) ou d'un agent délégant",
            "- Contexte projet depuis PRODUCT_CONTEXT/",
            "",
            f"**Ce que {agent_name} produit en sortie :**",
            "- Artefacts dans le répertoire du projet",
            "- Rapport de statut à l'orchestrateur",
            "- Escalades si nécessaire",
            "",
            "**Limites :**",
            "- Ne dépasse pas son périmètre d'autorité",
            "- Ne prend pas de décisions irréversibles sans approbation humaine si requis",
            "",
        ]

    lines += [
        "---",
        "",
        "_Fichier généré automatiquement. Régénérer via `/agentic-factory-intake`._",
    ]

    return "\n".join(lines)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ACF YAML → Markdown artefacts")
    parser.add_argument("--input",  "-i", default="acf_project.yaml", help="YAML source")
    parser.add_argument("--outdir", "-o", default=".",                help="Répertoire racine du projet")
    args = parser.parse_args()

    yaml_path = Path(args.input)
    if not yaml_path.exists():
        sys.exit(f"❌ YAML introuvable : {yaml_path}")

    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    outdir = Path(args.outdir)
    agents_dir = outdir / ".claude" / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)

    created_files = []

    # ── PROJECT_MANIFEST.md
    manifest_path = outdir / "PROJECT_MANIFEST.md"
    manifest_content = generate_manifest(data)
    manifest_path.write_text(manifest_content, encoding="utf-8")
    created_files.append(str(manifest_path))
    print(f"✅ {manifest_path}")

    # ── .claude/agents/*.md
    agents = data.get("agents", [])
    excluded = (data.get("factory") or {}).get("excluded_agents") or []
    if isinstance(excluded, str):
        excluded = [e.strip() for e in excluded.split(",") if e.strip()]

    n_generated = 0
    for agent in agents:
        if not agent:
            continue
        agent_id = agent.get("agent_id") or agent.get("Agent ID") or ""
        if agent_id in excluded:
            continue

        slug     = slug_from_agent(agent)
        filename = f"{slug}.md"
        filepath = agents_dir / filename
        content  = generate_agent_md(agent, data)
        filepath.write_text(content, encoding="utf-8")
        created_files.append(str(filepath))
        print(f"✅ {filepath}")
        n_generated += 1

    print(f"\n🎉 Terminé — {n_generated} agents + PROJECT_MANIFEST.md générés")
    print("\n📁 Structure créée :")
    print(f"   {outdir}/PROJECT_MANIFEST.md")
    print(f"   {outdir}/.claude/agents/")
    for f in created_files[1:]:
        print(f"     └── {Path(f).name}")


if __name__ == "__main__":
    main()
