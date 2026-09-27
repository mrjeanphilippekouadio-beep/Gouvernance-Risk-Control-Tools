# Retour d'expérience — pool multi-agents ACF (GRC Tools)

**Objet** : ce document capitalise sur les vrais problèmes rencontrés en
démarrant, coordonnant et intégrant le pool d'agents ACF sur ce premier
projet (GRC Tools / Djamo), pour améliorer le workbook Excel
(`ACF_GRC_Tools_v2_COMPLET.xlsx`) et le skill `agentic-factory-intake`
avant le prochain projet. Ce n'est pas un compte-rendu d'avancement
produit (voir le dashboard de statut pour ça) — c'est un audit de ce qui
a coûté du temps, produit des bugs, ou nécessité une intervention
manuelle de l'orchestrateur, avec la cause et la correction à intégrer
en amont la prochaine fois.

**Mise à jour** : après chaque batch de modules livré ou mergé dans
`main` (même rythme que le dashboard de statut) — pas seulement en fin
de projet. Le Product Owner demande un point sur ce fichier fréquemment ;
le traiter comme une priorité, pas comme un sous-produit optionnel.

**Statut au 27 septembre 2026** : 3 batches livrés (9 modules backend),
tous via pool d'agents parallèles en worktrees isolés. Ce document
reflète les frictions observées sur ces 3 batches.

---

## 1. Démarrage des agents

### 1.1 Un `.claude/agents/` fraîchement créé n'est pas reconnu sans redémarrage de session

**Ce qui s'est passé** : après avoir généré les 16 fichiers
`.claude/agents/*.md` depuis la feuille SYSTEM PROMPTS du classeur, les
premiers `Agent({ subagent_type: "dev-backend", ... })` échouaient avec
`Agent type 'dev-backend' not found`. Diagnostic confirmé via l'agent
`claude-code-guide` : Claude Code ne recharge la liste des subagents
disponibles qu'au démarrage d'une session — un répertoire d'agents créé
en cours de session reste invisible jusqu'au redémarrage.

**Impact** : une session complète perdue à essayer de dispatcher des
agents inexistants côté Claude Code, avant de comprendre qu'il fallait
interrompre volontairement et relancer (`claude --continue`).

**À faire différemment** : le skill doit annoncer explicitement, juste
après avoir écrit les fichiers `.claude/agents/*.md`, une étape
"redémarrage requis avant tout dispatch" — pas comme une note en bas de
page, comme une **étape numérotée du processus d'intake**, avec le
mécanisme de sauvegarde de contexte (voir §4) déclenché automatiquement
juste avant.

### 1.2 Les noms d'outils du classeur ACF ne sont pas les noms d'outils Claude Code

**Ce qui s'est passé** : la feuille AGENT CONFIG du classeur liste des
outils conceptuels (`read_yaml`, `write_code`, `run_tests`, `read_figma`,
`spawn_agent`...). Le premier jet des fichiers `.claude/agents/*.md`
copiait ces noms tels quels dans le champ `tools:` du frontmatter — un
champ que Claude Code lit réellement pour autoriser l'accès aux outils.
Résultat : aucun de ces noms ne correspond à un outil Claude Code réel
(`Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Agent`), donc les
agents générés auraient eu un accès aux outils incohérent ou nul.

**Impact** : bug silencieux — rien ne l'aurait signalé avant le premier
vrai dispatch d'un agent qui aurait eu besoin d'un outil absent. Détecté
et corrigé avant mise en production du pool, mais par relecture manuelle,
pas par un contrôle du skill.

**À faire différemment** : le skill doit produire **deux champs
distincts et documentés** dès la génération, jamais un seul :
- `tools:` — toujours une liste de vrais noms d'outils Claude Code,
  dérivée du rôle (ex. un rôle "lecture seule + rapport" → `[Read, Grep,
  Glob]`, un rôle "développeur" → `[Read, Write, Edit, Grep, Glob, Bash]`,
  un rôle "orchestrateur" → `[..., Agent]`).
- `acf_tools_conceptual:` — la liste brute du classeur, conservée pour
  traçabilité documentaire uniquement, jamais lue par Claude Code.
Ajouter une table de correspondance ACF→Claude Code dans le workbook
lui-même (nouvelle colonne ou onglet), pas seulement dans la mémoire de
l'orchestrateur d'un projet précédent.

---

## 2. Coordination entre agents parallèles

### 2.1 Un agent frais démarre sans AUCUN contexte du dépôt — le system prompt seul ne suffit jamais

