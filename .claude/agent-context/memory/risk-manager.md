# Mémoire — @risk-manager (A13)

Mémoire persistante du rôle Risk Manager sur GRC Tools. À lire **en
premier** par tout agent Risk Manager dispatché sur ce dépôt, avant
`SHARED_LOG.md` (`grep @risk-manager`). Tenue par l'orchestrateur : après
chaque intervention du Risk Manager, ses positions et principes y sont
ajoutés ou mis à jour. Les arbitrages finaux du PO (N0) priment toujours
sur ce fichier ; une recommandation non arbitrée est marquée comme telle.

## Principes retenus (formulés par le Risk Manager, 2026-10-08)

1. Je réponds en recommandations argumentées. Jean-Philippe (N0) décide, et
   je distingue fait, hypothèse et avis.
2. Contribution ≠ Cotation ≠ Décision ≠ Validation (contrat §5) : toute
   proposition qui fait coter ou décider un contributeur est à rejeter.
3. Les modes ne créent pas trois workflows (§7). Ils ne changent que les
   types de contribution ouverts, via une fonction unique.
4. Le Risk Owner est le seul décideur des cotations Inherent et Résiduel.
   Aucune contribution sur le Résiduel, jamais.
5. Séparation des tâches (mandat §43) : on ne peut ni cumuler désignation,
   cotation et validation sur soi, ni confirmer seul sa propre désignation.
6. Je ne mélange pas cause, événement et impact. Une structure d'Analyse
   doit les séparer.
7. L'historique d'une évaluation n'est jamais réécrit : tout contexte
   (mode, échelle, Analyse) est figé par instantané à la création.
8. Aucun code ne suppose un nombre d'axes d'impact. L'Impact retenu est le
   MAX des axes de l'échelle active.
9. Un blocage doit être justifié et proportionné. Je préfère l'alerte
   tracée et le KRI au blocage dur qui peut être détourné.
10. Je signale ce que le contrat ne tranche pas (ex. la Maîtrise dans §5)
    pour arbitrage PO, sans combler le trou par supposition.

## Positions sur les Open Decisions du passage Architecte

Source : `docs/architecture/RM-V1-Contribution-Hybride-E10-cadrage.md`.
Statut : **recommandations du 2026-10-08, en attente d'arbitrage PO**
(voir `ACTION_ITEMS.md`, lignes OD-1 à OD-11).

- **Évolution assumée de mes positions du 2026-09-29.** Je retire « L1
  soumet, L2 endosse » : le contrat §5/§7 sépare désormais celui qui
  informe (contributeur), celui qui cote (owner) et celui qui valide (un
  tiers). Le risque de biais d'auto-évaluation que je soulevais reste
  couvert. Le mode reste porté par le Dispositif **par principe** ; en V1
  il reste stocké sur Config/Processus avec instantané sur l'évaluation, et
  sa source basculera vers le Dispositif quand il existera.
- **OD-1, HYBRIDE.** Modes emboîtés CLASSIQUE ⊂ HYBRIDE ⊂ PARTICIPATIF.
  HYBRIDE = enrichissement qualitatif ouvert en amont, cotation centralisée
  chez l'owner. Matrice :

  | Type | CLASSIQUE | HYBRIDE | PARTICIPATIF |
  |---|---|---|---|
  | Signalement | Ouvert | Ouvert | Ouvert |
  | Identification | Fermé | Ouvert | Ouvert |
  | Analyse | Fermé | Ouvert | Ouvert |
  | Inherent | Fermé | Fermé | Ouvert |
  | Maîtrise | Fermé | Fermé | Ouvert |
  | Résiduel | Jamais | Jamais | Jamais |

  Risque sans processus résolu : seul le Signalement est autorisé. Rejeté :
  matrice configurable par tenant, cran d'endossement, Signalement
  dépendant du mode.
- **OD-2.** Texte obligatoire ; valeurs indicatives optionnelles pour
  Inherent/Maîtrise seulement (clés sur les axes de l'échelle active,
  `rating_scale_id` mémorisé), jamais sans justification, jamais recopiées,
  préremplies ni agrégées (pas de moyenne/médiane/consensus), affichées
  comme « avis » à côté de la cotation. Rejeté : bouton « reprendre cette
  valeur ».
- **OD-3.** V1 : permission `riskcontribution.create` + mode ouvert ; owner
  exclu de ses propres risques ; pas de portée RACI ni d'invitation (plus
  tard, quand la RACI sera source de vérité). Signalement : permission plus
  large, à trancher par Security. KRI anti-spam suggéré.
- **OD-4.** L'owner statue sur chaque contribution : RETENUE / ECARTEE,
  commentaire obligatoire si écartée ; RETENUE qualifie l'information, pas
  la cotation. Possible même après la fin du brouillon (trace). Rejeté :
  simple journal, statut intermédiaire.
- **OD-5, Signalement.** File de triage tenue par la fonction Risk (2e
  ligne), permission dédiée. Pas de rattachement obligatoire (processus
  indicatif possible, jamais Dispositif ni département). Issues tracées et
  motivées : conversion (désignation d'un owner, qui fait l'identification
  officielle ; lien conservé, aucun risque créé automatiquement),
  rattachement à un risque existant (contribution d'Identification), ou
  rejet. Réserve : confidentialité du signalant (fraude, inconduite) à
  soumettre à Privacy et Compliance. Lot séparé.
- **OD-6, E-10.** Inherent et Résiduel strictement réservés à l'owner,
  pas de saisie déléguée. **Trou du contrat** : §5 ne nomme pas la
  Maîtrise. Repli recommandé : saisie par l'owner dans le même parcours,
  appuyée sur les évaluations d'efficacité des contrôles, éclairée par les
  contributions Maîtrise (PARTICIPATIF), validée par un tiers. KRI
  suggéré : brouillons par owner et ancienneté (goulot).
- **OD-7.** Contrairement à l'Architecte (instantané) : contrôle à chaque
  saisie que l'acteur est l'owner actuel. L'ancien owner perd la main ; en
  V1, le brouillon est abandonné de façon explicite et tracée et le nouvel
  owner ouvre une nouvelle évaluation ; les contributions rattachées
  restent dans l'historique. Reprise tracée (`takeOver`) possible plus
  tard. Coût à vérifier par l'Architecte.
- **OD-10, Analyse.** Listes `causes[]`, `events[]`, `impacts[]` (libellé
  court + texte optionnel) et `context` texte ; contrôles connus dérivés
  des liens existants. Copie de travail éditée en place avec audit +
  instantané figé à chaque création d'évaluation. La contribution Analyse
  porte un `target` (cause / événement / impact / contexte) dès
  maintenant. Question PO : qui édite l'Analyse (suggestion : l'owner,
  permission `risk.analysis.update`).
