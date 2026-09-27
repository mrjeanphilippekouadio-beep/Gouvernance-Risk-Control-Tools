#!/usr/bin/env python3
"""
jev_router.py — Agent A00 Decision Router (JEV)
=================================================
Encapsule tous les appels JEV dans l'Agentic Code Factory.

A00 est l'arbitre des décisions structurées. Les agents Claude (A02, A13, A14…)
l'appellent via ce script — ils ne savent pas que JEV existe derrière.

Trois modes de décision :
  1. ROUTING   — Quel(s) agent(s) activer, dans quel ordre, avec quelle priorité
  2. RUNTIME   — Évaluation dynamique d'une règle métier en cours de projet
  3. ESCALADE  — Faut-il remonter une décision à un humain ?

Usage CLI (test direct) :
  python jev_router.py routing  --context "projet paiement PCI DSS criticité HAUTE" --agents "A05,A06,A10,A14"
  python jev_router.py runtime  --rule "security.scan_required" --context '{"security.level":"CRITIQUE"}'
  python jev_router.py escalade --action "Supprimer base de données production" --confidence 0.61

Usage depuis un agent Claude :
  from jev_router import JevRouter
  router = JevRouter(api_key="YOUR_JEV_API_KEY")  # ou env var JEV_API_KEY
  result = router.route(context, candidate_agents)
  result = router.eval_rule(rule_name, context)
  result = router.escalade(action_description, agent_confidence)
"""

import os
import sys
import json
import time
import argparse
import logging
from typing import Optional

try:
    import requests
except ImportError:
    sys.exit("❌ requests manquant — pip install requests --break-system-packages")

# ─── Configuration ────────────────────────────────────────────────────────────

JEV_API_BASE   = "https://api.typesafe.ai/v1"
JEV_MODEL      = "typesafe/jev-1.13"
JEV_API_KEY_ENV = "JEV_API_KEY"

DEFAULT_TIMEOUT = 10   # secondes
MAX_RETRIES     = 3
RETRY_DELAY     = 1.0  # secondes

# Seuils par défaut
ROUTING_MIN_CONFIDENCE  = 0.70  # En dessous → fallback Claude
ESCALADE_THRESHOLD      = 0.75  # En dessous de la confiance agent → escalade

# ─── Schémas de réponse JEV ──────────────────────────────────────────────────

SCHEMA_ROUTING = {
    "type": "object",
    "properties": {
        "agents_prioritaires": {
            "type": "array",
            "items": {"type": "string"},
            "description": "IDs des agents à activer, triés par ordre d'exécution"
        },
        "ordre_execution": {
            "type": "string",
            "enum": ["SEQUENTIEL", "PARALLELE", "CONDITIONNEL"],
            "description": "Comment les agents doivent s'enchaîner"
        },
        "priorite_globale": {
            "type": "string",
            "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            "description": "Urgence de l'exécution"
        },
        "supervision_humaine": {
            "type": "string",
            "enum": ["NONE", "REVIEW", "APPROVE"],
            "description": "Niveau de supervision humaine requis"
        },
        "justification": {
            "type": "string",
            "description": "Raison courte du choix"
        },
        "confiance": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Score de confiance de la décision"
        }
    },
    "required": ["agents_prioritaires", "ordre_execution", "priorite_globale",
                 "supervision_humaine", "confiance"]
}

SCHEMA_RUNTIME_RULE = {
    "type": "object",
    "properties": {
        "regle_satisfaite": {
            "type": "boolean",
            "description": "La règle est-elle vérifiée ?"
        },
        "action_recommandee": {
            "type": "string",
            "enum": ["ACTIVATE", "DEACTIVATE", "SET", "RECOMMEND", "REQUIRE", "SKIP"],
            "description": "Action à appliquer si la règle est satisfaite"
        },
        "valeur_cible": {
            "type": "string",
            "description": "Valeur à appliquer (pour action SET)"
        },
        "confiance": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
        },
        "motif": {
            "type": "string",
            "description": "Explication courte"
        }
    },
    "required": ["regle_satisfaite", "action_recommandee", "confiance"]
}

