# RM V1 — Étape 2 : projet de report des décisions dans le contrat

**Statut : PROJET, en attente de validation du PO.** Le contrat `.claude/agent-context/RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` n'est pas modifié.
Auteur : Risk Manager (A13), 2026-10-11. Tâche R1.1 de `docs/ROADMAP-V1.md`, étape 2 de `docs/architecture/RM-V1-Sequence-actions.md`.
Décisions reportées : DECISION-016 à 020, plus les décisions suivantes qui touchent le contrat (021, 025, 026, 027, 029, 030).
Distinction utilisée : **[PO]** = décidé par le PO, repris tel quel. **[Rédaction]** = conséquence directe d'une décision, formulée par moi. **[À CONFIRMER]** = je ne peux pas le trancher : voir la dernière section.

---

## Ce qui change pour l'utilisateur (à lire seul)

1. **Le Dispositif devient plus complet.** À sa création, on choisit la taille de l'échelle (3, 4, 5 ou 6), les axes d'impact (7 au maximum) et on écrit le descriptif de chaque niveau, pour la probabilité et pour chaque axe. La probabilité et tous les axes ont la même taille d'échelle. L'impact retenu reste le maximum des axes.
2. **L'appétence et les grilles de cotation passent dans le Dispositif.** Elles suivent les mêmes règles de version et d'approbation que les autres paramètres. On peut activer un Dispositif par défaut, et la création se fait par un assistant pas à pas (une saisie directe reste possible pour les experts).
3. **L'« équipe risque » est un groupe précis** : le groupe Risk Manager, qui ne peut jamais être vide. Deux autres groupes fixes existent (Risk Committee et Audit) et peuvent être vides. Les départements sont aussi des groupes.
4. **Qui approuve un changement du Dispositif se choisit** : Audit ou Comité. Un groupe vide ne peut pas être choisi, et on ne peut pas vider un groupe déjà choisi.
5. **Se désigner soi-même reste interdit, sauf si le Dispositif l'autorise.** Ce réglage est désactivé par défaut. Seul le Comité peut l'activer. Même activé, un autre membre du groupe Risk Manager doit approuver.
6. **Un membre de l'équipe risque ne revoit pas un risque dont il est Risk Owner, Délégué ou Exécuteur.** Un autre membre s'en charge. S'il n'y en a pas, la revue passe à Audit ou au Comité. Sur les autres risques, il travaille normalement.
7. **Le Risk Owner enregistre lui-même la décision de traitement.** Il n'y a plus de « proposeur ». L'équipe risque peut seulement joindre une recommandation qui ne lie personne.
8. **« Retourné » et « Rejeté » deviennent deux états différents.** Retourné : on demande ou on apporte une précision. Rejeté : la saisie n'est pas applicable ou n'est pas bonne.
9. **Le Comité peut voter à distance, avec une règle au choix** : Léger, Standard, Strict, ou une règle personnalisée. Certaines règles ne bougent jamais : pas de validation par silence, jamais un seul membre, ceux qui sont concernés ne votent pas.
10. **Le Risk Owner statue sur chaque contribution** (retenue, écartée avec motif, ou sans suite). L'import d'un registre ne contourne jamais la revue. Si l'audit ne peut pas être écrit, l'action est bloquée. Le temps réel (WebSocket) passe en V2.

---

## Plan du document

| Partie | Section du contrat | Décisions sources |
|---|---|---|
| 1 | En-tête | 016 à 020, 026 |
| 2 | §4 Identification et Analyse | 016, 019 |
| 3 | §5 Évaluation | 016, 017, 019, 027, 029 |
| 4 | §6 Axes d'impact | 016 |
| 5 | §7 Modes et contributions | 025 (q04) |
| 6 | §8 Appétence et Treatment Decision | 016, 017, 026 |
| 7 | §10 Dispositif | 016, 017, 018, 019, 025, 026 |
| 8 | §13 UX validée | 017, 030 |
| 9 | §14 et §17 (temps réel) | 020 |
| 10 | Décisions examinées sans effet sur le contrat | — |
| 11 | Points que le texte ne peut pas trancher seul | — |

Les textes « actuels » sont cités mot pour mot. Quand un paragraphe est long, je cite seulement la phrase concernée.

---

## 1. En-tête du contrat

