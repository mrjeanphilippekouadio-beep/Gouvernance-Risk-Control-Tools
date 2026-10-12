# Risk Management V1 — Decision & Execution Record

> Statut : **REFERENCE DE TRAVAIL VALIDEE**
>
> Ce document consolide les décisions métier, UX et architecture arrêtées avant l'implémentation frontend. Il complète les Decision Logs existants ; il ne remplace pas les décisions antérieures.
>
> **Version : étape 2 intégrée, 2026-10-11 (DECISION-033 à DECISION-042).** Texte validé par le PO (DECISION-038 point 2). Source : `docs/architecture/RM-V1-Contrat-etape2-PROJET.md`.
>
> **Version DECISION-043 (2026-10-11)** : intégration de q72 à q77 (sens validé de « jamais un seul membre » et marque « vote unique » ; une seule action par dossier en cas de cumul Comité + Audit ; ratification sans délai avec l'état « non ratifiée » ; demande en attente avec alerte quand plus personne ne peut décider ; Audit vote en repli avec la règle q61 ; phase d'« amorçage » avec un seul Risk Manager : §5, §8, §10). Les incohérences N1 à N7 sont closes ; sept points nouveaux (N8 à N14) restent à arbitrer par le PO, sans décision : `RM-V1-Contrat-etape2-PROJET.md`, section 13.1 bis. q70, q71 et q78 ne sont pas reportées dans ce document.
>
> **Version DECISION-041 et DECISION-042 (2026-10-11)** : intégration de la précision Cartographie (échelle toujours carrée, heatmap n×n du Dispositif actif, aucune grille sans Dispositif activé, visuel inchangé : §6) et des réponses q58 à q69 (cumuls, co-signature toujours exigée, règle de vote par défaut q61, décisions de repli marquées et ratifiées, circuit q69, auto-proposition par vrai vote du Comité, Audit ne saisit ni ne modifie, administrateur = Risk Manager marqué : §5, §8, §10). Invariant 10 reformulé. q58 à q69 et R1 à R3 sont closes ; sept incohérences nouvelles (N1 à N7) restent à arbitrer : `RM-V1-Contrat-etape2-PROJET.md`, section 13.1.
>
> **Version DECISION-040 (2026-10-11)** : intégration des réponses q42 à q57. Un seul circuit en l'absence du Comité : Comité, puis Audit, puis fonction risque, avec journalisation (§5, §8, §10) ; il remplace la chaîne q31 et la suppléance directe q41. « Consultation » devient co-signature (§8). Groupes fixes (§5), taille de matrice et descriptifs (§6), premier Dispositif sans l'administrateur (§10). Restent ouvertes : q58 (portée du cumul), q59 (Cartographie), q60 (refus de co-signer), q61 (règle de décision sans quorum), et les réserves de la revue Compliance R1 à R3 (q61 à q63). Détail : `RM-V1-Contrat-etape2-PROJET.md`, sections 11 bis et 13.
>
> **Version DECISION-039 (2026-10-11)** : la règle q37 (quorum du Comité impossible) est révisée et remplace DECISION-038 point 1 (§8 : Audit, puis responsable du risque, avec consultation s'il est concerné). q41 confirmé (un Comité vide peut être approbateur, la suppléance s'applique : §5, §10). Questions induites en attente du PO : `RM-V1-Contrat-etape2-PROJET.md`, section 13.
>
> **Amendement du 2026-10-08** (DECISION-014 et DECISION-015, `.claude/agent-context/ACTION_ITEMS.md`) : modes de cotation, rôles Risk Owner / Délégué / Exécuteur, paramètres du Dispositif. Paragraphes touchés : §4, §5, §7, §8, §10, §16, §17 (Phase 4). Origine : `docs/architecture/RM-V1-Modes-cotation-objections.md` et `docs/architecture/RM-V1-Amendement-contrat-modes-PROJET.md`.
>
> **Amendement du 2026-10-11** (étape 2, DECISION-016 à 020, 025, 026, 027, 029, 030, 033 à 042) : échelle, axes et descriptifs dans le Dispositif ; groupes ; approbateur configurable ; auto-proposition de désignation ; Comité asynchrone ; état « Rejeté » ; statuts des contributions ; temps réel reporté en V2. Paragraphes touchés : §4, §5, §6, §7, §8, §10, §13, §14, §17.

## 1. Gouvernance de conception

- **Jean-Philippe / N0** : décision finale et arbitrage.
- **Risk Manager** : porte la logique Risk Management, impulse la méthodologie, challenge les propositions et vérifie leur cohérence avec les principes de référence.
- **UX Designer** : transforme la logique validée en parcours, information architecture, interactions et design Penpot.
- **Architecte** : analyse l'existant, vérifie la faisabilité, propose la traduction technique et identifie les écarts ; il ne redéfinit pas la logique Risk.
- **Orchestrator** : transforme les décisions validées en lots d'exécution bornés.
- **dev-frontend** : implémente uniquement les lots validés.

Le code existant est une **contrainte à analyser**, pas la définition du produit.

```
Jean-Philippe
    ↓
Risk Manager — logique métier
    ↓
UX Designer — expérience
    ↓
Risk Manager + Jean-Philippe — validation
    ↓
Architecte — faisabilité / traduction technique
    ↓
Architecte + Risk Manager + Jean-Philippe — arbitrage
    ↓
UX / Penpot — design final
    ↓
Orchestrator
    ↓
dev-frontend
    ↓
QA
```

## 2. Finalité du produit Risk Management

Le produit est conçu autour du **processus de gestion des risques**, et non autour d'une collection d'onglets techniques.

```
Identification
    ↓
Analyse
    ↓
Évaluation
    ├── Inhérent
    ├── Maîtrise
    └── Résiduel
    ↓
Comparaison à l'appétence
    ↓
Décision de traitement si nécessaire
    ↓
Validation
    ↓
Traitement
    ↓
Suivi
    ↓
Réévaluation
    ↓
Cartographie / Risk 360
```

Cette structuration s'appuie sur ISO 31000 et COSO ERM comme **cadres de conception**, adaptés à DJAMO et non copiés littéralement dans l'application.