SCHEMA_ESCALADE = {
    "type": "object",
    "properties": {
        "escalade_requise": {
            "type": "boolean",
            "description": "Faut-il remonter à un humain ?"
        },
        "niveau_urgence": {
            "type": "string",
            "enum": ["INFO", "WARNING", "URGENT", "CRITIQUE"],
            "description": "Niveau d'urgence de l'escalade"
        },
        "destinataire": {
            "type": "string",
            "enum": ["TECH_LEAD", "PRODUCT_OWNER", "RISK_MANAGER", "CISO", "COMITE_DIRECTION"],
            "description": "À qui remonter"
        },
        "message_escalade": {
            "type": "string",
            "description": "Message synthétique pour le destinataire"
        },
        "confiance": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
        }
    },
    "required": ["escalade_requise", "niveau_urgence", "confiance"]
}

# Schéma 4 — SKILL ACTIVATION (v2.1)
# A00 décide quels skills JEV_DYNAMIC activer selon le contexte projet
SCHEMA_SKILL_ACTIVATION = {
    "type": "object",
    "properties": {
        "skills_a_activer": {
            "type": "array",
            "items": {"type": "string"},
            "description": "IDs des skills JEV_DYNAMIC à activer (ex: ['SK-012', 'SK-031'])"
        },
        "skills_a_desactiver": {
            "type": "array",
            "items": {"type": "string"},
            "description": "IDs des skills JEV_DYNAMIC à désactiver explicitement"
        },
        "justification": {
            "type": "string",
            "description": "Raison de l'activation/désactivation de chaque skill"
        },
        "confiance": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Score de confiance de la décision d'activation"
        },
        "revue_humaine_requise": {
            "type": "boolean",
            "description": "Faut-il une revue humaine avant d'appliquer ces activations ?"
        }
    },
    "required": ["skills_a_activer", "skills_a_desactiver", "confiance"]
}


# ─── Client JEV ──────────────────────────────────────────────────────────────

