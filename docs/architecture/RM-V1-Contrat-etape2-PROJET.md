# RM V1 — Étape 2 : projet de report des décisions dans le contrat

**Statut : PROJET, en attente de validation du PO.** Le contrat `.claude/agent-context/RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` n'est pas modifié.
Auteur : Risk Manager (A13), 2026-10-11. Relu par le Product Manager (A03) le 2026-10-11 : voir la section 12. Tâche R1.1 de `docs/ROADMAP-V1.md`, étape 2 de `docs/architecture/RM-V1-Sequence-actions.md`.
Décisions reportées : DECISION-016 à 020, plus les décisions suivantes qui touchent le contrat (021, 025, 026, 027, 029, 030).
Distinction utilisée : **[PO]** = décidé par le PO, repris tel quel. **[Rédaction]** = conséquence formulée par le rédacteur, pas écrite dans une décision : le PO la valide ou la refuse avec le reste. **[À CONFIRMER]** = ne peut pas être tranché par le texte : voir la section 11 (questions Q-E2-n).

---

## Ce qui change pour l'utilisateur (à lire seul)

1. **Le Dispositif devient plus complet.** À sa création, on choisit la taille de l'échelle (3, 4, 5 ou 6), les axes d'impact (7 au maximum) et on écrit le descriptif de chaque niveau, pour la probabilité et pour chaque axe. La probabilité et tous les axes ont la même taille d'échelle. L'impact retenu reste le maximum des axes.
2. **L'appétence et les grilles de cotation passent dans le Dispositif.** Elles suivent les mêmes règles de version et d'approbation que les autres paramètres. On peut activer un Dispositif par défaut, et la création se fait par un assistant pas à pas (une saisie directe reste possible pour les experts).
3. **L'« équipe risque » est un groupe précis** : le groupe Risk Manager, qui ne peut jamais être vide. Deux autres groupes fixes existent (Risk Committee et Audit) et peuvent être vides. Les départements sont aussi des groupes.
4. **Qui approuve un changement du Dispositif se choisit** : Audit ou Comité. Un groupe vide ne peut pas être choisi. (Rédaction : on ne peut pas non plus vider un groupe déjà choisi.) Si cela vaut pour tous les changements ou seulement la séparation des tâches : Q-E2-4.
5. **Se désigner soi-même reste interdit, sauf si le Dispositif l'autorise.** Ce réglage est désactivé par défaut. Seul le Comité peut l'activer. Même activé, un autre membre du groupe Risk Manager doit approuver.
6. **Un membre de l'équipe risque ne revoit pas un risque dont il est Risk Owner, Délégué ou Exécuteur.** Un autre membre s'en charge. S'il n'y en a pas, la revue passe à Audit ou au Comité (lequel : Q-E2-9). Sur les autres risques, il travaille normalement.
7. **Le Risk Owner enregistre lui-même la décision de traitement.** Il n'y a plus de « proposeur ». L'équipe risque peut seulement joindre une recommandation qui ne lie personne.
8. **« Retourné » et « Rejeté » deviennent deux états différents.** Retourné : on demande ou on apporte une précision. Rejeté : la saisie n'est pas applicable ou n'est pas bonne. Ce qui se passe après un rejet n'est pas décidé : Q-E2-8.
9. **Le Comité peut voter à distance, avec une règle choisie à la création du Dispositif** : A Léger (2 votants d'accord, 5 jours), B Standard (majorité, 3 votants au moins, 10 jours), C Strict (unanimité, 15 jours), ou une règle personnalisée. Le PO ne fixe pas de règle par défaut. Dans toutes les règles : pas de validation par silence, jamais un seul membre, auteurs et Risk Owner / Délégué / Exécuteur ne votent pas, vote motivé et tracé, escalade à l'échéance (jamais de clôture automatique), groupe vide refusé. Un vote peut être retiré tant que la décision n'est pas close.
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
| 6 | §8 Appétence et Treatment Decision | 016, 017, 026 (+ réponse q05) |
| 7 | §10 Dispositif | 016, 017, 018, 019, 025, 026 |
| 8 | §13 UX validée | 017, 030 |
| 9 | §14 et §17 (temps réel) | 020 |
| 10 | Décisions examinées sans effet sur le contrat | — |
| 11 | Questions ouvertes (Q-E2-1 à Q-E2-11) | — |
| 12 | Relecture produit (A03) : corrections | — |

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
> La désignation est proposée par la direction du département, approuvée par l'équipe risque (groupe Risk Manager) et tracée (auteur, motif, valeur précédente, approbateur). Chaque Processus est rattaché à un département.

**Décision source** : DECISION-016 (Q10, les départements sont des groupes) et DECISION-019 (P4, le Processus est rattaché à un département). **[PO]** pour le principe, **[Rédaction]** pour « proposée » (conséquence de l'invariant 5 : on distingue proposer et approuver). Qui, dans le groupe d'un département, compte comme « la direction » n'est écrit nulle part : Q-E2-1. (Le projet initial affirmait que « la direction » désigne les membres du groupe ; supprimé, voir section 12.)

Note : le détail technique (colonnes, tables) n'a pas sa place dans le contrat. Il reste dans les lots B-5 et B-8.

---

## 3. §5 Évaluation

### 3.1 Définition de l'équipe risque (ajout après le deuxième paragraphe)

**Texte actuel** (extrait)
> La saisie de l'Inhérent, de la Maîtrise et du Résiduel est attribuée selon le mode effectif de l'évaluation (§7). L'équipe risque saisit le Résiduel dans tous les modes.

**Texte proposé** (nouveau paragraphe qui suit)
> **Groupes.** L'« équipe risque » est le groupe fixe **Risk Manager**. Il ne peut jamais être vide *(Rédaction : on ne peut donc pas retirer son dernier membre)*. Deux autres groupes fixes existent, **Risk Committee** et **Audit** ; ils peuvent être vides. Les départements sont aussi des groupes.

**Source** : DECISION-016 (Q10). **[PO]** sauf la précision en italique. (Le projet initial ajoutait « un membre du groupe Risk Manager peut agir sur tout risque du tenant » : règle non décidée, supprimée.)

### 3.2 Conflit de rôles d'un membre de l'équipe risque (nouveau paragraphe)

**Texte proposé**
> **Conflit de rôles.** Un membre du groupe Risk Manager qui est Risk Owner, Délégué ou Exécuteur d'un risque ne saisit ni ne revoit ce risque. Un autre membre du groupe le fait. S'il n'y en a pas, la revue passe au groupe Audit ou au Comité. Sur les autres risques, ce membre agit normalement. Le cumul est marqué visiblement (invariant 6).

**Source** : DECISION-019 (P5). **[PO]** Le choix entre « Audit » et « Comité » n'est pas précisé : Q-E2-9.

### 3.3 Revue de l'Inhérent : Retourné et Rejeté sont deux états

**Texte actuel**
> […] un membre de l'équipe risque, différent de l'auteur, le **retient**, ou le **retourne / rejette avec une annotation obligatoire** ; un Inhérent retourné revient à la 1re ligne pour une nouvelle saisie. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Texte proposé**
> […] un membre de l'équipe risque, différent de l'auteur, le **retient**, le **retourne** ou le **rejette**. Une annotation est obligatoire pour un retour et pour un rejet. **Retourné** : on demande ou on apporte une précision. **Rejeté** : la saisie n'est pas applicable ou n'est pas bonne. Un Inhérent retourné revient à la 1re ligne pour une nouvelle saisie. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Source** : DECISION-017, point 3. **[PO]** pour la distinction. L'annotation obligatoire pour les deux vient du texte actuel (DECISION-015). Ce que devient une saisie rejetée n'est pas dit : Q-E2-8.

### 3.4 Reprise d'un registre existant (nouveau paragraphe en fin de §5)

**Texte proposé**
> **Reprise d'un registre (import).** À l'import, le client relie lui-même les colonnes de son fichier aux objets du Dispositif ; aucun rapprochement n'est implicite. Les objets importés (risques, processus, contrôles) arrivent en brouillon et sont activés par l'équipe risque. Les cotations du fichier deviennent des **propositions de cotation** quand la matrice probabilité × impact du fichier est la même que celle du Dispositif ; sinon elles restent en historique « reprise ». Une proposition suit le parcours normal (revue, validation par un tiers) : **l'import ne contourne jamais le maker-checker.** En V1, le fichier est un .xlsx (le lien direct vers un tableur en ligne est prévu en V1.1).

**Source** : DECISION-027 (q14, q15, q16) et DECISION-029 (q17). **[PO]** Qui est « l'auteur » d'une proposition importée : Q-E2-11.

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

Effet de bord à confirmer : une échelle qui change de taille d'une version à l'autre rend la Cartographie plus difficile à comparer (Q-E2-3).

---

## 5. §7 Modes et contributions

**Texte actuel** (extrait)
> - types : Identification ; Analyse ; Inherent ; Maîtrise ;

**Texte proposé** (nouveau paragraphe après la liste des types)
> **Statut d'une contribution.** Le Risk Owner statue sur chaque contribution : **Retenue**, **Écartée** (motif obligatoire) ou **Sans suite**. Le Délégué peut statuer si le Dispositif le prévoit ; l'auteur de la contribution ne statue jamais sur la sienne. Chaque décision est conservée en historique (append-only). Cette règle est configurable dans le Dispositif. « Retenue » qualifie l'information reçue, jamais la cotation (Contribution ≠ Saisie).

**Décision source** : DECISION-025, q04 (OD-4). **[PO]** pour les trois statuts, le Délégué, l'historique et « configurable ». La dernière phrase est **[Rédaction]**, tirée du principe déjà au contrat (« une contribution apporte de l'information et ne cote jamais »). Le sens de « Sans suite », la place du Délégué et ce qui est « configurable » : Q-E2-10.

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
> **Vote du Comité à distance.** Le Comité peut valider par vote asynchrone, sans séance. À la création du Dispositif, le client choisit une règle parmi trois règles prédéfinies, ou crée une **règle personnalisée** (groupes qui valident, quorum, majorité, délai, relances). Aucune règle n'est imposée par défaut.
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

**Décision source** : DECISION-026 (q05, B-12), réponses du PO à q05 et aux trois questions de DECISION-017 point 4 (cockpit, transmises par l'orchestrateur A02 ; pas encore inscrites dans le Decision Log, voir section 12). **[PO]** pour tout le tableau et toutes les règles fixes. **[Rédaction]** : « le retrait étant lui aussi tracé » (conséquence de « vote tracé ») ; les cellules « — » signifient « non précisé par le PO », pas « sans relance ». La cohérence avec le plancher « jamais un seul membre » (le quorum de 2 reste donc le minimum) est vérifiée. Ce que peut faire une règle personnalisée en dessous de ces planchers et le cas où trop d'éligibles sont exclus : Q-E2-7.

---

## 7. §10 Dispositif

### 7.1 Définition : le Dispositif n'est plus « distinct de l'Appétence »

**Texte actuel**
> Il est distinct du Risque, du Processus, de l'Évaluation, de l'Appétence, du Meeting et de Risk 360.

**Texte proposé**
> Il est distinct du Risque, du Processus, de l'Évaluation, du Meeting et de Risk 360. Il **porte** l'échelle, les grilles de cotation et l'appétence : ce sont des paramètres du Dispositif, versionnés avec lui.

**Source** : DECISION-017, point 5 (« tout passe dans le Dispositif »). **[PO]** La phrase actuelle se contredit avec cette décision, il faut donc la corriger. « Versionnés avec lui » est **[Rédaction]** mais découle du contrat existant, qui liste déjà « appétence, seuils Comité » parmi les paramètres du Dispositif, figés par instantané dans chaque évaluation. Conséquence pour le code (lot B-6, pas une question) : une modification d'appétence passera par une nouvelle version du Dispositif, et non plus par `riskappetite.update` en place (contrat, invariant 8 et gouvernance d'un changement).

### 7.2 Création : assistant et Dispositifs par défaut (ajout aux règles validées)

**Texte proposé**
> - La création d'un Dispositif se fait par un **assistant pas à pas**, activé par défaut. Une configuration directe reste possible pour les utilisateurs experts.
> - L'organisation peut **activer un Dispositif par défaut** fourni avec l'outil. Un Dispositif par défaut respecte les invariants comme tous les autres.

**Source** : DECISION-017, points 1 et 5. **[PO]** sauf la dernière phrase, **[Rédaction]** (elle applique l'invariant 8). Le contenu des Dispositifs par défaut est le lot B-13, rédigé à part. Comment on active le tout premier Dispositif : Q-E2-6.

### 7.3 Table des paramètres

Lignes modifiées ou ajoutées. Les autres lignes ne changent pas.

| Ligne | Texte actuel | Texte proposé | Source |
|---|---|---|---|
| Mode par défaut | Mode par défaut (tenant, puis Processus — DECISION-006) : Classique | Mode par défaut **porté par le Dispositif**, puis Processus (DECISION-006) : Classique. `Config.evaluationMode` devient obsolète. | DECISION-018 P1 [PO] |
| Changement de mode d'un Processus | (non écrit) | Validé par la fonction risque. `process.evaluationmode.set` est retiré. | DECISION-018 P2 [PO] (ajouté à la relecture, omis du projet initial) |
| Seuil de criticité « faible » | Inscrit à la création du Dispositif | **Configurable** par le groupe Risk Manager ; tout changement est tracé et approuvé (7.7) | DECISION-016 [PO] |
| Approbateur d'un changement de paramètre de séparation des tâches | Comité | **Configurable : Audit ou Comité** ; un groupe vide ne peut pas être choisi. Périmètre (tous les changements ou seulement la séparation des tâches) et valeur par défaut : [À CONFIRMER] Q-E2-4 | DECISION-016, DECISION-018 P6 [PO] |
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

**Décision source** : DECISION-018 (P3 : l'interdiction doit rester configurable) et DECISION-019 (P3 : réécriture proposée par l'Architecte, acceptée ; « activé par le Comité » est explicite). **[PO]** La réécriture règle la tension avec l'invariant 8 : c'est l'invariant lui-même qui prévoit le paramètre, donc rien n'est abaissé. En attendant le paramètre, le refus strict de l'auto-désignation (lot B-0) reste le comportement. Qui active le paramètre n'est plus une question : le Comité, par DECISION-019. (Conséquence de la règle « groupe vide refusé » : un Comité vide ne peut pas l'activer, **[Rédaction]**.)

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
> […] Les possibilités de configuration sont détenues par la fonction risque (groupe Risk Manager) et tracées. Le changement est demandé avec un motif écrit. L'**approbateur configuré** (Audit ou Comité), différent du demandeur, l'approuve **[À CONFIRMER Q-E2-4 : tous les changements, ou seulement la séparation des tâches]**. Un groupe vide ne peut pas être choisi comme approbateur, et on ne peut pas vider un groupe déjà choisi *(Rédaction)*. Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Tant que l'approbateur n'a pas décidé, la version reste en `DRAFT` ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. Quand l'approbateur est le Comité, il décide en séance ou par vote asynchrone selon sa règle (§8). L'audit conserve l'ancienne et la nouvelle valeur.

**Décision source** : DECISION-016 (configuration tenue par le groupe Risk Manager, approbateur configurable), DECISION-018 (P6, groupe vide), DECISION-017 point 4 et DECISION-026 (Comité à distance). **[PO]** sauf : le vidage d'un groupe choisi (avis du Risk Manager), le renvoi au vote à distance, et le remplacement de « l'administrateur du Dispositif (`riskframework.update`) » par une formulation sans rôle nommé : **[Rédaction]**. Le périmètre de l'approbateur est ouvert : Q-E2-4. Autres questions : Q-E2-5 (Audit) et Q-E2-6 (première activation).

### 7.8 Le reste de la ligne « Validateur » et « Désignation des rôles »

Ces deux lignes ne changent pas dans leur sens. Le terme « responsable de la fonction risque » reste utilisé. Il n'a pas de définition dans les groupes : Q-E2-2.

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

## 11. Questions ouvertes pour le PO

Onze questions, classées par ce qu'elles bloquent. Aucune règle n'est inventée : chaque point est un trou réel entre les décisions. Pour chacune : le contexte en une phrase, la question, les options, ma recommandation. Le PO peut répondre « Valider la recommandation » question par question.

### Bloque R1.2 (groupes)

**Q-E2-1. Qui est « la direction du département » ?**
Contexte : un département est maintenant un groupe de personnes, et c'est « la direction du département » qui propose le Risk Owner et le Délégué d'un Processus.
Question : parmi les membres du groupe d'un département, lesquels peuvent proposer ?
- Option 1 : tous les membres du groupe.
- Option 2 : une ou deux personnes désignées « direction » dans le groupe.
- Option 3 : un rôle « directeur » distinct de l'appartenance au groupe.
*Recommandation* : option 2. Proposer un Risk Owner engage le département ; il vaut mieux une personne désignée qu'un groupe entier, et cela garde le groupe simple pour les autres usages.

**Q-E2-2. Qui est « le responsable de la fonction risque » ?**
Contexte : le contrat s'en sert comme validateur par défaut et pour des approbations, mais le groupe Risk Manager n'a que des membres, sans chef.
Question : comment le repère-t-on ?
- Option 1 : le client désigne un responsable parmi les membres du groupe Risk Manager, dans le Dispositif.
- Option 2 : tout membre du groupe peut tenir ce rôle, tant qu'il est différent des auteurs.
*Recommandation* : option 1. Un responsable nommé est plus clair en cas de contestation, et il reste soumis à la règle « jamais validateur de ce qu'il a saisi » (c'est aussi ce que dit la réponse du PO sur le Comité).

### Bloque R1.3 (échelle)

**Q-E2-3. Cartographie et tailles d'échelle différentes.**
Contexte : chaque Dispositif choisit sa taille d'échelle (3 à 6) ; la Cartographie peut donc mélanger des évaluations cotées sur des échelles différentes, qui ne sont pas comparables telles quelles.
Question : que fait la Cartographie en V1 ?
- Option 1 : elle affiche un Dispositif à la fois.
- Option 2 : elle mélange tout et signale les évaluations d'une autre échelle.
- Option 3 : elle convertit automatiquement vers une échelle commune.
*Recommandation* : option 1 (ou 2 si l'option 1 est trop restrictive pour l'écran). Pas de conversion automatique : elle fabriquerait une comparabilité que la méthode ne donne pas. Cette question ne touche que l'affichage de la Cartographie, que je ne modifie pas ici.

### Bloque R1.4 (Dispositif)

**Q-E2-4. L'approbateur choisi (Audit ou Comité) approuve-t-il tous les changements ?**
Contexte : DECISION-016 dit que l'approbateur d'un changement est configurable (Audit ou Comité). Le contrat actuel, lui, fait approuver les changements courants par le responsable de la fonction risque et réserve le Comité à la séparation des tâches. Il faut aussi une valeur proposée à la création.
Question : que couvre l'approbateur configuré ?
- Option 1 : tous les changements de paramètres.
- Option 2 : seulement la séparation des tâches ; les autres restent approuvés par le responsable de la fonction risque.
*Recommandation* : option 1, avec le Comité proposé comme valeur de départ à la création (le client peut choisir Audit). Une seule règle, et la fonction risque ne s'approuve jamais elle-même. Coût : un délai plus long, que le vote à distance réduit.

**Q-E2-5. Quand l'approbateur est Audit, qui décide dans le groupe ?**
Contexte : les règles « jamais un seul membre » et de vote sont écrites pour le Comité. Rien n'est écrit pour Audit, qui est aussi la 3e ligne et contrôle ensuite ce qu'elle a approuvé.
Question : quelles règles pour Audit ?
- Option 1 : les mêmes règles de vote que le Comité (A, B, C ou personnalisée).
- Option 2 : Audit approuve par un seul de ses membres.
- Option 3 : Audit n'est pas proposé comme approbateur en V1.
*Recommandation* : option 1, avec un avertissement dans l'écran de création quand Audit est choisi (indépendance d'Audit) et un indicateur de suivi de la part des changements approuvés par Audit.

**Q-E2-6. Comment s'active le tout premier Dispositif ?**
Contexte : Audit et Risk Committee peuvent être vides et un groupe vide ne peut pas être approbateur ; au démarrage, il peut donc n'y avoir personne pour approuver la première activation (ni celle d'un Dispositif par défaut).
Question : qui approuve cette première activation ?
- Option 1 : l'administrateur du client (différent du demandeur), avec motif et trace, pour la première activation seulement.
- Option 2 : la première activation reste impossible tant qu'un groupe approbateur n'est pas rempli.
*Recommandation* : option 1. Les changements suivants suivent la règle normale.