## 3. Cartographie

**Décision validée : la Cartographie est conservée comme acquis produit.**

Elle reste une vue de synthèse de pilotage et ne doit pas recalculer indépendamment les données métier.

```
Cartographie
     ↓
Évaluation faisant foi
     ↓
Analyse
     ↓
Identification
```

Les autres anciens onglets/pages ne sont pas considérés comme définitifs : ils doivent être repensés comme capacités du parcours Risk Management.

## 4. Identification et Analyse

L'identification officielle relève du Risk Owner.

Le Risk Owner est un responsable métier (directeur de département, chef de projet, manager). Il est désigné au niveau du **Processus**, avec un **Délégué** quand l'effectif du département le permet ; les risques du Processus en héritent. Une surcharge sur un risque donné remplace toujours la paire Risk Owner + Délégué ensemble. La désignation est proposée par la direction du département, approuvée par l'équipe risque (groupe Risk Manager) et tracée (auteur, motif, valeur précédente, approbateur). **La direction du département est le membre du groupe hiérarchiquement au-dessus des autres (directeur ou head of) ; il voit le travail des membres sur les risques, les contrôles et les objets qu'ils détiennent ou ont créés.** Chaque Processus est rattaché à un département.

L'Analyse est une étape distincte de l'Identification et de l'Évaluation. Elle sert notamment à documenter causes, événements, impacts potentiels, contexte et contrôles connus.

Le contexte est cumulatif :

```
Identification
    ↓
visible dans Analyse
    ↓
Identification + Analyse
    ↓
visibles dans Évaluation
```

Une information héritée peut être visible sans être éditable dans l'étape suivante.

## 5. Évaluation

L'Évaluation couvre :

- Inhérent ;
- Maîtrise ;
- Résiduel ;
- comparaison à l'appétence ;
- décision de validation.

La saisie de l'Inhérent, de la Maîtrise et du Résiduel est attribuée selon le mode effectif de l'évaluation (§7). L'équipe risque saisit le Résiduel dans tous les modes.

**Groupes.** L'« équipe risque » est le groupe fixe **Risk Manager**. Il ne peut jamais être vide (on ne peut donc pas retirer son dernier membre). Deux autres groupes fixes existent, **Risk Committee** et **Audit** ; ils peuvent être vides. Les départements sont aussi des groupes.

**Responsable de la fonction risque.** Le « responsable de la fonction risque » est le responsable du service risque : il a des droits sur tous les risques, les contrôles et l'administration. « Responsable du risque » dans les règles d'escalade = responsable de la fonction risque (DECISION-040, q53).

**Droits des groupes fixes (DECISION-040).** *Risk Manager* : droits larges sur les risques, jamais approuver ce qu'il a lui-même saisi. *Comité* : lecture et vote. *Audit* : ~~lecture seule sur tout~~ ne saisit ni ne modifie jamais de données ; il exerce seulement les décisions prévues (validation du changement de ses droits, q45 ; décision de repli, q54), marquées « prises par la 3e ligne » (DECISION-042 q64) ; le groupe Audit remplace le rôle « Auditeur » (q42). Tous les membres Risk Manager agissent sur tous les risques (q42 prévaut), jamais d'auto-approbation (q66). Cumuls : Risk Manager + Audit toujours interdit, non configurable ; Risk Manager + Comité toujours autorisé, cumul affiché sur la fiche ; ~~L'interdiction des cumuls est configurable, sauf Risk Manager + Comité (portée du réglage : q58, ouverte) (q43).~~ le seul réglage porte sur Comité + Audit, autorisé par défaut (DECISION-042 q58). Administrateur = Risk Manager : autorisé ; cumul marqué sur la fiche, motif exigé, tiers prévenu (Audit ou Comité dès qu'ils existent) (q63). Entrer dans les trois groupes fixes ou en sortir : motif obligatoire, sans approbateur tiers (MVP) (q44). Seul l'administrateur de l'application modifie les droits du groupe Audit, jamais l'équipe risque, chaque changement étant tracé ; s'il est aussi responsable de la fonction risque, il fait le changement mais Audit ou le Comité doit le valider (q45) ; tant qu'aucun membre d'Audit ou du Comité n'existe, le changement reste en attente, jamais de validation automatique (q67). « Département = groupe » est confirmé (q47). Le rattachement Processus → département est obligatoire pour tout nouveau processus ; les existants sont rattachés avant l'ouverture aux utilisateurs, puis la colonne passe en NOT NULL (q46).

**Circuit unique en l'absence du Comité (DECISION-040, q54).** ~~Suppléance du Comité : si le groupe Risk Committee est vide, une personne au moins de la fonction risque prend en charge ce que le Comité aurait approuvé (q35, q41).~~ Remplacé par : **Comité ; s'il est vide, Audit ; s'il est vide, la fonction risque (groupe Risk Manager), avec journalisation.** Tout nouvel utilisateur ajouté au Comité ou à Audit dispose d'une vue de toutes les décisions prises en son absence. Quand la fonction risque décide : elle est exclue si elle est demandeur ou auteur ; si son responsable est Risk Owner, Délégué ou Exécuteur, il décide avec la **co-signature** d'un autre membre, tracée au journal (q52, q53) ; motif obligatoire et tracé, Audit prévenu chaque fois qu'il n'est pas lui-même décideur (q56). Les garde-fous de q35 non contredits par q53 (jamais le demandeur, jamais l'auteur) sont repris ; ~~« jamais pour activer l'auto-proposition de désignation » est à reconfirmer sous ce circuit~~ l'auto-proposition ne s'active que par un vrai vote du Comité, jamais en repli (DECISION-042 q65). L'approbateur choisi au Dispositif décide en premier ; s'il est vide ou ne peut pas décider, on suit le circuit en sautant ce maillon (q69). Chaque décision prise en repli est marquée comme telle ; un indicateur suit leur part par groupe décideur ; le Comité les ratifie a posteriori, sans blocage, dès qu'il a des membres (q62). Refus de co-signer : la décision n'est pas prise ; le responsable peut solliciter un autre membre du groupe risque ; sans co-signature, la demande reste en attente avec alerte (jamais de validation tacite) ; refus et motif tracés (q60). La co-signature est toujours exigée ; le réglage « consultation » est supprimé (q68). Tout est inscrit au **journal des décisions prises en l'absence du Comité** ; le circuit remplace l'envoi refusé de la règle « groupe vide refusé » sans le supprimer, et est tracé comme tel.

