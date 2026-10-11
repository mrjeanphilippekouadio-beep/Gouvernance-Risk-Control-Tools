# RM V1 — Étape 2 : projet de report des décisions dans le contrat

**Statut : PROJET, réponses du PO intégrées (2026-10-11, dont DECISION-035), en attente de validation finale du PO ; seul le point q37 reste à valider.** Le contrat `.claude/agent-context/RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` n'est pas modifié.
Auteur : Risk Manager (A13), 2026-10-11. Relu par le Product Manager (A03) le 2026-10-11 : voir la section 12. Tâche R1.1 de `docs/ROADMAP-V1.md`, étape 2 de `docs/architecture/RM-V1-Sequence-actions.md`.
Décisions reportées : DECISION-016 à 020, plus les décisions suivantes qui touchent le contrat (021, 025, 026, 027, 029, 030), plus les réponses du PO aux questions Q-E2-1 à Q-E2-11 (DECISION-033 et DECISION-034, 2026-10-11), plus les confirmations q34 à q39 (DECISION-035, 2026-10-11).
Distinction utilisée : **[PO]** = décidé par le PO, repris tel quel (avec la référence de la décision). **[Rédaction]** = conséquence formulée par le rédacteur, pas écrite dans une décision : le PO la valide ou la refuse avec le reste. **Interprétation à confirmer** = lecture d'une réponse du PO qui n'est pas certaine : elle est reprise dans la section 13.
Le cadre de la page Cartographie n'est pas touché par ce projet.

---

## Ce qui change pour l'utilisateur (à lire seul)

