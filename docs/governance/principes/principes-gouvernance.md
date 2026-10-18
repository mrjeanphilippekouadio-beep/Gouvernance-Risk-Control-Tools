# Principes de gouvernance : proposition A13 (DECISION-073)

Statut : **PROPOSITION à valider par le PO.** Rien n'est décidé. Tous les seuils sont « à valider PO ». Détail complet (détection, objets, indications) : `principes-gouvernance.json`.

Réserve de sourcing : les normes ne sont pas dans le dépôt. COSO ERM 2017 (P2, P10-P17) est vérifié sur la synthèse IFACI. ISO 31000:2018 et le modèle des trois lignes de l'IIA sont cités de mémoire, « à vérifier sur le texte ». Le texte BCEAO / UEMOA sur le contrôle interne est une « référence à confirmer » (A14).

## 1. Les 19 principes

| Id | Principe | Gravité | Évaluable aujourd'hui |
|---|---|---|---|
| GOV-SOD-01 | Quatre yeux : on ne valide pas ce qu'on a saisi | élevée | oui (historique d'audit) |
| GOV-SOD-02 | La méthode (Dispositif, échelles) ne se décide pas seul | élevée | oui |
| GOV-SOD-03 | Pas d'auto-attribution de rôle | élevée | oui (`user_roles.grantedBy`) |
| GOV-SOD-04 | Cumul de rôles visible et encadré | moyenne | oui |
| GOV-SOD-05 | Pas de cumul de lignes de défense sur un dossier | moyenne | oui |
| GOV-RISK-01 | Existence et indépendance de la fonction risque | élevée | oui |
| GOV-RISK-02 | Continuité des rôles clés (intérim, vacance déclarée) | élevée | effectifs oui, intérim non |
| GOV-AUD-01 | Audit informé, jamais décideur | élevée | oui, un point à vérifier |
| GOV-AUD-02 | Une 3e ligne existe, ses droits ne sont pas réduits en solo | élevée | oui |
| GOV-COM-01 | Supervision par un Comité (≥ 2 membres) | élevée | oui |
| GOV-COM-02 | Pas de validation tacite ni par un seul membre | élevée | à vérifier (votes) |
| GOV-APP-01 | Appétence non masquable, fixée par l'instance | élevée | changements oui, marqueur non |
| GOV-OWN-01 | Chaque risque a un propriétaire actif | moyenne | oui |
| GOV-OWN-02 | Propriétaire de processus et champion de risque | moyenne | partiel |
| GOV-OWN-03 | L'auteur de l'Analyse ne valide pas l'évaluation | moyenne | non (Analyse inexistante) |
| GOV-ACC-01 | Moindre privilège (administrateurs, rôles larges) | moyenne | oui hors comptes dormants |
| GOV-TRC-01 | Décision sans seconde validation tracée et visible | moyenne | partiel (pas de marqueur) |
| GOV-TRC-02 | Gérant désigné informé ou qui statue | moyenne | non (compte inexistant) |
| GOV-REG-01 | Régime « structure à une personne » déclaré et levé | moyenne | non (drapeau inexistant) |

10 principes de gravité élevée, 9 de gravité moyenne. Chacun a, dans le JSON, une conséquence en langage métier, une règle de détection sur des données que l'application possède, les objets à lister (rôle, permission, utilisateur, nombre de personnes, paramètre) et trois indications (TPE, PME, grande entreprise) avec un niveau « exigé / recommandé / informatif ».

## 2. Données qui manquent (à ne pas inventer)

- Marqueur « sans seconde validation » et statut « revu par un tiers » : à créer.
- Régime « structure à une personne » (DECISION-059), gérant désigné, intérim / suppléant / vacance déclarée : inexistants.
- `processes.owner` est un **texte libre**, pas un compte : on ne peut pas vérifier que le propriétaire d'un processus est une personne active. Pas de champion de risque. Pas de N-1 (DECISION-064).
- Pas de dernière connexion : comptes dormants non détectables.
- Pas d'effectif réel de l'entreprise : le classement de taille mesure la maturité de gouvernance visible dans l'outil.

Un principe sans donnée affiche « non évaluable : donnée absente », jamais « respecté ».

## 3. Règle de classement de la taille (seuils à valider PO)

Indicateurs : P = personnes actives ayant au moins un rôle (une personne compte une fois) ; RM, COM, AUD = membres actifs des trois groupes fixes ; PO = propriétaires de processus distincts (indicatif seulement, texte libre).

1. **TPE** si P ≤ 10 ET RM ≤ 1 ET COM = 0 ET AUD = 0.
2. **Grande entreprise** si P ≥ 100 OU (RM ≥ 3 ET COM ≥ 3 ET AUD ≥ 2).
3. **PME** sinon.

Incertitude : valeur à moins de 20 % d'un seuil (« proche de la limite ») ; signaux contradictoires, ex. petit effectif mais Audit et Comité présents (« à confirmer ») ; aucune personne avec rôle (« non évaluable »).

Affichage si incertain : la colonne retenue est en surbrillance avec « classement à confirmer », la colonne voisine plausible est entourée « proche de ce profil », les valeurs P / RM / COM / AUD sont affichées. Pour un principe de gravité élevée, l'indication la plus stricte des deux colonnes est « à viser », l'autre « minimum acceptable ». Si non évaluable : aucune surbrillance. Option : une taille déclarée par l'éditeur qui prime sur le calcul.

## 4. Point rouvert : `guard:notLastRiskManager`

Options : **INT-A** intérim désigné à l'avance (borné, 90 jours proposés) ; **INT-B** suppléant permanent (deuxième Risk Manager) ; **INT-C** repli sur le gérant ou l'administrateur en régime déclaré ; **INT-D** vacance déclarée, groupe vide toléré et signalé dans le panel.

Recommandation : **INT-D comme plancher** (on ne bloque jamais), **INT-A voie préférée**, **INT-C dernier repli**. Dans tous les cas l'accès de la personne qui part est coupé le jour même : garder un compte d'ancien salarié actif est pire que la vacance. L'intérimaire ne peut pas venir de l'Audit, ne valide pas ses propres actes, et son intérim a une fin obligatoire. INT-B reste une indication du panel, pas une obligation.

## 5. Questions pour le cockpit

1. **TAILLE-1** : seuils du classement. Recommandation D (seuils proposés, taille déclarée facultative qui prime).
2. **PRINCIPES-1** : principes affichés par défaut. Recommandation A (tous, triés par gravité puis exigence).
3. **INTERIM-1** : démission du seul Risk Manager. Recommandation INT-D plancher, INT-A préféré, INT-C repli.
4. **PANEL-1** : acceptation formelle datée d'un principe non respecté. Recommandation C (jamais implicite, expirée = remise en rouge).
5. **DONNEES-1** : livrer avec les seuls principes détectables ou créer d'abord les données manquantes. Recommandation B (créer d'abord le gérant désigné et le marqueur « sans seconde validation »).

Les questions complètes (contexte, options, recommandation) sont dans le JSON, section `questionsCockpit`.
