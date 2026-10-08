# RM V1 — Projet d'amendement du contrat (modes de cotation, RO / DEL / EXEC)

**Statut : APPLIQUÉ le 2026-10-08, avec les arbitrages du PO (DECISION-015).** Le texte qui fait foi est désormais le contrat `.claude/agent-context/RISK_MANAGEMENT_V1_FINAL_DECISIONS.md`. Écarts entre ce projet et le texte appliqué : revue de l'Inhérent « retenu » ou « retourné / rejeté avec annotation » (pas « amendé ») ; qui note la Maîtrise devient un paramètre du Dispositif ; contributions limitées au mode Participatif, faites par la personne désignée par le Risk Owner ; seuil de criticité faible inscrit à la création du Dispositif ; le Comité n'étant pas disponible spontanément, un changement reste en DRAFT jusqu'à sa séance.
Auteur : Risk Manager (A13), 2026-10-08. Base : DECISION-014 (questions A à H, plus deux compléments), DECISION-006, DECISION-013.
Distinction utilisée : **[PO]** = décidé par le PO. **[À VALIDER PO]** = ma proposition, au-delà de ce qu'il a dit.

## 1. Textes touchés

### §5 Évaluation

**Texte actuel**
> Le Risk Owner reste le seul décideur des cotations Inherent et Résiduel.
> Contribution ≠ Cotation ≠ Décision ≠ Validation.

**Texte proposé**
> La saisie de l'Inhérent, de la Maîtrise et du Résiduel est attribuée selon le mode effectif de l'évaluation (§7). L'équipe risque saisit le Résiduel dans tous les modes. Le Risk Owner (responsable métier) décide du traitement ; il ne cote pas. Le Délégué remplace le Risk Owner en son absence ou par délégation datée ; il ne valide jamais ses propres actes ; la responsabilité reste au Risk Owner. Un acteur ne valide jamais ce qu'il a saisi, revu ou exécuté : le validateur est différent de tous les auteurs de l'évaluation. Saisie ≠ Décision de traitement ≠ Validation.
> Une saisie de la 1re ligne (Inhérent, en mode PARTICIPATIF) est revue par un membre de l'équipe risque, par une action explicite « retenu » ou « amendé avec commentaire », avant de servir de base au Résiduel. **[À VALIDER PO]**
> La maîtrise globale reste le MIN non compensatoire. Quand deux acteurs notent la même cellule de Maîtrise, les deux saisies sont conservées, celle de l'équipe risque fait foi, un commentaire est obligatoire en cas d'écart, sans moyenne. **[À VALIDER PO]** (question Q3, non tranchée par DECISION-014)

### §7 Modes et contributions

**Texte actuel**
> Modes : Classique ; Participatif ; Hybride. Ils ne créent pas trois workflows métier différents.
> Contributions possibles : Signalement ; Identification ; Analyse ; Inherent ; Maîtrise.
> Aucune contribution sur le Résiduel. Le contributeur apporte de l'information et ne cote jamais à la place du Risk Owner.

**Texte proposé**
> Les modes ne créent pas trois workflows : les étapes sont identiques, seule l'attribution de la saisie change.
> - CLASSIQUE : l'équipe risque saisit Inhérent, Maîtrise et Résiduel.
> - PARTICIPATIF : l'exécutant du contrôle (1re ligne) saisit l'Inhérent et sa part de Maîtrise ; l'équipe risque revoit l'Inhérent, saisit la Maîtrise qui fait foi et le Résiduel.
> - HYBRIDE : politique du Dispositif qui permet CLASSIQUE ou PARTICIPATIF. Le mode **effectif** d'une évaluation est toujours CLASSIQUE ou PARTICIPATIF, figé sur l'évaluation.
>
> L'équipe risque peut commenter ou annoter l'Inhérent saisi par la 1re ligne (modes effectifs PARTICIPATIF). **[PO]** Une annotation ne remplace pas la revue décrite en §5.
> Les contributions (Signalement, Identification, Analyse) apportent de l'information ; elles ne cotent pas. Aucune contribution ni saisie 1re ligne sur le Résiduel. Une saisie 1re ligne d'Inhérent ou de Maîtrise n'est pas une contribution : c'est une auto-évaluation soumise à retenue.
> Le sort des contributions « Inherent » et « Maîtrise » du contrat actuel (supprimées au profit de la saisie 1re ligne, ou gardées comme avis) reste à trancher (Q8). **[À VALIDER PO]**
> Rôles d'organisation (RO, DEL, EXEC) et lignes de défense (L1, L2, L3) sont deux axes distincts. RO et DEL sont portés par le Processus et hérités par ses risques (surcharge par paire seulement) ; EXEC est porté par le Contrôle et relié à un utilisateur. **[PO]**