**Ce qui s'est passé** : un agent dispatché via l'outil `Agent` (pas un
fork) démarre avec son system prompt générique du classeur (le "ton"
du rôle) et rien d'autre. Il ne connaît ni l'architecture en couches, ni
les conventions de sécurité, ni où se trouve le fichier à imiter pour un
nouveau module. Chaque dispatch a dû inclure un briefing complet
reconstruit à la main (sections de CLAUDE.md à lire, fichiers de
référence à imiter, numéro de migration imposé, permissions suggérées,
fichiers interdits...).

**Impact** : sans ce briefing, les tout premiers essais (avant qu'on ne
le systématise) auraient probablement produit du code incohérent avec
les conventions du dépôt, ou une réinvention de patterns déjà établis
(ex. `buildUpdateSet`, append-only, terminal-state).

**À faire différemment** : le workbook doit livrer un **gabarit de
briefing d'amorçage unique et réutilisable** (pas quelque chose que
l'orchestrateur reconstruit à chaque projet). Ce gabarit doit contenir,
en variables à remplir par projet :
1. Pointeurs vers les sections d'architecture à lire (jamais dupliquées
   dans le prompt).
2. La liste des fichiers "à haut risque de collision" (voir §2.2).
3. Le pattern "paramètre optionnel" pour étendre un service sans casser
   les tests existants.
4. La règle de numérotation séquentielle (migrations, etc.) — voir §2.3.
5. La tâche précise (ID(s) de backlog), jamais un domaine entier sans
   granularité.
6. L'obligation de vérification avant de rapporter fini (`typecheck` +
   `test`, ou l'équivalent du langage cible).