**Précisions de DECISION-043 (q73 à q77).** *Cumul Comité + Audit (q73)* : le cumul reste autorisé ; sur un même dossier la personne n'agit qu'une fois (votante au Comité, elle est exclue côté Audit, et inversement) et ne ratifie jamais une décision à laquelle elle a pris part. *Ratification (q74)* : aucun délai imposé ; indicateur « décisions en attente de ratification » ; si le Comité refuse, la décision reste en vigueur, marquée « non ratifiée », et le dossier repart en vote du Comité. *Plus personne pour décider (q75)* : la demande reste en attente ; alerte visible de tous les membres Risk Manager et indicateur ; jamais de validation tacite, jamais l'administrateur. *Audit en repli (q76)* : Audit, quand il remplace un Comité vide, vote avec la même règle (q61) ; décision marquée « prise en repli par la 3e ligne ». *Amorçage (q77)* : avec un seul Risk Manager, des actions sont autorisées en phase de démarrage, marquées « amorçage » avec un motif ; elles apparaissent dans la vue « décisions prises en votre absence » des premiers membres d'Audit et du Comité, qui sont alors prévenus. *(Rédaction : la liste des actions couvertes, la fin de la phase et le rapport avec les invariants 1 et 5 ne sont pas dits : points N8 à N10 du projet d'étape 2, 13.1 bis.)*

**Conflit de rôles.** Un membre du groupe Risk Manager qui est Risk Owner, Délégué ou Exécuteur d'un risque ne saisit ni ne revoit ce risque. Un autre membre du groupe le fait. Si toute l'équipe risque est concernée, la revue suit le circuit unique Comité, Audit, fonction risque (q54, ci-dessus). ~~Audit, puis Comité, puis suppléance~~ (chaîne q31 remplacée). L'équipe risque est alertée (signe de sous-effectif). Les groupes Comité et Audit ont chacun un journal des décisions prises en leur absence. Sur les autres risques, ce membre agit normalement. Le cumul est marqué visiblement (invariant 6).

**Reprise d'un registre (import).** À l'import, le client relie lui-même les colonnes de son fichier aux objets du Dispositif ; aucun rapprochement n'est implicite. Les objets importés (risques, processus, contrôles) arrivent en brouillon et sont activés par l'équipe risque. Les cotations du fichier deviennent des propositions de cotation quand la matrice probabilité × impact du fichier est la même que celle du Dispositif ; sinon elles restent en historique « reprise ». Une proposition suit le parcours normal (revue, validation par un tiers) : l'import ne contourne jamais le maker-checker. L'auteur d'une cotation importée est la personne qui importe. Seule l'équipe risque importe un Résiduel. En V1, le fichier est un .xlsx (le lien direct vers un tableur en ligne est prévu en V1.1).

Le Risk Owner décide du traitement ; il ne cote pas. Le Délégué remplace le Risk Owner en son absence ou par délégation datée ; il ne valide jamais ses propres actes ; la responsabilité reste au Risk Owner.

Un acteur ne valide jamais ce qu'il a saisi, revu ou exécuté : le validateur est différent de tous les auteurs de l'évaluation. Par défaut, le validateur est le responsable de la fonction risque, et le Comité au-delà du seuil de passage Comité (§8) ; ce choix est un paramètre du Dispositif (§10).

**Revue de l'Inhérent saisi par la 1re ligne** (mode effectif Participatif) : un membre de l'équipe risque, différent de l'auteur, le **retient**, le **retourne** ou le **rejette**. Une annotation est obligatoire pour un retour et pour un rejet. **Retourné** : on demande ou on apporte une précision. **Rejeté** : la saisie n'est pas applicable ou n'est pas bonne. Un Inhérent retourné ou rejeté revient à la 1re ligne pour une nouvelle saisie ; un rejet est comme un retour, mais il est gardé en historique et compté. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Maîtrise** : qui la note est un **paramètre du Dispositif**, jamais une valeur figée en code (une organisation peut manquer de personnes pour séparer les saisies). Quand deux acteurs notent la même cellule, les deux saisies sont conservées, celle désignée par le paramètre fait foi (par défaut : l'équipe risque), un commentaire est obligatoire en cas d'écart, sans moyenne.

> Contribution ≠ Saisie ≠ Décision de traitement ≠ Validation.

La maîtrise globale utilise la règle **MIN non-compensatoire**. Le backend reste l'autorité métier ; le frontend ne recalcule pas la vérité métier.

## 6. Axes d'impact

Les axes d'impact (financier, réglementaire, opérationnel, etc.) et l'échelle sont choisis **à la création du Dispositif**. L'échelle a une taille de **3, 4, 5 ou 6** niveaux. La **probabilité et chaque axe d'impact ont la même taille d'échelle** (exemple : échelle de 4, probabilité sur 4 et chaque axe sur 4). Il y a **7 axes au maximum** ; ce chiffre est un plafond, jamais un nombre à supposer.

**Chaque niveau porte son propre descriptif**, pour la probabilité et pour chaque axe (exemple : échelle de 5, donc 5 descriptifs pour la probabilité et 5 par axe). Les descriptifs sont saisis à la création du Dispositif ; ils sont facultatifs en brouillon et obligatoires pour activer l'échelle (DECISION-040, q50).

**Taille de matrice (q49).** La taille (3×3, 4×4, 5×5 ou 6×6) est choisie à la création du Dispositif ; plafond de score = n², bandes de criticité, seuils et nombre de descriptifs à remplir s'alignent dessus côté serveur. ~~L'effet visuel côté frontend (page Cartographie) n'est pas décrit : question ouverte q59.~~

