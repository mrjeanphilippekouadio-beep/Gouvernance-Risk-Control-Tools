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

## Leçon 2026-10-12 : le frontend oublié
Le PO a constaté que le frontend n'avançait plus : 13 écrans pour 43 modules backend. Cause : à chaque décision PO je dispatchais le backend, et les specs renvoyaient l'écran à « un lot F » jamais planifié. Règle : à chaque transition de module, compter les modules backend sans écran ; tout renvoi à un « lot F » devient une ligne ACTION_ITEMS ; au moins un lot frontend tourne en parallèle des lots backend dès qu'un backend stable existe sans écran.
- 2026-10-12 13:30 : q105 répondue 13:12:50, juste après ma lecture ; j'ai affirmé au PO qu'elle restait ouverte. Règle : ne jamais affirmer qu'une question est « en attente » sans relire `questions` à l'instant du message (une lecture de quelques minutes est déjà périmée).
- 2026-10-12 : les worktrees `isolation: "worktree"` partent de `main` (origin par défaut), pas de la branche de travail — 318 commits de retard, l'agent ne trouve ni le code récent ni sa mémoire. Règle : chaque prompt de dispatch en worktree commence par « `git merge --no-edit claude/gouvernance-risk-control-tools-0mus68` avant toute lecture », et à l'intégration on cherry-pick les commits de travail (pas de merge de la branche de l'agent, qui embarquerait des commits de main).

## 2026-10-17 — passation vers une nouvelle conversation

- État complet, reste à faire et erreurs commises : `.claude/agent-context/HANDOFF-2026-10-17.md` (à lire en premier).
- Leçons : tenir les 4 collections du cockpit (status, deliveries, agents, releases) à chaque livraison, pas seulement le bandeau ; relire les questions `answered` à chaque reprise ; formuler l'invariant dans un dispatch, pas l'implémentation ; un correctif fait par l'orchestrateur après une revue appelle un retest explicite.

## 2026-11-07 — Ne pas redemander un accord déjà donné par le PO (retour du PO)
- Le PO a obtenu l'accord du DPO sur la note D6 entière (R3, R5, R6) : cet accord couvre le texte d'information et la
  formalité ARTCI. Ne plus lister « validation DPO » ni « formalité ARTCI » comme conditions ouvertes (DECISION-116).
- Règle générale : quand le PO dit avoir un accord d'un tiers (DPO, juriste…), l'inscrire une fois au Decision Log comme
  couvrant tout le périmètre du document soumis, et ne pas le reposer sous une autre forme. Ne poser une question que
  pour une précision réellement absente, une seule fois, puis s'arrêter.

## 2026-11-11 — reprise après HANDOFF-2026-11-11
- q245 à q258 répondues avant la reprise : journalisées (DECISION-120 à 123), #238 et #239 fusionnées (conflit #239 après #238 limité aux mémoires d'agents : union des deux côtés, tests relancés avant merge).
- **Rechute DECISION-045** : q259 répondue à 14:35, vue à 16:23 ; quatre messages au PO entre-temps disaient « q259 en attente ». La règle « relire `questions` answered avant chaque message au PO » reste à appliquer à la lettre, y compris dans les réponses courtes aux notifications GitHub.
- Sonar : l'API `sonarcloud.io/api/issues/search?...&pullRequest=N` répond désormais depuis la session (le blocage proxy noté plus haut ne vaut plus) ; utile pour lire un échec de Quality Gate.
- Un écart du code au texte d'une décision PO (ex. SEC-B6C-04 : « au moment de la demande ») est un correctif, pas une nouvelle question au PO.
- Limite d'usage de 5 h : un agent coupé se relance par SendMessage dès la remise à zéro ; ne pas programmer de rappel si le PO signale lui-même la reprise.

## 2026-11-11 (soir) — état pour reprise
- Fusionnés dans staging : #238, #239 (087), #247 (F8), #240 (B-6c, 088–090). Decision Log jusqu'à DECISION-131.
- Branches prêtes / en cours :
  - `feat/r1-q251-journal-sans-identite` = PR #248, prête (q281 posée).
  - `feat/r1-b13-dispositifs-defaut` (091) : A10 VERT (`sec/b13`), QA en cours (`qa/b13`) ; puis lot correctif INFO SEC-B13-01..03 ; questions q278–q280.
  - `feat/r1-f8bis-clients` (sans migration) : A10 ORANGE + escalade q275 (`hd`), QA PARTIAL_PASS (concurrence) ; lot correctif après q275–q277 et après le merge de B-13 (index unique = migration 092).
- File de migrations à tenir séquentielle : 091 B-13 → 092 F8-bis → q253 → q266 → conservation L1 (puis L2a/L2b/L2c/L3) → INFO-12 + SEC-B13-01. Une branche avec une migration ne part qu'après le merge de la précédente (sinon trou de numérotation et tests de contiguïté rouges).
- Leçons du jour : un conflit de code résolu par l'orchestrateur appelle un retest QA explicite ; Sonar refuse les scripts QA qui écrivent dans /tmp ou passent une variable d'environnement / une valeur d'API en argument de commande (passer le SQL sur stdin) ; un worktree neuf doit compiler `packages/design-system` avant le build front.