Ce gabarit existe déjà dans `CLAUDE.md` (section "Amorçage d'un agent
ACF") pour ce projet — mais il a été écrit **après** avoir buté sur le
problème, pas avant. Il doit être un artefact standard du skill dès la
génération initiale, pas quelque chose que l'orchestrateur découvre en
cours de route.

### 2.2 Fichiers partagés à haut risque : la collision est garantie sans isolation

**Ce qui s'est passé** : `server.ts` (câblage) et `permissions.ts`
(énumération des permissions) sont modifiés par quasiment chaque nouveau
module. Le premier batch (KPI/RiskAppetite/RatingScale) a géré ça par
convention ("n'y touchez pas, remontez les lignes exactes à
l'orchestrateur") — ça a fonctionné mais reposait sur une discipline
manuelle fragile. Les batches suivants ont utilisé `isolation: "worktree"`
pour chaque agent — bien plus sûr, aucune collision n'a eu lieu, et les
conflits de fusion sur `permissions.ts` (attendus, deux agents ajoutant
chacun leurs propres lignes) se résolvent trivialement à la fusion Git
plutôt que par relecture manuelle de code produit en parallèle dans le
même répertoire de travail.

**Impact réel évité de justesse** : sans worktree, deux agents éditant
`server.ts`/`permissions.ts` au même moment dans le même répertoire de
travail auraient pu se corrompre mutuellement (dernier écrivain gagne,
édition non atomique) — pas seulement un conflit de fusion propre.

**À faire différemment** : dès la conception du projet, **documenter la
liste des fichiers centraux à haut risque de collision** (équivalent de
`server.ts`/`permissions.ts` ici — tout fichier de câblage central,
toute énumération partagée) comme un livrable du skill, pas une
découverte en cours de projet. Et faire de `isolation: "worktree"` le
mode par défaut pour tout agent dont la tâche touche potentiellement un
de ces fichiers — pas une option à réserver aux cas où on a déjà eu peur
une fois.

### 2.3 Ressources à numérotation séquentielle : l'orchestrateur doit pré-assigner, jamais laisser chaque agent deviner

**Ce qui s'est passé** : chaque nouveau module a besoin d'un numéro de
migration SQL séquentiel. Avec des agents lancés en parallèle, laisser
chacun déterminer "le prochain numéro libre" indépendamment aurait pu
produire deux migrations avec le même numéro. Résolu en pré-assignant
explicitement un numéro par agent dans le prompt de dispatch (ex.
"utilise 019", "utilise 020", "utilise 021").

**À faire différemment** : généraliser cette règle à toute ressource à
séquence globale (numéros de migration, mais aussi tout identifiant
auto-incrémenté géré côté fichiers plutôt que côté base de données) :
**l'orchestrateur pré-assigne avant dispatch, jamais "vérifie le dernier
numéro" laissé à la charge de chaque agent parallèle.**

### 2.4 Ne jamais briefer un agent sur un travail qui n'est pas encore fusionné dans la branche dont il va partir

**Ce qui s'est passé** : un agent (UserManagement) a été briefé en lui
disant qu'un `User`/`UserRepository` existait déjà — vrai dans le
contexte de l'orchestrateur (construit plus tôt dans la session, sur une
branche non fusionnée), mais faux dans le worktree de l'agent, qui
partait de `main` (qui ne l'avait pas). L'agent a correctement détecté
l'écart et reconstruit sa propre version — sans dommage grâce à sa
rigueur, mais avec un travail dupliqué à réconcilier ensuite à la
fusion.

**À faire différemment** : avant de dire à un agent "X existe déjà, étends-le
plutôt que de le reconstruire", **vérifier que X est réellement présent
sur la branche depuis laquelle son worktree va partir** (typiquement
`main`), jamais se fier au contexte de conversation de l'orchestrateur
seul. Une simple vérification `git show <branche-cible>:<chemin>` avant
de rédiger le prompt aurait évité ça.

### 2.5 Dégradation explicite face à une dépendance pas encore fusionnée — le bon réflexe, à standardiser

**Ce qui a bien fonctionné** : quand un agent (Cartography) avait besoin
d'un champ qui n'existait pas encore dans sa branche (le filtre par
`ownerId`, construit en parallèle par un autre agent), la consigne
donnée était : accepter le paramètre pour compatibilité future, mais
répondre par une erreur de validation explicite plutôt que d'inventer un
comportement ou d'ignorer silencieusement le filtre. Documenté clairement
dans le résumé de l'agent, résolu proprement à l'intégration suivante.

**À faire différemment (dans le bon sens — à préserver)** : faire de
cette règle une instruction *standard*, écrite une fois dans le gabarit
de briefing (§2.1), et non une clause ad hoc réinventée à chaque prompt
qui s'y prête. Formulation à réutiliser : *"si une dépendance dont ta
tâche a besoin n'est pas encore présente dans ton checkout, n'invente
jamais une forme de repli silencieuse — implémente un rejet explicite et
signale-le clairement dans ton résumé."*

---

## 3. Conventions à figer avant le premier agent, pas après

Plusieurs conventions ont émergé par petites décisions successives de
l'orchestrateur (moi) au fil des batches, plutôt que d'être écrites une
fois dans le workbook/skill avant de commencer. Ce n'était pas
bloquant ici parce qu'un seul orchestrateur a suivi tout le projet et
gardait la cohérence en mémoire — mais ça ne passera pas à l'échelle sur
un projet plus long, ou si l'orchestration change de main.

- **Permissions terminales séparées des permissions génériques.** Toute
  transition vers un état terminal/archivé (désactiver, archiver,
  suspendre, clôturer) doit être gardée par sa propre permission
  (`x.delete`, `x.validate`, `x.reactivate`...), jamais par le
  `x.update` générique. Découvert/appliqué au fil de l'eau (KPI,
  RiskAppetite, RatingScale, RiskOwnership, ActionPlan...) — doit être
  une règle écrite dans le workbook dès le départ, pas une convention
  redécouverte à chaque nouveau module.
- **Convention de nommage des permissions.** `domaine.action` en
  minuscules, un domaine = un préfixe. Jamais formalisé nulle part avant
  ce retex — juste appliqué par cohérence visuelle avec l'existant.
- **Le pattern "paramètre optionnel constructeur".** LA technique
  utilisée pour faire évoluer un service existant sans casser les tests
  qui le construisent avec moins d'arguments. Documenté dans
  `CLAUDE.md`, mais seulement après avoir été appliqué plusieurs fois —
  devrait être présent dans le workbook comme un pattern nommé, au même
  titre que les 3 patterns d'écriture (append-only / in-place /
  ticket-lifecycle).

**À faire différemment** : le workbook doit inclure une section
"conventions transverses non négociables" (permissions terminales,
nommage des permissions, pattern paramètre optionnel, pattern de
dégradation explicite du §2.5) comme point de départ de tout nouveau
projet — pas comme un chapitre qu'on écrit après coup une fois qu'on a
souffert.

---

## 4. Reprise après incident (rate limit, erreur API)

**Ce qui s'est passé** : les 3 agents d'un batch ont tous échoué
simultanément avec une erreur `rate_limit` (limite de session du compte,
pas liée au projet). La bonne réaction — reprendre chaque agent via
`SendMessage` vers son `agentId` une fois la limite réinitialisée,
plutôt que de relancer un agent tout neuf — a permis de ne perdre aucun
travail d'investigation déjà fait (lecture de fichiers, compréhension du
code existant) : chaque agent a repris exactement où il s'était arrêté.