1. **Le Dispositif devient plus complet.** À sa création, on choisit la taille de l'échelle (3, 4, 5 ou 6), les axes d'impact (7 au maximum) et on écrit le descriptif de chaque niveau, pour la probabilité et pour chaque axe. La probabilité et tous les axes ont la même taille d'échelle. L'impact retenu reste le maximum des axes. Le Dispositif est choisi à la création de l'espace client et/ou à la création du Dispositif ; les risques sont affichés par Dispositif, un Dispositif à la fois.
2. **L'appétence et les grilles de cotation passent dans le Dispositif.** Elles suivent les mêmes règles de version et d'approbation que les autres paramètres. On peut activer un Dispositif par défaut, et la création se fait par un assistant pas à pas (une saisie directe reste possible pour les experts).
3. **L'« équipe risque » est un groupe précis** : le groupe Risk Manager, qui ne peut jamais être vide. Son responsable est le responsable du service risque, qui a des droits sur tous les risques, les contrôles et l'administration. Deux autres groupes fixes existent (Risk Committee et Audit) et peuvent être vides. Les départements sont aussi des groupes ; la direction d'un département est le membre hiérarchiquement au-dessus des autres.
4. **Les changements du Dispositif.** Par défaut, la fonction risque approuve et Audit est notifié si son groupe n'est pas vide ; le Dispositif peut exiger l'approbation d'Audit et/ou du Comité (validé, q34). Audit vote avec les mêmes règles que le Comité, avec un avertissement et un indicateur. Si le Comité est vide, une personne au moins de la fonction risque prend en charge ce que le Comité aurait approuvé (DECISION-033 et q35, avec garde-fous). Les groupes Comité et Audit ont chacun un journal des décisions prises en leur absence.
5. **Se désigner soi-même reste interdit, sauf si le Dispositif l'autorise.** Ce réglage est désactivé par défaut. Seul le Comité peut l'activer. Même activé, un autre membre du groupe Risk Manager doit approuver.
6. **Un membre de l'équipe risque ne revoit pas un risque dont il est Risk Owner, Délégué ou Exécuteur.** Un autre membre s'en charge. Si toute l'équipe risque est concernée, la revue passe à Audit si son groupe n'est pas vide, puis au Comité, puis à la suppléance ; l'équipe risque est alertée. Sur les autres risques, il travaille normalement.
7. **Le Risk Owner enregistre lui-même la décision de traitement.** Il n'y a plus de « proposeur ». L'équipe risque peut seulement joindre une recommandation qui ne lie personne.
8. **« Retourné » et « Rejeté » sont deux états différents, avec le même effet pratique.** Retourné : on demande ou on apporte une précision. Rejeté : la saisie n'est pas applicable ou n'est pas bonne. Après un rejet, la saisie revient à la 1re ligne comme après un retour ; le rejet reste en historique et est compté.
9. **Le Comité peut voter à distance, avec une règle choisie à la création du Dispositif** : A Léger (2 votants d'accord, 5 jours), B Standard (majorité, 3 votants au moins, 10 jours), C Strict (unanimité, 15 jours), ou une règle personnalisée (seuls les planchers fixes s'imposent ; si le quorum est impossible, l'envoi est refusé puis escalade ; destinataire : proposition en attente, q37). Le PO ne fixe pas de règle par défaut. Dans toutes les règles : pas de validation par silence, jamais un seul membre, auteurs et Risk Owner / Délégué / Exécuteur ne votent pas, vote motivé et tracé, escalade à l'échéance (jamais de clôture automatique), groupe vide refusé. Un vote peut être retiré tant que la décision n'est pas close.
10. **Le Risk Owner statue sur chaque contribution** (retenue ou écartée avec motif ; « Sans suite » est retiré ; le Dispositif permet de créer des statuts de contribution personnalisés, et tout statut d'écartement porte une trace). L'import d'un registre ne contourne jamais la revue : l'auteur d'une cotation importée est la personne qui importe, et seule l'équipe risque importe un Résiduel.
11. **Premier Dispositif.** On demande d'abord de créer un utilisateur dans le groupe risque au niveau hiérarchique le plus élevé ; à défaut, l'administrateur du client (différent du demandeur) l'active, avec motif et trace, une seule fois.
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
> **Responsable de la fonction risque.** Le « responsable de la fonction risque » est le responsable du service risque : il a des droits sur tous les risques, les contrôles et l'administration. Il peut suppléer le Comité si le groupe Risk Committee est vide.
> **Suppléance du Comité.** Si le groupe Risk Committee est vide, le groupe Risk Manager (la fonction risque) prend en charge ce que le Comité aurait approuvé. *(Rédaction, garde-fous proposés par l'orchestrateur et non confirmés par le PO : l'approbateur est un autre membre du groupe que le demandeur, motif obligatoire, trace d'audit, cumul marqué ; un groupe Risk Manager d'un seul membre ne peut pas s'approuver lui-même. Voir les conflits signalés en section 11.)*

**Source** : DECISION-016 (Q10) ; DECISION-034 (q24 / Q-E2-2) pour la définition du responsable ; DECISION-033 pour la suppléance. **[PO]** sauf les précisions en italique. (Le projet initial ajoutait « un membre du groupe Risk Manager peut agir sur tout risque du tenant » : règle non décidée, supprimée. Les droits « sur tous les risques » viennent de la décision q24 et sont attribués au responsable, pas à tous les membres.)

### 3.2 Conflit de rôles d'un membre de l'équipe risque (nouveau paragraphe)

**Texte proposé**
> **Conflit de rôles.** Un membre du groupe Risk Manager qui est Risk Owner, Délégué ou Exécuteur d'un risque ne saisit ni ne revoit ce risque. Un autre membre du groupe le fait. S'il n'y en a pas, la revue passe à l'**approbateur choisi au Dispositif** et l'équipe risque est alertée (signe de sous-effectif). Sur les autres risques, ce membre agit normalement. Le cumul est marqué visiblement (invariant 6).

**Source** : DECISION-019 (P5) ; DECISION-034 (q31 / Q-E2-9) pour le choix de l'approbateur et l'alerte. **[PO]** Cas où le Dispositif n'a que l'approbateur par défaut (la fonction risque elle-même) : voir section 13.

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
> **Chaque niveau porte son propre descriptif**, pour la probabilité et pour chaque axe (exemple : échelle de 5, donc 5 descriptifs pour la probabilité et 5 par axe). Les descriptifs sont saisis à la création du Dispositif.
> Le nombre d'axes reste déterminé par l'échelle du Dispositif applicable, jamais par le code.
> `Impact retenu = MAX(valeur de tous les axes configurés)` (inchangé)
> Le frontend itère dynamiquement sur les axes retournés par le backend. **Aucun code ne doit supposer 7 axes** (inchangé). Un changement d'échelle, d'axe ou de descriptif crée une nouvelle version du Dispositif et ne touche que les cycles à venir (invariant 9).
> **Affichage.** Un Dispositif est choisi une seule fois, à la création ; les risques sont affichés par Dispositif, un à la fois.

**Décision source** : DECISION-016 (Q11 et complément du PO) ; DECISION-034 (q25 / Q-E2-3) pour la dernière phrase. **[PO]** pour le contenu. La phrase « Un changement d'échelle… » est **[Rédaction]** : elle découle du versionnement du §10 et de l'invariant 9. « Corrélée » veut dire « même taille d'échelle », pas une grille croisée (retenu par le PO). La réponse q25 est une règle d'affichage : ce projet ne propose aucun changement d'écran. Sur quoi porte « choisi une seule fois à la création » : section 13.

---

## 5. §7 Modes et contributions

**Texte actuel** (extrait)
> - types : Identification ; Analyse ; Inherent ; Maîtrise ;

**Texte proposé** (nouveau paragraphe après la liste des types)
> **Statut d'une contribution.** Le Risk Owner statue sur chaque contribution : **Retenue**, **Écartée** (motif obligatoire) ou **Sans suite**. **« Sans suite » ne demande pas de commentaire ; il peut être retiré s'il n'est pas pertinent.** Le Délégué peut statuer si le Dispositif le prévoit ; l'auteur de la contribution ne statue jamais sur la sienne. Chaque décision est conservée en historique (append-only). Cette règle est configurable dans le Dispositif. « Retenue » qualifie l'information reçue, jamais la cotation (Contribution ≠ Saisie).

**Décision source** : DECISION-025, q04 (OD-4) ; DECISION-034 (q32 / Q-E2-10). **[PO]** pour les trois statuts, le Délégué, l'historique, « configurable », l'absence de commentaire pour « Sans suite » et la possibilité de le retirer. La dernière phrase est **[Rédaction]**, tirée du principe déjà au contrat (« une contribution apporte de l'information et ne cote jamais »). **Interprétation à confirmer** : « le retirer » est lu comme annuler le statut « Sans suite » (la contribution redevient à statuer), l'historique append-only gardant la trace de la décision et de son retrait. Le sens exact de « Sans suite » et ce qui est « configurable » (place du Délégué) n'ont pas été précisés par la réponse : section 13.

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
> **Vote du Comité à distance.** Le Comité peut valider par vote asynchrone, sans séance. À la création du Dispositif, le client choisit une règle parmi trois règles prédéfinies, ou crée une **règle personnalisée** (groupes qui valident, quorum, majorité, délai, relances). Aucune règle n'est imposée par défaut. **Une règle personnalisée n'est limitée que par les règles fixes ci-dessous. Si le quorum est impossible (par exemple parce que presque tous les éligibles sont exclus du vote), l'envoi est refusé, puis il y a escalade.**
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

**Décision source** : DECISION-026 (q05, B-12), réponses du PO à q05 et aux trois questions de DECISION-017 point 4 (cockpit, transmises par l'orchestrateur A02 ; pas encore inscrites dans le Decision Log, voir section 12) ; DECISION-034 (q29 / Q-E2-7 pour la règle personnalisée, q27 / Q-E2-5 pour Audit). **[PO]** pour tout le tableau, toutes les règles fixes, la phrase sur la règle personnalisée et le paragraphe Audit. **[Rédaction]** : « le retrait étant lui aussi tracé » (conséquence de « vote tracé ») ; les cellules « — » signifient « non précisé par le PO », pas « sans relance ». La cohérence avec le plancher « jamais un seul membre » (le quorum de 2 reste donc le minimum) est vérifiée. Vers qui se fait l'escalade quand le quorum est impossible : section 13.

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
> - **Première activation.** Pour activer le tout premier Dispositif, on demande d'abord de créer un utilisateur dans le groupe risque au niveau hiérarchique le plus élevé. À défaut, l'administrateur du client, différent du demandeur, l'active, avec motif et trace, **une seule fois**.

**Source** : DECISION-017, points 1 et 5 ; DECISION-034 (q28 / Q-E2-6). **[PO]** sauf la phrase sur les Dispositifs par défaut qui respectent les invariants, **[Rédaction]** (elle applique l'invariant 8). Le contenu des Dispositifs par défaut est le lot B-13, rédigé à part. Le principe de suppléance de DECISION-033 (groupe Comité vide) s'ajoute à ce cas (section 3.1).

### 7.3 Table des paramètres

Lignes modifiées ou ajoutées. Les autres lignes ne changent pas.

| Ligne | Texte actuel | Texte proposé | Source |
|---|---|---|---|
| Mode par défaut | Mode par défaut (tenant, puis Processus — DECISION-006) : Classique | Mode par défaut **porté par le Dispositif**, puis Processus (DECISION-006) : Classique. `Config.evaluationMode` devient obsolète. | DECISION-018 P1 [PO] |
| Changement de mode d'un Processus | (non écrit) | Validé par la fonction risque. `process.evaluationmode.set` est retiré. | DECISION-018 P2 [PO] (ajouté à la relecture, omis du projet initial) |
| Seuil de criticité « faible » | Inscrit à la création du Dispositif | **Configurable** par le groupe Risk Manager ; tout changement est tracé et approuvé (7.7) | DECISION-016 [PO] |
| Approbateur d'un changement de paramètre | Responsable de la fonction risque ; Comité pour la séparation des tâches | **Par défaut : la fonction risque approuve et Audit est notifié si son groupe n'est pas vide.** Le Dispositif peut exiger l'approbation d'**Audit et/ou du Comité**. Audit vote avec les règles du Comité (6.2). Détail et lecture : 7.7 et section 13 | DECISION-016, DECISION-018 P6, DECISION-034 q26 et q27 [PO] ; lecture de q26 : interprétation à confirmer |
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

**Décision source** : DECISION-018 (P3 : l'interdiction doit rester configurable) et DECISION-019 (P3 : réécriture proposée par l'Architecte, acceptée ; « activé par le Comité » est explicite). **[PO]** La réécriture règle la tension avec l'invariant 8 : c'est l'invariant lui-même qui prévoit le paramètre, donc rien n'est abaissé. En attendant le paramètre, le refus strict de l'auto-désignation (lot B-0) reste le comportement. Qui active le paramètre n'est plus une question : le Comité, par DECISION-019. (Conséquence de la règle « groupe vide refusé » : un Comité vide ne peut pas l'activer, **[Rédaction]**. La suppléance de DECISION-033 pourrait contredire cette phrase : conflit signalé en section 11, Q-E2-2 / DECISION-033.)

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
> […] Les possibilités de configuration sont détenues par la fonction risque (groupe Risk Manager) et tracées. Le changement est demandé avec un motif écrit. **Par défaut, la fonction risque approuve le changement, différente du demandeur, et Audit est notifié si son groupe n'est pas vide. Le Dispositif peut exiger l'approbation d'Audit et/ou du Comité.** *(Interprétation à confirmer, voir section 13 : « les changements sont au niveau du risque » est lu comme « la fonction risque approuve », la notification d'Audit n'est pas une approbation, et « et/ou » veut dire que le Dispositif peut exiger l'un, l'autre ou les deux.)* Quand l'approbateur est Audit, il vote avec les règles du Comité (§8). Si le groupe Comité est vide, la fonction risque prend en charge ce que le Comité aurait approuvé (3.1). *(Rédaction : on ne peut pas vider un groupe déjà choisi comme approbateur ; la réponse sur le Comité vide (DECISION-033) rend la règle « un groupe vide ne peut pas être choisi » à reconfirmer pour le Comité, voir section 13.)* Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Tant que l'approbateur n'a pas décidé, la version reste en `DRAFT` ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. Quand l'approbateur est le Comité, il décide en séance ou par vote asynchrone selon sa règle (§8). L'audit conserve l'ancienne et la nouvelle valeur.

**Décision source** : DECISION-016 (configuration tenue par le groupe Risk Manager, approbateur configurable), DECISION-018 (P6, groupe vide), DECISION-017 point 4 et DECISION-026 (Comité à distance), DECISION-033 (Comité vide), DECISION-034 (q26 / Q-E2-4, q27 / Q-E2-5). **[PO]** pour le contenu des réponses citées ; la lecture de q26 est une interprétation à confirmer. **[Rédaction]** : le vidage d'un groupe choisi, le renvoi au vote à distance, et le remplacement de « l'administrateur du Dispositif (`riskframework.update`) » par une formulation sans rôle nommé. Première activation : 7.2.

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
Effet : §5 (3.1) : définition et suppléance ; 7.8 : renvoi à 3.1. Conflits avec les règles fixes, voir ci-dessous.

*Cohérence de DECISION-033 / q24 avec les règles fixes (conflits à lever, recommandations de garde-fou) :*
- **Jamais un seul membre.** La suppléance, si elle revient à un seul approbateur, remplace un organe collégial par une personne. *Garde-fou recommandé* : la suppléance exige l'approbation de deux membres du groupe Risk Manager au moins, ni l'un ni l'autre n'étant le demandeur ; sinon l'envoi est refusé et escalade (même logique que Q-E2-7).
- **Jamais validateur de ce qu'il a saisi.** Le responsable a des droits sur tous les risques et l'administration : il peut être demandeur et approbateur d'un même changement. *Garde-fou recommandé* : la suppléance ne s'applique jamais à un acte dont le responsable est l'auteur, le Risk Owner, le Délégué ou l'Exécuteur ; un autre membre approuve (c'est déjà le texte proposé de DECISION-033).
- **Auto-proposition (DECISION-019 P3 : activée par le Comité).** Si le Comité est vide, la fonction risque pourrait activer sa propre auto-désignation, ce qui vide l'invariant 5. *Garde-fou recommandé* : la suppléance du Comité ne couvre jamais l'activation de l'auto-proposition ; si le Comité est vide, la demande est refusée ou renvoyée à HUMAN.
- **« Groupe vide refusé ».** Cette règle (6.2, 7.7) interdit de solliciter un Comité vide ; la suppléance la contourne dans l'esprit. *Recommandation* : écrire que la suppléance remplace l'envoi refusé, sans le supprimer, et la tracer comme telle.

**Q-E2-3 (q25). Cartographie et tailles d'échelle différentes.**
Réponse du PO : « Un Dispositif est choisi une seule fois à la création ; les risques sont affichés par Dispositif, un à la fois. »
Effet : §6 (partie 4) : phrase « Affichage » ajoutée, et l'« effet de bord à confirmer » du projet initial est supprimé (réponse reçue). C'est une règle d'affichage : la page Cartographie n'est pas touchée et aucun changement d'écran n'est proposé.

**Q-E2-4 (q26). L'approbateur choisi approuve-t-il tous les changements ?**
Réponse du PO : « les changements sont au niveau du risque et l'audit est notifié si le groupe n'est pas vide, comportement par défaut ; on pourra choisir l'audit et/ou le comité. »
Effet : 7.3 (ligne « Approbateur »), 7.7 et résumé (point 4). **Interprétation à confirmer** : par défaut la fonction risque approuve les changements et Audit est seulement notifié (si son groupe n'est pas vide) ; le Dispositif peut exiger l'approbation d'Audit, du Comité, ou des deux. Ce choix remplace la valeur « Comité par défaut » de ma recommandation.

**Q-E2-5 (q27). Quand l'approbateur est Audit, qui décide ?**
Réponse du PO : Audit suit les mêmes règles de vote que le Comité, avec avertissement et indicateur.
Effet : §8 (6.2), paragraphe « Audit » ; 7.7.

**Q-E2-6 (q28). Comment s'active le tout premier Dispositif ?**
Réponse du PO : « on demande d'abord de créer un utilisateur dans le groupe risque au niveau hiérarchique le plus élevé ; à défaut, l'administrateur du client (différent du demandeur), avec motif et trace, une seule fois. »
Effet : 7.2, puce « Première activation ».

**Q-E2-7 (q29). Limites d'une règle de Comité personnalisée.**
Réponse du PO : planchers fixes seulement ; quorum impossible = envoi refusé puis escalade.
Effet : 6.2, deux phrases ajoutées. La destination de l'escalade n'est pas précisée : section 13.

**Q-E2-8 (q30). Que devient une saisie « Rejetée » ?**
Réponse du PO : rejet = comme un retour, gardé en historique et compté.
Effet : 3.3 et résumé (point 8).

**Q-E2-9 (q31). Revue d'un risque sans autre membre disponible.**
Réponse du PO : l'approbateur choisi au Dispositif, avec alerte à l'équipe risque.
Effet : 3.2 et résumé (point 6). Lien avec Q-E2-4 : voir section 13.

**Q-E2-10 (q32). Contributions : « Sans suite ».**
Réponse du PO : « Sans suite » sans commentaire, avec possibilité de le retirer s'il n'est pas pertinent.
Effet : §7 (partie 5). **Interprétation à confirmer** : « le retirer » = annuler le statut, la trace restant en historique. La réponse ne traite pas la place du Délégué ni le contenu du réglage « configurable » : le texte de DECISION-025 est conservé tel quel.

**Q-E2-11 (q33). Reprise de registre : qui est l'auteur d'une proposition importée ?**
Réponse du PO : l'auteur d'une cotation importée est la personne qui importe ; Résiduel importé par l'équipe risque seulement.
Effet : 3.4.

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

Seules les lectures douteuses sont listées ; aucune règle n'est inventée pour les combler.

1. **Q-E2-4 / q26 (interprétation).** Par défaut, la fonction risque approuve les changements du Dispositif et Audit est seulement notifié si son groupe n'est pas vide ; le Dispositif peut exiger l'approbation d'Audit, du Comité ou des deux. Est-ce bien cela, et « au niveau du risque » désigne-t-il la fonction risque ?
2. **DECISION-033 / q24 (garde-fous non confirmés).** Les garde-fous proposés par l'orchestrateur (autre membre que le demandeur, motif, audit, cumul marqué, un groupe Risk Manager d'un seul membre ne s'approuve pas) sont-ils validés ? Et le PO retient-il les trois garde-fous recommandés en section 11 : deux approbateurs au moins pour une suppléance, exclusion des actes dont le responsable est auteur ou concerné, et exclusion de l'activation de l'auto-proposition (DECISION-019 P3) ?
3. **DECISION-033 / « groupe vide ».** Un Comité vide peut-il être choisi comme approbateur d'un Dispositif (la suppléance s'applique alors), ou la règle « un groupe vide ne peut pas être choisi » (7.7) reste-t-elle valable pour le Comité ?
4. **Q-E2-9 / q31.** Si le Dispositif n'a que l'approbateur par défaut (la fonction risque elle-même, déjà concernée par le risque), qui revoit ? L'approbation d'Audit ou du Comité est-elle alors obligatoire, ou y a-t-il un autre recours ?
5. **Q-E2-7 / q29.** Vers qui se fait l'escalade quand le quorum est impossible (l'approbateur choisi, HUMAN, autre) ?
6. **Q-E2-10 / q32.** « Le retirer » signifie-t-il annuler le statut « Sans suite » (la contribution redevient à statuer) ? Et la place du Délégué ainsi que le contenu du réglage « configurable » restent à préciser.
7. **Q-E2-3 / q25.** « Un Dispositif est choisi une seule fois à la création » : à la création du risque (hypothèse retenue pour l'affichage) ou à la création du Dispositif ?

---

## Suite

1. Le PO lit le résumé et la section 13, et confirme ou corrige les points restants.
2. Il valide, refuse ou modifie le texte ; la décision est inscrite au Decision Log (règle 7bis).
3. Après validation, l'Orchestrateur applique le texte dans le contrat (A03 relit, R1.1) et l'étape 2 est marquée terminée dans `RM-V1-Sequence-actions.md`. Elle débloque B-9 et B-6 (étapes 8 et 9).