### Bloque R2 (rôles, saisie, validation)

**Q-E2-7. Limites d'une règle de Comité personnalisée (R2.6).**
Contexte : le PO a fixé les planchers (jamais un seul membre, quorum de 2 seulement en règle A) mais une règle personnalisée choisit elle-même quorum, majorité, délai et relances. Cas à part : si presque tous les éligibles sont exclus du vote (ils sont Risk Owner, Délégué ou Exécuteur du risque), le quorum ne peut pas être atteint.
Question : une règle personnalisée peut-elle descendre sous les règles prédéfinies, et que se passe-t-il quand le quorum est impossible ?
- Option 1 : une règle personnalisée garde les planchers fixes (au moins 2 votants, jamais de silence valant accord) ; sinon libre. Quorum impossible : l'envoi est refusé comme pour un groupe vide, puis escalade.
- Option 2 : une règle personnalisée ne peut pas être moins stricte que la règle A.
*Recommandation* : option 1, avec l'escalade vers Audit ou le Comité selon Q-E2-4.

**Q-E2-8. Que devient une saisie « Rejetée » (R2.5) ?**
Contexte : « Retourné » et « Rejeté » sont deux états, mais l'effet d'un rejet n'est pas décidé.
Question : après un rejet de l'Inhérent saisi par la 1re ligne, que se passe-t-il ?
- Option 1 : comme un retour (la 1re ligne ressaisit), mais le rejet reste en historique et compté.
- Option 2 : l'évaluation bascule vers la saisie de l'équipe risque.
- Option 3 : l'évaluation s'arrête pour ce cycle.
*Recommandation* : option 1. Un rejet du Comité ouvre « Rejeté », une demande de précision ouvre « Retourné ».