- **OD-11.** Aucun blocage dur de `validate()` par des contributions
  SOUMISE (déni de service possible). Blocage doux : compteur visible par
  l'owner et le validateur, consigné à l'audit ; KRI sur la part et
  l'ancienneté des contributions non traitées.
- **OD-9 (question du PO sur l'auto-désignation).** Favorable au groupe
  désignateur portant `risk.owner.assign` (rôle RBAC, pas `risk.update`) et
  à la liste des désignateurs affichée à l'utilisateur sans le droit
  (exposition à valider par Security). Refuser de désigner un owner qui
  n'a pas `riskevaluation.create`. L'auto-désignation n'est pas interdite
  par principe (être owner de son risque est souhaitable, ISO 31000) ; ce
  qui est interdit, c'est de la confirmer seul : un membre du groupe peut
  se désigner avec justification obligatoire **et** confirmation par un
  autre membre du groupe, audit des deux acteurs ; groupe d'un seul membre
  → confirmation par HUMAN. Un non-membre ne se désigne jamais. KRI :
  nombre d'auto-désignations, part des risques dont le créateur est aussi
  l'owner. Prérequis de B-1 via B-0.

## KRI suggérés (à reprendre quand le module KRI de pilotage sera ouvert)

- Brouillons d'évaluation par owner et leur ancienneté (goulot).
- Part et ancienneté des contributions SOUMISE non traitées.
- Nombre d'auto-désignations de Risk Owner ; part des risques dont le
  créateur est aussi l'owner.
- Volume de contributions par contributeur (anti-spam).

## Trous du contrat au regard d'ISO 31000:2018 et COSO ERM 2017 (2026-10-08)

Statut : **recommandations, en attente d'arbitrage PO.** Réserve de
sourcing : les normes ne sont pas dans le dépôt ; les références sont
paraphrasées de mémoire et à vérifier sur les textes avant toute citation
littérale dans une décision consignée.

- **Fait vérifié dans le code** (`RiskEvaluationService.recordMasteryAssessment`) :
  la Maîtrise est déjà saisie par ligne de défense configurée
  (`masteryScale.defenseLines`) × trois dimensions (adéquation, exécution,
  efficacité), et la maîtrise globale est le MIN non compensatoire. Le
  commentaire de la méthode dit encore « moyenne » (périmé, famille F-5).
- **Qui cote la Maîtrise.** ISO 31000 (6.4.1, 6.4.3, 5.4.3, 6.2) impose un
  propriétaire accountable et un processus collaboratif limitant les biais,
  sans dire qui cote l'efficacité ; COSO ERM (P10-P14, P2, P15-P17) laisse
  la répartition des rôles à l'organisation ; les trois lignes (IIA 2020)
  font de l'auto-évaluation d'un exécutant un biais classique et réservent
  la note L3 à l'assurance indépendante. **Recommandation ferme** : l'owner
  seul **enregistre** la Maîtrise (même parcours, même évaluateur), mais
  chaque note de ligne s'appuie sur sa source : L1 ← exécutions de
  contrôles ; L2 ← évaluations d'efficacité validées + contributions
  Maîtrise retenues ; L3 ← conclusions d'audit. Note sans source ou en écart
  → signalée `Evidence Missing` au validateur et au Comité (pas de blocage
  en V1). Rejeté pour la V1 : « chaque ligne note sa ligne » (trois
  écrivains + endossement = workflow par mode interdit par §7), gardé comme
  évolution cible. Risque accepté à acter par le PO : l'owner reste juge et
  partie sur L1.
- **Qui édite l'Analyse.** ISO 6.4.2 (identification : sources, événements,
  causes, conséquences), 6.4.1/6.2 (collaboratif), 6.7 (enregistrement) ;
  attention, l'« analyse du risque » ISO couvre l'Évaluation du produit,
  l'« Analyse » du produit correspond à 6.3 + 6.4.2. **Recommandation** :
  l'owner seul édite l'Analyse officielle (`risk.analysis.update`) ; les
  autres informent par la contribution ANALYSE (`target`) ; la 2e ligne
  challenge sans réécrire. Règle unique : **les autres informent, l'owner
  écrit.** Point à trancher par le PO : en CLASSIQUE, la consultation
  attendue par ISO passe par le Meeting (§9) et l'owner (option
  recommandée), plutôt que d'ouvrir Identification/Analyse dans les trois
  modes (HYBRIDE se confondrait avec CLASSIQUE).
- **Signalement anonyme ou nominatif (DECISION-012)** : cohérent avec COSO
  Governance & Culture et ISO 6.2. Impacts : distinguer anonyme réel et
  confidentiel (ne jamais promettre un anonymat que le système ne tient
  pas) ; code de suivi remis au signalant ; KRI part d'anonymes et taux de
  rejet au triage ; conversion toujours par triage humain + identification
  officielle de l'owner.
- **Changements par rapport à mes recommandations précédentes** : OD-2,
  valeurs indicatives de la contribution Maîtrise par ligne de défense ×
  dimension (lues dans la `masteryScale` active) ; OD-6, Maîtrise à l'owner
  passe de repli à recommandation ferme ; OD-10, édition de l'Analyse
  réservée à l'owner. Inchangés : OD-1 (avec le point CLASSIQUE), OD-3,
  OD-4, OD-7, OD-9, OD-11.

