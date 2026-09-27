#!/usr/bin/env python3
"""
intake_reader.py — Phase 1 du skill agentic-factory-intake
============================================================
Lit ACF_Project_Intake_v2.xlsx et produit acf_project.yaml.

Pipeline :
  1. Lecture des 7 onglets du workbook
  2. Construction du contexte (context keys → valeurs)
  3. Évaluation des DECISION RULES avec gestion du Group ID (AND/OR)
  4. Sérialisation YAML

Usage :
  python intake_reader.py --input ACF_Project_Intake_v2.xlsx --output acf_project.yaml
"""

import argparse
import sys
import re
from collections import defaultdict
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("❌ openpyxl manquant — pip install openpyxl --break-system-packages")

try:
    import yaml
except ImportError:
    sys.exit("❌ pyyaml manquant — pip install pyyaml --break-system-packages")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def cell_val(ws, row, col):
    """Retourne la valeur d'une cellule, None si vide."""
    v = ws.cell(row=row, column=col).value
    if isinstance(v, str):
        v = v.strip()
        return v if v else None
    return v


def find_tab(wb, name_fragment):
    """Trouve un onglet par fragment de nom (insensible à la casse)."""
    for name in wb.sheetnames:
        if name_fragment.lower() in name.lower():
            return wb[name]
    return None


def rows_as_dicts(ws, header_row=3, data_start=4, max_col=None):
    """Lit un onglet comme une liste de dicts {header: valeur}."""
    if max_col is None:
        max_col = ws.max_column
    headers = [cell_val(ws, header_row, c) for c in range(1, max_col + 1)]
    records = []
    for r in range(data_start, ws.max_row + 1):
        row = {}
        all_empty = True
        for c, h in enumerate(headers, start=1):
            v = cell_val(ws, r, c)
            if h:
                row[h] = v
            if v is not None:
                all_empty = False
        if not all_empty:
            records.append(row)
    return records


# ─── Lecture PROJECT BRIEF ────────────────────────────────────────────────────

def read_project_brief(ws):
    """
    Retourne un dict context_key → valeur à partir de l'onglet PROJECT BRIEF.
    Skip les lignes de section (ID vide).
    """
    context = {}
    for r in range(4, ws.max_row + 1):
        qid     = cell_val(ws, r, 1)   # Col A : ID
        ctx_key = cell_val(ws, r, 7)   # Col G : Context Key
        answer  = cell_val(ws, r, 5)   # Col E : Valeurs (= réponse remplie par l'utilisateur)

        if not qid or not ctx_key:
            continue

        # Normalisation : listes multi-select → liste Python
        if answer and " / " in str(answer):
            answer = [v.strip() for v in str(answer).split(" / ")]

        # Booléens
        if answer in ("OUI", "oui", "Yes", "YES", True):
            answer = True
        elif answer in ("NON", "non", "No", "NO", False):
            answer = False

        context[ctx_key] = answer

    return context


# ─── Lecture DECISION RULES ───────────────────────────────────────────────────

def read_decision_rules(ws):
    """
    Retourne une liste de règles :
    {rule_id, group_id, domain, context_key, operator, value, logic, action, target_param, priority}
    """
    rules = []
    for r in range(4, ws.max_row + 1):
        rule_id     = cell_val(ws, r, 1)
        group_id    = cell_val(ws, r, 2)
        domain      = cell_val(ws, r, 3)
        context_key = cell_val(ws, r, 4)
        operator    = cell_val(ws, r, 5)
        value       = cell_val(ws, r, 6)
        logic       = cell_val(ws, r, 7)   # AND | OR | None
        action      = cell_val(ws, r, 8)   # SET | ACTIVATE | DEACTIVATE | RECOMMEND | REQUIRE
        target_param= cell_val(ws, r, 9)
        priority    = cell_val(ws, r, 10)

        if not rule_id or not context_key:
            continue

        rules.append({
            "rule_id":      rule_id,
            "group_id":     group_id or "",
            "domain":       domain,
            "context_key":  context_key,
            "operator":     operator,
            "value":        value,
            "logic":        logic,
            "action":       action,
            "target_param": target_param,
            "priority":     priority,
        })
    return rules