**Texte actuel** (ligne 7)
> **Amendement du 2026-10-08** (DECISION-014 et DECISION-015, `.claude/agent-context/ACTION_ITEMS.md`) : modes de cotation, rôles Risk Owner / Délégué / Exécuteur, paramètres du Dispositif. Paragraphes touchés : §4, §5, §7, §8, §10, §16, §17 (Phase 4). […]

**Texte proposé** (ajout d'un second paragraphe)
> **Amendement du [date de validation]** (étape 2, DECISION-016 à 020, 025, 026, 027, 029 et 030) : échelle, axes et descriptifs dans le Dispositif ; groupes ; approbateur configurable ; auto-proposition de désignation ; Comité asynchrone ; état « Rejeté » ; statuts des contributions ; temps réel reporté en V2. Paragraphes touchés : §4, §5, §6, §7, §8, §10, §13, §14, §17.

**Source** : [Rédaction], pour la traçabilité.

---

## 2. §4 Identification et Analyse

**Texte actuel**
> […] Il est désigné au niveau du **Processus**, avec un **Délégué** quand l'effectif du département le permet ; les risques du Processus en héritent. Une surcharge sur un risque donné remplace toujours la paire Risk Owner + Délégué ensemble. La désignation est faite par la direction du département, approuvée par l'équipe risque et tracée (auteur, motif, valeur précédente, approbateur).

**Texte proposé** (la dernière phrase est remplacée et une phrase s'ajoute)
> La désignation est proposée par la direction du département, approuvée par l'équipe risque (groupe Risk Manager) et tracée (auteur, motif, valeur précédente, approbateur). Chaque Processus est rattaché à un département. La « direction du département » désigne les membres du groupe de ce département.

**Décision source** : DECISION-016 (Q10, les départements sont des groupes) et DECISION-019 (P4, accord avec le modèle de l'Architecte : le Processus est rattaché à un département, un groupe est le groupe d'un département). **[PO]** pour le principe, **[Rédaction]** pour la formulation.

Note : le détail technique (colonnes, tables) n'a pas sa place dans le contrat. Il reste dans les lots B-5 et B-8.

---

## 3. §5 Évaluation

### 3.1 Définition de l'équipe risque (ajout après le deuxième paragraphe)

**Texte actuel** (extrait)
> La saisie de l'Inhérent, de la Maîtrise et du Résiduel est attribuée selon le mode effectif de l'évaluation (§7). L'équipe risque saisit le Résiduel dans tous les modes.

**Texte proposé** (nouveau paragraphe qui suit)
> **Groupes.** L'« équipe risque » est le groupe fixe **Risk Manager**. Il ne peut jamais être vide : on ne peut pas retirer son dernier membre. Deux autres groupes fixes existent, **Risk Committee** et **Audit** ; ils peuvent être vides. Les départements sont aussi des groupes. Un membre du groupe Risk Manager peut agir sur tout risque du tenant, selon les permissions de chaque étape.

**Source** : DECISION-016 (Q10). **[PO]**

### 3.2 Conflit de rôles d'un membre de l'équipe risque (nouveau paragraphe)

**Texte proposé**
> **Conflit de rôles.** Un membre du groupe Risk Manager qui est Risk Owner, Délégué ou Exécuteur d'un risque ne saisit ni ne revoit ce risque. Un autre membre du groupe le fait. S'il n'y en a pas, la revue passe au groupe Audit ou au Comité. Sur les autres risques, ce membre agit normalement. Le cumul est marqué visiblement (invariant 6).

**Source** : DECISION-019 (P5). **[PO]** La phrase « Audit ou Comité » n'est pas précise : voir question 8.

### 3.3 Revue de l'Inhérent : Retourné et Rejeté sont deux états

**Texte actuel**
> […] un membre de l'équipe risque, différent de l'auteur, le **retient**, ou le **retourne / rejette avec une annotation obligatoire** ; un Inhérent retourné revient à la 1re ligne pour une nouvelle saisie. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Texte proposé**
> […] un membre de l'équipe risque, différent de l'auteur, le **retient**, le **retourne** ou le **rejette**. Une annotation est obligatoire pour un retour et pour un rejet. **Retourné** : on demande ou on apporte une précision. **Rejeté** : la saisie n'est pas applicable ou n'est pas bonne. Un Inhérent retourné revient à la 1re ligne pour une nouvelle saisie. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Source** : DECISION-017, point 3. **[PO]** pour la distinction. Ce que devient une saisie rejetée n'est pas dit : voir question 5.

### 3.4 Reprise d'un registre existant (nouveau paragraphe en fin de §5)

**Texte proposé**
> **Reprise d'un registre (import).** À l'import, le client relie lui-même les colonnes de son fichier aux objets du Dispositif ; aucun rapprochement n'est implicite. Les objets importés (risques, processus, contrôles) arrivent en brouillon et sont activés par l'équipe risque. Les cotations du fichier deviennent des **propositions de cotation** quand la matrice probabilité × impact du fichier est la même que celle du Dispositif ; sinon elles restent en historique « reprise ». Une proposition suit le parcours normal (revue, validation par un tiers) : **l'import ne contourne jamais la revue ni la validation.** En V1, le fichier est un .xlsx (le lien direct vers un tableur en ligne est prévu en V1.1).

**Source** : DECISION-027 (q14, q15, q16) et DECISION-029 (q17). **[PO]** Qui est « l'auteur » d'une proposition importée : voir question 12.

---

## 4. §6 Axes d'impact

**Texte actuel**
> Le nombre d'axes d'impact **n'est pas fixe**. Il est déterminé par la Rating Scale active.
> `Impact retenu = MAX(valeur de tous les axes configurés)`
> Le frontend doit donc itérer dynamiquement sur les axes retournés par le backend.
> **Aucun code ne doit supposer 7 axes.**

**Texte proposé**
> Les axes d'impact (financier, réglementaire, opérationnel, etc.) et l'échelle sont choisis **à la création du Dispositif**. L'échelle a une taille de **3, 4, 5 ou 6** niveaux. La **probabilité et chaque axe d'impact ont la même taille d'échelle** (exemple : échelle de 4, probabilité sur 4 et chaque axe sur 4). Il y a **7 axes au maximum** ; ce chiffre est un plafond, jamais un nombre à supposer.
> **Chaque niveau porte son propre descriptif**, pour la probabilité et pour chaque axe (exemple : échelle de 5, donc 5 descriptifs pour la probabilité et 5 par axe). Les descriptifs sont saisis à la création du Dispositif.
> Le nombre d'axes reste déterminé par l'échelle du Dispositif applicable, jamais par le code.
> `Impact retenu = MAX(valeur de tous les axes configurés)` (inchangé)
> Le frontend itère dynamiquement sur les axes retournés par le backend. **Aucun code ne doit supposer 7 axes** (inchangé). Un changement d'échelle, d'axe ou de descriptif crée une nouvelle version du Dispositif et ne touche que les cycles à venir (invariant 9).

**Décision source** : DECISION-016 (Q11 et complément du PO). **[PO]** pour le contenu. La dernière phrase est **[Rédaction]** : elle découle du versionnement du §10 et de l'invariant 9. « Corrélée » veut dire « même taille d'échelle », pas une grille croisée (retenu par le PO).

Effet de bord à confirmer : une échelle qui change de taille d'une version à l'autre rend la Cartographie plus difficile à comparer (question 11).

---

## 5. §7 Modes et contributions

**Texte actuel** (extrait)
> - types : Identification ; Analyse ; Inherent ; Maîtrise ;

**Texte proposé** (nouveau paragraphe après la liste des types)
> **Statut d'une contribution.** Le Risk Owner statue sur chaque contribution : **Retenue**, **Écartée** (motif obligatoire) ou **Sans suite**. Le Délégué peut statuer si le Dispositif le prévoit ; l'auteur de la contribution ne statue jamais sur la sienne. Chaque décision est conservée en historique (append-only). Cette règle est configurable dans le Dispositif. « Retenue » qualifie l'information reçue, jamais la cotation (Contribution ≠ Saisie).

**Décision source** : DECISION-025, q04 (OD-4). **[PO]** pour les trois statuts, le Délégué, l'historique et « configurable ». La dernière phrase est **[Rédaction]**, tirée du principe déjà au contrat (« une contribution apporte de l'information et ne cote jamais »). Le sens de « Sans suite » et ce qui est « configurable » : voir question 6.

---

## 6. §8 Appétence et Treatment Decision

### 6.1 Qui enregistre la décision

**Texte actuel**
> Un dépassement peut déclencher une Treatment Decision, rattachée à l'évaluation qui l'a déclenchée. Le Risk Owner décide de la Treatment Decision (qui la propose reste à trancher).

**Texte proposé**
> Un dépassement peut déclencher une Treatment Decision, rattachée à l'évaluation qui l'a déclenchée. **Le Risk Owner enregistre la Treatment Decision** ; le Délégué le fait quand le §5 l'autorise (absence ou délégation datée). **Il n'y a pas de proposeur distinct.** L'équipe risque peut joindre une **recommandation non contraignante**. La Treatment Decision est ensuite validée par un tiers, selon le §5.

**Décision source** : DECISION-016 (Q9). **[PO]** La mention « validée par un tiers selon le §5 » est **[Rédaction]** : elle applique la règle générale « on ne valide jamais ce qu'on a saisi ».

### 6.2 Comité asynchrone (nouveau paragraphe, après « Deux seuils de Comité sont indépendants »)

**Texte proposé**
> **Vote du Comité à distance.** Le Comité peut valider par vote asynchrone, sans séance. Le Dispositif propose des **règles prédéfinies** (A Léger, B Standard, C Strict) et permet de créer une **règle personnalisée** : groupes qui valident, quorum, majorité, délai, relances. Aucune règle n'est imposée par défaut.
> **Règles fixes, qu'aucune règle ne peut changer :**
> - jamais de validation tacite : le silence n'est pas un accord, une échéance déclenche une escalade ;
> - jamais un seul membre ;
> - les auteurs et le Risk Owner, le Délégué et l'Exécuteur concernés ne votent pas ;
> - chaque vote est motivé et tracé (append-only) ;
> - un groupe vide ne peut pas être sollicité (l'envoi est refusé).

**Décision source** : DECISION-026 (q05, B-12), complétée par DECISION-017 point 4 (règle de clôture et échéance configurables). **[PO]** Je n'ai pas recopié le détail des règles A, B et C : il figure dans la question q05 de la page de pilotage, qui n'est pas dans le dépôt. Il faut l'annexer au contrat au moment de la validation (question 7).

---

## 7. §10 Dispositif

### 7.1 Définition : le Dispositif n'est plus « distinct de l'Appétence »

**Texte actuel**
> Il est distinct du Risque, du Processus, de l'Évaluation, de l'Appétence, du Meeting et de Risk 360.

**Texte proposé**
> Il est distinct du Risque, du Processus, de l'Évaluation, du Meeting et de Risk 360. Il **porte** l'échelle, les grilles de cotation et l'appétence : ce sont des paramètres du Dispositif, versionnés avec lui.

**Source** : DECISION-017, point 5 (« tout passe dans le Dispositif »). **[PO]** La phrase actuelle se contredit avec cette décision, il faut donc la corriger. Voir question 10.

### 7.2 Création : assistant et Dispositifs par défaut (ajout aux règles validées)

**Texte proposé**
> - La création d'un Dispositif se fait par un **assistant pas à pas**, activé par défaut. Une configuration directe reste possible pour les utilisateurs experts.
> - L'organisation peut **activer un Dispositif par défaut** fourni avec l'outil. Un Dispositif par défaut respecte les invariants comme tous les autres.

**Source** : DECISION-017, points 1 et 5. **[PO]** Le contenu des Dispositifs par défaut (Prudent, Standard, Léger) est le lot B-13, rédigé à part. Comment on active le tout premier Dispositif : voir question 3.

### 7.3 Table des paramètres

Lignes modifiées ou ajoutées. Les autres lignes ne changent pas.

| Ligne | Texte actuel | Texte proposé | Source |
|---|---|---|---|
| Mode par défaut | Mode par défaut (tenant, puis Processus — DECISION-006) : Classique | Mode par défaut **porté par le Dispositif**, puis Processus (DECISION-006) : Classique. `Config.evaluationMode` devient obsolète. | DECISION-018 P1 [PO] |
| Seuil de criticité « faible » | Inscrit à la création du Dispositif | **Configurable** par le groupe Risk Manager ; tout changement est tracé et approuvé (7.5) | DECISION-016 [PO] |
| Approbateur d'un changement de paramètre de séparation des tâches | Comité | **Configurable : Audit ou Comité** (Comité par défaut) ; un groupe vide ne peut pas être choisi | DECISION-016, DECISION-018 P6 [PO] ; « Comité par défaut » = [À CONFIRMER] (question 1) |
| Échelles, descriptions de probabilité, appétence, seuils Comité | Déjà paramétrables | Remplacée par les cinq lignes ci-dessous | DECISION-016, DECISION-017 |
| Échelle et axes | (nouvelle) | Taille 3, 4, 5 ou 6 ; 7 axes au maximum ; fixés à la création (§6) | DECISION-016 [PO] |
| Descriptifs des niveaux | (nouvelle) | Un descriptif par niveau, pour la probabilité et pour chaque axe, saisi à la création | DECISION-016 [PO] |
| Appétence et grilles de cotation | (nouvelle) | Paramètres du Dispositif | DECISION-017 point 5 [PO] |
| Seuils de passage Comité (§8) | (nouvelle) | Paramètres du Dispositif, figés dans l'instantané de chaque évaluation | [À CONFIRMER] (question 10) |
| Règle du Comité asynchrone | (nouvelle) | Règle prédéfinie (A, B, C) ou personnalisée (§8) | DECISION-026 [PO] |
| Auto-proposition de désignation | (nouvelle) | **Désactivée par défaut.** Seul le Comité l'active (invariant 5) | DECISION-019 P3 [PO] |

### 7.4 Invariant 5 réécrit

**Texte actuel**
> 5. Toute désignation (Risk Owner, Délégué, Exécuteur) et tout changement de paramètre sont tracés (auteur, motif, valeur précédente, approbateur), approuvés par un tiers, jamais auto-attribués ni auto-approuvés.

**Texte proposé**
> 5. Toute désignation (Risk Owner, Délégué, Exécuteur) et tout changement de paramètre sont tracés (auteur, motif, valeur précédente, approbateur) et approuvés par un tiers. **Rien n'est jamais auto-approuvé.** Une **auto-proposition** (se désigner soi-même) n'est permise que si le Dispositif l'autorise. Ce paramètre est désactivé par défaut et son activation est décidée par le Comité. Quand il est activé : un **autre membre du groupe Risk Manager** approuve, avec motif et audit, et le cumul est marqué. S'il n'y a aucun autre approbateur, la demande est refusée.

**Décision source** : DECISION-018 (P3 : l'interdiction doit rester configurable) et DECISION-019 (P3 : réécriture proposée par l'Architecte, acceptée). **[PO]** La réécriture règle la tension avec l'invariant 8 : c'est l'invariant lui-même qui prévoit le paramètre, donc rien n'est abaissé. En attendant le paramètre, le refus strict de l'auto-désignation (lot B-0) reste le comportement. Voir question 9.

### 7.5 Invariant 7 : audit en échec (ajout)

**Texte actuel**
> 7. Les champs d'attribution sont forcés côté serveur ; l'audit est append-only ; l'historique d'une évaluation n'est jamais réécrit.

**Texte proposé** (une phrase s'ajoute)
> […] **Si l'écriture de l'audit échoue, l'action est bloquée** (l'action et son audit sont dans la même transaction) ; une consultation confidentielle sans trace est refusée ; l'équipe risque et le support sont alertés.

**Source** : DECISION-025, q12. **[PO]**

### 7.6 Nouvel invariant 10 : règles fixes du Comité (proposition)

**Texte proposé**
> 10. Quelle que soit la règle de Comité choisie (prédéfinie ou personnalisée) : jamais de validation tacite, jamais un seul membre, auteurs et Risk Owner / Délégué / Exécuteur exclus du vote, vote motivé et tracé, escalade à l'échéance, groupe vide refusé.

**Source** : DECISION-026 (« les règles fixes restent non configurables »). **[Rédaction]** : je propose de la placer parmi les invariants pour que l'invariant 8 la protège. Si le PO préfère la garder dans le §8 (6.2), on supprime cette ligne. Constat de code : `validateByCommittee` valide aujourd'hui sur l'appel d'un seul membre (F-14).

### 7.7 Gouvernance d'un changement de paramètre

**Texte actuel**
> […] l'administrateur du Dispositif (`riskframework.update`) le demande, avec un motif écrit ; le responsable de la fonction risque, différent du demandeur, l'approuve, ou le Comité pour les paramètres de séparation des tâches. Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Le Comité n'étant pas disponible à tout moment, la version reste en `DRAFT` jusqu'à sa séance ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. L'audit conserve l'ancienne et la nouvelle valeur.

**Texte proposé**
> […] Les possibilités de configuration sont détenues par la fonction risque (groupe Risk Manager) et tracées. Un membre du groupe demande le changement, avec un motif écrit. L'**approbateur configuré** (Audit ou Comité), différent du demandeur, l'approuve. Un groupe vide ne peut pas être choisi comme approbateur, et on ne peut pas vider un groupe déjà choisi. Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Tant que l'approbateur n'a pas décidé, la version reste en `DRAFT` ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. Quand l'approbateur est le Comité, il décide en séance ou par vote asynchrone selon sa règle (§8). L'audit conserve l'ancienne et la nouvelle valeur.

**Décision source** : DECISION-016 (configuration tenue par le groupe Risk Manager, approbateur configurable), DECISION-018 (P6, groupe vide ; avis du Risk Manager : bloquer aussi le vidage d'un groupe déjà choisi), DECISION-017 point 4 et DECISION-026 (Comité à distance). **[PO]** sauf le vidage d'un groupe choisi et la référence au vote à distance : **[Rédaction]**.
Ce texte pose trois questions : le périmètre de l'approbateur (question 1), la règle de décision d'Audit (question 2), et la première activation (question 3).

### 7.8 Le reste de la ligne « Validateur » et « Désignation des rôles »

Ces deux lignes ne changent pas dans leur sens. Le terme « responsable de la fonction risque » reste utilisé. Il n'a pas de définition dans les groupes : voir question 4.

---

## 8. §13 UX validée

**Texte actuel** (extrait)
> Le Dispositif peut être présenté comme **Référentiel méthodologique** dans l'UX. Dans l'évaluation, il apparaît comme contexte en lecture seule et ne devient pas une étape de cotation.

**Texte proposé** (trois puces s'ajoutent à la liste de la section)
> - création du Dispositif par un assistant pas à pas, configuration directe pour les experts ;
> - notifications dans l'application et par e-mail ;
> - accessibilité : WCAG 2.1 AA est le critère de sortie de chaque composant (tests automatiques et passe visuelle pour les contrastes).

**Source** : DECISION-017 (points 1 et 2) et DECISION-030 (q20). **[PO]** La phrase actuelle sur le Référentiel méthodologique est conservée.

---

## 9. §14 WebSocket-ready et §17 Phase 6

**Texte actuel (§14)**
> Le frontend doit être préparé pour le temps réel sans implémenter le WebSocket dans le premier lot.

**Texte proposé (§14, ajout en tête)**
> La V1 est livrée **WebSocket-ready** : abstraction `RealtimeClient`, REST autoritaire, stratégie de resynchronisation, événements métier nommés et versionnés. **Le serveur WebSocket, le contrat événementiel complet et les tests temps réel font partie de la V2**, avec les retours futurs du client.

**Texte actuel (§17)** : « ### Phase 6 — Temps réel » (étapes 19 à 23).
**Texte proposé** : « ### Phase 6 — Temps réel (**reportée en V2**, DECISION-020). En V1, seule la préparation du §14 est livrée. » Les étapes 19 à 23 restent listées pour la V2. Dans la Phase 7, la QA realtime (étape 28) vérifie seulement que la V1 est WebSocket-ready.

**Source** : DECISION-020. **[PO]**

---

## 10. Décisions examinées sans effet sur le contrat

Elles ne touchent pas le périmètre Risk Management du contrat. Elles restent dans le Decision Log.

- DECISION-018 (EVD §33) et DECISION-019 (stockage Drive, import Excel) et DECISION-020 (données personnelles, clé de rapprochement) : module Évidences, cadré dans `EVD-Import-Excel-cadrage.md`.
- DECISION-021 : périmètre V1 (étape 18, B-4, piste EVD), masquage, R0 : plan de livraison, déjà couvert par le §17. OD-4 est repris au §7 ci-dessus.
- DECISION-022, 023, 024 : infrastructure, e-mail, secrets, coût du MVP.
- DECISION-025 hors q04 et q12 : R0, fenêtre de refus (q02), protections de la base, antivirus (module Évidences), organisation de l'Administration.
- DECISION-028 : méthode de revue des maquettes Penpot.
- DECISION-029 q18 et q19 : migration 047 et clé Drive.
- DECISION-030 q21 : réglages de charte, ailleurs que dans le contrat.

Une remarque sur DECISION-011 (fenêtre de refus) : elle n'apparaît pas dans le contrat actuel, et je ne propose pas de l'y ajouter ici.

---

## 11. Points que le texte ne peut pas trancher seul

Je n'ai inventé aucune règle. Chaque point est un vrai trou ou une vraie contradiction entre les décisions, avec ma recommandation. Le PO tranche.

**1. L'approbateur configurable couvre-t-il tous les changements, ou seulement ceux de séparation des tâches ?**
DECISION-016 dit « l'approbateur d'un changement est lui-même configurable : Audit ou Comité ». Le contrat actuel distingue deux cas : le responsable de la fonction risque pour les paramètres courants, le Comité pour la séparation des tâches. Le texte 7.7 fait une seule règle pour tout.
*Recommandation* : une seule règle, l'approbateur configuré pour tous les changements de paramètres. C'est plus simple, et c'est le seul moyen d'éviter que la fonction risque se serve elle-même (elle demande, donc elle ne doit pas approuver). Le coût est un délai plus long. Le vote à distance du Comité le réduit. Le défaut « Comité » reprend le contrat actuel.

**2. Quand l'approbateur est Audit, qui décide dans le groupe ?**
La règle « jamais un seul membre » est écrite pour le Comité. Rien n'est écrit pour Audit. Deuxième sujet : Audit est la 3e ligne, qui doit pouvoir contrôler ensuite ce qu'elle a approuvé (mandat §43 : on n'approuve pas puis on n'audite pas sa propre décision).
*Recommandation* : appliquer à Audit les mêmes règles de vote que celles du Comité (quorum, jamais un seul membre). Garder « Comité » comme défaut. Si le PO choisit Audit, l'indiquer clairement dans l'écran de création, et ajouter un KRI sur la part des changements approuvés par Audit.

**3. Comment s'active le tout premier Dispositif (et un Dispositif par défaut) ?**
Les groupes Audit et Risk Committee peuvent être vides, et un groupe vide ne peut pas être approbateur. Au démarrage, il peut donc n'y avoir personne pour approuver la première activation. La question est la même pour l'activation d'un Dispositif par défaut : est-ce un « changement de paramètre » ?
*Recommandation* : pour la première activation seulement, une personne désignée par le client (administrateur du tenant), différente du demandeur, approuve avec motif et audit. Les changements suivants suivent la règle normale. L'activation refuse de se faire tant qu'aucun approbateur n'est possible, sauf cette exception.

**4. Qui est « le responsable de la fonction risque » ?**
Le contrat s'en sert comme validateur par défaut et pour l'approbation des désignations. Mais le groupe Risk Manager est un groupe de membres sans « responsable ».
*Recommandation* : ajouter dans le Dispositif la désignation d'un responsable parmi les membres du groupe Risk Manager. Il est soumis aux mêmes règles : jamais validateur de ce qu'il a saisi.

**5. Que devient une saisie « Rejetée » ?**
DECISION-017 distingue Retourné de Rejeté mais ne dit pas l'effet d'un rejet. Une saisie « pas bonne » doit-elle revenir à la 1re ligne comme un retour, ou rester en historique et faire basculer l'évaluation vers la saisie de l'équipe risque ? Aussi : un rejet motivé du Comité ouvre-t-il « Retourné » (ma proposition de défauts) ou « Rejeté » ?
*Recommandation* : un rejet de l'Inhérent est conservé en historique et la 1re ligne ressaisit, comme pour un retour. La différence est la trace (la saisie rejetée n'est jamais reprise sans nouvelle saisie) et un compteur pour un KRI. Un rejet du Comité ouvre « Rejeté » ; une demande de précision ouvre « Retourné ».

**6. « Sans suite » et « configurable » pour les contributions.**
q04 donne trois statuts (Retenue, Écartée avec motif, Sans suite) mais ne définit pas « Sans suite » : est-ce un classement sans motif ? Aussi, « Délégué désignable par le Dispositif » semble plus large que le §5, qui limite le Délégué à l'absence du Risk Owner ou à une délégation datée. Enfin on ne sait pas ce qui est « configurable ».
*Recommandation* : « Sans suite » = contribution reçue mais non traitée dans le cycle (hors sujet ou arrivée après la fin du brouillon), avec un commentaire court mais obligatoire, pour éviter l'écartement sans trace. Le Délégué statue dans les mêmes limites que le §5 sauf si le Dispositif lui donne cette tâche de façon permanente (paramètre, désactivé par défaut). Le paramètre configurable est donc « qui statue ».

**7. Détails du Comité asynchrone.**
(a) Les règles A, B et C sont décrites dans q05 de la page de pilotage, absente du dépôt : je n'ai pas pu les citer sans risque d'erreur. (b) Trois questions de DECISION-017 point 4 restent sans réponse écrite : quorum de 2 pour les petites structures ; le responsable de la fonction risque peut-il être membre du Comité ; retrait d'un vote déjà donné. (c) Si tous les membres éligibles sont exclus du vote (ils sont Risk Owner, Délégué ou Exécuteur du risque), que se passe-t-il ?
*Recommandation* : (a) annexer les règles A, B et C au contrat à la validation. (b) Quorum de 2 autorisé seulement par une règle personnalisée, avec marquage visible ; le responsable de la fonction risque ne vote pas dans le Comité sur ce qu'il a saisi, sinon il peut en être membre ; pas de retrait de vote après clôture, retrait possible tant que le vote n'est pas clos, avec trace. (c) Escalade à Audit, jamais de validation tacite.

**8. P5 : « le groupe Audit ou le Comité », lequel ?**
Quand aucun autre membre de l'équipe risque n'est disponible, DECISION-019 renvoie à « Audit ou Comité » sans dire comment choisir.
*Recommandation* : utiliser l'approbateur configuré au Dispositif (question 1), donc un seul choix à faire. Ce même cas devrait déclencher une alerte à l'équipe risque : c'est un signe de sous-effectif.

**9. Auto-proposition : qui active, le Comité seul ou l'approbateur configuré ?**
DECISION-019 dit « activé par le Comité ». DECISION-016 rend l'approbateur configurable. Si Audit est approbateur, activer l'auto-proposition par Audit assouplit un invariant avec un organe moins collectif. En outre, la séquence d'actions avait recommandé « strictement interdite » (P3) avant que le PO ne demande la configuration.
*Recommandation* : garder « Comité seul » pour ce paramètre, comme dit DECISION-019. Le Comité ne peut pas être vide pour l'activer (règle du groupe vide).

**10. Appétence dans le Dispositif : trois effets à confirmer.**
(a) Les seuils de Comité (§8) deviennent-ils aussi des paramètres du Dispositif ? DECISION-017 point 5 ne cite que l'appétence et les grilles, mais F-8 (seuils figés à la création) l'exige. (b) Le module d'appétence existant se modifie aujourd'hui directement (`riskappetite.update`) : doit-il passer par une nouvelle version du Dispositif ? (c) Le contrat actuel dit que le Dispositif est « distinct de l'Appétence » : le texte 7.1 le corrige.
*Recommandation* : (a) oui, versionnés avec le Dispositif. (b) Oui : sinon la modification directe contourne la gouvernance, et on retrouve la faille que l'invariant 8 veut éviter (changer le seuil pour faire disparaître un dépassement). Les cycles en cours gardent leur instantané. (c) Accepté tel quel.

**11. Cartographie et tailles d'échelle différentes.**
Chaque Dispositif choisit sa taille d'échelle (3 à 6). La Cartographie, conservée comme acquis produit, rassemble des évaluations qui peuvent venir de Dispositifs différents, voire de deux versions d'un même Dispositif avec des tailles différentes. Les niveaux ne sont pas comparables tels quels.
*Recommandation* : en V1, aucune conversion automatique. La Cartographie affiche un Dispositif à la fois, ou signale clairement les évaluations d'une autre échelle. Une conversion éventuelle serait une décision du PO, parce qu'elle fabriquerait de la comparabilité là où la méthode n'en donne pas.

**12. Reprise de registre : qui est l'auteur d'une proposition importée ?**
DECISION-027 dit que l'import ne contourne jamais le maker-checker, mais pas qui compte comme auteur. Si l'auteur est la personne qui importe, elle ne peut pas valider. Aussi : une proposition de Résiduel issue d'un fichier doit-elle être limitée à l'équipe risque (invariant 3) ?
*Recommandation* : l'auteur est la personne qui importe, tracée avec le fichier source. Seule l'équipe risque peut importer une proposition de Résiduel ; un autre rôle peut importer l'Inhérent (soumis à la revue du §5). Si l'importeur est lui-même Risk Owner du risque, le cumul est marqué (invariant 6).

---

## Suite

1. Le PO lit le résumé et les 12 points ci-dessus.
2. Il valide, refuse ou modifie le texte ; la décision est inscrite au Decision Log (règle 7bis).
3. Après validation, l'Orchestrateur applique le texte dans le contrat (A03 relit, R1.1) et l'étape 2 est marquée terminée dans `RM-V1-Sequence-actions.md`. Elle débloque B-9 et B-6 (étapes 8 et 9).