### Principes ajoutés (2026-10-08, second passage)

11. La Maîtrise est structurée par ligne de défense × adéquation /
    exécution / efficacité. Je lis les `defenseLines` de l'échelle active,
    je ne suppose jamais trois lignes.
12. Tenir l'accountability d'une saisie ne veut pas dire la renseigner
    seul : l'owner enregistre, chaque ligne l'alimente par sa source.
13. La séparation des lignes se traite par la source et la validation, pas
    par un cran d'endossement (qui recrée un workflow par mode).
14. Pour l'Analyse comme pour l'Identification : les autres informent,
    l'owner écrit.
15. Distinguer anonyme et confidentiel : ne jamais promettre à un
    signalant un anonymat que le système ne tient pas.
16. Ne jamais citer une norme comme texte vérifié sans l'avoir sous les
    yeux : distinguer écrit et interprétation, demander la vérification.
17. Le vocabulaire ISO diffère du produit (« analyse du risque » ISO =
    Évaluation du produit) : le préciser avant de mapper une clause.

## Sources de référence disponibles

- **COSO ERM 2017, synthèse en français (IFACI)** : repères et vérification
  de mes références dans `docs/references/COSO-ERM-2017-synthese-notes.md`
  (le PDF n'est pas dans le dépôt, copyright COSO et dépôt public).
  Vérifié le 2026-10-08 : P2, P10-P14, P15-P17 confirmés ; « P11 aux
  niveaux inhérent, cible et résiduel » non vérifiable avec la synthèse
  (cadre complet requis). La traduction française dit « criticité » pour
  « severity ».
- **ISO 31000:2018** : pas encore disponible dans le dépôt (le PO n'a pas
  réussi à charger ses documents) ; mes références ISO restent à vérifier.

## Position du PO sur les modes de cotation (2026-10-08) — mes objections

Détail consolidé avec les autres rôles : `docs/architecture/RM-V1-Modes-cotation-objections.md`.
Statut : en attente des réponses du PO (Q1 à Q11).

- Je préfère la lecture **B** du Risk Owner : responsable métier qui ne cote
  pas mais décide du traitement ; l'équipe risque saisit le Résiduel.
- Je retire : « le mode ne s'applique jamais au niveau du risque » (accepté
  sous conditions : politique HYBRIDE du Dispositif, choix justifié,
  changement validé, mode effectif figé) ; le rejet de « chaque ligne note
  sa ligne » ; la matrice OD-1 (à réécrire en « qui saisit quoi »).
- Je maintiens : dispositif non redéfini risque par risque (comparabilité) ;
  revue de l'Inhérent du L1 par une 2e personne ; un seul L1 par risque ou
  une règle de consolidation ; validateur hors des saisissants en
  Classique ; mode effectif jamais HYBRIDE ; proposant de la Treatment
  Decision défini ; Inhérent et Résiduel restent des jugements humains.
- Maîtrise saisie par deux acteurs : les deux saisies conservées, la
  valeur de l'équipe risque fait foi, commentaire obligatoire en cas
  d'écart, pas de moyenne ; la MIN globale porte sur les valeurs qui font
  foi.

### Principes ajoutés ou modifiés (2026-10-08, troisième passage)

- Les principes 2, 3 et 4 dérivent du contrat §5/§7 : s'il est amendé, ils
  changent avec lui. Je défends la séparation des tâches et la revue
  indépendante, pas une attribution particulière de la saisie.
18. Un modèle « qui saisit quoi » par mode n'est pas trois workflows tant
    que les étapes sont les mêmes ; ce qui change est l'attribution.
19. Une auto-évaluation de la 1re ligne est acceptable si une 2e personne
    la revoit avant qu'elle serve de base au Résiduel.
20. Quand deux acteurs notent la même cellule, les deux saisies sont
    conservées et une seule fait foi ; pas de moyenne, commentaire
    obligatoire sur l'écart.
21. Le mode effectif d'une évaluation est toujours CLASSIQUE ou
    PARTICIPATIF ; HYBRIDE est une politique du Dispositif.
22. Le Dispositif ne se redéfinit pas risque par risque (comparabilité de
    la Cartographie) ; il peut être résolu et affiché à l'ajout.
23. Avant d'amender un principe de rôle, demander qui est le Risk Owner.

## Workflow RO / DEL / EXEC du PO (2026-10-08, quatrième passage)

Détail : `docs/architecture/RM-V1-Modes-cotation-objections.md` §6.
Statut : **recommandations, en attente des réponses du PO (questions A à
H).**

- Q1 tranchée (RO = responsable métier), Q7 tranchée (dispositif posé avant
  le risque), Q4 et Q6 en partie.
- RO et DEL par Processus, hérités par les risques, surcharge tracée ; EXEC
  par contrôle, relié à un utilisateur.
- Délégué : suppléant du RO (absence ou délégation datée), ne valide jamais
  ses propres actes.
- Config 1 : validateur extérieur au département (responsable de la
  fonction risque ou Comité). Config 4 « Sensible » : le cumul RO + EXEC
  est inversé par rapport à la sensibilité ; à interdire ou à compenser par
  un second contrôle indépendant.
- Ordre : poser échelles et appétence avec le dispositif ; les contrôles
  existent avant la désignation de leur exécuteur ; contrôle de cohérence
  avant la création du premier risque.

### Principes ajoutés (2026-10-08, quatrième passage)

24. Un cumul de rôles (RO + EXEC, DEL + EXEC) n'est acceptable que si
    s'appliquent la règle « on ne valide jamais ce qu'on a saisi ou
    exécuté » et un validateur extérieur ; la règle d'or du PO n'interdit
    que RO + DEL.
25. Définir les pouvoirs d'un délégué avant de coder la délégation :
    suppléant du RO, jamais validateur de ses propres actes ; la
    responsabilité reste au RO.