# ─── Évaluation des règles ────────────────────────────────────────────────────

def _coerce(a, b):
    """Essaie de convertir b au type de a pour comparaison."""
    if isinstance(a, bool):
        return str(b).upper() in ("OUI", "TRUE", "YES", "1")
    if isinstance(a, (int, float)):
        try:
            return type(a)(b)
        except (ValueError, TypeError):
            return b
    return str(b) if b is not None else None


def evaluate_condition(rule, context):
    """
    Évalue une condition atomique contre le contexte.
    Retourne True / False.
    """
    key  = rule["context_key"]
    op   = (rule["operator"] or "==").strip().upper()
    val  = rule["value"]

    ctx_val = context.get(key)

    # Valeur du contexte absente → condition non satisfaite (sauf IS_MISSING)
    if ctx_val is None and op != "IS_MISSING":
        return False

    coerced_val = _coerce(ctx_val, val) if ctx_val is not None else val

    if op in ("==", "EQ", "EQUALS"):
        if isinstance(ctx_val, list):
            return coerced_val in ctx_val
        return ctx_val == coerced_val

    if op in ("!=", "NEQ", "NOT_EQUALS"):
        if isinstance(ctx_val, list):
            return coerced_val not in ctx_val
        return ctx_val != coerced_val

    if op in (">", "GT"):
        try:
            return float(ctx_val) > float(val)
        except (ValueError, TypeError):
            return False

    if op in (">=", "GTE"):
        try:
            return float(ctx_val) >= float(val)
        except (ValueError, TypeError):
            return False

    if op in ("<", "LT"):
        try:
            return float(ctx_val) < float(val)
        except (ValueError, TypeError):
            return False

    if op in ("<=", "LTE"):
        try:
            return float(ctx_val) <= float(val)
        except (ValueError, TypeError):
            return False

    if op in ("CONTAINS", "IN"):
        if isinstance(ctx_val, list):
            return val in ctx_val
        return str(val) in str(ctx_val)

    if op == "NOT_CONTAINS":
        if isinstance(ctx_val, list):
            return val not in ctx_val
        return str(val) not in str(ctx_val)

    if op == "IS_EMPTY":
        return ctx_val is None or ctx_val == "" or ctx_val == []

    if op == "IS_NOT_EMPTY":
        return ctx_val is not None and ctx_val != "" and ctx_val != []

    if op == "IS_MISSING":
        return ctx_val is None

    if op == "IS_TRUE":
        return ctx_val is True or str(ctx_val).upper() in ("OUI", "TRUE", "YES")

    if op == "IS_FALSE":
        return ctx_val is False or str(ctx_val).upper() in ("NON", "FALSE", "NO")

    # Fallback : comparaison stricte
    return str(ctx_val) == str(val)


def apply_rules(rules, context):
    """
    Applique toutes les règles avec gestion du Group ID.

    Règles autonomes (group_id == "") : évaluées indépendamment.
    Règles groupées (même group_id) :
      - collectées, puis évaluées avec la logique AND/OR du groupe
      - la logique (AND/OR) est prise de la première règle du groupe
        qui a une valeur non nulle dans la colonne Logic

    Retourne (applied_rules, skipped_rules) — deux listes de dicts.
    """
    applied = []
    skipped = []

    # Séparer règles autonomes / groupées
    standalone = [r for r in rules if not r["group_id"]]
    grouped    = defaultdict(list)
    for r in rules:
        if r["group_id"]:
            grouped[r["group_id"]].append(r)

    # ── Règles autonomes ──────────────────────────────────────────────────────
    for rule in standalone:
        result = evaluate_condition(rule, context)
        entry  = {
            "rule_id":    rule["rule_id"],
            "group_id":   "",
            "action":     rule["action"],
            "target_param": rule["target_param"],
            "triggered_by": f"{rule['context_key']} {rule['operator']} {rule['value']}",
        }
        if result:
            applied.append(entry)
        else:
            skipped.append(entry)

    # ── Règles groupées ───────────────────────────────────────────────────────
    for gid, grp_rules in grouped.items():
        # Déterminer la logique du groupe (AND par défaut)
        group_logic = "AND"
        for r in grp_rules:
            if r.get("logic") and r["logic"].upper() in ("AND", "OR"):
                group_logic = r["logic"].upper()
                break

        # Évaluer chaque condition atomique
        conditions = [(r, evaluate_condition(r, context)) for r in grp_rules]

        # Combiner selon la logique
        if group_logic == "AND":
            group_result = all(res for _, res in conditions)
        else:  # OR
            group_result = any(res for _, res in conditions)

        # Si le groupe est satisfait, appliquer toutes les règles du groupe
        triggered_parts = " & ".join(
            f"{r['context_key']} {r['operator']} {r['value']}"
            for r, _ in conditions
        )
        for rule, _ in conditions:
            entry = {
                "rule_id":      rule["rule_id"],
                "group_id":     gid,
                "group_logic":  group_logic,
                "action":       rule["action"],
                "target_param": rule["target_param"],
                "triggered_by": f"[{group_logic}] {triggered_parts}",
            }
            if group_result:
                applied.append(entry)
            else:
                skipped.append(entry)

    return applied, skipped