class JevRouter:
    """
    Client A00 pour tous les appels JEV dans l'ACF.

    En l'absence de clé API JEV, fonctionne en mode SIMULATION
    (retourne des réponses plausibles pour tests et développement).
    """

    def __init__(self, api_key: Optional[str] = None, simulate: bool = False):
        self.api_key  = api_key or os.environ.get(JEV_API_KEY_ENV)
        self.simulate = simulate or not self.api_key
        self.logger   = logging.getLogger("A00_JevRouter")

        if self.simulate:
            self.logger.warning(
                "⚠️  Mode SIMULATION actif — aucune clé JEV_API_KEY trouvée. "
                "Définir la variable d'environnement JEV_API_KEY pour les appels réels."
            )

    def _call_jev(self, context: str, question: str, schema: dict) -> dict:
        """Appel REST à l'API JEV avec retry et timeout."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model":   JEV_MODEL,
            "context": context,
            "question": question,
            "response_schema": schema,
        }

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = requests.post(
                    f"{JEV_API_BASE}/decisions",
                    headers=headers,
                    json=payload,
                    timeout=DEFAULT_TIMEOUT,
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("result", data)

            except requests.exceptions.Timeout:
                self.logger.warning(f"Timeout JEV (tentative {attempt}/{MAX_RETRIES})")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY * attempt)
                else:
                    raise RuntimeError("JEV API timeout après 3 tentatives — fallback recommandé")

            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response else "?"
                self.logger.error(f"Erreur HTTP JEV {status}: {e}")
                raise

            except requests.exceptions.RequestException as e:
                self.logger.error(f"Erreur réseau JEV: {e}")
                raise

    def _simulate_routing(self, context: str, candidate_agents: list) -> dict:
        """Simulation déterministe du routing pour tests."""
        ctx_lower = context.lower()

        # Logique de simulation simple basée sur mots-clés
        prioritaires = []
        if "sécurité" in ctx_lower or "pci" in ctx_lower or "critique" in ctx_lower:
            prioritaires = [a for a in candidate_agents if a in ("A10", "A11", "A13", "A14")]
        if "architecture" in ctx_lower or "api" in ctx_lower:
            prioritaires += [a for a in candidate_agents if a == "A05"]
        if not prioritaires:
            prioritaires = candidate_agents[:3] if candidate_agents else ["A02"]

        return {
            "agents_prioritaires":  list(dict.fromkeys(prioritaires)),
            "ordre_execution":      "SEQUENTIEL",
            "priorite_globale":     "HIGH" if "critique" in ctx_lower else "MEDIUM",
            "supervision_humaine":  "APPROVE" if "critique" in ctx_lower else "REVIEW",
            "justification":        "[SIMULATION] Routing basé sur mots-clés de contexte",
            "confiance":            0.82,
        }

    def _simulate_runtime_rule(self, rule_name: str, context: dict) -> dict:
        """Simulation de l'évaluation d'une règle runtime."""
        # Exemples déterministes
        PCI_RULES = {"security.scan_required", "security.pentest_required", "security.pci_dss"}
        satisfaite = rule_name in PCI_RULES and context.get("security.level") in ("CRITIQUE", "ÉLEVÉ")

        return {
            "regle_satisfaite":   satisfaite,
            "action_recommandee": "REQUIRE" if satisfaite else "SKIP",
            "valeur_cible":       "true" if satisfaite else "false",
            "confiance":          0.88,
            "motif":              "[SIMULATION] Règle évaluée sur mots-clés",
        }

    def _simulate_skill_activation(self, project_context: dict,
                                    candidate_skills: list) -> dict:
        """Simulation déterministe de l'activation de skills JEV_DYNAMIC."""
        ctx = {k.lower(): str(v).lower() for k, v in project_context.items()}
        a_activer   = []
        a_desactiver = []

        for sk in candidate_skills:
            sk_lower = sk.lower()
            # Logique déterministe sur IDs et contexte
            if sk in ("SK-012", "SK-013", "SK-014") and ctx.get("figma.api_access") == "oui":
                a_activer.append(sk)
            elif sk == "SK-014" and ctx.get("design.style_tone", "") == "motion ui":
                a_activer.append(sk)
            elif sk == "SK-031" and ctx.get("security.internet_exposed") == "oui":
                a_activer.append(sk)
            elif sk in ("SK-022", "SK-023", "SK-024") and ctx.get("data.volume_transactions", "") in ("> 100k", "10k – 100k"):
                a_activer.append(sk)
            elif sk == "SK-027" and ctx.get("data.volume_users", "") in ("> 1m", "100k – 1m"):
                a_activer.append(sk)
            elif sk in ("SK-032", "SK-033") and ctx.get("security.pentest_required") == "oui":
                a_activer.append(sk)
            elif sk in ("SK-039", "SK-041") and ctx.get("regulatory.regulated") == "oui":
                a_activer.append(sk)
            elif sk in ("SK-043", "SK-044", "SK-047", "SK-048") and ctx.get("infrastructure.target", "") in ("aws", "gcp", "azure", "cloud"):
                a_activer.append(sk)
            else:
                a_desactiver.append(sk)

        return {
            "skills_a_activer":      list(dict.fromkeys(a_activer)),
            "skills_a_desactiver":   list(dict.fromkeys(a_desactiver)),
            "justification":         "[SIMULATION] Activation basée sur mots-clés de contexte projet",
            "confiance":             0.85,
            "revue_humaine_requise": False,
        }

    def _simulate_escalade(self, action: str, agent_confidence: float) -> dict:
        """Simulation de la décision d'escalade."""
        action_lower = action.lower()
        keywords_critiques = ["supprimer", "drop", "delete", "production", "irréversible",
                               "base de données", "migration", "clé privée"]
        is_critique = any(k in action_lower for k in keywords_critiques)
        escalade = is_critique or agent_confidence < ESCALADE_THRESHOLD

        return {
            "escalade_requise": escalade,
            "niveau_urgence":   "CRITIQUE" if is_critique else ("URGENT" if escalade else "INFO"),
            "destinataire":     "TECH_LEAD" if escalade else None,
            "message_escalade": f"[SIMULATION] Action '{action[:60]}…' nécessite validation humaine",
            "confiance":        0.91,
        }

    # ── API publique ──────────────────────────────────────────────────────────

    def route(self, context: str, candidate_agents: list) -> dict:
        """
        MODE ROUTING — Décide quels agents activer.

        Args:
            context: Description textuelle du contexte projet + tâche en cours
            candidate_agents: Liste des IDs agents éligibles (ex: ["A05","A06","A10"])

        Returns:
            dict avec agents_prioritaires, ordre_execution, priorite_globale,
            supervision_humaine, justification, confiance
        """
        if self.simulate:
            result = self._simulate_routing(context, candidate_agents)
            self.logger.info(f"[SIMULATE] ROUTING → {result['agents_prioritaires']} "
                             f"(confiance {result['confiance']:.0%})")
            return result

        question = (
            f"Parmi les agents disponibles {candidate_agents}, lesquels activer "
            f"en priorité pour ce contexte, et dans quel ordre ?"
        )
        result = self._call_jev(context, question, SCHEMA_ROUTING)

        # Fallback si confiance trop faible
        if result.get("confiance", 0) < ROUTING_MIN_CONFIDENCE:
            self.logger.warning(
                f"Confiance JEV trop faible ({result['confiance']:.0%}) — "
                f"fallback sur première candidat de la liste"
            )
            result["_fallback"] = True

        self.logger.info(f"ROUTING → {result.get('agents_prioritaires')} "
                         f"(confiance {result.get('confiance', 0):.0%})")
        return result

    def eval_rule(self, rule_name: str, context: dict) -> dict:
        """
        MODE RUNTIME — Évalue une règle métier en cours de projet.

        Args:
            rule_name: Identifiant de la règle (ex: "security.scan_required")
            context:   Dict des valeurs actuelles du projet

        Returns:
            dict avec regle_satisfaite, action_recommandee, valeur_cible, confiance, motif
        """
        if self.simulate:
            result = self._simulate_runtime_rule(rule_name, context)
            self.logger.info(f"[SIMULATE] RULE '{rule_name}' → {result['regle_satisfaite']} "
                             f"(confiance {result['confiance']:.0%})")
            return result

        ctx_str  = json.dumps(context, ensure_ascii=False, indent=2)
        question = f"La règle '{rule_name}' est-elle satisfaite dans ce contexte ?"
        result   = self._call_jev(ctx_str, question, SCHEMA_RUNTIME_RULE)

        self.logger.info(f"RULE '{rule_name}' → {result.get('regle_satisfaite')} "
                         f"(confiance {result.get('confiance', 0):.0%})")
        return result

    def escalade(self, action_description: str, agent_confidence: float,
                 extra_context: Optional[str] = None) -> dict:
        """
        MODE ESCALADE — Décide si une action doit être soumise à validation humaine.

        Args:
            action_description: Description de l'action que l'agent veut effectuer
            agent_confidence:   Score de confiance de l'agent sur cette action (0-1)
            extra_context:      Contexte projet additionnel (optionnel)

        Returns:
            dict avec escalade_requise, niveau_urgence, destinataire,
            message_escalade, confiance
        """
        if self.simulate:
            result = self._simulate_escalade(action_description, agent_confidence)
            status = "⚠️  ESCALADE REQUISE" if result["escalade_requise"] else "✅ PAS D'ESCALADE"
            self.logger.info(f"[SIMULATE] ESCALADE → {status} "
                             f"(confiance {result['confiance']:.0%})")
            return result

        context = (
            f"Action proposée : {action_description}\n"
            f"Confiance de l'agent : {agent_confidence:.0%}\n"
        )
        if extra_context:
            context += f"Contexte additionnel : {extra_context}"

        question = (
            "Cette action nécessite-t-elle une validation humaine avant d'être exécutée ? "
            "Prendre en compte l'irréversibilité, la criticité et la confiance de l'agent."
        )
        result = self._call_jev(context, question, SCHEMA_ESCALADE)

        status = "⚠️  ESCALADE REQUISE" if result.get("escalade_requise") else "✅ PAS D'ESCALADE"
        self.logger.info(f"ESCALADE → {status} "
                         f"(confiance {result.get('confiance', 0):.0%})")
        return result

    def activate_skills(self, project_context: dict,
                        candidate_skills: list) -> dict:
        """
        MODE SKILL_ACTIVATION (v2.1) — Décide quels skills JEV_DYNAMIC activer.

        Appelé par A00 au démarrage du projet ou quand le contexte change.
        Les skills STATIC ne passent jamais par cette méthode (toujours actifs).

        Args:
            project_context: Dict des valeurs PROJECT_BRIEF (ex: {"figma.api_access":"OUI",
                             "design.style_tone":"Motion UI", "security.level":"CRITIQUE"})
            candidate_skills: Liste des skill IDs JEV_DYNAMIC candidats
                              (ex: ["SK-012","SK-014","SK-031","SK-039"])

        Returns:
            dict avec skills_a_activer, skills_a_desactiver, justification,
            confiance, revue_humaine_requise
        """
        if self.simulate:
            result = self._simulate_skill_activation(project_context, candidate_skills)
            self.logger.info(
                f"[SIMULATE] SKILL_ACTIVATION → activer={result['skills_a_activer']} "
                f"désactiver={result['skills_a_desactiver']} "
                f"(confiance {result['confiance']:.0%})"
            )
            return result

        ctx_str  = json.dumps(project_context, ensure_ascii=False, indent=2)
        question = (
            f"Parmi les skills JEV_DYNAMIC candidats {candidate_skills}, "
            f"lesquels activer ou désactiver selon ce contexte projet ?"
        )
        result = self._call_jev(ctx_str, question, SCHEMA_SKILL_ACTIVATION)

        if result.get("confiance", 0) < ROUTING_MIN_CONFIDENCE:
            self.logger.warning(
                f"Confiance faible ({result.get('confiance', 0):.0%}) pour skill activation — "
                f"revue humaine recommandée"
            )
            result["revue_humaine_requise"] = True

        self.logger.info(
            f"SKILL_ACTIVATION → activer={result.get('skills_a_activer')} "
            f"(confiance {result.get('confiance', 0):.0%})"
        )
        return result

    def decision_batch(self, decisions: list) -> list:
        """
        Traitement batch — exécute plusieurs décisions en séquence.
        Chaque item : {"type": "routing"|"runtime"|"escalade", "params": {...}}
        Retourne une liste de résultats dans le même ordre.
        """
        results = []
        for d in decisions:
            dtype  = d.get("type", "routing")
            params = d.get("params", {})

            try:
                if dtype == "routing":
                    results.append(self.route(
                        params.get("context", ""),
                        params.get("candidate_agents", [])
                    ))
                elif dtype == "runtime":
                    results.append(self.eval_rule(
                        params.get("rule_name", ""),
                        params.get("context", {})
                    ))
                elif dtype == "escalade":
                    results.append(self.escalade(
                        params.get("action_description", ""),
                        params.get("agent_confidence", 0.5),
                        params.get("extra_context")
                    ))
                elif dtype == "skill_activation":
                    results.append(self.activate_skills(
                        params.get("project_context", {}),
                        params.get("candidate_skills", [])
                    ))
                else:
                    results.append({"error": f"Type de décision inconnu : {dtype}"})
            except Exception as e:
                results.append({"error": str(e), "type": dtype})

        return results