26. Rôles d'organisation (RO / DEL / EXEC) et lignes de défense (L1 / L2 /
    L3) sont deux axes distincts ; RO / DEL par Processus, EXEC par
    contrôle, règle vérifiée au niveau du risque après héritage.

## Projet d'amendement du contrat (2026-10-08, cinquième passage)

Projet : `docs/architecture/RM-V1-Amendement-contrat-modes-PROJET.md`
(§5, §7, §10 réécrits ou complétés ; §4, §8, §16, §17 touchés ; paramètres
du dispositif avec valeurs par défaut ; 9 invariants ; gouvernance des
changements de paramètres). **En attente de validation PO** ; le contrat
n'est pas modifié. Sept points marqués « À VALIDER PO » (§6 du projet),
dont la revue explicite de l'Inhérent L1 en plus de l'annotation.

27. Une annotation n'est pas une revue : seule une action explicite et
    tracée (« retenu » / « amendé avec commentaire ») prouve qu'une 2e
    personne a revu une saisie avant son usage.
28. Un paramètre du dispositif ne peut jamais abaisser un invariant ; tout
    changement est une nouvelle version, motivée, approuvée par un tiers,
    avec effet au cycle suivant.

## Arbitrage PO sur le projet d'amendement (2026-10-08, DECISION-015)

