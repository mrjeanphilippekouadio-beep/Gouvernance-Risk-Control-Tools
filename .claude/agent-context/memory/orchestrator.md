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

## 2026-10-12 — Réponses du cockpit non relues pendant ~7 h (q79–q95)
- Le PO avait répondu à q79–q93 vers 01:20 UTC ; je les ai annoncées « en attente » jusqu'à 08:40, et deux PR (#165, #166) ont été fusionnées avec du code que q87/q90/q94/q95 modifiaient.
- Règle : à chaque transition (PR fusionnée, retour d'agent, avant tout dispatch), requêter `questions` avec `status == "answered"` et comparer au Decision Log ; toute réponse non journalisée passe avant le reste.
- Une réponse libre (champ `decision = other`) s'inscrit avec l'interprétation explicitement marquée « à confirmer par A13 », jamais reformulée comme si c'était le texte du PO.

## 2026-10-12 — rechute sur la lecture du cockpit (DECISION-045)
- Deuxième retard le même jour : q96–q99 répondues à 08:46–08:48, découvertes à 13:20 seulement parce qu'une écriture épinglée a échoué (version_mismatch). La leçon de DECISION-044 (« relire à chaque transition ») ne suffit pas.
- Règle renforcée : **avant chaque message au PO et avant chaque dispatch**, `query questions where status == "answered"` sur les ordres ≥ dernière question journalisée. Une réponse trouvée → Decision Log d'abord, tout le reste ensuite.
- Signal utile : un `version_mismatch` sur un document `questions` = le PO l'a probablement tranché.