**Échelle carrée et Cartographie (DECISION-041).** L'échelle est toujours carrée (3×3, 4×4, 5×5 ou 6×6), configurée à la création du Dispositif : la probabilité va de 1 à n et l'impact de 1 à n quel que soit le nombre d'axes, avec n descriptifs pour la probabilité et n pour chaque axe. La heatmap de la Cartographie suit la taille de l'échelle du Dispositif actif (grille n×n) ; tant qu'aucun Dispositif n'est activé, elle n'affiche aucune grille. La consigne « ne pas toucher la page Cartographie » vise le visuel (design, mise en page, style), qui reste inchangé. Les bandes de couleur sont servies par le backend.

Le nombre d'axes reste déterminé par l'échelle du Dispositif applicable, jamais par le code.

```
Impact retenu = MAX(valeur de tous les axes configurés)
```

Le frontend itère dynamiquement sur les axes retournés par le backend.

**Aucun code ne doit supposer 7 axes.**

Un changement d'échelle, d'axe ou de descriptif crée une nouvelle version du Dispositif et ne touche que les cycles à venir (invariant 9).

**Affichage.** Le Dispositif est choisi à la création de l'espace client et/ou à la création du Dispositif ; les risques sont affichés par Dispositif, un à la fois.

## 7. Modes et contributions

Modes :

- **Classique** : l'équipe risque saisit l'Inhérent, la Maîtrise et le Résiduel ;
- **Participatif** : l'Exécuteur du contrôle (1re ligne) saisit l'Inhérent et sa part de Maîtrise ; l'équipe risque revoit l'Inhérent (§5), saisit la Maîtrise selon le paramètre du Dispositif et le Résiduel ;
- **Hybride** : politique du Dispositif qui permet de choisir Classique ou Participatif risque par risque.

Ils ne créent pas trois workflows métier différents : les étapes sont identiques, seule l'attribution de la saisie change. Le mode **effectif** d'une évaluation est toujours Classique ou Participatif, jamais Hybride, et il est figé sur l'évaluation.

En mode effectif Participatif, l'équipe risque peut commenter ou annoter l'Inhérent saisi par la 1re ligne. Une annotation ne remplace pas la revue explicite (retenu, ou retourné / rejeté) du §5.

Contributions :

- elles interviennent sur les risques évalués en mode effectif **Participatif** ;
- elles sont faites par la personne désignée par le Risk Owner : le Délégué, l'Exécuteur du contrôle ou le Risk Owner lui-même, toujours selon les règles du Dispositif ;
- types : Identification ; Analyse ; Inherent ; Maîtrise ;
- **statut d'une contribution.** Le Risk Owner statue sur chaque contribution : **Retenue** ou **Écartée** (motif obligatoire). « Sans suite » est retiré. Le Dispositif permet de créer des statuts de contribution personnalisés ; tout statut d'écartement porte une trace. Le Délégué peut statuer si le Dispositif le prévoit ; l'auteur de la contribution ne statue jamais sur la sienne. Chaque décision est conservée en historique (append-only). Cette règle est configurable dans le Dispositif. « Retenue » qualifie l'information reçue, jamais la cotation (Contribution ≠ Saisie) ;
- le **Signalement** reste ouvert indépendamment du mode et du Dispositif (§10, DECISION-012).

Aucune contribution ni saisie de 1re ligne sur le Résiduel. Une contribution apporte de l'information et ne cote jamais. La saisie de l'Inhérent par la 1re ligne n'est pas une contribution : c'est une auto-évaluation soumise à la revue du §5.

Rôles d'organisation (Risk Owner, Délégué, Exécuteur du contrôle) et lignes de défense (L1, L2, L3) sont deux axes distincts. L'Exécuteur est porté par le Contrôle et relié à un utilisateur ; un contrôle sans Exécuteur relié ne permet pas la cotation Participative.

## 8. Appétence et Treatment Decision

L'appétence est une référence de décision dans le cycle d'évaluation.

Un dépassement peut déclencher une Treatment Decision, rattachée à l'évaluation qui l'a déclenchée. **Le Risk Owner enregistre la Treatment Decision** ; le Délégué le fait quand le §5 l'autorise (absence ou délégation datée). **Il n'y a pas de proposeur distinct.** L'équipe risque peut joindre une **recommandation non contraignante**. La Treatment Decision est ensuite validée par un tiers, selon le §5.

Options validées :

- Accepter ;
- Surveiller ;
- Réduire ;
- Transférer ;
- Éviter.

**Accepter** et **Surveiller** restent distincts.

Deux seuils de Comité sont indépendants :

1. seuil de passage Comité de l'Évaluation ;
2. seuil de passage Comité de la Treatment Decision.

Ils sont configurables et ne doivent pas être traités comme une constante métier unique.

**Vote du Comité à distance.** Le Comité peut valider par vote asynchrone, sans séance. À la création du Dispositif, le client choisit une règle parmi trois règles prédéfinies, ou crée une **règle personnalisée** (groupes qui valident, quorum, majorité, délai, relances). ~~Aucune règle n'est imposée par défaut.~~ La règle de décision par défaut est celle de q61 (ci-dessous). Une règle personnalisée n'est limitée que par les règles fixes ci-dessous. Si le quorum est impossible (trop de votants exclus du vote, ou échéance dépassée), l'envoi au Comité est refusé et la demande suit le circuit unique (§5) : Audit ; si le groupe Audit est vide, la fonction risque. Le « responsable du risque » est le responsable de la fonction risque. Il est exclu s'il est demandeur ou auteur ; s'il est Risk Owner, Délégué ou Exécuteur, il décide avec la co-signature (toujours exigée, q68) d'un autre membre du groupe Risk Manager, tracée au journal ; si la co-signature est refusée, la décision n'est pas prise ; le responsable peut solliciter un autre membre du groupe risque ; sans co-signature la demande reste en attente avec alerte (jamais de validation tacite) ; refus et motif tracés (q60). Le motif est obligatoire et tracé ; Audit est prévenu chaque fois qu'il n'est pas lui-même décideur. La décision est inscrite au journal des décisions prises en l'absence du Comité, visible dans une vue dédiée au Comité et à Audit, sans autre restriction ; jamais de validation tacite ; jamais l'administrateur du client (DECISION-040 q52 à q56, qui précise DECISION-039 point 3). ~~Si le groupe Audit est vide, elle passe au responsable du risque ; s'il est lui-même concerné, il décide avec la consultation d'un autre membre (paramètre configurable).~~ Les votes déjà émis à l'échéance sont gardés dans l'historique, visibles par le décideur, et non comptés dans la nouvelle décision (q57).

