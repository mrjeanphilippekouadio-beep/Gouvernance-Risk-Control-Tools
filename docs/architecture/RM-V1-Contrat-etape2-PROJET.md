# RM V1 — Étape 2 : projet de report des décisions dans le contrat

**Statut : VALIDÉ par le PO (DECISION-038, 2026-10-11), avec q37 RÉVISÉE par DECISION-039 point 3 (2026-10-11).** Le texte final de l'étape 2 est validé (DECISION-038 point 2). Le point q37 a d'abord été tranché par DECISION-038 point 1, puis remplacé par DECISION-039 point 3 (nouvelle règle en 6.2). Ce texte est reporté dans le contrat `.claude/agent-context/RISK_MANAGEMENT_V1_FINAL_DECISIONS.md`. Plusieurs points induits par la révision attendent le PO (section 13).

**Version DECISION-040 (2026-10-11).** DECISION-040 (réponses du PO q42 à q57) est intégrée. Elle **remplace** la chaîne d'escalade de q31 (3.2) et la suppléance directe de q41 (3.1, 7.7) par **un seul circuit** : Comité, puis Audit si le Comité est vide, puis fonction risque, avec journalisation (point 13 de la décision). Elle clôt Q-37a à Q-37i (section 13) ; restent ouvertes q58 à q61. Dans ce document, `~~texte~~` = passage remplacé, conservé pour la traçabilité.
Auteur : Risk Manager (A13), 2026-10-11. Relu par le Product Manager (A03) le 2026-10-11 : voir la section 12. Tâche R1.1 de `docs/ROADMAP-V1.md`, étape 2 de `docs/architecture/RM-V1-Sequence-actions.md`.
Décisions reportées : DECISION-016 à 020, plus les décisions suivantes qui touchent le contrat (021, 025, 026, 027, 029, 030), plus les réponses du PO aux questions Q-E2-1 à Q-E2-11 (DECISION-033 et DECISION-034, 2026-10-11), plus les confirmations q34 à q39 (DECISION-035, 2026-10-11), plus la validation du texte final (DECISION-038, 2026-10-11), plus la révision de q37 (DECISION-039 point 3) et la confirmation de q41 (DECISION-039 point 5, 2026-10-11), plus les réponses q42 à q57 (DECISION-040, 2026-10-11).
Distinction utilisée : **[PO]** = décidé par le PO, repris tel quel (avec la référence de la décision). **[Rédaction]** = conséquence formulée par le rédacteur, pas écrite dans une décision ; le texte final est validé par DECISION-038 point 2. **Interprétation à confirmer** = lecture d'une réponse du PO qui n'est pas certaine (aucune ne reste).
Le cadre de la page Cartographie n'est pas touché par ce projet (consigne permanente du PO). L'effet visuel de la taille de matrice sur cette page n'est pas décrit ici : question ouverte q59.

---

## Ce qui change pour l'utilisateur (à lire seul)

1. **Le Dispositif devient plus complet.** À sa création, on choisit la taille de l'échelle (3, 4, 5 ou 6), les axes d'impact (7 au maximum) et on écrit le descriptif de chaque niveau, pour la probabilité et pour chaque axe. La probabilité et tous les axes ont la même taille d'échelle. L'impact retenu reste le maximum des axes. Le Dispositif est choisi à la création de l'espace client et/ou à la création du Dispositif ; les risques sont affichés par Dispositif, un Dispositif à la fois. **La taille de matrice (3×3, 4×4, 5×5 ou 6×6) choisie au Dispositif fixe le plafond de score (n²), les bandes de criticité, les seuils et le nombre de descriptifs à remplir ; les descriptifs sont facultatifs en brouillon et obligatoires pour activer l'échelle (DECISION-040, q49 et q50).**
2. **L'appétence et les grilles de cotation passent dans le Dispositif.** Elles suivent les mêmes règles de version et d'approbation que les autres paramètres. On peut activer un Dispositif par défaut, et la création se fait par un assistant pas à pas (une saisie directe reste possible pour les experts).
3. **L'« équipe risque » est un groupe précis** : le groupe Risk Manager, qui ne peut jamais être vide. Son responsable est le responsable du service risque, qui a des droits sur tous les risques, les contrôles et l'administration. Deux autres groupes fixes existent (Risk Committee et Audit) et peuvent être vides. Les départements sont aussi des groupes (modèle « département = groupe » confirmé, q47) ; la direction d'un département est le membre hiérarchiquement au-dessus des autres. **Le groupe Audit remplace le rôle « Auditeur » (lecture seule sur tout). Les cumuls Risk Manager + Audit sont interdits ; Risk Manager + Comité est autorisé et affiché sur la fiche. Entrer dans ces trois groupes ou en sortir exige un motif, sans approbateur tiers en MVP (DECISION-040, q42 à q44).**
4. **Les changements du Dispositif.** Par défaut, la fonction risque approuve et Audit est notifié si son groupe n'est pas vide ; le Dispositif peut exiger l'approbation d'Audit et/ou du Comité (validé, q34). Audit vote avec les mêmes règles que le Comité, avec un avertissement et un indicateur. **Un seul circuit : Comité ; s'il est vide, Audit ; s'il est vide, la fonction risque, avec journalisation. Tout nouveau membre du Comité ou d'Audit voit une vue de toutes les décisions prises en son absence (DECISION-040, q54 ; remplace la suppléance directe de DECISION-033, q35 et q41).** ~~Si le Comité est vide, une personne au moins de la fonction risque prend en charge ce que le Comité aurait approuvé (DECISION-033 et q35, avec garde-fous).~~ Les groupes Comité et Audit ont chacun un journal des décisions prises en leur absence.
5. **Se désigner soi-même reste interdit, sauf si le Dispositif l'autorise.** Ce réglage est désactivé par défaut. Seul le Comité peut l'activer. Même activé, un autre membre du groupe Risk Manager doit approuver.
6. **Un membre de l'équipe risque ne revoit pas un risque dont il est Risk Owner, Délégué ou Exécuteur.** Un autre membre s'en charge. Si toute l'équipe risque est concernée, la revue suit le circuit unique Comité, Audit, fonction risque (q54) ; l'équipe risque est alertée. ~~Audit, puis Comité, puis suppléance~~ (chaîne q31 remplacée). Sur les autres risques, il travaille normalement.
7. **Le Risk Owner enregistre lui-même la décision de traitement.** Il n'y a plus de « proposeur ». L'équipe risque peut seulement joindre une recommandation qui ne lie personne.
8. **« Retourné » et « Rejeté » sont deux états différents, avec le même effet pratique.** Retourné : on demande ou on apporte une précision. Rejeté : la saisie n'est pas applicable ou n'est pas bonne. Après un rejet, la saisie revient à la 1re ligne comme après un retour ; le rejet reste en historique et est compté.
9. **Le Comité peut voter à distance, avec une règle choisie à la création du Dispositif** : A Léger (2 votants d'accord, 5 jours), B Standard (majorité, 3 votants au moins, 10 jours), C Strict (unanimité, 15 jours), ou une règle personnalisée (seuls les planchers fixes s'imposent ; si le quorum est impossible (trop de votants exclus ou échéance dépassée), l'envoi au Comité est refusé et la demande suit le circuit unique : Audit, puis, si Audit est vide, la fonction risque ; si le responsable de la fonction risque est Risk Owner, Délégué ou Exécuteur, il décide avec la co-signature d'un autre membre ; il est exclu s'il est demandeur ou auteur ; motif obligatoire, Audit prévenu quand il n'est pas décideur, décision au journal des décisions prises en l'absence du Comité ; jamais de validation tacite, jamais l'administrateur du client, DECISION-040 q52 à q57, qui précise DECISION-039 point 3). **Aucun quorum n'est forcé par défaut pour les décisions** (système souple, actions journalisées, q55) ; la règle de décision par défaut reste ouverte (q61). Le PO ne fixe pas de règle par défaut. Dans toutes les règles : pas de validation par silence, jamais un seul membre, auteurs et Risk Owner / Délégué / Exécuteur ne votent pas, vote motivé et tracé, escalade à l'échéance (jamais de clôture automatique), groupe vide refusé. Un vote peut être retiré tant que la décision n'est pas close.
10. **Le Risk Owner statue sur chaque contribution** (retenue ou écartée avec motif ; « Sans suite » est retiré ; le Dispositif permet de créer des statuts de contribution personnalisés, et tout statut d'écartement porte une trace). L'import d'un registre ne contourne jamais la revue : l'auteur d'une cotation importée est la personne qui importe, et seule l'équipe risque importe un Résiduel.
11. **Premier Dispositif.** ~~On demande d'abord de créer un utilisateur dans le groupe risque au niveau hiérarchique le plus élevé ; à défaut, l'administrateur du client (différent du demandeur) l'active, avec motif et trace, une seule fois.~~ **Seul un membre du groupe Risk Manager active le premier Dispositif ; l'administrateur est retiré de cette règle. Le premier utilisateur créé par l'administrateur est le Risk Manager (groupe risque, plus haut niveau d'accès) ; dans certains cas, l'administrateur peut être lui-même le Risk Manager (DECISION-040, q51).**
12. Si l'audit ne peut pas être écrit, l'action est bloquée. Le temps réel (WebSocket) passe en V2.

