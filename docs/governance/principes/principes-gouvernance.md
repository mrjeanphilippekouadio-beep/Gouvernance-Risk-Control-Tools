# Principes de gouvernance : proposition A13 (DECISION-073, mises à jour DECISION-074 et DECISION-075), version 0.3

Statut : **PROPOSITION à valider par le PO.** Rien n'est décidé au-delà des réponses q135 à q145 (DECISION-074) et q146 à q153 (DECISION-075). Le choix des 6 questions du profil et leurs seuils attendent la validation q154. Tous les seuils sont « à valider PO ». Détail complet (détection, objets, indications, questionnaire, données) : `principes-gouvernance.json`.

Historique des versions : 0.1 (DECISION-073, 19 principes, taille déduite des comptes) ; 0.2 (DECISION-074, questionnaire à 12 questions, écarts E1 à E6, données D01 à D19) ; 0.3 (DECISION-075, questionnaire à 6 questions).

Réserve de sourcing : les normes ne sont pas dans le dépôt. COSO ERM 2017 (P2, P10-P17) est vérifié sur la synthèse IFACI. ISO 31000:2018 et le modèle des trois lignes de l'IIA sont cités de mémoire, « à vérifier sur le texte ». Le texte BCEAO / UEMOA sur le contrôle interne est une « référence à confirmer » (A14). Le questionnaire ne cite aucun texte réglementaire.

## 0. Ce qui a changé

### v0.3 (DECISION-075)

- q146 : questionnaire ramené à 6 questions fermées (Q1, Q2, Q5, Q7, Q8, Q11). Les identifiants d'origine sont conservés ; Q3, Q4, Q6, Q9, Q10, Q12 sont retirées (section 2).
- Règle de classement réécrite : 4 critères de structuration (S sur 4) déclarés ou observés dans l'outil ; effectif retenu = le plus grand entre Q1 et les comptes actifs.
- q147 et q148 intégrées (administrateur remplit, le plus exigeant s'applique ; N = max(Q2, comptes Risk Manager)).
- Écarts : E5 et E6 retirés, E7 ajouté (effectif déclaré inférieur aux comptes actifs).
- Les 19 principes, leurs indications et les données D02 à D19 sont inchangés. Nouvelle question cockpit q154 (PROFIL-3).

### v0.2 (DECISION-074)

- q135 : la taille vient d'un questionnaire de 12 questions ; le calcul sur les comptes devient le « profil observé » et sert à afficher les écarts.
- q136 : vérifié, les 19 principes portent les 3 niveaux (exigé / recommandé / informatif) pour TPE, PME, grande entreprise.
- q137 : règle intérimaire / suppléant, sens du « nombre de personnes » à trancher (INTERIM-2).
- q139 : inventaire définitif de 19 données à créer (D01 à D19).
- Questions cockpit : 5 anciennes closes, 4 nouvelles (PROFIL-1, INTERIM-2, PROFIL-2, DONNEES-2).

## 1. Les 19 principes

| Id | Principe | Gravité | Évaluable aujourd'hui | Données à créer |
|---|---|---|---|---|
| GOV-SOD-01 | Quatre yeux : on ne valide pas ce qu'on a saisi | élevée | oui (historique d'audit) | D09, D10, D19 |
| GOV-SOD-02 | La méthode (Dispositif, échelles) ne se décide pas seul | élevée | oui | aucune |
| GOV-SOD-03 | Pas d'auto-attribution de rôle | élevée | oui (`user_roles.grantedBy`) | D14 |
| GOV-SOD-04 | Cumul de rôles visible et encadré | moyenne | oui | aucune |
| GOV-SOD-05 | Pas de cumul de lignes de défense sur un dossier | moyenne | oui | aucune |
| GOV-RISK-01 | Existence et indépendance de la fonction risque | élevée | oui | D01, D04 |
| GOV-RISK-02 | Continuité des rôles clés (intérim, vacance déclarée) | élevée | effectifs oui, intérim non | D04, D05, D18 |
| GOV-AUD-01 | Audit informé, jamais décideur | élevée | oui, un point à vérifier | D19 |
| GOV-AUD-02 | Une 3e ligne existe, ses droits ne sont pas réduits en solo | élevée | oui | D19 |
| GOV-COM-01 | Supervision par un Comité (≥ 2 membres) | élevée | oui | aucune |
| GOV-COM-02 | Pas de validation tacite ni par un seul membre | élevée | à vérifier (votes) | D16 |
| GOV-APP-01 | Appétence non masquable, fixée par l'instance | élevée | changements oui, marqueur non | D09 |
| GOV-OWN-01 | Chaque risque a un propriétaire actif | moyenne | oui | aucune |
| GOV-OWN-02 | Propriétaire de processus et champion de risque | moyenne | partiel | D06, D07, D08 |
| GOV-OWN-03 | L'auteur de l'Analyse ne valide pas l'évaluation | moyenne | non (Analyse inexistante) | D15 |
| GOV-ACC-01 | Moindre privilège (administrateurs, rôles larges) | moyenne | oui hors comptes dormants | D13, D18 |
| GOV-TRC-01 | Décision sans seconde validation tracée et visible | moyenne | partiel (pas de marqueur) | D09, D10, D11, D17 |
| GOV-TRC-02 | Gérant désigné informé ou qui statue | moyenne | non (compte inexistant) | D03, D17 |
| GOV-REG-01 | Régime « structure à une personne » déclaré et levé | moyenne | non (drapeau inexistant) | D14 |