### §10 Dispositif (ajouts, règles existantes conservées)

**Texte actuel** : « Un Processus peut avoir un seul Dispositif actif… Le Dispositif est versionné DRAFT → ACTIVE → ARCHIVED… »

**Texte ajouté**
> - Le Dispositif porte ses **paramètres** (mode, politique HYBRIDE, cumuls, plafonds, validateur, désignateur, échelles, appétence) avec des valeurs par défaut. Ils sont fixés avant la création du premier risque. **[PO]**
> - Le mode vient du Processus (DECISION-006), avec défaut au niveau du tenant. Le Dispositif n'est jamais redéfini risque par risque (comparabilité de la Cartographie). Il est résolu et affiché à l'ajout du risque.
> - Les paramètres et les désignations RO / DEL / EXEC en vigueur sont figés par instantané dans chaque évaluation (l'historique n'est jamais réécrit).
> - Un changement de paramètre suit la gouvernance du §3 ci-dessous.
> - Une surcharge du mode sur un risque donné n'existe que si la politique HYBRIDE l'autorise ; elle est motivée, approuvée et prend effet au cycle suivant. **[À VALIDER PO]** (position du PO du 1er tour, Q6 tranchée en partie seulement)

### Autres paragraphes rendus faux ou incomplets

- **§4** : « L'identification officielle relève du Risk Owner » reste vrai. Ajouter : « le Risk Owner est désigné au niveau du Processus ». Cela remplace la clause DECISION-013 « owner détenteur de `riskevaluation.create` » (caduque si le RO ne cote pas).
- **§8** : ajouter « Le Risk Owner décide de la Treatment Decision. » [PO] La question de qui la **propose** (Q9) reste ouverte.
- **§16** : « décider seul des règles maker-checker, Comité ou Dispositif » devient « …Comité, Dispositif ou paramètres du Dispositif ».
- **§17 Phase 4** : l'étape « Évaluation Inherent » suppose le RO comme cotant. À relire après validation.

## 2. Paramètres du dispositif (modifiables par le client) et valeurs par défaut

| Paramètre | Valeur par défaut |
|---|---|
| Mode par défaut du tenant / par Processus | CLASSIQUE (à aligner sur `Config.evaluationMode`) |
| Politique HYBRIDE (surcharge par risque) | Désactivée |
| Annotation de l'Inhérent par l'équipe risque | Active en PARTICIPATIF [PO] |
| Cumul RO + EXEC | Autorisé jusqu'à une criticité faible ; au-dessus, exception approuvée et revue à chaque cycle [PO : plafonné] |
| Cumul DEL + EXEC | Autorisé, le DEL ne validant pas sa propre exécution |
| Configuration « Sensible » (RO + EXEC + DEL) | Non préconfigurée ; à revoir [PO] |
| Délégué | Recommandé, jamais bloquant ; affiché « Non désigné (équipe trop réduite) » |
| Durée de délégation datée | À fixer par le client |
| Validateur | Responsable de la fonction risque ; Comité au-delà du seuil de passage Comité (§8) |
| Désignateur / approbateur | Direction du département désigne ; l'équipe risque approuve |
| DEL = N+1 d'escalade | Non |
| Textes libres `Control.executor`, `Process.owner` | Conservés, sans reprise automatique ; un contrôle sans exécuteur relié ne permet pas la cotation PARTICIPATIVE |
| Échelles (paires / impaires, probabilités), appétence, seuils Comité | Déjà paramétrables |
| Périodicité de revue des cumuls | Chaque cycle d'évaluation |

## 3. Invariants (non paramétrables)