---

## Plan du document

| Partie | Section du contrat | Décisions sources |
|---|---|---|
| 1 | En-tête | 016 à 020, 026, 033, 034 |
| 2 | §4 Identification et Analyse | 016, 019, 034 (q23) |
| 3 | §5 Évaluation | 016, 017, 019, 027, 029, 033, 034 |
| 4 | §6 Axes d'impact | 016, 034 (q25) |
| 5 | §7 Modes et contributions | 025 (q04), 034 (q32) |
| 6 | §8 Appétence et Treatment Decision | 016, 017, 026, 034 (q29) |
| 7 | §10 Dispositif | 016, 017, 018, 019, 025, 026, 033, 034 |
| 8 | §13 UX validée | 017, 030 |
| 9 | §14 et §17 (temps réel) | 020 |
| 10 | Décisions examinées sans effet sur le contrat | — |
| 11 | Réponses du PO (Q-E2-1 à Q-E2-11) | 033, 034 |
| 12 | Relecture produit (A03) : corrections | — |
| 13 | Points restant à confirmer par le PO | — |

Les textes « actuels » sont cités mot pour mot. Quand un paragraphe est long, je cite seulement la phrase concernée.

---

## 1. En-tête du contrat

**Texte actuel** (ligne 7)
> **Amendement du 2026-10-08** (DECISION-014 et DECISION-015, `.claude/agent-context/ACTION_ITEMS.md`) : modes de cotation, rôles Risk Owner / Délégué / Exécuteur, paramètres du Dispositif. Paragraphes touchés : §4, §5, §7, §8, §10, §16, §17 (Phase 4). […]