10 principes de gravité élevée, 9 de gravité moyenne.

### Contrôle q136 (niveau par taille)

Complet : 19 principes x 3 tailles = 57 indications, chacune avec un niveau et une action. Points d'attention :
- GOV-RISK-01, PME « exigé » (2 Risk Managers) : rend la règle q137 toujours applicable à une PME.
- GOV-REG-01, PME « exigé » (le régime une personne ne doit pas exister) : une PME déclarant 1 seule personne dans le risque sera signalée en anomalie.
- GOV-TRC-01 et GOV-TRC-02 sont « exigés » dès la TPE : ils dépendent de D03, D09, D10.

## 2. Questionnaire de profil d'organisation (q135, raccourci à 6 questions par q146)

À remplir par l'administrateur du client avec le dirigeant, à l'onboarding. Questions courtes, fermées. « Je ne sais pas » est admis sauf Q1 et Q2. Les identifiants de la v0.2 sont conservés.

Principe de choix : une question est gardée si l'outil ne peut pas la déduire de ses données **et** si sa réponse change le classement ou une règle déjà décidée. Fait : l'outil observe les comptes actifs, leurs rôles (groupes Risk Manager, Comité, Audit), les processus et les départements saisis. Hypothèse : un compte actif = une personne.

| # | Question | Type | Pourquoi gardée |
|---|---|---|---|
| Q1 | Combien de personnes travaillent dans l'entreprise (salariés, temps partiel, prestataires réguliers) ? | nombre | effectif, non observable (les comptes ne sont qu'un minimum) |
| Q2 | Combien de personnes s'occupent de la gestion des risques, même à temps partiel ? | nombre | critère ; entrée de N = max(Q2, comptes Risk Manager) (q148) |
| Q5 | Avez-vous un audit interne ? | non / oui / je ne sais pas | critère ; comparé aux comptes Audit |
| Q7 | Avez-vous un conseil d'administration, de surveillance ou équivalent ? | non / oui / je ne sais pas | critère ; non observable |
| Q8 | Avez-vous un comité des risques ou d'audit ? | non / informel / formel / je ne sais pas | critère ; comparé aux comptes Comité |
| Q11 | Activité sous contrôle d'une autorité de supervision avec agrément ou licence ? | non / oui / je ne sais pas | plancher PME ; non observable |

### Questions retirées et ce qui les remplace

| Retirée | Remplacée par | Pourquoi c'est acceptable |
|---|---|---|
| Q3 fonction risque dédiée | Q2 et comptes Risk Manager ; part des risques et contrôles tenus par un Risk Manager (observé) | ne change ni le classement ni une règle : les indications de GOV-RISK-01 dépendent de la taille retenue |
| Q4 personnes en conformité | rien de direct | 1 critère sur 5, jamais décisif seul ; structure captée par Q2, Q5, Q7, Q8 et le rôle observé ; caractère réglementé par Q11. Risque résiduel : une PME centrée sur la conformité peut paraître moins structurée, compensé par Q11 et par « à confirmer » près des seuils |
| Q6 audit externe | donnée D19 (tiers externe de relecture) saisie par l'administrateur | n'entrait pas dans le classement |
| Q9 processus | nombre de processus actifs saisis (observé, information) | ne servait qu'au contrôle de couverture E5, retiré |
| Q10 directions / services | nombre de départements avec au moins un compte actif (observé, information) | donnée de contexte, jamais un critère |
| Q12 dirigeant distinct | donnée D03 (gérant désigné) avec indicateur « même personne que l'administrateur » calculé sur les comptes | ne servait pas au classement ; la désignation est confirmée par une autre personne |

### Règle de déduction (seuils à valider PO, aucun n'est une norme réglementaire)