**Q-E2-9. Revue d'un risque sans autre membre disponible : Audit ou Comité (R2.4) ?**
Contexte : si tous les membres de l'équipe risque sont concernés par un risque, DECISION-019 renvoie à « Audit ou Comité » sans dire comment choisir.
Question : lequel ?
- Option 1 : l'approbateur choisi au Dispositif (Q-E2-4).
- Option 2 : le Comité toujours.
*Recommandation* : option 1, et une alerte à l'équipe risque (signe de sous-effectif).

### Bloque R3 (contributions, reprise de registre)

**Q-E2-10. Contributions : « Sans suite », Délégué et réglage (R3.3).**
Contexte : le PO a défini trois statuts (Retenue, Écartée avec motif, Sans suite) et un réglage dans le Dispositif, sans définir « Sans suite ». Le Délégué « désignable par le Dispositif » semble plus large que le §5 (absence ou délégation datée).
Question : que veut dire « Sans suite », et quel est le réglage ?
- Option 1 : « Sans suite » = reçue mais non traitée dans le cycle, avec un commentaire court obligatoire ; le réglage est « qui statue » (Délégué dans les limites du §5, ou en permanence si le Dispositif le prévoit, désactivé par défaut).
- Option 2 : « Sans suite » sans commentaire.
*Recommandation* : option 1, pour éviter un écartement sans trace.

