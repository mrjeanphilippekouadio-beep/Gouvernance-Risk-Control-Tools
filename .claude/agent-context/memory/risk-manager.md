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