~~**Pas de quorum forcé par défaut pour les décisions (DECISION-040, q55, révise q27).** Le système est souple et adaptable à l'environnement de contrôle, les actions étant journalisées. La règle de décision par défaut reste ouverte (q61) ; l'articulation avec les règles fixes ci-dessous (« jamais un seul membre ») est une réserve de la revue Compliance (R1), non tranchée.~~

**Règle de décision par défaut (DECISION-042 q61 et R1, révise q27).** Le système reste souple et journalisé (q55). Par défaut : majorité des votes exprimés à l'échéance, avec au moins un vote d'un membre non concerné ; un quorum minimal est activable dans l'administration ; si personne n'a voté à l'échéance, on passe au niveau suivant (Audit, puis fonction risque). Les règles A, B, C restent des règles prédéfinies que le client peut choisir à la place.

**Portée de « jamais un seul membre » (R1).** La règle fixe vise le vote du Comité : l'envoi à un groupe n'est possible que s'il compte au moins deux membres éligibles. Elle ne vise pas la décision de repli du circuit unique, qui peut être prise par une personne de la fonction risque mais est alors marquée, journalisée et ratifiée a posteriori. **Validé par le PO (DECISION-043 q72) : un groupe n'est sollicité que s'il compte au moins deux membres éligibles, sinon on passe au maillon suivant, en repli marqué ; la règle q61 est inchangée ; une décision prise par un seul vote exprimé est marquée « vote unique » dans la vue Comité/Audit.** ~~*(Précision rédigée par le Risk Manager, non écrite dans la décision : tension résiduelle N1, projet d'étape 2, 13.1.)*~~ Le vote unique n'est ni bloqué ni ratifié : point N11 (projet d'étape 2, 13.1 bis).

**Décisions de repli (q62).** Chaque décision prise en repli est marquée comme telle ; un indicateur suit la part des décisions de repli par groupe décideur ; le Comité les ratifie a posteriori (non bloquant) dès qu'il a des membres. Une décision d'Audit est marquée « prise par la 3e ligne » (q64).

**Ordre du circuit (q69).** L'approbateur choisi au Dispositif décide en premier ; s'il est vide ou ne peut pas décider, on suit le circuit unique (Comité, Audit, fonction risque) en sautant ce maillon.

**Une seule action par dossier (DECISION-043 q73).** Le cumul Comité + Audit reste autorisé (q58). Sur un même dossier, la personne n'agit qu'une fois : votante au Comité, elle est exclue côté Audit, et inversement. Elle ne ratifie jamais une décision à laquelle elle a pris part.

**Ratification (DECISION-043 q74).** Aucun délai n'est imposé. Un indicateur « décisions en attente de ratification » est affiché. Si le Comité refuse de ratifier, la décision reste en vigueur, marquée « non ratifiée », et le dossier repart en vote du Comité.

**Plus personne pour décider (DECISION-043 q75).** Si ni le Comité, ni Audit, ni la fonction risque ne peuvent décider, la demande reste en attente. Une alerte est visible de tous les membres Risk Manager et un indicateur la suit. Jamais de validation tacite, jamais l'administrateur.

**Audit en repli (DECISION-043 q76).** Quand Audit remplace un Comité vide, il vote avec la même règle (q61). La décision est marquée « prise en repli par la 3e ligne ».

| Règle | Pour qui | Décision | Quorum | Délai | Relances |
|---|---|---|---|---|---|
| **A Léger** | petite structure | 2 votants d'accord | 2 | 5 jours | — |
| **B Standard** | structure moyenne | majorité des votants | au moins 3 | 10 jours | à 50 % et à 90 % du délai |
| **C Strict** | grande structure ou très régulée | unanimité | au moins 2/3 des éligibles, 4 minimum | 15 jours | — |

Règles fixes, qu'aucune règle ne peut changer :