1. On ne valide jamais ce qu'on a saisi, revu ou exécuté ; le validateur est hors de tous les auteurs. [PO]
2. RO ≠ DEL : on ne se délègue pas à soi-même ; pas de DEL sans RO. [PO]
3. Le Résiduel est saisi par l'équipe risque. Aucune contribution ni saisie 1re ligne sur le Résiduel. [PO]
4. Le mode effectif d'une évaluation est CLASSIQUE ou PARTICIPATIF, jamais HYBRIDE.
5. Toute désignation (RO, DEL, EXEC) et tout changement de paramètre sont tracés (auteur, motif, valeur précédente, approbateur), approuvés par un tiers, et jamais auto-attribués ni auto-approuvés. [PO]
6. Tout cumul de rôles est marqué visiblement, quel que soit le paramètre.
7. Les champs d'attribution sont forcés côté serveur ; l'audit est append-only ; l'historique d'une évaluation n'est jamais réécrit.
8. Un paramètre ne peut jamais abaisser un invariant, ni être modifié pour faire disparaître un dépassement d'appétence (mandat, point 26).
9. Un changement ne touche que les cycles à venir ; les évaluations en cours gardent leur instantané. [PO]

## 4. Gouvernance d'un changement de paramètre **[À VALIDER PO]**

Le PO a dit que le client peut demander des modifications. Il n'a pas dit comment. Je propose :
- **Qui demande** : l'administrateur du Dispositif (`riskframework.update`) ; le client final passe par lui.
- **Motif** : écrit, obligatoire.
- **Qui approuve** : le responsable de la fonction risque, différent du demandeur. Pour les paramètres de séparation des tâches (cumuls, plafonds, validateur, désignateur) : le Comité.
- **Comment** : le changement produit une nouvelle version du Dispositif (DRAFT puis ACTIVE, mécanisme déjà prévu au §10). Rien n'est modifié en place.
- **Effet** : au cycle suivant seulement. L'audit conserve l'ancienne et la nouvelle valeur.
- **Garde-fou** : KRI sur le nombre de changements et la part des risques par mode, pour repérer « le réglage qui donne la note voulue ».

## 5. Annotation seule : suffit-elle ? Non (réponse honnête)

Une annotation est un commentaire libre. Rien ne prouve qu'une 2e personne a lu l'Inhérent, ni qu'elle l'a jugé acceptable. Elle ne satisfait donc **ni mon principe 19 ni l'objection Compliance B-2**, qui exigent une revue avant usage pour le Résiduel.
Il faut en plus une **action explicite** d'un membre de l'équipe risque, différent de l'auteur 1re ligne : « retenu » ou « amendé avec commentaire ». En cas d'amendement, les deux valeurs sont conservées et celle de l'équipe risque fait foi (pas de moyenne). Tant que cette action manque, le Résiduel ne s'appuie pas sur l'Inhérent. L'annotation reste utile pour expliquer la décision. **[À VALIDER PO]** : c'est plus que la décision du PO.

## 6. Points « À VALIDER PO » (récapitulatif)

1. Revue explicite de l'Inhérent (retenu / amendé) en plus de l'annotation, et blocage de l'usage pour le Résiduel tant qu'elle manque.
2. Maîtrise à deux acteurs : les deux saisies conservées, l'équipe risque fait foi (Q3).
3. Sort des contributions « Inherent » et « Maîtrise » (Q8) ; Q2, Q9, Q10, Q11 non tranchées par DECISION-014.
4. Surcharge du mode par risque sous politique HYBRIDE (Q6 en partie).
5. Gouvernance des changements de paramètres (§4), dont le Comité pour les paramètres de séparation des tâches.
6. Plafond de cumul par défaut « criticité faible » et définition de la criticité retenue.
7. Invariants 4, 6 et 8 comme non paramétrables (ajoutés par moi).

## 7. Références normatives (paraphrasées, à vérifier)

- COSO ERM 2017, P2 (structures opérationnelles, gouvernance et culture) : **confirmé** par `docs/references/COSO-ERM-2017-synthese-notes.md`. Le cadre ne fixe pas qui cote ; il laisse l'organisation répartir les rôles.
- ISO 31000:2018 : un propriétaire du risque responsable, une démarche collaborative limitant les biais. **À vérifier** sur le texte, non disponible dans le dépôt.
- Modèle des trois lignes (IIA 2020) : l'auto-évaluation d'un exécutant est un biais connu ; revue indépendante utile. **À vérifier.**
- BCEAO : exigence d'indépendance des fonctions de contrôle selon l'agrément de Djamo. **À faire confirmer par les juristes internes.**