**À faire différemment (bon réflexe à documenter, pas une erreur)** :
consigner cette procédure dans le workbook/skill comme le comportement
par défaut face à un échec d'agent en cours de tâche : **vérifier
l'heure de réinitialisation annoncée par l'erreur, attendre, puis
reprendre (`SendMessage` vers l'`agentId`), jamais relancer un agent
frais qui perdrait tout son contexte accumulé.**

---

## 5. Intégration post-fusion : travail mécanique à templatiser

**Ce qui s'est passé** : à chaque batch, la même séquence d'intégration
manuelle a été rejouée : fusionner chaque branche d'agent une par une,
résoudre le conflit attendu sur `permissions.ts` (toujours à la même
forme : deux blocs de nouvelles lignes en fin d'union de types et de
tableau), câbler `server.ts` (import × N, instanciation de repository ×
N, instanciation de service × N, montage de route × N), lancer
`typecheck` + `test`, appliquer les migrations, tester en fumée les
nouveaux endpoints (401 sans jeton), committer, pousser, ouvrir la PR.

**Impact** : fonctionne bien avec un seul orchestrateur qui garde le
pattern en tête, mais c'est un travail 100% mécanique reconstruit à
l'identique à chaque fois, sans checklist écrite — source d'oubli si
l'orchestration change de main ou si le rythme s'accélère.

**À faire différemment** : le workbook/skill doit fournir une
**checklist d'intégration post-batch** explicite (les 8 étapes
ci-dessus, dans l'ordre), que l'orchestrateur suit plutôt que reconstruit
de mémoire. Elle doit aussi rappeler la contrainte d'environnement
suivante (§6).

---

## 6. Contraintes d'environnement à anticiper dès la conception du projet

**Ce qui s'est passé** : ce dépôt bloque le push direct sur `main`
(garde-fou trunk-based development) et le classificateur de permissions
Claude Code bloque parfois la fusion de PR sans confirmation humaine
explicite — découvert en cours de route, pas anticipé.

**À faire différemment** : dès la conception d'un nouveau projet avec ce
skill, **partir du principe qu'aucun commit direct sur la branche
principale n'est possible** — toujours prévoir le flux
branche-de-fonctionnalité + Pull Request, et prévoir explicitement dans
le plan de travail qui (l'orchestrateur ou l'utilisateur) merge les PR,
plutôt que de le découvrir au premier `git push` refusé.

---

## 7. Synthèse — ce qui doit changer dans le workbook/skill avant le prochain projet

| # | Changement à apporter | Où |
|---|---|---|
| 1 | Étape numérotée "redémarrage de session requis" juste après génération de `.claude/agents/*.md` | Processus d'intake (skill) |
| 2 | Colonne/onglet de correspondance ACF→Claude Code pour le champ `tools:` | Classeur ACF |
| 3 | Gabarit de briefing d'amorçage réutilisable (pointeurs archi, fichiers à risque, pattern paramètre optionnel, numérotation pré-assignée, dégradation explicite) | Skill, livré comme artefact dès l'intake |
| 4 | Liste des "fichiers centraux à haut risque" comme livrable explicite du skill | Processus d'intake |
| 5 | `isolation: "worktree"` par défaut pour tout agent touchant un fichier central | Skill / doc d'orchestration |
| 6 | Règle : ne jamais pré-assigner une ressource séquentielle sans vérifier l'état réel de la branche cible | Doc d'orchestration |
| 7 | Règle : vérifier `git show <branche>:<fichier>` avant de briefer "X existe déjà" | Doc d'orchestration |
| 8 | Section "conventions transverses non négociables" (permissions terminales, nommage, pattern optionnel, dégradation explicite) | Workbook, dès le départ |
| 9 | Procédure de reprise après rate-limit/erreur API (reprendre, ne jamais relancer) | Doc d'orchestration |
| 10 | Checklist d'intégration post-batch (8 étapes) | Skill |
| 11 | Hypothèse par défaut "pas de commit direct sur main, toujours PR" dans la planification | Doc d'orchestration |

---

*Document vivant — mis à jour après chaque batch de modules livré ou
fusionné dans `main`. Ne pas archiver en fin de projet : c'est
l'intrant direct de la prochaine révision du workbook ACF et du skill
`agentic-factory-intake`.*