Contrat amendé (§4, §5, §7, §8, §10, §16, §17). Écarts avec mon projet :
la revue de l'Inhérent L1 est « retenu » ou « retourné / rejeté avec
annotation » (pas « amendé » par l'équipe risque) ; qui note la Maîtrise
est un paramètre du Dispositif (le PO refuse toute valeur figée : une
organisation en sous-effectif doit pouvoir s'adapter) ; contributions
seulement en mode Participatif, faites par la personne que désigne le
Risk Owner (Délégué, Exécuteur ou lui-même) ; seuil de criticité faible
inscrit à la création du Dispositif ; le Comité n'est pas disponible
spontanément, un changement de paramètre attend sa séance en DRAFT.
Restent ouvertes : Q9, Q10, Q11.

29. Le PO veut un dispositif configurable par le client : proposer des
    valeurs par défaut et des invariants, jamais une règle de répartition
    figée ; ne défendre comme non paramétrable que ce qui relève d'un
    invariant (séparation des tâches, traçabilité).

## Q9, Q10, Q11 déduites des positions du PO (2026-10-08, sixième passage)

Statut : **déductions à confirmer par le PO.**
- Q9 : pas de proposeur distinct ; le Risk Owner (ou le Délégué en
  délégation datée) enregistre la Treatment Decision ; l'équipe risque peut
  joindre une recommandation non contraignante ; invariant, pas paramètre.
- Q10 : « équipe risque » = rôle RBAC, tout membre sur tout risque du
  tenant, permissions par étape ; recommandé : un membre qui est RO, DEL ou
  EXEC d'un risque ne saisit ni ne revoit ce risque.
- Q11 : grille probabilité × niveau d'impact retenu, cellules optionnelles,
  repli sur `probabilityLabels` ; paramètre de la Rating Scale.
- À arbitrer par moi (Architecte, F-9) : la surcharge d'appétence ne doit
  jamais faire disparaître un dépassement (invariant 8).

30. Quand le PO tranche qui décide, une question « qui propose » se résout
    en supprimant l'étape ; au plus une recommandation non contraignante.

## Arbitrage PO sur Q9, Q10, Q11 (2026-10-08, DECISION-016)

- Q9 : ma déduction est retenue.
- Q10 : « équipe risque » = groupe fixe **Risk Manager**, jamais vide ;
  groupes **Risk Committee** et **Audit**, qui peuvent être vides ; les
  autres groupes sont les départements (plus des groupes techniques).
- Q11 : ma grille N×M n'est **pas** retenue. Le PO : probabilité et chaque
  axe d'impact (7 au maximum) partagent la même taille d'échelle (3, 4, 5
  ou 6, choisie à la création du Dispositif) ; chaque axe a ses propres
  niveaux décrits. Impact retenu = MAX des axes (§6) inchangé.
- Configuration : tenue par le groupe Risk Manager, tracée ; approbateur
  configurable entre Audit et Comité.
- Encore ouverts : conflit de rôles d'un membre Risk Manager sur son propre
  risque ; groupe approbateur vide.

31. Avant de proposer une structure d'échelle, demander ce que le PO
    entend par « corrélé » : chez lui, c'est « même taille d'échelle », pas
    une grille croisée.
- Complément PO (DECISION-016) : chaque niveau 1..N de la probabilité et
  de chaque axe d'impact porte son propre descriptif, saisi à la création
  du Dispositif.

## Comité asynchrone — défauts proposés (2026-10-08, non arbitrés)

Quorum majorité simple des éligibles (≥ 3, jamais 1) ; majorité des
exprimés ; égalité → relance puis séance ; abstention motivée comptée au
quorum ; un rejet motivé ouvre « Retourné » ; échéance 10 jours ouvrés
(3–30), relances 50 % / 90 %, une prolongation motivée ; l'échéance ne
clôt pas, elle escalade ; groupe vide → envoi refusé ; auteurs, RO, DEL,
EXEC exclus du vote. Invariants : jamais de validation tacite, jamais un
seul membre, vote nominatif et motivé en append-only. Constat code (F-14) :
`validateByCommittee` valide sur l'appel d'un seul membre.

32. Le silence n'est jamais un accord : une échéance déclenche une
    escalade, jamais une validation.

## Étape 2 — projet de report dans le contrat (2026-10-11)

- 2026-10-11 : rédigé `docs/architecture/RM-V1-Contrat-etape2-PROJET.md`
  (R1.1) : DECISION-016 à 020 et 021/025/026/027/029/030 reportées en texte
  proposé pour §4, §5, §6, §7, §8, §10 (dont invariants 5, 7 et un 10
  proposé), §13, §14, §17. **Contrat non modifié, en attente de validation
  PO.** 12 points non tranchables posés au PO, dont : périmètre de
  l'approbateur Audit/Comité, règle de décision d'Audit et indépendance 3e
  ligne, amorçage de la première activation, définition du « responsable de
  la fonction risque », effet d'un « Rejeté », appétence dans le Dispositif,
  comparabilité de la Cartographie entre tailles d'échelle. Détail des règles
  Comité A/B/C (q05) absent du dépôt : à annexer.
- 2026-10-11 : réponses du PO (DECISION-033 et 034, Q-E2-1 à 11) intégrées
  au projet d'étape 2 (section 11 devenue « Réponses du PO », section 13
  « Points restant à confirmer » : 7 points). Conflits signalés avec
  recommandation de garde-fou : la suppléance du Comité par la fonction
  risque doit respecter « jamais un seul membre », « jamais validateur de ce
  qu'on a saisi » et ne pas couvrir l'activation de l'auto-proposition
  (DECISION-019 P3). Lecture de q26 (fonction risque approuve par défaut,
  Audit notifié, Dispositif peut exiger Audit et/ou Comité) marquée
  « interprétation à confirmer ». Cartographie non touchée.
- 2026-10-11 : DECISION-035 (q34 à q39) intégrée au projet d'étape 2 :
  lecture de q26 validée ; suppléance du Comité vide par une personne au
  moins (garde-fous maintenus) ; ordre de revue Audit, Comité, suppléance
  (ordre après Audit en [Rédaction]) ; journaux des décisions prises en
  l'absence du Comité et d'Audit ; « Sans suite » retiré, statuts de
  contribution personnalisés ; Dispositif choisi à la création de l'espace
  client et/ou du Dispositif. Section 13 ramenée à q37 (proposition
  d'escalade, en attente du PO). Principe 33 : une décision du PO prime sur
  mon garde-fou recommandé (ici deux approbateurs -> une personne).
- 2026-10-11 : **DECISION-038 point 1 (q37) et point 2 (texte final
  validé).** Quorum du Comité impossible : envoi refusé ; décision par la
  fonction risque (responsable du service risque en suppléance, garde-fous
  q35) ; s'il est concerné, Audit si son groupe n'est pas vide, sinon un
  autre membre Risk Manager non concerné ; **jamais l'administrateur du
  client** (peut être de l'équipe technique) ; motif, trace, Audit notifié,
  journal des décisions prises en l'absence du Comité, jamais de validation
  tacite. Texte étape 2 **intégré au contrat** `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md`
  (version « étape 2 intégrée, 2026-10-11, DECISION-033 à 038 ») : en-tête,
  §4, §5 (groupes, responsable, suppléance, conflit de rôles, Rejeté, import),
  §6, §7 (statuts de contribution), §8 (Treatment Decision, Comité
  asynchrone A/B/C, Audit), §10 (Dispositif porte l'échelle, assistant,
  première activation, table, invariants 5, 7, 10, gouvernance), §13, §14,
  §17 (Phase 6 en V2). Projet passé à « VALIDÉ par le PO ». Séquence : étapes
  2 et 3 (P1-P6, DECISION-018/019) FAIT. Relecture A03 à suivre.
  **Vigilance ouverte** : la règle « Premier Dispositif » cite encore
  l'administrateur du client (même motif que q37 a priori) ; le PO n'a
  tranché que q37, texte inchangé, à confirmer.

- 2026-10-11 : **DECISION-039 point 3 : q37 RÉVISÉE** (remplace
  DECISION-038 §1). Quorum impossible (votants exclus ou échéance) : envoi
  refusé, demande à Audit ; Audit vide -> responsable du risque (groupe Risk
  Manager) ; concerné -> il décide AVEC CONSULTATION d'un autre membre
  (paramètre configurable) ; journal des décisions prises en l'absence du
  Comité ; jamais tacite ; jamais l'administrateur. Point 5 (q41) : Comité
  vide choisi comme approbateur, suppléance applicable (texte déjà conforme).
  Reporté dans le projet étape 2 (statut, résumé 9, 6.2, sources, sections
  11/13) et le contrat (en-tête, §8) avec les mots du PO. Questions Q-37a à
  Q-37i posées au PO, non tranchées : sens de « consultation » (ma
  recommandation : obligatoire, motivée, tracée, escalade HUMAN en cas de
  désaccord, non désactivable), contenu et défaut du paramètre (forme avis /
  co-signature, jamais « aucune »), tension avec q35 et invariant 1 (le
  concerné décide), « responsable du risque » ambigu, deux chemins pour un
  Comité indisponible, règle de vote d'Audit, perte de « motif / Audit
  notifié », sort des votes déjà émis, « Premier Dispositif » cite encore
  l'administrateur.

- 2026-10-11 : **DECISION-040 (q42 à q57) intégrée** au projet étape 2 et au contrat. Un seul circuit : Comité, Audit, fonction risque, journalisé ; remplace q31 et la suppléance q41. « Consultation » = co-signature (q52) ; responsable exclu s'il est demandeur/auteur. Pas de quorum forcé par défaut (q55) : règle ouverte q61. Premier Dispositif : administrateur retiré (q51). Taille de matrice et descriptifs (q49, q50) sans décrire la Cartographie (q59). Ouvertes : q58 à q61 plus R1 à R3 de la revue A14 (q62, q63). Incohérences signalées sans trancher : Audit « lecture seule » mais décideur ; entrée dans Comité sans approbateur (q44) alors que seul le Comité active l'auto-proposition ; « droits larges » du Risk Manager (q42) contre la suppression de ce droit en 3.1 ; premier Dispositif « différent du demandeur » impossible si un seul Risk Manager ; « jamais un seul membre » contre q55 ; garde-fou auto-proposition non repris sous q54. Leçon : dans les consignes d'un dispatch, « §n » peut viser le point n de la décision, pas la section du contrat ; vérifier.

- 2026-10-11 : **DECISION-041 et DECISION-042 intégrées** (projet étape 2 + contrat, textes remplacés barrés). Échelle toujours carrée, Cartographie en grille n×n sans grille avant Dispositif activé, visuel inchangé ; q58 (RM+Audit interdit, RM+Comité autorisé, seul réglage Comité+Audit autorisé par défaut) ; q60 ; q61/R1 (majorité des exprimés à l'échéance avec au moins un vote d'un non-concerné, quorum activable) ; q62 ; q63 ; q64 ; q65 ; q66 ; q67 ; q68 (co-signature toujours exigée) ; q69. Invariant 10 reformulé : « jamais un seul membre » = ne pas solliciter un groupe de moins de deux éligibles ; le repli est un autre régime (marqué, ratifié). **Cette précision est ma rédaction, pas la décision.** Nouvelles incohérences N1 à N7 listées au projet §13.1 sans arbitrage : vote unique possible (N1), cumul Comité+Audit sur une même décision (N2), ratification sans délai (N3), circuit sans maillon disponible (N4), Audit approbateur en repli (N5), premier Dispositif avec un seul RM (N6), tiers prévenu inexistant à l'amorçage (N7). Le rapprochement des incohérences 7 et 8 d'origine avec q69/q62-q63 est ma lecture.

- 2026-10-11 : **DECISION-043 (q72 à q77) intégrée** au projet étape 2 (en-tête, résumé 4, 3.1, 6.2, 7.2, 7.6, nouvelle table 11 quater, 13.1 et 13.1 bis) et au contrat (en-tête, §5, §8, invariant 10, §10 première activation, §13). N1 à N7 closes (q72 = N1, q73 = N2, q74 = N3, q75 = N4, q76 = N5, q77 = N6 et N7). Ma précision de l'invariant 10 (« au moins deux éligibles sollicités ») est désormais **validée par le PO** (plus une [Rédaction]). Points nouveaux **non tranchés** N8 à N14 : liste, fin et compatibilité de l'« amorçage » avec les invariants 1 et 5, q66, q67 (N8 à N10) ; vote unique ni bloqué ni ratifié (N11) ; règle et effets de la ratification, dossier sans ratificateur possible (N12) ; décompte des éligibles après exclusion des cumulants (N13) ; libellés de repli multiples, règle d'Audit en repli contre règle choisie, q75 sans escalade (N14). q70, q71, q78 non reportées (hors contrat à ce jour, q71 absent du contrat). Recommandations remises au PO (non décidées) sur F-B8t-06 / F-B8q-02 : `config.manage` compte comme admin, `config.update` non (la configuration est tenue par le groupe Risk Manager, DECISION-016) ; admin + Comité autorisé, marqué, motif, tiers prévenu, jamais votant sur ses propres demandes. Point connexe signalé : admin + Audit (l'admin modifie les droits d'Audit, q45) plus sensible que admin + Comité.

38. Un « amorçage » ou toute exception de démarrage doit avoir une liste fermée d'actions, une fin et une trace ; sinon c'est une exception permanente sans échéance (mandat §32).

37. Quand une décision du PO répond à un conflit entre invariants, ne pas reformuler l'invariant en silence : marquer la précision comme rédaction et lister la tension résiduelle.

36. Une décision qui retire une règle (quorum, approbateur) doit être confrontée aux invariants du contrat avant intégration ; signaler sans trancher.

35. Une règle d'escalade où le décideur peut être concerné par l'acte
    contredit « on ne valide jamais ce qu'on a saisi » : exiger au minimum une
    consultation obligatoire tracée, non désactivable par paramètre.

34. Quand le PO écarte un acteur pour un motif de nature (ex. administrateur
    = possible équipe technique), vérifier ce motif sur les autres règles du
    même document avant de conclure ; signaler sans modifier.

- 2026-10-12 : arbitrage B-6a (`docs/architecture/RM-V1-B6a-arbitrage-A13.md`, **recommandations non arbitrées**). F-B6a-04 : exclure aussi les auteurs de l'échelle encore en brouillon (audit `RatingScale`), ne pas exiger une échelle figée (circulaire : l'échelle devient ACTIVE par la décision du Dispositif, et ce serait une 2e approbation hors contrat) ; échelle déjà ACTIVE/ARCHIVED : pas d'exclusion (hypothèse à confirmer A06) ; prévenir le PO qu'il faut 3 Risk Managers pour éviter le blocage q75. F-B6a-05 : voulu par le contrat §8 (exclusion = quorum impossible -> circuit) ; garder la règle, mais enregistrer la cause du repli (ABSENCE / EXCLUSION), ratifier en priorité par les non concernés, KRI ; question PO facultative (3 options, option 1 recommandée). C-B6a-03 : rejoint A14, repli marqué « double contrôle dégradé » (régime FALLBACK, jamais NORMAL), Audit seul marqué 3e ligne, ratification append-only, q88 reste ouverte.

39. L'exclusion d'un auteur est de la séparation des tâches ; son effet sur le régime de décision (vote -> repli) doit être tracé avec sa cause, pas bloqué (principe 9).
40. Ce qui est approuvé comprend les objets que la demande référence (échelle, descriptifs), pas seulement la ligne de demande : l'exclusion des auteurs couvre l'ensemble.

# Addendum mémoire @risk-manager (A13), 2026-10-12

À ajouter À LA FIN de `.claude/agent-context/memory/risk-manager.md` (le fichier n'existe pas dans le worktree de base 0dc6bda, donc non édité ici ; le copier tel quel dans la mémoire puis supprimer cet addendum).

- 2026-10-12 : **revue DECISION-044** (`docs/risk/A13-review-DECISION-044.md`, **recommandations non arbitrées**). q82/q83 : lecture fidèle mais incomplète ; fin de l'amorçage **définitive et mémorisée** (sinon un RM rouvre l'exception en retirant le tiers), motif d'impossibilité structuré (le RM n'a pas `user.create`), tiers prévenu même si Audit et Comité sont vides (administrateurs autres + HUMAN), l'exception ne lève que « décideur ≠ demandeur », q83 l'emporte sur q62 pour BOOTSTRAP seul, KRI d'ancienneté plutôt que durée maximale, valeurs du Dispositif amorcé = défauts du contrat ou plus strictes (I-D5, question PO). Version ACTIVE héritée COMMITTEE/AUDIT : repérage pré-déploiement obligatoire, garde-fou FALLBACK (cause `LEGACY_APPROVER_PRE_B12`) seulement si ≥ 1 ligne, jamais d'intervention en base (le trigger d'immuabilité l'interdit). Trou de séparation des tâches trouvé (G1) : `changeAuditGroupPermissions` ne met en attente que l'auteur RM, donc admin + Comité applique seul des droits d'Audit. Admin + Audit non encadré (Q-A13-5). q96 : oui, notifier le propriétaire du risque du KRI (`Kri.riskId` est obligatoire). R1-R5, I-C1, I-C2 répondus (I-C1 et I-C2 confirmés).

41. Une exception à fin « événementielle » se ferme à sens unique : la fin est mémorisée, jamais recalculée sur l'état courant des groupes, sinon elle se rouvre à volonté.
42. Une règle qui dépend d'un acte « impossible » à déclarer n'est vérifiable que si le motif est structuré (qui, quand, pourquoi) et qu'un tiers hors groupes vides est prévenu.
43. Quand une catégorie devient autorisée (admin + Comité), chercher tous les flux où l'ancienne interdiction jouait le rôle de contrôle (ici la mise en attente des droits d'Audit).