**Texte proposé** (ajout d'un second paragraphe)
> **Amendement du [date de validation]** (étape 2, DECISION-016 à 020, 025, 026, 027, 029, 030, 033 et 034) : échelle, axes et descriptifs dans le Dispositif ; groupes ; approbateur configurable ; auto-proposition de désignation ; Comité asynchrone ; état « Rejeté » ; statuts des contributions ; temps réel reporté en V2. Paragraphes touchés : §4, §5, §6, §7, §8, §10, §13, §14, §17.

**Source** : [Rédaction], pour la traçabilité.

---

## 2. §4 Identification et Analyse

**Texte actuel**
> […] Il est désigné au niveau du **Processus**, avec un **Délégué** quand l'effectif du département le permet ; les risques du Processus en héritent. Une surcharge sur un risque donné remplace toujours la paire Risk Owner + Délégué ensemble. La désignation est faite par la direction du département, approuvée par l'équipe risque et tracée (auteur, motif, valeur précédente, approbateur).

**Texte proposé** (la dernière phrase est remplacée et deux phrases s'ajoutent)
> La désignation est proposée par la direction du département, approuvée par l'équipe risque (groupe Risk Manager) et tracée (auteur, motif, valeur précédente, approbateur). **La direction du département est le membre du groupe hiérarchiquement au-dessus des autres (directeur ou head of) ; il voit le travail des membres sur les risques, les contrôles et les objets qu'ils détiennent ou ont créés.** Chaque Processus est rattaché à un département.

**Décision source** : DECISION-016 (Q10, les départements sont des groupes), DECISION-019 (P4, le Processus est rattaché à un département) et DECISION-034 (q23 / Q-E2-1, définition de la direction et sa visibilité). **[PO]** pour le principe et la phrase en gras. **[Rédaction]** pour « proposée » (conséquence de l'invariant 5 : on distingue proposer et approuver). La décision définit la direction et sa visibilité ; elle ne dit pas que la direction peut agir sur les objets de ses membres, et le texte ne l'écrit pas.

Note : le détail technique (colonnes, tables) n'a pas sa place dans le contrat. Il reste dans les lots B-5 et B-8.

---

## 3. §5 Évaluation

### 3.1 Définition de l'équipe risque (ajout après le deuxième paragraphe)

**Texte actuel** (extrait)
> La saisie de l'Inhérent, de la Maîtrise et du Résiduel est attribuée selon le mode effectif de l'évaluation (§7). L'équipe risque saisit le Résiduel dans tous les modes.

**Texte proposé** (nouveau paragraphe qui suit)
> **Groupes.** L'« équipe risque » est le groupe fixe **Risk Manager**. Il ne peut jamais être vide *(Rédaction : on ne peut donc pas retirer son dernier membre)*. Deux autres groupes fixes existent, **Risk Committee** et **Audit** ; ils peuvent être vides. Les départements sont aussi des groupes.
> **Responsable de la fonction risque.** Le « responsable de la fonction risque » est le responsable du service risque : il a des droits sur tous les risques, les contrôles et l'administration. ~~Il peut suppléer le Comité si le groupe Risk Committee est vide.~~ **« Responsable du risque » dans les règles d'escalade = responsable de la fonction risque. [PO, q53]**
> **Droits des groupes fixes. [PO, DECISION-040]** *Risk Manager* : droits larges sur les risques, jamais approuver ce qu'il a lui-même saisi. *Comité* : lecture et vote. *Audit* : lecture seule sur tout ; le **groupe Audit remplace le rôle « Auditeur »** (q42). Cumuls : Risk Manager + Audit **interdit** ; Risk Manager + Comité **autorisé**, cumul affiché sur la fiche. L'interdiction des cumuls est **configurable**, à l'exception de Risk Manager + Comité (portée exacte du réglage : **q58, ouverte**) (q43). Entrer dans les trois groupes fixes ou en sortir : **motif obligatoire, sans approbateur tiers** (MVP) (q44). Seul l'**administrateur de l'application** modifie les droits du groupe Audit, jamais l'équipe risque, chaque changement étant tracé ; s'il est aussi responsable de la fonction risque, il fait le changement mais **Audit ou le Comité doit le valider** (maker-checker) (q45). Le modèle « département = groupe » est confirmé (q47). Rattachement Processus → département : obligatoire pour tout nouveau processus dès maintenant ; les processus existants sont rattachés avant l'ouverture aux utilisateurs, puis la colonne passe en NOT NULL (q46).
> **Circuit unique en l'absence du Comité. [PO, q54]** ~~**Suppléance du Comité.** Si le groupe Risk Committee est vide, **une personne au moins** de la fonction risque prend en charge ce que le Comité aurait approuvé (q35, q41).~~ Remplacé par : **Comité ; s'il est vide, Audit ; s'il est vide, la fonction risque (groupe Risk Manager), avec journalisation.** Tout nouvel utilisateur ajouté au Comité ou à Audit dispose d'une **vue de toutes les décisions prises en son absence**. Quand c'est la fonction risque qui décide : elle est exclue si elle est **demandeur ou auteur** ; si le responsable de la fonction risque est **Risk Owner, Délégué ou Exécuteur**, il décide avec la **co-signature** d'un autre membre (et non un simple avis) **[PO, q53 et q52]** ; motif obligatoire et tracé, **Audit prévenu chaque fois qu'il n'est pas lui-même décideur** **[PO, q56]**. Les garde-fous de q35 qui ne contredisent pas q53 (jamais le demandeur, jamais l'auteur) sont repris ; « jamais pour activer l'auto-proposition de désignation » : **à reconfirmer sous le nouveau circuit** (section 13, points induits). Tout est inscrit au **journal des décisions prises en l'absence du Comité**. **[PO, q36]** *(Rédaction : le circuit remplace l'envoi refusé de la règle « groupe vide refusé » sans le supprimer, et est tracé comme tel.)*

**Source** : DECISION-016 (Q10) ; DECISION-034 (q24 / Q-E2-2) pour la définition du responsable ; DECISION-033 et DECISION-035 (q35, q36) pour la suppléance, remplacée par le circuit unique de DECISION-040 (q42 à q47, q52 à q56). **[PO]** sauf les précisions en italique. ~~Une personne suffit pour la suppléance : le PO l'a décidé (q35) ; la règle « jamais un seul membre » du §8 vise le vote du Comité, pas la suppléance.~~ (Le projet initial ajoutait « un membre du groupe Risk Manager peut agir sur tout risque du tenant » : règle non décidée, supprimée. Les droits « sur tous les risques » viennent de la décision q24 et sont attribués au responsable, pas à tous les membres.)

### 3.2 Conflit de rôles d'un membre de l'équipe risque (nouveau paragraphe)

**Texte proposé**
> **Conflit de rôles.** Un membre du groupe Risk Manager qui est Risk Owner, Délégué ou Exécuteur d'un risque ne saisit ni ne revoit ce risque. Un autre membre du groupe le fait. Si toute l'équipe risque est concernée, la revue suit le **circuit unique** de 3.1 : **Comité ; s'il est vide, Audit ; s'il est vide, la fonction risque, avec journalisation** **[PO, DECISION-040 q54]** (avec co-signature si le responsable de la fonction risque est lui-même concerné, 3.1). ~~Audit si son groupe n'est pas vide [q36] ; ensuite le Comité, puis la suppléance [Rédaction]~~ (chaîne q31 remplacée). L'équipe risque est alertée (signe de sous-effectif). Les groupes Comité et Audit ont chacun un **journal des décisions prises en leur absence** **[PO, q36]**. Sur les autres risques, ce membre agit normalement. Le cumul est marqué visiblement (invariant 6).

**Source** : DECISION-019 (P5) ; DECISION-034 (q31 / Q-E2-9) pour l'alerte ; DECISION-035 (q36) pour le journal ; DECISION-040 (q54) pour l'ordre, qui remplace l'ordre de q36 (Audit, Comité, suppléance, dont la partie après Audit était une [Rédaction]).

### 3.3 Revue de l'Inhérent : Retourné et Rejeté sont deux états

**Texte actuel**
> […] un membre de l'équipe risque, différent de l'auteur, le **retient**, ou le **retourne / rejette avec une annotation obligatoire** ; un Inhérent retourné revient à la 1re ligne pour une nouvelle saisie. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Texte proposé**
> […] un membre de l'équipe risque, différent de l'auteur, le **retient**, le **retourne** ou le **rejette**. Une annotation est obligatoire pour un retour et pour un rejet. **Retourné** : on demande ou on apporte une précision. **Rejeté** : la saisie n'est pas applicable ou n'est pas bonne. Un Inhérent retourné ou rejeté revient à la 1re ligne pour une nouvelle saisie ; **un rejet est comme un retour, mais il est gardé en historique et compté**. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Source** : DECISION-017, point 3 ; DECISION-034 (q30 / Q-E2-8 : « Rejet = comme un retour, gardé en historique et compté »). **[PO]** L'annotation obligatoire pour les deux vient du texte actuel (DECISION-015).

### 3.4 Reprise d'un registre existant (nouveau paragraphe en fin de §5)

**Texte proposé**
> **Reprise d'un registre (import).** À l'import, le client relie lui-même les colonnes de son fichier aux objets du Dispositif ; aucun rapprochement n'est implicite. Les objets importés (risques, processus, contrôles) arrivent en brouillon et sont activés par l'équipe risque. Les cotations du fichier deviennent des **propositions de cotation** quand la matrice probabilité × impact du fichier est la même que celle du Dispositif ; sinon elles restent en historique « reprise ». Une proposition suit le parcours normal (revue, validation par un tiers) : **l'import ne contourne jamais le maker-checker.** **L'auteur d'une cotation importée est la personne qui importe. Seule l'équipe risque importe un Résiduel.** En V1, le fichier est un .xlsx (le lien direct vers un tableur en ligne est prévu en V1.1).

**Source** : DECISION-027 (q14, q15, q16), DECISION-029 (q17) et DECISION-034 (q33 / Q-E2-11). **[PO]** La décision ne dit rien de l'import d'un Inhérent par un autre rôle ni du marquage du cumul quand l'importeur est Risk Owner ; le texte ne l'écrit pas (l'invariant 6 s'applique de toute façon).

---

## 4. §6 Axes d'impact

**Texte actuel**
> Le nombre d'axes d'impact **n'est pas fixe**. Il est déterminé par la Rating Scale active.
> `Impact retenu = MAX(valeur de tous les axes configurés)`
> Le frontend doit donc itérer dynamiquement sur les axes retournés par le backend.
> **Aucun code ne doit supposer 7 axes.**

**Texte proposé**
> Les axes d'impact (financier, réglementaire, opérationnel, etc.) et l'échelle sont choisis **à la création du Dispositif**. L'échelle a une taille de **3, 4, 5 ou 6** niveaux. La **probabilité et chaque axe d'impact ont la même taille d'échelle** (exemple : échelle de 4, probabilité sur 4 et chaque axe sur 4). Il y a **7 axes au maximum** ; ce chiffre est un plafond, jamais un nombre à supposer.
> **Chaque niveau porte son propre descriptif**, pour la probabilité et pour chaque axe (exemple : échelle de 5, donc 5 descriptifs pour la probabilité et 5 par axe). Les descriptifs sont saisis à la création du Dispositif ; **ils sont facultatifs tant que le Dispositif est en brouillon et obligatoires pour activer l'échelle** [PO, DECISION-040 q50].
> **Taille de matrice.** La taille (3×3, 4×4, 5×5 ou 6×6) est choisie à la création du Dispositif ; **tout s'aligne dessus côté serveur : plafond de score = n², bandes de criticité, seuils, nombre de descriptifs à remplir** [PO, q49]. L'effet visuel côté frontend (page Cartographie) n'est pas décrit : **question ouverte q59** (consigne permanente du PO : la page Cartographie n'est pas modifiée).
> Le nombre d'axes reste déterminé par l'échelle du Dispositif applicable, jamais par le code.
> `Impact retenu = MAX(valeur de tous les axes configurés)` (inchangé)
> Le frontend itère dynamiquement sur les axes retournés par le backend. **Aucun code ne doit supposer 7 axes** (inchangé). Un changement d'échelle, d'axe ou de descriptif crée une nouvelle version du Dispositif et ne touche que les cycles à venir (invariant 9).
> **Affichage.** Le Dispositif est choisi à la création de l'espace client et/ou à la création du Dispositif ; les risques sont affichés par Dispositif, un à la fois.

**Décision source** : DECISION-016 (Q11 et complément du PO) ; DECISION-034 (q25 / Q-E2-3) et DECISION-035 (q39) pour la dernière phrase ; DECISION-040 (q49, q50) pour la taille de matrice et le statut des descriptifs. **[PO]** pour le contenu. La phrase « Un changement d'échelle… » est **[Rédaction]** : elle découle du versionnement du §10 et de l'invariant 9. « Corrélée » veut dire « même taille d'échelle », pas une grille croisée (retenu par le PO). La réponse q25 est une règle d'affichage : ce projet ne propose aucun changement d'écran.
---

## 5. §7 Modes et contributions

**Texte actuel** (extrait)
> - types : Identification ; Analyse ; Inherent ; Maîtrise ;

**Texte proposé** (nouveau paragraphe après la liste des types)
> **Statut d'une contribution.** Le Risk Owner statue sur chaque contribution : **Retenue** ou **Écartée** (motif obligatoire). **« Sans suite » est retiré. Le Dispositif permet de créer des statuts de contribution personnalisés ; tout statut d'écartement porte une trace.** Le Délégué peut statuer si le Dispositif le prévoit ; l'auteur de la contribution ne statue jamais sur la sienne. Chaque décision est conservée en historique (append-only). Cette règle est configurable dans le Dispositif. « Retenue » qualifie l'information reçue, jamais la cotation (Contribution ≠ Saisie).

**Décision source** : DECISION-025, q04 (OD-4) ; DECISION-034 (q32 / Q-E2-10) ; DECISION-035 (q38). **[PO]** pour les statuts Retenue et Écartée, le Délégué, l'historique, « configurable », le retrait de « Sans suite » et les statuts personnalisés. La règle « tout statut d'écartement porte une trace » est maintenue de l'orchestrateur et du Risk Manager, non contestée par le PO ; elle ne se configure pas. La dernière phrase est **[Rédaction]**, tirée du principe déjà au contrat (« une contribution apporte de l'information et ne cote jamais »).

---

## 6. §8 Appétence et Treatment Decision

### 6.1 Qui enregistre la décision

**Texte actuel**
> Un dépassement peut déclencher une Treatment Decision, rattachée à l'évaluation qui l'a déclenchée. Le Risk Owner décide de la Treatment Decision (qui la propose reste à trancher).

**Texte proposé**
> Un dépassement peut déclencher une Treatment Decision, rattachée à l'évaluation qui l'a déclenchée. **Le Risk Owner enregistre la Treatment Decision** ; le Délégué le fait quand le §5 l'autorise (absence ou délégation datée). **Il n'y a pas de proposeur distinct.** L'équipe risque peut joindre une **recommandation non contraignante**. La Treatment Decision est ensuite validée par un tiers, selon le §5.

**Décision source** : DECISION-016 (Q9 : « le Risk Owner (ou le Délégué) enregistre »). **[PO]** pour le Risk Owner, l'absence de proposeur et la recommandation. **[Rédaction]** pour « quand le §5 l'autorise » (renvoi aux conditions déjà au contrat) et pour « validée par un tiers selon le §5 » (application de la règle générale « on ne valide jamais ce qu'on a saisi »).

### 6.2 Comité asynchrone (nouveau paragraphe, après « Deux seuils de Comité sont indépendants »)

**Texte proposé**
> **Vote du Comité à distance.** Le Comité peut valider par vote asynchrone, sans séance. À la création du Dispositif, le client choisit une règle parmi trois règles prédéfinies, ou crée une **règle personnalisée** (groupes qui valident, quorum, majorité, délai, relances). Aucune règle n'est imposée par défaut. **Une règle personnalisée n'est limitée que par les règles fixes ci-dessous. Si le quorum est impossible (trop de votants exclus du vote, ou échéance dépassée), l'envoi au Comité est refusé et la demande suit le circuit unique : Audit ; si le groupe Audit est vide, la fonction risque. Le « responsable du risque » est le responsable de la fonction risque. Il est exclu s'il est demandeur ou auteur ; s'il est Risk Owner, Délégué ou Exécuteur, il décide avec la co-signature d'un autre membre du groupe Risk Manager, tracée au journal. Le motif est obligatoire et tracé ; Audit est prévenu chaque fois qu'il n'est pas lui-même décideur. La décision est inscrite au journal des décisions prises en l'absence du Comité, visible dans une vue dédiée au Comité et à Audit, sans autre restriction ; jamais de validation tacite ; jamais l'administrateur du client.** **[PO, DECISION-040 q52 à q56, qui précise DECISION-039 point 3]**
>
> ~~Si le groupe Audit est vide, elle passe au responsable du risque (membre du groupe Risk Manager). S'il est lui-même concerné, il décide avec la consultation d'un autre membre du groupe Risk Manager (paramètre configurable dans l'administration).~~ (DECISION-039 point 3, « consultation » remplacée par la co-signature, q52.)
>
> **Circuit unique (q54).** Qu'il s'agisse d'un Comité vide ou d'un quorum impossible, il n'y a **qu'un seul circuit** : Comité ; si vide, Audit ; si vide, fonction risque, avec journalisation. Tout nouvel utilisateur ajouté au Comité ou à Audit a une vue de toutes les décisions prises en son absence. Ce circuit remplace la chaîne de q31 et la suppléance directe de q41. **Votes déjà émis** à l'échéance : gardés dans l'historique, visibles par le décideur, **non comptés** dans la nouvelle décision (q57).
>
> **Pas de quorum forcé par défaut pour les décisions (q55, révise q27).** Le système est souple et adaptable à l'environnement de contrôle, les actions étant journalisées. **La règle de décision par défaut reste ouverte : q61.** *(Rédaction : les règles A, B, C et les règles fixes ci-dessous sont reportées telles quelles ; leur articulation avec q55 est une question au PO, section 13.)*
>
> | Règle | Pour qui | Décision | Quorum | Délai | Relances |
> |---|---|---|---|---|---|
> | **A Léger** | petite structure | 2 votants d'accord | 2 | 5 jours | — |
> | **B Standard** | structure moyenne | majorité des votants | au moins 3 | 10 jours | à 50 % et à 90 % du délai |
> | **C Strict** | grande structure ou très régulée | unanimité | au moins 2/3 des éligibles, 4 minimum | 15 jours | — |
>
> **Règles fixes, qu'aucune règle ne peut changer :**
> - jamais de validation tacite : le silence n'est pas un accord ;
> - à l'échéance, escalade : jamais de clôture automatique ;
> - jamais un seul membre ; un quorum de 2 n'existe que dans la règle A ;
> - les auteurs et le Risk Owner, le Délégué et l'Exécuteur concernés ne votent pas ;
> - chaque vote est motivé et tracé (append-only) ; un vote peut être retiré tant que la décision n'est pas close, le retrait étant lui aussi tracé ;
> - un groupe vide ne peut pas être sollicité (l'envoi est refusé) ;
> - le responsable de la fonction risque peut être membre du Comité, mais ne vote pas sur ce qu'il a saisi.
>
> **Audit.** Quand Audit est l'approbateur choisi, il vote avec les mêmes règles que le Comité (règles A, B, C ou personnalisée, mêmes règles fixes). L'écran de création affiche un avertissement sur l'indépendance d'Audit, et un indicateur suit la part des changements approuvés par Audit.

**Décision source** : DECISION-026 (q05, B-12), réponses du PO à q05 et aux trois questions de DECISION-017 point 4 (cockpit, transmises par l'orchestrateur A02 ; pas encore inscrites dans le Decision Log, voir section 12) ; DECISION-034 (q29 / Q-E2-7 pour la règle personnalisée, q27 / Q-E2-5 pour Audit). **[PO]** pour tout le tableau, toutes les règles fixes, la phrase sur la règle personnalisée et le paragraphe Audit. **[Rédaction]** : « le retrait étant lui aussi tracé » (conséquence de « vote tracé ») ; les cellules « — » signifient « non précisé par le PO », pas « sans relance ». La cohérence avec le plancher « jamais un seul membre » (le quorum de 2 reste donc le minimum) est vérifiée. Vers qui se fait l'escalade quand le quorum est impossible : DECISION-039 point 3, remplacée dans ses détails par DECISION-040 (q52 à q57) **[PO]** ; le dernier recours « administrateur du client » reste écarté. Les questions Q-37a à Q-37h sont closes (section 13) ; restent ouvertes q58 à q61.

---

## 7. §10 Dispositif

### 7.1 Définition : le Dispositif n'est plus « distinct de l'Appétence »

**Texte actuel**
> Il est distinct du Risque, du Processus, de l'Évaluation, de l'Appétence, du Meeting et de Risk 360.

**Texte proposé**
> Il est distinct du Risque, du Processus, de l'Évaluation, du Meeting et de Risk 360. Il **porte** l'échelle, les grilles de cotation et l'appétence : ce sont des paramètres du Dispositif, versionnés avec lui.

**Source** : DECISION-017, point 5 (« tout passe dans le Dispositif »). **[PO]** La phrase actuelle se contredit avec cette décision, il faut donc la corriger. « Versionnés avec lui » est **[Rédaction]** mais découle du contrat existant, qui liste déjà « appétence, seuils Comité » parmi les paramètres du Dispositif, figés par instantané dans chaque évaluation. Conséquence pour le code (lot B-6, pas une question) : une modification d'appétence passera par une nouvelle version du Dispositif, et non plus par `riskappetite.update` en place (contrat, invariant 8 et gouvernance d'un changement).

### 7.2 Création : assistant, Dispositifs par défaut et première activation (ajout aux règles validées)

**Texte proposé**
> - La création d'un Dispositif se fait par un **assistant pas à pas**, activé par défaut. Une configuration directe reste possible pour les utilisateurs experts.
> - L'organisation peut **activer un Dispositif par défaut** fourni avec l'outil. Un Dispositif par défaut respecte les invariants comme tous les autres.
> - **Première activation.** ~~Pour activer le tout premier Dispositif, on demande d'abord de créer un utilisateur dans le groupe risque au niveau hiérarchique le plus élevé. À défaut, l'administrateur du client, différent du demandeur, l'active, avec motif et trace, une seule fois.~~ **Seul un membre du groupe Risk Manager active le premier Dispositif. L'administrateur est retiré de cette règle. Le premier utilisateur créé par l'administrateur est le Risk Manager (groupe risque, plus haut niveau d'accès) ; l'administrateur peut, dans certains cas, être lui-même le Risk Manager.** [PO, DECISION-040 q51]

**Source** : DECISION-017, points 1 et 5 ; DECISION-034 (q28 / Q-E2-6), remplacé par DECISION-040 (q51). **[PO]** sauf la phrase sur les Dispositifs par défaut qui respectent les invariants, **[Rédaction]** (elle applique l'invariant 8). Le contenu des Dispositifs par défaut est le lot B-13, rédigé à part. Le principe de suppléance de DECISION-033 (groupe Comité vide) s'ajoute à ce cas (section 3.1).

### 7.3 Table des paramètres

Lignes modifiées ou ajoutées. Les autres lignes ne changent pas.

| Ligne | Texte actuel | Texte proposé | Source |
|---|---|---|---|
| Mode par défaut | Mode par défaut (tenant, puis Processus — DECISION-006) : Classique | Mode par défaut **porté par le Dispositif**, puis Processus (DECISION-006) : Classique. `Config.evaluationMode` devient obsolète. | DECISION-018 P1 [PO] |
| Changement de mode d'un Processus | (non écrit) | Validé par la fonction risque. `process.evaluationmode.set` est retiré. | DECISION-018 P2 [PO] (ajouté à la relecture, omis du projet initial) |
| Seuil de criticité « faible » | Inscrit à la création du Dispositif | **Configurable** par le groupe Risk Manager ; tout changement est tracé et approuvé (7.7) | DECISION-016 [PO] |
| Approbateur d'un changement de paramètre | Responsable de la fonction risque ; Comité pour la séparation des tâches | **Par défaut : la fonction risque approuve et Audit est notifié si son groupe n'est pas vide.** Le Dispositif peut exiger l'approbation d'**Audit et/ou du Comité**. Audit vote avec les règles du Comité (6.2). Détail : 7.7 | DECISION-016, DECISION-018 P6, DECISION-034 q26 et q27 [PO] ; DECISION-035 q34 [PO] (lecture de q26 validée) |
| Échelles, descriptions de probabilité, appétence, seuils Comité | Déjà paramétrables | Remplacée par les lignes ci-dessous | DECISION-016, DECISION-017 |
| Échelle et axes | (nouvelle) | Taille 3, 4, 5 ou 6 ; 7 axes au maximum ; fixés à la création (§6) | DECISION-016 [PO] |
| Descriptifs des niveaux | (nouvelle) | Un descriptif par niveau, pour la probabilité et pour chaque axe, saisi à la création | DECISION-016 [PO] |
| Appétence et grilles de cotation | (nouvelle) | Paramètres du Dispositif | DECISION-017 point 5 [PO] |
| Seuils de passage Comité (§8) | Déjà paramétrables | Paramètres du Dispositif, figés dans l'instantané de chaque évaluation | Contrat actuel (§10, lignes « seuils Comité » et instantané) + DECISION-017 point 5 ; pas de changement de fond |
| Règle du Comité asynchrone | (nouvelle) | Règle prédéfinie (A, B, C) ou personnalisée, choisie à la création (§8) | DECISION-026 [PO] |
| Auto-proposition de désignation | (nouvelle) | **Désactivée par défaut.** Seul le Comité l'active (invariant 5) | DECISION-019 P3 [PO] |

### 7.4 Invariant 5 réécrit

**Texte actuel**
> 5. Toute désignation (Risk Owner, Délégué, Exécuteur) et tout changement de paramètre sont tracés (auteur, motif, valeur précédente, approbateur), approuvés par un tiers, jamais auto-attribués ni auto-approuvés.

**Texte proposé**
> 5. Toute désignation (Risk Owner, Délégué, Exécuteur) et tout changement de paramètre sont tracés (auteur, motif, valeur précédente, approbateur) et approuvés par un tiers. **Rien n'est jamais auto-approuvé.** Une **auto-proposition** (se désigner soi-même) n'est permise que si le Dispositif l'autorise. Ce paramètre est désactivé par défaut et son activation est décidée par le Comité. Quand il est activé : un **autre membre du groupe Risk Manager** approuve, avec motif et audit, et le cumul est marqué. S'il n'y a aucun autre approbateur, la demande est refusée.

**Décision source** : DECISION-018 (P3 : l'interdiction doit rester configurable) et DECISION-019 (P3 : réécriture proposée par l'Architecte, acceptée ; « activé par le Comité » est explicite). **[PO]** La réécriture règle la tension avec l'invariant 8 : c'est l'invariant lui-même qui prévoit le paramètre, donc rien n'est abaissé. En attendant le paramètre, le refus strict de l'auto-désignation (lot B-0) reste le comportement. Qui active le paramètre n'est plus une question : le Comité, par DECISION-019. (Conséquence de la règle « groupe vide refusé » : un Comité vide ne peut pas l'activer, **[Rédaction]**. La suppléance de DECISION-033 ne couvre jamais l'activation de l'auto-proposition (q35) : un Comité vide ne peut donc pas l'activer, même en suppléance. **Depuis DECISION-040 (q54), la suppléance est remplacée par le circuit unique Comité, Audit, fonction risque ; l'application de ce garde-fou à ce circuit n'est pas reprise par la décision : à reconfirmer (section 13).**)

### 7.5 Invariant 7 : audit en échec (ajout)

**Texte actuel**
> 7. Les champs d'attribution sont forcés côté serveur ; l'audit est append-only ; l'historique d'une évaluation n'est jamais réécrit.

**Texte proposé** (une phrase s'ajoute)
> […] **Si l'écriture de l'audit échoue, l'action est bloquée** (l'action et son audit sont dans la même transaction) ; une consultation confidentielle sans trace est refusée ; l'équipe risque et le support sont alertés.

**Source** : DECISION-025, q12. **[PO]**

### 7.6 Nouvel invariant 10 : règles fixes du Comité (proposition)

**Texte proposé**
> 10. Quelle que soit la règle de Comité choisie (prédéfinie ou personnalisée) : jamais de validation tacite ni de clôture automatique (escalade à l'échéance), jamais un seul membre, auteurs et Risk Owner / Délégué / Exécuteur exclus du vote, vote motivé et tracé, groupe vide refusé.

**Source** : DECISION-026 (« les règles fixes restent non configurables »). **[Rédaction]** : la placer parmi les invariants est ma proposition, pour que l'invariant 8 la protège. Si le PO préfère la garder dans le §8 (6.2), on supprime cette ligne. Constat de code : `validateByCommittee` valide aujourd'hui sur l'appel d'un seul membre (F-14).

### 7.7 Gouvernance d'un changement de paramètre

**Texte actuel**
> […] l'administrateur du Dispositif (`riskframework.update`) le demande, avec un motif écrit ; le responsable de la fonction risque, différent du demandeur, l'approuve, ou le Comité pour les paramètres de séparation des tâches. Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Le Comité n'étant pas disponible à tout moment, la version reste en `DRAFT` jusqu'à sa séance ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. L'audit conserve l'ancienne et la nouvelle valeur.

**Texte proposé**
> […] Les possibilités de configuration sont détenues par la fonction risque (groupe Risk Manager) et tracées. Le changement est demandé avec un motif écrit. **Par défaut, la fonction risque approuve le changement, différente du demandeur, et Audit est notifié si son groupe n'est pas vide. Le Dispositif peut exiger l'approbation d'Audit et/ou du Comité.** **[PO, q34 : lecture validée]** Quand l'approbateur est Audit, il vote avec les règles du Comité (§8). Si le groupe Comité est vide, le circuit unique de 3.1 s'applique : Audit, puis la fonction risque, avec journalisation **[PO, DECISION-040 q54, qui remplace la suppléance directe de q35 et q41]**. ~~une personne au moins de la fonction risque prend en charge ce que le Comité aurait approuvé, avec les garde-fous et le journal de 3.1 [q35]~~. *(Rédaction : on ne peut pas vider un groupe déjà choisi comme approbateur ; pour le Comité vide, le circuit s'applique.)* Les droits du groupe Audit ne sont modifiables que par l'administrateur de l'application, avec validation par Audit ou le Comité si l'administrateur est aussi responsable de la fonction risque (3.1, q45). Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Tant que l'approbateur n'a pas décidé, la version reste en `DRAFT` ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. Quand l'approbateur est le Comité, il décide en séance ou par vote asynchrone selon sa règle (§8). L'audit conserve l'ancienne et la nouvelle valeur.

**Décision source** : DECISION-016 (configuration tenue par le groupe Risk Manager, approbateur configurable), DECISION-018 (P6, groupe vide), DECISION-017 point 4 et DECISION-026 (Comité à distance), DECISION-033 (Comité vide), DECISION-034 (q26 / Q-E2-4, q27 / Q-E2-5), DECISION-035 (q34, q35). **[PO]** pour le contenu des réponses citées. **[Rédaction]** : le vidage d'un groupe choisi, le renvoi au vote à distance, et le remplacement de « l'administrateur du Dispositif (`riskframework.update`) » par une formulation sans rôle nommé. Première activation : 7.2.

### 7.8 Le reste de la ligne « Validateur » et « Désignation des rôles »

Ces deux lignes ne changent pas dans leur sens. Le terme « responsable de la fonction risque » reste utilisé ; il est défini en 3.1 (responsable du service risque, DECISION-034 q24).

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
> La V1 est livrée **WebSocket-ready** : abstraction `RealtimeClient`, REST autoritaire, stratégie de resynchronisation, événements métier nommés et versionnés. **Le serveur WebSocket fait partie de la V2**, avec les retours futurs du client. *(Rédaction : le contrat événementiel complet et les tests temps réel suivent le serveur, donc la V2.)*

**Texte actuel (§17)** : « ### Phase 6 — Temps réel » (étapes 19 à 23).
**Texte proposé** : « ### Phase 6 — Temps réel (**reportée en V2**, DECISION-020). En V1, seule la préparation du §14 est livrée. » Les étapes 19 à 23 restent listées pour la V2. Dans la Phase 7, la QA realtime (étape 28) vérifie seulement que la V1 est WebSocket-ready.

**Source** : DECISION-020. **[PO]** : « V1 WebSocket-ready (contrat §14), WebSocket lui-même en V2 ». **[Rédaction]** : le report du contrat événementiel complet et des tests temps réel, le contenu de la Phase 7, et la liste « événements nommés et versionnés » (reprise de `ROADMAP-V1.md` R3.4, absente de la décision et du §14 actuel).

---

## 10. Décisions examinées sans effet sur le contrat

Elles ne touchent pas le périmètre Risk Management du contrat. Elles restent dans le Decision Log.

- Les parties EVD de DECISION-018 (§33 du cahier des charges), DECISION-019 (stockage Drive, import Excel) et DECISION-020 (données personnelles, clé de rapprochement) : module Évidences, cadré dans `EVD-Import-Excel-cadrage.md`. (Les points P1 à P6 de DECISION-018 et P3 à P5 de DECISION-019 sont, eux, repris ci-dessus.)
- DECISION-021 : périmètre V1 (étape 18, B-4, piste EVD), masquage, R0 : plan de livraison, déjà couvert par le §17. OD-4 est repris au §7 ci-dessus.
- DECISION-022, 023, 024 : infrastructure, e-mail, secrets, coût du MVP.
- DECISION-025 hors q04 et q12 : R0, fenêtre de refus (q02), protections de la base, antivirus (module Évidences), organisation de l'Administration.
- DECISION-028 : méthode de revue des maquettes Penpot.
- DECISION-029 q18 et q19 : migration 047 et clé Drive.
- DECISION-030 q21 : réglages de charte, ailleurs que dans le contrat.
- DECISION-031 et DECISION-032 : branche archivée, accès Drive.

Une remarque sur DECISION-011 (fenêtre de refus) : elle n'apparaît pas dans le contrat actuel, et je ne propose pas de l'y ajouter ici.

---

## 11. Réponses du PO (Q-E2-1 à Q-E2-11)

Source : DECISION-034 (q23 à q33, 2026-10-11) et DECISION-033 (Comité vide). Pour chaque question : la réponse du PO, puis son effet sur le texte. Les réponses sont reprises au plus près des termes du PO.

**Q-E2-1 (q23). Qui est « la direction du département » ?**
Réponse du PO : « la direction du département est le membre du groupe hiérarchiquement au-dessus des autres (directeur ou head of) ; il voit le travail des membres sur les risques, les contrôles et les objets qu'ils détiennent ou ont créés. »
Effet : §4 (partie 2) : définition ajoutée, visibilité reprise. Aucune permission d'action n'est ajoutée.

**Q-E2-2 (q24 + DECISION-033). Qui est « le responsable de la fonction risque » ?**
Réponse du PO : le responsable du service risque ; droits sur tous les risques, les contrôles et l'administration ; il peut suppléer le Comité si le groupe Comité est vide. DECISION-033 : si le groupe Comité est vide, le groupe Risk Manager prend en charge ce que le Comité aurait approuvé (garde-fous proposés par l'orchestrateur, à confirmer par le PO).
Effet : §5 (3.1) : définition et suppléance ; 7.8 : renvoi à 3.1. Conflits avec les règles fixes : levés par DECISION-035 (q35), voir ci-dessous.

*Cohérence de DECISION-033 / q24 avec les règles fixes, tranchée par DECISION-035 (q35, 2026-10-11) :*
- **Jamais un seul membre.** **[PO, q35]** Une personne au moins de la fonction risque suffit pour la suppléance (la recommandation de deux approbateurs n'est pas retenue). Un demandeur ne peut pas être son propre suppléant.
- **Jamais validateur de ce qu'il a saisi.** Le responsable a des droits sur tous les risques et l'administration : il peut être demandeur et approbateur d'un même changement. **[PO, q35]** La suppléance ne s'applique jamais à un acte dont la personne est l'auteur, le Risk Owner, le Délégué ou l'Exécuteur ; un autre membre approuve.
- **Auto-proposition (DECISION-019 P3 : activée par le Comité).** Si le Comité est vide, la fonction risque pourrait activer sa propre auto-désignation, ce qui vide l'invariant 5. **[PO, q35]** La suppléance du Comité ne couvre jamais l'activation de l'auto-proposition.
- **« Groupe vide refusé ».** Cette règle (6.2, 7.7) interdit de solliciter un Comité vide ; la suppléance la contourne dans l'esprit. **[Rédaction]** La suppléance remplace l'envoi refusé sans le supprimer et est tracée comme telle, au journal des décisions prises en l'absence du Comité (q36). Motif et trace obligatoires (q35).

**Q-E2-3 (q25). Cartographie et tailles d'échelle différentes.**
Réponse du PO : « Un Dispositif est choisi une seule fois à la création ; les risques sont affichés par Dispositif, un à la fois. » Précisé par DECISION-035 (q39) : choisi à la création de l'espace client et/ou du Dispositif.
Effet : §6 (partie 4) : phrase « Affichage » ajoutée, et l'« effet de bord à confirmer » du projet initial est supprimé (réponse reçue). C'est une règle d'affichage : la page Cartographie n'est pas touchée et aucun changement d'écran n'est proposé.

**Q-E2-4 (q26). L'approbateur choisi approuve-t-il tous les changements ?**
Réponse du PO : « les changements sont au niveau du risque et l'audit est notifié si le groupe n'est pas vide, comportement par défaut ; on pourra choisir l'audit et/ou le comité. »
Effet : 7.3 (ligne « Approbateur »), 7.7 et résumé (point 4). **[PO, q34 : lecture validée]** Par défaut la fonction risque approuve les changements et Audit est seulement notifié (si son groupe n'est pas vide) ; le Dispositif peut exiger l'approbation d'Audit, du Comité, ou des deux. Ce choix remplace la valeur « Comité par défaut » de ma recommandation.

**Q-E2-5 (q27). Quand l'approbateur est Audit, qui décide ?**
Réponse du PO : Audit suit les mêmes règles de vote que le Comité, avec avertissement et indicateur.
Effet : §8 (6.2), paragraphe « Audit » ; 7.7.

**Q-E2-6 (q28). Comment s'active le tout premier Dispositif ?**
Réponse du PO : « on demande d'abord de créer un utilisateur dans le groupe risque au niveau hiérarchique le plus élevé ; à défaut, l'administrateur du client (différent du demandeur), avec motif et trace, une seule fois. »
Effet : 7.2, puce « Première activation ».

**Q-E2-7 (q29). Limites d'une règle de Comité personnalisée.**
Réponse du PO : planchers fixes seulement ; quorum impossible = envoi refusé puis escalade.
Effet : 6.2, deux phrases ajoutées. La destination de l'escalade (q37) a été tranchée par DECISION-038 point 1, puis révisée par DECISION-039 point 3 ; elle est reportée en 6.2 (Audit, puis responsable du risque, avec consultation s'il est concerné).

**Q-E2-8 (q30). Que devient une saisie « Rejetée » ?**
Réponse du PO : rejet = comme un retour, gardé en historique et compté.
Effet : 3.3 et résumé (point 8).

**Q-E2-9 (q31). Revue d'un risque sans autre membre disponible.**
Réponse du PO : l'approbateur choisi au Dispositif, avec alerte à l'équipe risque.
Effet : 3.2 et résumé (point 6). Précisé par DECISION-035 (q36) : Audit si son groupe n'est pas vide, puis Comité, puis suppléance (ordre après Audit : [Rédaction]).

**Q-E2-10 (q32). Contributions : « Sans suite ».**
Réponse du PO : « Sans suite » sans commentaire, avec possibilité de le retirer s'il n'est pas pertinent. Confirmé par DECISION-035 (q38) : « Sans suite » est retiré ; le Dispositif permet de créer des statuts de contribution personnalisés.
Effet : §7 (partie 5). Règle fixe maintenue : tout statut d'écartement porte une trace.

**Q-E2-11 (q33). Reprise de registre : qui est l'auteur d'une proposition importée ?**
Réponse du PO : l'auteur d'une cotation importée est la personne qui importe ; Résiduel importé par l'équipe risque seulement.
Effet : 3.4.

---

### 11 bis. Réponses du PO q42 à q57 (DECISION-040, 2026-10-11)

| Question | Réponse du PO | Effet sur le texte |
|---|---|---|
| q42 (B8-1) | Risk Manager : droits larges, jamais approuver ce qu'il a saisi ; Comité : lecture + vote ; Audit : lecture seule sur tout ; le groupe Audit remplace le rôle « Auditeur » | 3.1 |
| q43 (B8-2) | Risk Manager + Audit interdit ; Risk Manager + Comité autorisé, affiché sur la fiche ; interdiction des cumuls configurable sauf Risk Manager + Comité | 3.1 ; portée : q58 |
| q44 (B8-3) | Motif obligatoire pour entrer/sortir des 3 groupes fixes, sans approbateur tiers (MVP) | 3.1 |
| q45 (B8-4) | Seul l'administrateur de l'application modifie les droits du groupe Audit, tracé ; s'il est aussi responsable de la fonction risque, Audit ou le Comité valide | 3.1, 7.7 |
| q46 (B8-5) | Rattachement Processus → département obligatoire dès maintenant pour les nouveaux ; existants rattachés avant l'ouverture aux utilisateurs, puis NOT NULL | 3.1 |
| q47 (B8-6) | « Département = groupe » confirmé | 3.1, résumé 3 |
| q48 (F-B8-06) | Fenêtre « droits perdus » : afficher les noms de ceux qui peuvent redonner les droits (exception à q02 / DECISION-011, limitée à ce cas) | Hors contrat (écran) ; consigné pour mémoire |
| q49 (B9-1) | Taille de matrice choisie au Dispositif ; plafond n², bandes, seuils, nombre de descriptifs, côté serveur ; effet visuel : q59 | §6, résumé 1 ; Cartographie non touchée |
| q50 (B9-2) | Descriptifs facultatifs en brouillon, obligatoires pour activer l'échelle | §6 |
| q51 (E2-C8) | Administrateur retiré ; seul un membre Risk Manager active le premier Dispositif ; le premier utilisateur créé par l'administrateur est le Risk Manager | 7.2, résumé 11 ; clôt Q-37i |
| q52 (Q-37a/b) | « Consultation » = co-signature tracée au journal, journal visible par le Comité et Audit, sans autre restriction ; refus de co-signer : q60 | 3.1, 6.2 ; clôt Q-37a et Q-37b |
| q53 (Q-37c/d) | Responsable exclu s'il est demandeur ou auteur ; co-signature seulement s'il est Risk Owner, Délégué ou Exécuteur ; « responsable du risque » = responsable de la fonction risque | 3.1, 6.2 ; clôt Q-37c et Q-37d |
| q54 (Q-37e) | Un seul circuit : Comité, puis Audit, puis fonction risque, avec journalisation ; vue des décisions prises en l'absence d'un nouveau membre | 3.1, 3.2, 6.2, 7.7 ; clôt Q-37e et la cohérence q31 ; remplace q31 et q41 |
| q55 (Q-37f) | Aucun quorum forcé par défaut pour les décisions ; système souple, actions journalisées ; règle par défaut : q61 | 6.2 ; révise q27 |
| q56 (Q-37g) | Motif obligatoire et tracé ; Audit prévenu chaque fois qu'il n'est pas décideur | 3.1, 6.2 ; clôt Q-37g |
| q57 (Q-37h) | Votes déjà émis conservés dans l'historique, visibles par le décideur, non comptés | 6.2 ; clôt Q-37h |

Réserve de Gitar (PR #154), notée par la décision : q37, q54 et q55 classés « risque élevé » (décisions de risque possibles sans contrôle indépendant du Comité). Choix du PO assumé (journalisation et vue dédiée Comité/Audit) ; revue Compliance (A14) demandée.

---

## 12. Relecture produit (A03, 2026-10-11) : corrections

Corrections faites dans ce projet :
1. §2 : supprimé « la direction du département désigne les membres du groupe de ce département » (règle non décidée) ; ajouté Q-E2-1 (réponse reçue : voir section 11).
2. §3.1 : supprimé « un membre du groupe Risk Manager peut agir sur tout risque du tenant » (non décidé, élargit les droits).
3. §6.2 : règles du Comité réécrites avec la réponse du PO à q05 (A, B, C, planchers fixes, trois réponses) ; ajout de « jamais de clôture automatique » ; marqué [Rédaction] ce qui ne vient pas du PO.
4. §7.3 : ligne ajoutée « changement de mode d'un Processus » (DECISION-018 P2, omise) ; ligne « seuils Comité » ramenée au contrat actuel ; « cinq lignes » corrigé (il y en a plus) ; suppression de « Comité par défaut » présenté comme acquis.
5. §7.4 : « activé par le Comité » confirmé par DECISION-019 ; ancienne question 9 supprimée.
6. §7.7 : « l'administrateur du Dispositif (`riskframework.update`) » remplacé : marqué [Rédaction].
7. §7.2 : noms « Prudent / Standard / Léger » retirés du texte (non décidés) ; dernière phrase marquée [Rédaction].
8. §9 : marqué [Rédaction] le report du contrat événementiel complet, des tests temps réel et la liste « événements nommés et versionnés » (vient de la roadmap, pas de DECISION-020).
9. Marqué [Rédaction] : « proposée » (§4), « on ne peut pas retirer son dernier membre » (§3.1), « quand le §5 l'autorise » et « validée par un tiers » (§6.1), « versionnés avec lui » (§7.1), « un Comité vide ne peut pas activer » (§7.4).
10. Questions : 12 réduites à 11, réécrites en langage simple, numérotées Q-E2-n. Elles ont reçu une réponse du PO le 2026-10-11 (section 11).

Fait depuis par l'orchestrateur : la réponse du PO à q05 est inscrite (DECISION-026) et Q-E2-1 à Q-E2-11 sont tranchées (DECISION-033 et DECISION-034).

---

## 13. Points restant à confirmer par le PO

Points q34, q35, q36, q38 et q39 tranchés par DECISION-035 (2026-10-11) et reportés dans le texte.

### 13.1 Questions encore ouvertes (DECISION-040, 2026-10-11)

Posées au PO dans l'artefact Pilotage (ligne `ACTION_ITEMS.md`, owner HUMAN, statut Ouvert). Rien n'est tranché ; le texte ne les devance pas.

- **q58. Portée du réglage de cumul (q43).** L'interdiction des cumuls est configurable sauf Risk Manager + Comité : le réglage s'applique-t-il à Risk Manager + Audit seulement, ou à d'autres cumuls (par exemple Comité + Audit) ?
- **q59. Cartographie (q49).** La taille de matrice doit s'aligner « visuellement côté frontend » ; cela entre en tension avec la consigne permanente du PO de ne pas modifier la page Cartographie. Le PO doit dire ce qui est autorisé. Aucune modification de la page n'est décrite dans ce document.
- **q60. Refus de co-signer (q52).** Que se passe-t-il quand le membre sollicité refuse de co-signer (autre co-signataire, escalade, blocage) ?
- **q61. Règle de décision par défaut sans quorum (q55, révise q27).** Sans quorum forcé, quelle règle de décision s'applique par défaut (qui décide, combien de voix, ou décision du responsable journalisée) ?
- **R1 (revue Compliance A14, `docs/security/compliance-DECISION-040.md`), rattaché à q61. Portée de « pas de quorum ».** Désigne-t-il la décision de repli (circuit unique, 6.2) ou le vote du Comité lui-même ? Conflit apparent avec DECISION-026 et l'invariant 10 (« jamais un seul membre », quorum de 2 seulement en règle A). Non tranché.
- **R2 / q62. Garde-fous des décisions prises en repli**, en particulier quand Audit (3e ligne) décide. A14 évoque marquage, indicateur et ratification a posteriori par le Comité ; ce sont des suggestions de la revue, non décidées. Non tranché.
- **R3 / q63. Administrateur = Risk Manager.** Cumul auto-attribué à l'amorçage du premier Dispositif (q51) et à la modification des droits d'Audit (q45). A14 évoque marquage, motif et notification d'une tierce personne ; non décidé. Non tranché.

### 13.2 Historique : questions closes par DECISION-040

Q-37a et Q-37b (q52), Q-37c et Q-37d (q53), Q-37e et « cohérence avec q31 / 3.2 » (q54), Q-37f (q55, partiellement : la règle par défaut devient q61), Q-37g (q56), Q-37h (q57), Q-37i (q51). Le détail des anciennes questions et recommandations est conservé ci-dessous pour la traçabilité ; les réponses du PO sont dans la section 11 bis.

### 13.3 Historique (avant DECISION-040)

1. **Q-E2-7 / q29 / q37. Révisé par DECISION-039 point 3 (2026-10-11), qui remplace DECISION-038 point 1 ; précisé par DECISION-040 (q52 à q57).** Quand le quorum d'une règle de Comité est impossible (trop de votants exclus ou échéance dépassée) : l'envoi au Comité est refusé et la demande passe à Audit ; si le groupe Audit est vide, au responsable du risque (membre du groupe Risk Manager) ; s'il est lui-même concerné, il décide avec la consultation d'un autre membre du groupe Risk Manager (paramètre configurable dans l'administration). Décision inscrite au journal des décisions prises en l'absence du Comité ; jamais de validation tacite ; jamais l'administrateur du client. Reporté en 6.2.
2. ~~**q41 (DECISION-039 point 5). Confirmé, texte déjà conforme.** Un Comité vide peut être choisi comme approbateur du Dispositif et la suppléance s'applique (7.7, 3.1).~~ **Remplacé par DECISION-040 q54** : un Comité vide suit le circuit unique Comité, Audit, fonction risque (la suppléance directe disparaît).

**Questions au PO induites par la révision de q37 : CLOSES par DECISION-040 (texte conservé pour la traçabilité).**

- **Q-37a. Que veut dire « avec consultation » ?** Fait : DECISION-039 ne le précise pas. Hypothèses : (i) avis obligatoire mais non contraignant ; (ii) co-signature. Recommandation : le responsable concerné décide seul d'un risque qui le concerne, ce qui contredit l'invariant 1 (« on ne valide jamais ce qu'on a saisi, revu ou exécuté »). Je recommande donc une consultation obligatoire (impossible à désactiver), écrite, motivée et tracée, du membre non concerné ; avec un désaccord exprimé par le consulté, la décision est escaladée à HUMAN au lieu d'être prise. Si le PO veut seulement un avis non contraignant, le risque résiduel de juge et partie reste, à accepter explicitement et à suivre par un indicateur.
- **Q-37b. Que configure le « paramètre configurable dans l'administration » ?** Hypothèses : (i) l'activation de la consultation ; (ii) le choix de la personne consultée ; (iii) la forme (avis ou co-signature). Recommandation : le paramètre choisit la forme (avis tracé ou co-signature) et le groupe d'où vient le consulté, sans jamais pouvoir supprimer la consultation (invariant 8 : un paramètre n'abaisse pas un invariant). Valeur par défaut recommandée : avis obligatoire, motivé et tracé, avec escalade à HUMAN en cas de désaccord (l'option co-signature plus stricte est proposée au client). La modification suit la gouvernance de 7.7.
- **Q-37c. Tension avec q35 (garde-fous de la suppléance).** q35 interdit à la fonction risque de suppléer sur un acte dont la personne est l'auteur, le Risk Owner, le Délégué ou l'Exécuteur, et de rester le demandeur. La nouvelle règle laisse décider un responsable « lui-même concerné », avec consultation. Question : la consultation remplace-t-elle ce garde-fou pour ce seul cas, ou « concerné » ne vise-t-il que le Risk Owner et pas l'auteur du changement ? Recommandation : conserver q35 sur « jamais le demandeur » et « jamais pour activer l'auto-proposition », et n'ouvrir l'exception de la consultation que pour le Risk Owner, Délégué ou Exécuteur du risque.
- **Q-37d. Qui est « le responsable du risque » ?** L'ancien texte visait le responsable du service risque (3.1, q24) ; DECISION-039 dit « responsable du risque (membre du groupe Risk Manager) ». Est-ce le responsable de la fonction risque ou le Risk Owner du risque (qui est un responsable métier, pas toujours membre du groupe Risk Manager) ? Recommandation : le responsable de la fonction risque défini en 3.1, car le Risk Owner est par nature concerné.
- **Q-37e. Deux chemins pour un Comité indisponible.** Un Comité vide (q41, 3.1) va à la suppléance de la fonction risque, sans passer par Audit ; un quorum impossible va d'abord à Audit. Est-ce voulu ? Recommandation : aligner les deux sur l'ordre Audit, puis fonction risque, ou confirmer la différence.
- **Q-37f. Règle de vote d'Audit.** Audit vote avec les règles du Comité (q27) : un quorum impossible pour le Comité peut l'être aussi pour Audit (petit groupe). Audit décide-t-il alors par vote, ou un seul auditeur suffit-il (contraire à « jamais un seul membre ») ? Et si Audit était déjà l'approbateur choisi, la boucle est possible. Recommandation : quorum d'Audit à vérifier, repli au responsable du risque si impossible, jamais une personne seule d'Audit.
- **Q-37g. Éléments disparus de la règle.** « Motif obligatoire et trace » et « Audit notifié » (DECISION-038) ne figurent plus dans DECISION-039. Le texte les retire du 6.2 sans les inventer. Recommandation : maintenir motif et trace (invariant 7, q35) ; « Audit notifié » seulement quand Audit n'a pas décidé (sinon il est le décideur).
- **Q-37h. Échéance dépassée.** Un vote déjà ouvert est-il annulé ou ses votes sont-ils conservés quand la demande passe à Audit ? Recommandation : conserver les votes en historique (append-only) et ne pas les compter dans la nouvelle décision.
- **Q-37i. Premier Dispositif (vigilance maintenue, texte inchangé).** La règle « Premier Dispositif » (résumé point 11, 7.2, Q-E2-6) cite encore l'administrateur du client comme dernier recours d'activation, alors que le PO l'écarte pour q37 parce qu'il peut être de l'équipe technique. À confirmer par le PO si cette règle doit rester telle quelle. Recommandation : remplacer par un membre de plus haut niveau du groupe Risk Manager approuvé par HUMAN, ou par HUMAN seul pour la toute première activation.
- **Cohérence avec q31 / 3.2 et q36.** Les deux chaînes d'escalade (3.2 : Audit, Comité, suppléance ; 6.2 : Audit, responsable du risque) ne sont pas identiques. Elles restent cohérentes sur le premier maillon (Audit) et sur le journal des absences du Comité. Question : faut-il unifier les maillons suivants ? Recommandation : oui, une seule chaîne dans le contrat.

---

## Suite

1. Fait : le PO a validé le texte final (DECISION-038, 2026-10-11) et révisé q37 (DECISION-039 point 3). DECISION-040 (q42 à q57) est intégrée : Q-37a à Q-37i et la cohérence des chaînes d'escalade sont closes. Restent à confirmer : q58 à q63 (section 13.1, dont R1 à R3 de la revue Compliance).
2. Fait : le texte est reporté dans le contrat (A13), l'étape 2 est marquée FAIT dans `RM-V1-Sequence-actions.md`.
3. À faire : relecture A03 (R1.1). L'étape 2 débloque B-9 et B-6 (étapes 8 et 9).