**Q-E2-11. Reprise de registre : qui est l'auteur d'une proposition importée ?**
Contexte : l'import ne contourne jamais le maker-checker, mais on ne dit pas qui compte comme auteur.
Question : qui, et peut-on importer un Résiduel ?
- Option 1 : l'auteur est la personne qui importe, tracée avec le fichier source ; seule l'équipe risque importe un Résiduel ; un autre rôle peut importer l'Inhérent (soumis à la revue du §5).
- Option 2 : toute personne autorisée à importer peut importer toutes les cotations.
*Recommandation* : option 1. Si l'importeur est Risk Owner du risque, le cumul est marqué (invariant 6).

### Questions de l'ancien projet supprimées (tranchées)

- Ancienne 7(a) et 7(b) (détail des règles A, B, C ; quorum de 2 ; responsable de la fonction risque dans le Comité ; retrait de vote) : tranchées par la réponse du PO à q05 / DECISION-026, intégrées en 6.2. Reste la définition du « responsable » : Q-E2-2.
- Ancienne 9 (auto-proposition : qui active) : tranchée par DECISION-019 P3 (« activé par le Comité »), intégrée en 7.4.
- Ancienne 10 (appétence et seuils dans le Dispositif) : (a) et (c) tranchées par DECISION-017 point 5 et le contrat actuel ; (b) conséquence de l'invariant 8 et du versionnement, devenue une note de code (7.1).
- Anciennes 2 et 7(c) : reformulées en Q-E2-5 et Q-E2-7 ; ancienne 8 : Q-E2-9.