- 2026-10-12 : **F-D044-08 et I-D7** (`docs/risk/A13-review-DECISION-044.md` §6, **recommandations non arbitrées**). q58 : étendre la définition « Comité = groupe ou pouvoirs de validation » (`isCommitteeRole`), dans les deux sens, assignation et élargissement (la règle regardait déjà l'Audit par ses pouvoirs : asymétrie). q65 : étendre aussi, y compris à l'élargissement d'un rôle ordinaire (sinon ce chemin reste muet), notification à la transition non-membre -> membre. Ni l'un ni l'autre ne relève du PO (cohérence d'implémentation avec q94/q80, durcit seulement un choix de tenant ; à consigner pour information). I-D7 : lecture orchestrateur confirmée ; consultation et information ouvertes dès le premier membre actif, « > 1 » = fin de l'amorçage, compté en éligibles actifs (ma rédaction, pas la décision). Réponses conciliables ; confirmation PO d'une ligne facultative, non bloquante.

- 2026-10-18 : **I-D8 et I-D9** (`docs/risk/A13-review-DECISION-044.md` §7, positions A13, PO informé, non décidé par lui). I-D8 : q98 ne contraint que les paramètres ayant un défaut au contrat ; pas de plafond inventé sur appétence / seuil « faible » / délégation / seuil Comité de traitement, mais valeurs libres figées et affichées (justification, route BOOTSTRAP, notice), avertissement R2 non bloquant ; un plafond serait une décision nouvelle du PO. I-D9 : interdit de se nommer « administrateur sollicité » (`askedUserId` ≠ demandeur, côté serveur) ; la prémisse de q83 (RM sans `user.create`) disparaît pour un RM administrateur ; sorties : autre administrateur ou création du second membre du groupe risque.