# ─── Lecture SCOPE & AGENTS ───────────────────────────────────────────────────

def read_scope_agents(ws):
    """
    Lit l'onglet SCOPE & AGENTS.
    Structure :
      Ligne 1 : titre
      Ligne 2 : note
      Ligne 3 : groupes de couleurs (🔵 IDENTITY, 🟢 RUNTIME…)
      Ligne 4 : vrais headers (Agent ID, Agent Name, Model…)
      Ligne 5+ : données agents
    """
    # Trouver la ligne de vrais headers (chercher "Agent ID" en col 1)
    header_row = None
    for r in range(1, min(10, ws.max_row + 1)):
        v = cell_val(ws, r, 1)
        if v and "Agent ID" in str(v):
            header_row = r
            break

    if header_row is None:
        # Fallback : ligne 4
        header_row = 4

    headers = {}
    for c in range(1, ws.max_column + 1):
        h = cell_val(ws, header_row, c)
        if h and not str(h).startswith("🔵") and not str(h).startswith("🟢") \
               and not str(h).startswith("🟠") and not str(h).startswith("🟣") \
               and not str(h).startswith("🔴") and not str(h).startswith("⚫") \
               and not str(h).startswith("🟡"):
            headers[c] = h

    agents = []
    for r in range(header_row + 1, ws.max_row + 1):
        agent_id = cell_val(ws, r, 1)
        if not agent_id:
            continue
        agent = {}
        for col, header in headers.items():
            agent[header] = cell_val(ws, r, col)
        agents.append(agent)
    return agents


# ─── Lecture AGENT RELATIONSHIPS ─────────────────────────────────────────────

def read_agent_relationships(ws):
    """
    Lit l'onglet AGENT RELATIONSHIPS en 4 sections.
    Détecte les sections par les marqueurs dans la col A.
    """
    sections = {
        "hierarchy":    [],
        "reporting":    [],
        "communication":[],
        "dependency":   [],
    }
    current_section = None
    current_headers = None

    SECTION_MARKERS = {
        "HIERARCHY":    "hierarchy",
        "REPORTING":    "reporting",
        "COMMUNICATION":"communication",
        "DEPENDENCY":   "dependency",
    }

    for r in range(1, ws.max_row + 1):
        col1 = cell_val(ws, r, 1)
        if not col1:
            continue

        # Détecter un marqueur de section
        found_section = None
        for marker, key in SECTION_MARKERS.items():
            if marker in str(col1).upper():
                found_section = key
                break

        if found_section:
            current_section = found_section
            # La ligne suivante contient les headers
            current_headers = None
            continue

        # Ligne de headers (première ligne non-vide après un marqueur de section)
        if current_section and current_headers is None:
            current_headers = {}
            for c in range(1, ws.max_column + 1):
                h = cell_val(ws, r, c)
                if h:
                    current_headers[c] = h
            continue

        # Ligne de données
        if current_section and current_headers:
            row_id = cell_val(ws, r, 1)
            if not row_id:
                continue
            record = {}
            all_empty = True
            for c, h in current_headers.items():
                v = cell_val(ws, r, c)
                record[h] = v
                if v is not None:
                    all_empty = False
            if not all_empty:
                sections[current_section].append(record)

    return sections