Effectif retenu E = le plus grand de (Q1, nombre de comptes actifs de l'outil).

S = nombre de critères remplis parmi 4. Un critère est rempli s'il est déclaré **ou** observé : C1 = Q2 ≥ 2 ou comptes Risk Manager ≥ 2 ; C2 = Q5 = oui ou comptes Audit ≥ 1 ; C3 = Q7 = oui ; C4 = Q8 = formel ou comptes Comité ≥ 2.

1. **Grande entreprise** si E ≥ [250] ou (E ≥ [100] et S ≥ [3]). (3 sur 4 garde la proportion de l'ancienne règle, 4 sur 5.)
2. **TPE** si E ≤ [20] et S ≤ [1] et Q11 = non.
3. **PME** sinon. Une entreprise supervisée (Q11 = oui) n'est jamais TPE ; Q11 « je ne sais pas » l'empêche aussi tant qu'il n'est pas levé.

Incertain (« à confirmer », colonne voisine entourée) : E à moins de 20 % d'un seuil (16 à 24, 80 à 120, 200 à 300) ; S à une unité d'un seuil (E ≤ 24 et S = 2 ; E de 80 à 249 et S = 2) ; signaux contradictoires (E ≤ 10 et S ≥ 3, E ≥ 250 et S = 0, supervisée et E ≤ 20, Q1 inférieur aux comptes actifs) ; « je ne sais pas » qui change le classement. Questionnaire non rempli : « non évaluable : profil non rempli », repli provisoire sur le profil observé étiqueté « calculé d'après les comptes ».

Exemples fictifs : Q1 = 8, Q2 = 1, rien d'autre, non supervisé → TPE. Q1 = 40, Q2 = 2, conseil oui → S = 2, PME. Q1 = 15, supervisée → PME, à confirmer. Q1 = 130, Q2 = 3, audit oui, conseil oui, comité formel → grande entreprise. Q1 = 12 déclaré mais 31 comptes actifs → E = 31, PME, à confirmer.

### Qui remplit, modification, trace

Administrateur du client à l'onboarding, avec le dirigeant ; obligatoire avant l'ouverture du panel. Modifiable à tout moment, chaque version tracée (auteur, date, motif, ancien / nouveau), journal append-only, rappel de revue à 12 mois. Un passage à une taille moins exigeante exige une seconde confirmation dès qu'un tiers existe et le notifie ; sans tiers, motif et marquage « sans seconde validation ».

### Combinaison avec ce que l'outil voit

Le profil observé (comptes et rôles) est affiché à côté du déclaré. Le plus exigeant des deux s'applique (q147), avec la mention « profil observé plus structuré que déclaré » : c'est ce que font l'effectif retenu et les critères « déclarés ou observés ». Écarts affichés dans le panel (jamais bloquants) :

- E1 : Q2 supérieur aux comptes Risk Manager actifs (ex. « 3 personnes déclarées, 1 compte ») : comptes à créer ou déclaration à corriger.
- E2 : Q2 inférieur aux comptes Risk Manager (déclaration périmée ou comptes en trop).
- E3 : audit interne déclaré non présent dans l'outil, ou l'inverse.
- E4 : comité formel déclaré avec moins de 2 membres dans l'outil, ou l'inverse.
- E5 et E6 : retirés en v0.3 (leurs questions Q9 et Q12 le sont).
- E7 (nouveau) : Q1 inférieur au nombre de comptes actifs ; l'effectif retenu est le nombre de comptes.

La comparaison est à sens unique : plus de comptes que déclaré relève l'effectif retenu, mais un faible nombre de comptes est normal au démarrage et ne fait jamais baisser la taille.

## 3. Intérimaire et suppléant (q137)

Lecture validée par le PO (q148) : N = max(personnes déclarées Q2, comptes actifs du groupe Risk Manager). Dès que N ≥ 2, chaque titulaire du rôle Risk Manager a un remplaçant désigné à l'attribution du rôle : suppléant permanent (autre Risk Manager actif) ou intérimaire (compte actif hors Audit, sans droit tant que le titulaire est en poste, fin obligatoire, 90 jours proposés). Jamais bloquant : sans désignation, l'action « désigner un remplaçant » reste dans le panel avec son ancienneté. Une personne seule (N = 1) : aucune obligation, signalée comme point de défaillance unique ; le départ suit la vacance déclarée, accès coupé le jour même. D = 1 et comptes = 0 : écart E1, pas une vacance. D = 0 et un compte : écart E2. Sens de N : question INTERIM-2.

## 4. Données à créer (q139)

« Système » = posé par l'outil. Obligatoire : T = TPE, P = PME, G = grande entreprise.

| Id | Donnée | Définition | Qui la renseigne | T / P / G |
|---|---|---|---|---|
| D01 | Profil d'organisation | Réponses Q1, Q2, Q5, Q7, Q8, Q11 (6 réponses, v0.3), versionnées | Administrateur avec le dirigeant | oblig / oblig / oblig |
| D02 | Classement retenu et écarts | Classe, indicateurs, incertitude, écarts E1 à E4 et E7, effectif retenu | Système | oblig / oblig / oblig |
| D03 | Gérant désigné | Compte du dirigeant informé ou qui statue, second destinataire, indicateur « même personne que l'administrateur » | Administrateur, confirmé par un autre | oblig / oblig (DG + 2e) / reco |
| D04 | Remplaçant du titulaire de rôle | Intérimaire ou suppléant, dates, désigné par, confirmé par, fin d'intérim | Titulaire ou gérant, confirmation par un tiers | reco (oblig si N ≥ 2) / oblig / oblig |
| D05 | Vacance déclarée | Rôle, début, motif, échéance, déclarée par, confirmée par | Administrateur avec confirmation | facult / facult / facult |
| D06 | Champion de risque par processus | Compte relais de la gestion des risques | Propriétaire du processus | sans objet / oblig / oblig |
| D07 | Propriétaire de processus en compte | Lien vers un compte actif, reprise assistée du texte libre | Administrateur ou Risk Manager, confirmé par le propriétaire | reco / oblig / oblig |
| D08 | N-1 / attributaire par processus | Personne à qui le propriétaire confie l'attribution (DECISION-064) | Propriétaire | sans objet / reco / oblig |
| D09 | Marqueur « sans seconde validation » | Motif, seconde confirmation, date, auteur, revue par un tiers | Système, motif par l'acteur | oblig / oblig / oblig |
| D10 | Statut « Appliqué sans validation indépendante » | Distinct de « Validé » (q142) | Système | oblig / oblig / oblig |
| D11 | Date de mise en service du suivi | « Suivi depuis le <date> », pas de reconstitution (q143) | Système | oblig / oblig / oblig |
| D12 | Acceptation d'un principe | Motif, durée, acceptant, seconde confirmation, échéance (q138) | Gérant ou administrateur, tiers pour la seconde confirmation | facult / facult / facult |
| D13 | Dernière connexion | Dernière authentification réussie | Système | oblig / oblig / oblig |
| D14 | Régime « structure à une personne » | Drapeau, déclaration, levée (DECISION-059) | Éditeur ; levée par le système | oblig si applicable / sans objet / sans objet |
| D15 | Analyse du risque et auteurs | Entité Analyse, historique par auteur, droit d'édition (DECISION-064) | Propriétaire du risque et profils autorisés | reco / oblig / oblig |
| D16 | Votes nominatifs du Comité | Un vote par membre, append-only (à vérifier si déjà lisible dans le journal) | Système | sans objet / oblig si Comité / oblig |
| D17 | Notification et droit de lecture du panel | q140 et q144 | Système | oblig / oblig / oblig |
| D18 | Paramètres du panel | Délais : intérim 90 j, vacance 60 j, inactivité 90 j, écart 90 j, revue du profil 12 mois, acceptation 12 mois | Éditeur ; administrateur dans la plage | oblig / oblig / oblig |
| D19 | Tiers externe de relecture | Personne ou cabinet qui relit le journal, périodicité, dernière relecture | Administrateur avec le dirigeant | oblig / reco / sans objet |

Volontairement non créées : détection de deux comptes d'un même humain (données personnelles, à soumettre à Privacy), import d'effectif RH, comptes rendus de séances du Comité (non vérifié dans le dépôt). Avec D01 à D19, les 19 principes sont évaluables, sous réserve de D15 et D16. Une donnée absente affiche « non évaluable : donnée absente », jamais « respecté ».

## 5. Point rouvert : `guard:notLastRiskManager`

Le PO a répondu (q137). Le reste de la recommandation demeure : INT-D (vacance déclarée) en plancher, INT-A (intérim désigné, borné) voie préférée, INT-C (gérant) dernier repli, INT-B en indication seulement. Accès du partant coupé le jour même ; l'intérimaire ne vient pas de l'Audit.

## 6. Questions pour le cockpit

1. **PROFIL-3 (q154)** : choix des 6 questions et seuils de classement. Recommandation A (Q1, Q2, Q5, Q7, Q8, Q11 ; 250 / 100 avec 3 sur 4 / 20).
2. **DONNEES-2** : liste D01 à D19 et reprise du propriétaire de processus en compte. Recommandation A.

Questions closes par DECISION-074 : TAILLE-1 (remplacée par le questionnaire), PRINCIPES-1 (tous), INTERIM-1 (q137), PANEL-1 (q138), DONNEES-1 (q139). Closes par DECISION-075 : PROFIL-1 (q146, 6 questions), PROFIL-2 (q147), INTERIM-2 (q148).

Texte complet des questions : `principes-gouvernance.json`, section `questionsCockpit`.
