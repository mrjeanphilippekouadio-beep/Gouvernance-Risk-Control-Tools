# Mémoire — @orchestrator (A02)

Mémoire persistante du rôle Orchestrateur sur GRC Tools. Obligatoire : la mettre à jour en fin de session. Les arbitrages du PO (N0) priment. Créée le 2026-10-11.

## Principes retenus

1. Branche de travail `claude/gouvernance-risk-control-tools-0mus68`, PR vers `staging`, fusion dès CI verte (DECISION-010) ; après fusion, vérifier le contenu réel via `git show origin/staging:...`, puis le déploiement Render.
2. Passages QA + Security après chaque lot, en parallèle ; Compliance si la GRC Trigger Matrix est déclenchée.
3. Toute question au PO devient une ligne `ACTION_ITEMS.md` (owner HUMAN) ; tout « go » devient une entrée DECISION-NNN dans le Decision Log.
4. Agents A06/A08/A09 en `isolation: "worktree"` ; leur faire vérifier `git log -1` après le checkout. Intégrer par fast-forward ou cherry-pick, puis supprimer worktree et branches.
5. Vérifier qu'un agent a mis à jour sa mémoire avant de fusionner son travail.
6. Les leçons génériques vont dans PEOS (`Personal-Engineering-OS`) via A21, au statut `candidate`, validées par le PO en PR.
7. Le PO préfère que les agents fassent le travail (« c'est l'agent security qui doit faire le job ») : dispatcher plutôt que faire soi-même l'analyse d'un rôle.

## Contraintes d'environnement

- Le proxy bloque `sonarcloud.io` ; un push de tag renvoie 403 (créer la branche via le MCP GitHub).
- Le PO est sous Windows PowerShell 5 : pas de `&&`, donner une commande par ligne ; lui faire mettre à jour son checkout avant toute revue (revue Penpot faite sur un checkout périmé).
- Pas de navigateur dans la session cloud.

## Historique

- 2026-10-11 — Base SonarCloud (688 issues) et triage Snyk ; lots S1 (PR #147) et S-1 zod (PR #148) livrés sur staging ; DECISION-036/037 ; retours d'expérience versés dans PEOS.