# ─── Intégration dans les agents .md ─────────────────────────────────────────

AGENT_A00_TEMPLATE = """
## Utilisation de A00 (Decision Router JEV) depuis un agent Claude

```python
# Dans ton agent Claude, importer et utiliser A00 comme outil
import subprocess, json

def call_a00_routing(context: str, candidate_agents: list) -> dict:
    result = subprocess.run(
        ["python", ".claude/skills/agentic-factory-intake/jev_router.py",
         "routing",
         "--context", context,
         "--agents", ",".join(candidate_agents)],
        capture_output=True, text=True
    )
    return json.loads(result.stdout)

def call_a00_escalade(action: str, confidence: float) -> dict:
    result = subprocess.run(
        ["python", ".claude/skills/agentic-factory-intake/jev_router.py",
         "escalade",
         "--action", action,
         "--confidence", str(confidence)],
        capture_output=True, text=True
    )
    return json.loads(result.stdout)
```

**Règle d'or :** Avant d'activer 2 agents ou plus, A02 DOIT appeler A00.
**Règle d'or :** Avant toute action irréversible, l'agent concerné DOIT appeler A00.
"""


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(
        description="A00 Decision Router — Interface CLI pour JEV",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples :
  # Test routing (mode simulation sans clé API)
  python jev_router.py routing --context "projet PCI DSS criticité CRITIQUE" --agents "A05,A06,A10,A14"

  # Test évaluation de règle runtime
  python jev_router.py runtime --rule "security.scan_required" --context '{"security.level":"CRITIQUE"}'

  # Test décision d'escalade
  python jev_router.py escalade --action "DROP TABLE users en production" --confidence 0.55
        """
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    # ── Routing
    p_route = sub.add_parser("routing", help="Décider quels agents activer")
    p_route.add_argument("--context", "-c", required=True, help="Contexte textuel du projet/tâche")
    p_route.add_argument("--agents",  "-a", required=True, help="Agents candidats (ex: A05,A06,A10)")
    p_route.add_argument("--api-key", default=None)

    # ── Runtime rule
    p_rule = sub.add_parser("runtime", help="Évaluer une règle métier dynamiquement")
    p_rule.add_argument("--rule",    "-r", required=True, help="Nom de la règle (ex: security.scan_required)")
    p_rule.add_argument("--context", "-c", required=True, help="Contexte JSON des valeurs courantes")
    p_rule.add_argument("--api-key", default=None)

    # ── Escalade
    p_esc = sub.add_parser("escalade", help="Décider si escalade humaine requise")
    p_esc.add_argument("--action",     "-a", required=True, help="Description de l'action à valider")
    p_esc.add_argument("--confidence", "-f", type=float, required=True, help="Confiance de l'agent (0.0-1.0)")
    p_esc.add_argument("--extra",      "-e", default=None, help="Contexte additionnel")
    p_esc.add_argument("--api-key", default=None)

    args = parser.parse_args()

    api_key = getattr(args, "api_key", None)
    router  = JevRouter(api_key=api_key)

    if args.mode == "routing":
        agents = [a.strip() for a in args.agents.split(",") if a.strip()]
        result = router.route(args.context, agents)

    elif args.mode == "runtime":
        try:
            ctx = json.loads(args.context)
        except json.JSONDecodeError:
            # Accepter format simple "key:value,key:value"
            ctx = {}
            for pair in args.context.split(","):
                if ":" in pair:
                    k, v = pair.split(":", 1)
                    ctx[k.strip()] = v.strip()
        result = router.eval_rule(args.rule, ctx)

    elif args.mode == "escalade":
        result = router.escalade(args.action, args.confidence, args.extra)

    else:
        parser.print_help()
        sys.exit(1)

    # Sortie JSON structurée (pour consommation par d'autres agents)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
