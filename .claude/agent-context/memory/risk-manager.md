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