- jamais de validation tacite : le silence n'est pas un accord ;
- à l'échéance, escalade : jamais de clôture automatique ;
- jamais un seul membre (au sens précisé ci-dessus et en invariant 10) ; un quorum de 2 n'existe que dans la règle A ; le quorum minimal est activable dans l'administration (q61) ;
- les auteurs et le Risk Owner, le Délégué et l'Exécuteur concernés ne votent pas ;
- chaque vote est motivé et tracé (append-only) ; un vote peut être retiré tant que la décision n'est pas close, le retrait étant lui aussi tracé ;
- un groupe vide ne peut pas être sollicité (l'envoi est refusé) ;
- le responsable de la fonction risque peut être membre du Comité, mais ne vote pas sur ce qu'il a saisi.

**Audit.** Quand Audit est l'approbateur choisi, il vote avec les mêmes règles que le Comité (règles A, B, C ou personnalisée, mêmes règles fixes). Audit ne saisit ni ne modifie jamais de données ; il exerce seulement les décisions prévues, marquées « prises par la 3e ligne » (q64). L'écran de création affiche un avertissement sur l'indépendance d'Audit, et un indicateur suit la part des changements approuvés par Audit.

## 9. Meeting

Le Meeting est une capacité transverse : ni mode d'évaluation, ni étape obligatoire, ni étape supplémentaire du stepper.

Il peut servir à recueillir des contributions, discuter, décider, valider une identification ou travailler sur une évaluation.

Le Meeting DJAMO est la source de vérité métier. Les calendriers externes sont des projections/synchronisations.

## 10. Dispositif — décision finale RM + UX + Architecture

Le **Dispositif** est le cadre méthodologique de référence qui rend une évaluation interprétable et comparable.

Il est distinct du Risque, du Processus, de l'Évaluation, du Meeting et de Risk 360. Il **porte** l'échelle, les grilles de cotation et l'appétence : ce sont des paramètres du Dispositif, versionnés avec lui.

### Règles validées

- Un Dispositif peut couvrir plusieurs Processus.
- Un Processus peut avoir un seul Dispositif actif à un instant donné.
- Le Dispositif est résolu après l'identification officielle, à partir du Processus applicable.
- Le signalement ne dépend pas du Dispositif.
- Une évaluation utilise une seule méthodologie de Dispositif applicable.
- Le Dispositif est versionné : `DRAFT → ACTIVE → ARCHIVED`.
- L'historique d'une évaluation ne doit jamais être réécrit par une modification ultérieure du Dispositif.
- Le contexte méthodologique applicable doit être conservé dans l'évaluation.
- La création d'un Dispositif se fait par un **assistant pas à pas**, activé par défaut. Une configuration directe reste possible pour les utilisateurs experts.
- L'organisation peut **activer un Dispositif par défaut** fourni avec l'outil. Un Dispositif par défaut respecte les invariants comme tous les autres.
- **Première activation (DECISION-040, q51).** ~~On demande d'abord de créer un utilisateur dans le groupe risque au niveau hiérarchique le plus élevé ; à défaut, l'administrateur du client l'active, une seule fois.~~ **Seul un membre du groupe Risk Manager active le premier Dispositif ; l'administrateur est retiré de cette règle. Le premier utilisateur créé par l'administrateur est le Risk Manager (groupe risque, plus haut niveau d'accès) ; l'administrateur peut, dans certains cas, être lui-même le Risk Manager.** Ce cumul est autorisé ; il est marqué sur la fiche, le motif est exigé et un tiers est prévenu (Audit ou Comité dès qu'ils existent) (DECISION-042 q63).
- **Amorçage avec un seul Risk Manager (DECISION-043 q77).** Au démarrage avec un seul Risk Manager, des actions sont autorisées en phase de démarrage. Elles sont marquées « amorçage » avec un motif. Elles apparaissent dans la vue « décisions prises en votre absence » des premiers membres d'Audit et du Comité, qui sont alors prévenus. *(Rédaction : la liste des actions, la fin de la phase et le rapport avec les invariants 1 et 5, q66 et q67 ne sont pas dits : points N8 à N10, projet d'étape 2, 13.1 bis.)*

### Traduction technique validée

Le Dispositif doit être un **objet persistant et versionné**, distinct de Risk 360.

Proposition technique :

- métier : **Dispositif** ;
- UX : **Référentiel de risque** possible ;
- technique : `RiskFramework` / `risk_frameworks`.

L'évaluation doit conserver le lien vers le Dispositif/version applicable et sa lineage/snapshot.

### Paramètres, invariants et gouvernance (amendement 2026-10-08)

Le Dispositif est **configurable** : le client final peut demander des modifications. Ses paramètres sont fixés à la création du Dispositif, avant le premier risque, avec des valeurs par défaut :

| Paramètre | Valeur par défaut |
|---|---|
| Mode par défaut porté par le Dispositif, puis Processus (DECISION-006) | Classique (`Config.evaluationMode` devient obsolète) |
| Changement de mode d'un Processus | Validé par la fonction risque (`process.evaluationmode.set` est retiré) |
| Politique Hybride (choix du mode par risque) | Désactivée |
| Qui note la Maîtrise, et quelle saisie fait foi | Selon le mode (§7) ; l'équipe risque fait foi |
| Cumul Risk Owner + Exécuteur | Autorisé jusqu'au seuil de criticité « faible » ; au-delà, exception approuvée et revue à chaque cycle |
| Seuil de criticité « faible » | Inscrit à la création du Dispositif ; configurable par le groupe Risk Manager, tout changement est tracé et approuvé |
| Cumul Délégué + Exécuteur | Autorisé, le Délégué ne validant pas sa propre exécution |
| Délégué | Recommandé, jamais bloquant (« Non désigné (équipe trop réduite) ») |
| Durée d'une délégation datée | Fixée par le client |
| Validateur | Responsable de la fonction risque ; Comité au-delà du seuil (§8) |
| Désignation des rôles | Direction du département ; approbation par l'équipe risque |
| Approbateur d'un changement de paramètre | Par défaut : la fonction risque approuve et Audit est notifié si son groupe n'est pas vide. Le Dispositif peut exiger l'approbation d'Audit et/ou du Comité. Audit vote avec les règles du Comité (§8) |
| Échelle et axes | Taille 3, 4, 5 ou 6 ; 7 axes au maximum ; fixés à la création (§6) |
| Descriptifs des niveaux | Un descriptif par niveau, pour la probabilité et pour chaque axe, saisi à la création |
| Appétence et grilles de cotation | Paramètres du Dispositif |
| Seuils de passage Comité (§8) | Paramètres du Dispositif, figés dans l'instantané de chaque évaluation |
| Règle du Comité asynchrone | Règle prédéfinie (A, B, C) ou personnalisée, choisie à la création (§8) |
| Auto-proposition de désignation | Désactivée par défaut. Seul le Comité l'active (invariant 5) |

**Invariants** (aucun paramètre ne peut les modifier) :