---

## 12. Relecture produit (A03, 2026-10-11) : corrections

Corrections faites dans ce projet :
1. §2 : supprimé « la direction du département désigne les membres du groupe de ce département » (règle non décidée) ; ajouté Q-E2-1.
2. §3.1 : supprimé « un membre du groupe Risk Manager peut agir sur tout risque du tenant » (non décidé, élargit les droits).
3. §6.2 : règles du Comité réécrites avec la réponse du PO à q05 (A, B, C, planchers fixes, trois réponses) ; ajout de « jamais de clôture automatique » ; marqué [Rédaction] ce qui ne vient pas du PO.
4. §7.3 : ligne ajoutée « changement de mode d'un Processus » (DECISION-018 P2, omise) ; ligne « seuils Comité » ramenée au contrat actuel (plus d'[À CONFIRMER]) ; « cinq lignes » corrigé (il y en a plus) ; suppression de « Comité par défaut » présenté comme acquis (renvoi à Q-E2-4).
5. §7.4 : « activé par le Comité » confirmé par DECISION-019 ; ancienne question 9 supprimée.
6. §7.7 : « l'administrateur du Dispositif (`riskframework.update`) » remplacé : marqué [Rédaction] ; périmètre de l'approbateur marqué [À CONFIRMER].
7. §7.2 : noms « Prudent / Standard / Léger » retirés du texte (non décidés) ; dernière phrase marquée [Rédaction].
8. §9 : marqué [Rédaction] le report du contrat événementiel complet, des tests temps réel et la liste « événements nommés et versionnés » (vient de la roadmap, pas de DECISION-020).
9. Marqué [Rédaction] : « proposée » (§4), « on ne peut pas retirer son dernier membre » (§3.1), « quand le §5 l'autorise » et « validée par un tiers » (§6.1), « versionnés avec lui » (§7.1), « un Comité vide ne peut pas activer » (§7.4).
10. Questions : 12 réduites à 11, réécrites en langage simple, numérotées Q-E2-n et classées par lot bloqué.

À faire par l'orchestrateur (règle 7bis) : inscrire au Decision Log la réponse du PO à q05 et aux trois questions du Comité (DECISION-026 complément) et créer les lignes `ACTION_ITEMS.md` pour Q-E2-1 à Q-E2-11 (owner HUMAN, statut Ouvert).

---

## Suite

1. Le PO lit le résumé et répond aux 11 questions de la section 11.
2. Il valide, refuse ou modifie le texte ; la décision est inscrite au Decision Log (règle 7bis).
3. Après validation, l'Orchestrateur applique le texte dans le contrat (A03 relit, R1.1) et l'étape 2 est marquée terminée dans `RM-V1-Sequence-actions.md`. Elle débloque B-9 et B-6 (étapes 8 et 9).