# ─── Lecture TOOL & PERMISSION MATRIX ────────────────────────────────────────

def read_tool_permission_matrix(ws):
    """
    Lit la matrice outils × agents.
    Ligne 3 = headers (col 1 = Tool ID, col 2 = Tool Name, puis Agent IDs)
    Données à partir de la ligne 4.
    Retourne une liste de dicts {tool_id, tool_name, permissions: {agent_id: permission}}.
    """
    # Headers ligne 3
    tool_id_col  = 1
    tool_name_col = 2
    agent_cols   = {}
    for c in range(3, ws.max_column + 1):
        h = cell_val(ws, 3, c)
        if h:
            agent_cols[c] = h

    tools = []
    for r in range(4, ws.max_row + 1):
        tid   = cell_val(ws, r, tool_id_col)
        tname = cell_val(ws, r, tool_name_col)
        if not tid:
            continue
        permissions = {}
        for col, agent_id in agent_cols.items():
            perm = cell_val(ws, r, col)
            if perm:
                permissions[agent_id] = perm
        tools.append({
            "tool_id":     tid,
            "tool_name":   tname,
            "permissions": permissions,
        })
    return tools


# ─── Lecture MODEL REGISTRY ───────────────────────────────────────────────────

def read_model_registry(ws):
    """Lit l'onglet MODEL REGISTRY. Headers en ligne 3, données à partir de ligne 4."""
    headers = {}
    for c in range(1, ws.max_column + 1):
        h = cell_val(ws, 3, c)
        if h:
            headers[c] = h

    models = []
    for r in range(4, ws.max_row + 1):
        mid = cell_val(ws, r, 1)
        if not mid:
            continue
        model = {}
        for col, header in headers.items():
            model[header] = cell_val(ws, r, col)
        models.append(model)
    return models


# ─── Application des règles au contexte factory ───────────────────────────────

def apply_rules_to_factory(applied_rules, context, agents):
    """
    Applique les règles (action SET/ACTIVATE/DEACTIVATE) sur le contexte
    et sur la liste d'agents.
    """
    for rule in applied_rules:
        action = (rule.get("action") or "").upper()
        target = rule.get("target_param") or ""

        if action == "SET" and target:
            # SET agent.{agent_id}.{param} = valeur
            # ou SET context_key = valeur
            parts = target.split(".")
            if parts[0] == "agent" and len(parts) >= 3:
                agent_id  = parts[1]
                param_key = ".".join(parts[2:])
                for agent in agents:
                    if agent.get("Agent ID") == agent_id:
                        agent[f"_rule_{param_key}"] = rule.get("value")
            else:
                # SET sur le contexte global
                context[target] = True

        elif action == "ACTIVATE" and target:
            # Activer un agent
            for agent in agents:
                if agent.get("Agent ID") == target or agent.get("slug") == target:
                    agent["_active_override"] = True

        elif action == "DEACTIVATE" and target:
            # Désactiver un agent
            for agent in agents:
                if agent.get("Agent ID") == target or agent.get("slug") == target:
                    agent["_active_override"] = False

    return context, agents


# ─── Construction du dictionnaire final ──────────────────────────────────────