- 2026-10-18 : **F-B6d-02** (`docs/risk/A13-review-DECISION-044.md` §8, position A13, PO informé, non décidé par lui). Après un repli q100, la v2 naît RISK_MANAGER (q87) et Comité/Audit perdent leur rôle d'approbateur au-delà de B-12 : non voulu (q87 évite un approbateur inexerçable, q100 contourne sans supprimer). Rien à coder avant B-12 (option a rejetée : exception au garde q87 pour une population probablement vide ; payload d'audit `legacyChangeApprover` facultatif). A05 écrit dans la spec B-12 une demande de rétablissement par le circuit (jamais décidée par le RM d'origine), obligatoire si la ratification est refusée, confirmation explicite du client si acceptée ; item tracé, lié à C-B6d-05. Requête n° 10 à 0 ligne : une ligne de spec suffit ; >= 1 ligne : bloquant pour B-12 sur ce tenant.

48. Un contournement « jusqu'à B-12 » doit avoir une sortie écrite : sans règle de retour, il devient une suppression silencieuse du contrôle choisi par le client. Fermer cela dans la spec du lot qui lève la limite, pas par une exception dans le garde actuel.

46. Quand le contrat ne donne pas de valeur, on ne contraint pas par un plafond inventé : on rend la valeur visible au tiers. La visibilité remplace la limite que le PO n'a pas posée.
47. Une exception accordée pour une impossibilité (faute de droit) ne s'étend pas à qui a le droit : l'acteur qui peut agir ne peut pas attester seul qu'il ne l'a pas fait.

44. Une règle de gouvernance définie par une étiquette (groupe) alors que sa jumelle l'est par les pouvoirs est une asymétrie à corriger : un terme du PO (« Comité ») se définit une fois, par la substance, pour toutes les règles.
- 2026-10-18 : **consultation q113 (principe PO « tout modulable, défaut strict »)**, recommandations non arbitrées. I-D9 : je maintiens le refus du faux tiers (auto-nomination) mais propose un régime « une personne » déclaré, marqué sur chaque décision et rapport, jamais silencieux. Invariants proposés : jamais valider sa saisie, aucune auto-approbation, audit append-only/attribution serveur, historique figé, pas de validation tacite, appétence non masquable, cumul visible. Le reste = réglages à défaut strict.
49. Un produit modulable ne retire pas un invariant : il le remplace, si le client est trop petit, par un régime dégradé honnête, marqué et visible, jamais par un faux tiers. Un contournement impossible à éviter pousse le client à fabriquer un second compte fictif : pire que l'exception déclarée.

- 2026-10-18 : **DECISION-060 confirmée avec réserve** (recommandations non arbitrées sur les points ouverts). Circuit d'approbation inchangé (`decide` l.481-491 : demandeur et auteurs exclus, `assertRiskManager`), mais `assertRiskManager` garde aussi les 7 méthodes de rédaction : à retirer de celles-là seulement. Admin : `riskframework.read/create/update/archive` + `ratingscale.read/create/update` ; jamais `activate`. Contrat amendé en place (en-tête, §1, §5, §10, §13, §16) ; champs Analyse non touchés (q121) ; DECISION-059 non intégrée. Constats : `setCommitteeEnforcement` fermé par le Dispositif (ConfigService l.299), donc DECISION-058 ne s'y applique plus ; le régime « une personne » (059) ne dit pas si la personne unique approuve ses changements après l'amorçage (aujourd'hui q75 permanent) ; le drapeau du régime ne doit pas être un paramètre du Dispositif ni modifiable par l'administrateur.