1. On ne valide jamais ce qu'on a saisi, revu ou exécuté ; le validateur est hors de tous les auteurs.
2. Risk Owner ≠ Délégué ; pas de Délégué sans Risk Owner.
3. Le Résiduel est saisi par l'équipe risque ; aucune contribution ni saisie de 1re ligne sur le Résiduel.
4. Le mode effectif d'une évaluation est Classique ou Participatif, jamais Hybride.
5. Toute désignation (Risk Owner, Délégué, Exécuteur) et tout changement de paramètre sont tracés (auteur, motif, valeur précédente, approbateur) et approuvés par un tiers. **Rien n'est jamais auto-approuvé.** Une **auto-proposition** (se désigner soi-même) n'est permise que si le Dispositif l'autorise. Ce paramètre est désactivé par défaut et son activation est décidée par le Comité. Quand il est activé : un **autre membre du groupe Risk Manager** approuve, avec motif et audit, et le cumul est marqué. S'il n'y a aucun autre approbateur, la demande est refusée. Un Comité vide ne peut pas l'activer. ~~Même en suppléance (§5) ; depuis DECISION-040 (q54) la suppléance est remplacée par le circuit unique, et ce garde-fou est à reconfirmer sous ce circuit.~~ L'activation exige un vrai vote du Comité, jamais en repli (circuit unique, §5) ; Audit est prévenu de toute entrée au Comité (DECISION-042 q65).
6. Tout cumul de rôles est marqué visiblement.
7. Les champs d'attribution sont forcés côté serveur ; l'audit est append-only ; l'historique d'une évaluation n'est jamais réécrit. **Si l'écriture de l'audit échoue, l'action est bloquée** (l'action et son audit sont dans la même transaction) ; une consultation confidentielle sans trace est refusée ; l'équipe risque et le support sont alertés.
8. Un paramètre ne peut jamais abaisser un invariant, ni être modifié pour faire disparaître un dépassement d'appétence.
9. Un changement ne touche que les cycles à venir ; les évaluations en cours gardent leur instantané.
~~10. Quelle que soit la règle de Comité choisie (prédéfinie ou personnalisée) : jamais de validation tacite ni de clôture automatique (escalade à l'échéance), jamais un seul membre, auteurs et Risk Owner / Délégué / Exécuteur exclus du vote, vote motivé et tracé, groupe vide refusé.~~
10. (Reformulé, DECISION-042 q61 / R1.) Quelle que soit la règle de Comité choisie (prédéfinie, personnalisée ou règle par défaut) : jamais de validation tacite ni de clôture automatique (escalade à l'échéance) ; jamais un seul membre au sens suivant : un groupe n'est sollicité pour un vote que s'il compte au moins deux membres éligibles, et le vote seul d'un membre ne vaut pas décision collective du Comité ; une décision de repli du circuit unique est un autre régime : marquée, journalisée, ratifiée a posteriori ; auteurs et Risk Owner / Délégué / Exécuteur exclus du vote ; vote motivé et tracé ; groupe vide refusé (le circuit unique s'applique alors). Sens de « jamais un seul membre » validé par le PO (DECISION-043 q72) ; une décision prise par un seul vote exprimé est marquée « vote unique ».

**Gouvernance d'un changement de paramètre** : les possibilités de configuration sont détenues par la fonction risque (groupe Risk Manager) et tracées. Le changement est demandé avec un motif écrit. **Par défaut, la fonction risque approuve le changement, différente du demandeur, et Audit est notifié si son groupe n'est pas vide. Le Dispositif peut exiger l'approbation d'Audit et/ou du Comité.** Quand l'approbateur est Audit, il vote avec les règles du Comité (§8). Si le groupe Comité est vide, le circuit unique du §5 s'applique : Audit, puis la fonction risque, avec journalisation (DECISION-040, q54) ; l'approbateur choisi au Dispositif décide en premier, et s'il est vide ou ne peut pas décider on saute ce maillon (q69) ; les décisions de repli sont marquées et ratifiées a posteriori (q62) ; ~~une personne au moins de la fonction risque prend en charge ce que le Comité aurait approuvé~~. On ne peut pas vider un groupe déjà choisi comme approbateur ; pour un Comité vide, le circuit s'applique. Les droits du groupe Audit ne sont modifiables que par l'administrateur de l'application, avec validation par Audit ou le Comité s'il est aussi responsable de la fonction risque (§5, q45). Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Tant que l'approbateur n'a pas décidé, la version reste en `DRAFT` ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. Quand l'approbateur est le Comité, il décide en séance ou par vote asynchrone selon sa règle (§8). L'audit conserve l'ancienne et la nouvelle valeur.

Le mode d'un risque donné ne peut différer de celui du Processus que si la politique Hybride l'autorise ; ce choix est motivé, approuvé et prend effet au cycle suivant. Le Dispositif n'est jamais redéfini risque par risque : il est résolu et affiché à l'ajout du risque. Les paramètres et les désignations en vigueur sont figés par instantané dans chaque évaluation.

Permissions cibles :

- `riskframework.read`
- `riskframework.create`
- `riskframework.update`
- `riskframework.activate`
- `riskframework.archive`
- `riskframework.process.assign`

### Risk 360

Le service existant `RiskDeviceViewService` représente une **vue composite Risk 360**, pas le nouveau Dispositif. Il devra être renommé ultérieurement pour supprimer l'ambiguïté terminologique.

## 11. Risk 360

Risk 360 reste une vue consolidée, transverse et en lecture. Il ne devient pas une deuxième source de vérité métier.

## 12. Réévaluation

Une réévaluation est un **nouveau cycle du même risque**. L'historique précédent ne doit jamais être écrasé.

```
Risque
 ├── Évaluation #1
 ├── Treatment Decision #1
 ├── Évaluation #2
 ├── Treatment Decision #2
 └── ...
```

## 13. UX validée

L'expérience doit privilégier :

- une seule source de vérité ;
- un parcours continu ;
- une fiche risque portant le cycle ;
- progressive disclosure ;
- contexte cumulatif ;
- contributions distinctes des décisions ;
- historique lisible ;
- Cartographie/Risk 360 comme vues de synthèse.

Le Dispositif peut être présenté comme **Référentiel méthodologique** dans l'UX. Dans l'évaluation, il apparaît comme contexte en lecture seule et ne devient pas une étape de cotation.

Autres points validés :

- création du Dispositif par un assistant pas à pas, configuration directe pour les experts ;
- notifications dans l'application et par e-mail ;
- accessibilité : WCAG 2.1 AA est le critère de sortie de chaque composant (tests automatiques et passe visuelle pour les contrastes).

Penpot est la référence visuelle avant implémentation.

~~Questions ouvertes au PO (DECISION-040) : q58 portée du réglage de cumul ; q59 Cartographie et taille de matrice ; q60 refus de co-signer ; q61 règle de décision par défaut sans quorum (R1) ; q62 garde-fous des décisions de repli (R2) ; q63 administrateur = Risk Manager (R3).~~ **Closes** par DECISION-041 (q59) et DECISION-042 (q58, q60 à q69, R1 à R3), reportées en §5, §6, §8 et §10. ~~Restent à arbitrer par le PO les incohérences nouvelles N1 à N7, sans décision.~~ N1 à N7 sont closes par DECISION-043 (q72 à q77). Restent à arbitrer par le PO les points nouveaux N8 à N14, sans décision (détail dans `RM-V1-Contrat-etape2-PROJET.md` §13.1 bis).

## 14. WebSocket-ready

La V1 est livrée **WebSocket-ready** : abstraction `RealtimeClient`, REST autoritaire, stratégie de resynchronisation, événements métier nommés et versionnés. **Le serveur WebSocket fait partie de la V2**, avec les retours futurs du client (DECISION-020). Le contrat événementiel complet et les tests temps réel suivent le serveur, donc la V2.

Le frontend doit être préparé pour le temps réel sans implémenter le WebSocket dans le premier lot.

```
PostgreSQL = source de vérité
REST/API = lecture + mutations autoritaires
WebSocket = notification de changement
```

Prévoir une abstraction `RealtimeClient` et une stratégie de resynchronisation.

Le futur contrat événementiel devra traiter versionnement, idempotence, tenant scope, reconnexion et resynchronisation.

## 15. Déjà réalisé

Lot 0 backend intégré à STAGING :

- **R-01** : Rating Scale ACTIVE/ARCHIVED immuable ;
- **P-04** : seuil d'appétence inactif exclu de l'applicable ;
- **D-06** : audit `ESCALATE` accepté par la contrainte DB.

La migration 044 est appliquée et vérifiée sur STAGING. Production n'a pas été modifiée par cette passe.

## 16. Interdictions dev-frontend

Ne pas :

- redéfinir la méthodologie ;
- inventer des règles de scoring ;
- supposer 7 axes ;
- modifier le backend sans lot explicite ;
- créer de migration ;
- créer un nouveau Design System ;
- créer une autre source de vérité ;
- implémenter le serveur WebSocket ;
- décider seul des règles maker-checker, Comité, Dispositif ou paramètres du Dispositif ;
- utiliser l'ancien frontend comme définition du produit.

Si un contrat manque :

```
STOP
↓
documenter le manque
↓
identifier le propriétaire du contrat
↓
attendre arbitrage / lot dédié
```

## 17. Séquence d'exécution

### Phase 0 — Trace et gouvernance

1. Conserver ce document dans le repo avec les Decision Logs.
2. Vérifier les décisions ouvertes et leurs propriétaires.
3. Ne jamais remplacer une décision validée par une supposition technique.

### Phase 1 — Penpot

4. Transformer le modèle RM + UX validé en écrans Penpot.
5. Préserver la Cartographie.
6. Repenser les anciens onglets comme capacités du parcours.
7. Validation Risk Manager.
8. Contrôle de faisabilité Architecte.
9. GO final Jean-Philippe.

### Phase 2 — Architecture exécutable

10. Transformer l'architecture validée en lots.
11. Pour chaque lot : API, DB, permissions, audit, frontend, historique, critères d'acceptation.
12. Identifier explicitement les dépendances bloquantes.

### Phase 3 — Fondations frontend

13. Mettre en place le parcours Risk Management.
14. Réutiliser `@djamo/design-system`.
15. Préparer le contexte cumulatif.
16. Préparer `RealtimeClient` sans WebSocket réel.
17. Obtenir le premier écran visible dans le navigateur.
18. Comparer Penpot ↔ navigateur.
19. Corriger avant d'élargir le périmètre.

### Phase 4 — Parcours métier

Ordre recommandé :

1. Identification ;
2. Analyse ;
3. Évaluation Inherent (saisie selon le mode, revue de la 1re ligne — §5 et §7) ;
4. Maîtrise (selon le paramètre du Dispositif) ;
5. Résiduel ;
6. Appétence ;
7. Treatment Decision ;
8. Validation / Comité ;
9. Traitement ;
10. Suivi ;
11. Réévaluation ;
12. Cartographie / Risk 360.

### Phase 5 — Capacités transverses

13. Dispositif / Référentiel méthodologique ;
14. Contributions ;
15. Meeting ;
16. permissions ;
17. audit ;
18. historique.

### Phase 6 — Temps réel (reportée en V2, DECISION-020)

En V1, seule la préparation du §14 est livrée. Les étapes 19 à 23 restent listées pour la V2.

19. Contrat événementiel Architect + Backend.
20. WebSocket backend.
21. WebSocket frontend.
22. Resynchronisation REST.
23. Tests reconnexion / idempotence / ordre.

### Phase 7 — QA et gates

24. QA fonctionnelle.
25. QA UX / Penpot.
26. QA sécurité / permissions.
27. QA historique / audit.
28. QA realtime (en V1, vérifie seulement que la V1 est WebSocket-ready).
29. Validation Risk Manager.
30. Validation UX.
31. Validation Architecte.
32. GO Jean-Philippe.
33. STAGING.
34. Validation STAGING.
35. Préparation PROD seulement après validation.

## 18. Gate entre les lots

Chaque lot doit retourner :

- fichiers modifiés ;
- décisions utilisées ;
- contrats utilisés ;
- tests ;
- captures/validation visuelle si pertinent ;
- écarts ;
- blocages ;
- aucun scope supplémentaire.

Le lot suivant ne démarre qu'après le gate humain.

## 19. Statut

```
Méthodologie Risk Management       ✅
RM + UX                            ✅
Dispositif métier                  ✅
Architecture cible                 ✅
Lot 0 backend                      ✅
STAGING                            ✅

Penpot final                       → prochaine étape
Frontend Risk Management           → après validation Penpot
Backend gaps méthodologiques       → lots dédiés
WebSocket                          → couche finale
PROD                               → hors périmètre actuel
```