def build_yaml_dict(context, applied_rules, skipped_rules, agents, relationships, tools, models):
    """Assemble le dictionnaire complet qui sera sérialisé en YAML."""

    # Décomposer le contexte en sections
    def section(prefix):
        return {k.split(".", 1)[1]: v for k, v in context.items()
                if k.startswith(prefix + ".") and v is not None}

    # Agents : normaliser les noms de colonnes
    def normalize_agents(raw_agents):
        normalized = []
        for a in raw_agents:
            n = {}
            for k, v in a.items():
                # Transformer les noms de colonnes en snake_case minimal
                clean_key = re.sub(r'[^a-zA-Z0-9_ ]', '', str(k)).strip()
                clean_key = re.sub(r'\s+', '_', clean_key).lower()
                n[clean_key] = v
            normalized.append(n)
        return normalized

    return {
        "project":     section("project"),
        "regulations": section("regulations"),
        "data":        section("data"),
        "security":    section("security"),
        "infrastructure": section("infrastructure"),
        "architecture": section("architecture"),
        "team":        section("team"),
        "timeline":    section("timeline"),
        "factory":     section("factory"),
        "applied_rules": applied_rules,
        "skipped_rules_count": len(skipped_rules),
        "agents":      normalize_agents(agents),
        "relationships": relationships,
        "tools":       tools,
        "models":      models,
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ACF Intake Reader — Excel → YAML")
    parser.add_argument("--input",  "-i", required=True, help="Chemin vers ACF_Project_Intake_v2.xlsx")
    parser.add_argument("--output", "-o", default="acf_project.yaml", help="Fichier YAML de sortie")
    args = parser.parse_args()

    xlsx_path = Path(args.input)
    if not xlsx_path.exists():
        sys.exit(f"❌ Fichier introuvable : {xlsx_path}")

    print(f"📂 Lecture du workbook : {xlsx_path}")
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    # ── Onglets
    ws_brief        = find_tab(wb, "PROJECT BRIEF")
    ws_rules        = find_tab(wb, "DECISION RULES")
    ws_agents       = find_tab(wb, "SCOPE")
    ws_relationships= find_tab(wb, "RELATIONSHIPS")
    ws_tools        = find_tab(wb, "TOOL")
    ws_models       = find_tab(wb, "MODEL REGISTRY")

    missing = [name for name, ws in [
        ("PROJECT BRIEF", ws_brief),
        ("DECISION RULES", ws_rules),
        ("SCOPE & AGENTS", ws_agents),
        ("AGENT RELATIONSHIPS", ws_relationships),
        ("TOOL & PERMISSION", ws_tools),
        ("MODEL REGISTRY", ws_models),
    ] if ws is None]

    if missing:
        sys.exit(f"❌ Onglets manquants dans le workbook : {', '.join(missing)}")

    # ── Lecture
    print("📋 PROJECT BRIEF…")
    context = read_project_brief(ws_brief)

    print("⚙️  DECISION RULES…")
    rules = read_decision_rules(ws_rules)

    print("🤖 SCOPE & AGENTS…")
    agents = read_scope_agents(ws_agents)

    print("🔗 AGENT RELATIONSHIPS…")
    relationships = read_agent_relationships(ws_relationships)

    print("🛡️  TOOL & PERMISSION MATRIX…")
    tools = read_tool_permission_matrix(ws_tools)

    print("🧠 MODEL REGISTRY…")
    models = read_model_registry(ws_models)

    # ── Application des règles
    print("📐 Application des DECISION RULES…")
    applied_rules, skipped_rules = apply_rules(rules, context)
    context, agents = apply_rules_to_factory(applied_rules, context, agents)

    # ── Filtrage des agents exclus
    excluded = context.get("factory.excluded_agents") or []
    if isinstance(excluded, str):
        excluded = [e.strip() for e in excluded.split(",") if e.strip()]
    active_agents = [a for a in agents if a.get("Agent ID") not in excluded]

    # ── Assemblage YAML
    data = build_yaml_dict(context, applied_rules, skipped_rules, active_agents,
                           relationships, tools, models)

    # ── Écriture
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)

    # ── Résumé
    project_name = data["project"].get("name", "(sans nom)")
    n_agents     = len([a for a in active_agents if a])
    n_applied    = len(applied_rules)
    n_skipped    = len(skipped_rules)

    print(f"\n✅ YAML généré : {out_path}")
    print(f"   Projet        : {project_name}")
    print(f"   Agents actifs : {n_agents}")
    print(f"   Règles appliquées : {n_applied} / {n_applied + n_skipped}")
    print(f"   Règles ignorées   : {n_skipped}")


if __name__ == "__main__":
    main()