50. Un droit étendu par décision ne se règle pas par la seule attribution de permissions : chercher les gardes d'appartenance (groupe) qui doublent la permission, et garder distincts le droit de rédiger et le droit d'approuver.
51. Quand deux décisions du PO ouvrent deux chemins vers un même réglage (058 : un admin seul ; Dispositif : deux personnes), le chemin faible annule le fort : demander lequel prime, avec ma recommandation (le circuit).

- 2026-10-18 : **DECISION-068, lecture gouvernance « Droits et accès »** (`docs/governance/droits-acces/risk.json`, recommandations non arbitrées). Conflits signalés : auto-validation contre « ne jamais bloquer » (q126/q127), auto-attribution de rôle (q129), q130 (assouplissement par un administrateur seul : config.committeeenforcement.set, config.cumul.set, rolegroup.audit.update), plus des conflits moyens (Analyse DECISION-064, cumul admin + RM, RM + Comité codé en dur, appétence modifiable par l'administrateur, suspension qui vide Audit/Comité, mode d'évaluation direct). Ligne directrice : l'invariant devient « jamais en silence » ; hors régime déclaré l'interdit reste le défaut ; régime hybride (un administrateur seul tant qu'aucun tiers n'existe, circuit à deux dès qu'un tiers existe). Réserve : le contenu de q12 et la nature de q109 n'ont pas été vérifiés.

52. Quand deux principes du PO se contredisent (invariant contre « ne jamais bloquer »), ne pas choisir : proposer un régime déclaré, marqué et à seconde confirmation, avec le défaut strict hors régime.

- 2026-10-18 : **DECISION-073, catalogue des principes de gouvernance** (`docs/governance/principes/principes-gouvernance.json` et `.md`, **PROPOSITION non arbitrée**). 19 principes (10 élevée, 9 moyenne), chacun avec détection sur données réelles, objets, indications TPE / PME / grande entreprise. Constats code : `processes.owner` est un texte libre (pas un compte), pas de champion de risque, pas de gérant désigné, pas d'intérim, pas de marqueur « sans seconde validation », pas de dernière connexion. Taille : TPE si P <= 10, RM <= 1, COM = 0, AUD = 0 ; grande si P >= 100 ou (RM >= 3, COM >= 3, AUD >= 2) ; sinon PME ; seuils à valider PO ; le classement mesure la maturité visible dans l'outil, pas l'effectif. `guard:notLastRiskManager` : INT-D (vacance déclarée) plancher, INT-A (intérim désigné, borné) préféré, INT-C (gérant) repli, INT-B (suppléant permanent) en indication seulement ; accès du partant coupé le jour même ; l'intérimaire ne vient pas de l'Audit. 5 questions cockpit : TAILLE-1, PRINCIPES-1, INTERIM-1, PANEL-1, DONNEES-1. Note : le commentaire de `Config.committeeAuditCumulAllowed` dit « Default true » alors que DECISION-061 l'a rendu interdit par défaut (commentaire probablement périmé, à vérifier par A06).

- 2026-10-18 : **DECISION-074, mise à jour du catalogue (v0.2, PROPOSITION non arbitrée).** q135 : questionnaire de profil de 12 questions fermées (effectif, personnes dans le risque, fonction dédiée, conformité, audit interne, audit externe, conseil, comité, processus, directions, supervision, dirigeant distinct) ; classement : S = fonctions structurées sur 5, grande si Q1 >= 250 ou (Q1 >= 100 et S >= 4), TPE si Q1 <= 20 et S <= 1 et non supervisée, PME sinon (seuils à valider PO). Le calcul sur les comptes devient le profil observé ; écarts E1 à E6 affichés au panel ; le plus exigeant des deux s'applique si l'observé dépasse le déclaré ; baisse de taille avec seconde confirmation dès qu'un tiers existe. q136 : 57 indications vérifiées, complet. q137 : N = max(déclaré, comptes), remplaçant désigné dès N >= 2, jamais bloquant, personne seule = point de défaillance unique. q139 : D01 à D19. Questions : PROFIL-1, INTERIM-2, PROFIL-2, DONNEES-2. Je n'ai pas vérifié dans le code si les votes du Comité (D16) sont lisibles dans audit_logs.

56. Un questionnaire déclaratif doit être confronté à l'observé et le plus exigeant des deux s'applique : sinon se déclarer plus léger est gratuit. L'écart est une information, jamais un blocage.
57. Ne pas inventer de seuil réglementaire pour classer une taille : seuils proposés, marqués à valider, affichés avec les réponses qui les produisent.

53. Un panel de principes non respectés ne doit jamais afficher « respecté » faute de donnée : « non évaluable : donnée absente » est un état à part entière.
54. Le classement de taille mesure la structure visible dans l'outil, pas l'effectif ; en cas d'incertitude, montrer le calcul et la colonne voisine plutôt que trancher en silence.
55. Un garde-fou qui force à garder actif le compte d'un salarié parti pour que l'outil fonctionne est pire que la vacance déclarée : l'accès se coupe toujours sans attendre le remplaçant.

45. Un contrôle détectif (notification) doit couvrir le chemin le plus discret (rôle ordinaire, élargissement de rôle), sinon il ne couvre que celui que personne n'emprunterait. Une information sans accès à la preuve n'est pas un contrôle : privilégier la lecture d'une décision ambiguë qui n'affaiblit aucun contrôle, et la marquer comme interprétation.
