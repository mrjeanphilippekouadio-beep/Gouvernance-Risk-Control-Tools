# RM V1 — Expérience utilisateur du Dispositif (A04, UX Designer)

**Statut** : DRAFT pour validation PO, avant maquette Penpot. Aucune maquette ici.
**Base** : contrat amendé (§4 à §13, §16), DECISION-011, 012, 014, 015, 016, `RM-V1-Modes-cotation-objections.md` §6, `RM-V1-Lots-contrat-amende.md`. Les écrans existants (`EvaluationPage`, `RatingScalesPage`, `AppetitePage`, `RisksPage`, `RolesAdmin`, `ActionPlansPage`) et le design system (`Table`, `FormField`, `StatusBadge`, `Modal`, `Tabs`, `Timeline`, `SegmentedControl`, `MessageBanner`, `Panel`, `ContextRail`, `RaciPanel`) sont réutilisés ; aucun nouvel atome n'est proposé. La Cartographie est hors périmètre : toute vue de synthèse renvoie vers « Cartographie (hors périmètre) ».

## 0. Principes directeurs

1. **D'abord ce que je dois faire maintenant** : la page d'arrivée de chacun est sa file « À faire », pas un menu.
2. **Un objet, un écran, une seule source de vérité** : l'évaluation est un écran unique ; seules les zones éditables changent selon le mode et le rôle.
3. **Le système sait, l'utilisateur confirme** : valeurs par défaut, pré-remplissage du cycle précédent, rôle et mode résolus par le Dispositif, jamais re-saisis.
4. **L'interdit est impossible à saisir, l'impossible est expliqué** : on ne propose que les choix valides (listes d'éligibles fournies par le backend) ; un refus dit quoi faire (DECISION-011).
5. **Le frontend reflète, le backend décide** : aucune règle de cotation, de cumul ou de validateur n'est recalculée côté UI.

## 1. Acteurs et file de travail à l'arrivée

Un utilisateur peut cumuler plusieurs rôles : sa file « À faire » est l'union de ses rôles, groupée par type, triée par échéance de cycle. Les contrôles d'accès restent côté serveur ; masquer n'est pas autoriser.

| Acteur | Voit en arrivant (ordre de priorité) |
|---|---|
| **Équipe risque** (groupe Risk Manager) | 1) Inhérents à revoir (retenir / retourner) ; 2) évaluations à saisir ou compléter (Classique : tout ; Résiduel toujours) ; 3) évaluations à valider (hors ses propres saisies) ; 4) désignations à approuver ; 5) versions de Dispositif à approuver ; 6) signalements reçus (si droit de lecture) |
| **Risk Owner** | 1) Treatment Decisions à enregistrer ; 2) risques à contribuer à désigner (Participatif) ; 3) contributions à retenir/écarter (OD-4, sous réserve d'arbitrage) ; 4) cumuls à justifier ; 5) mes processus et mes risques |
| **Délégué** | Idem Risk Owner, étiqueté « au nom de <RO> » ; la délégation datée et son échéance sont rappelées en tête |
| **Exécuteur (1re ligne)** | 1) Inhérents/Maîtrises à saisir (Participatif) ; 2) Inhérents retournés, annotation du réviseur en tête ; 3) exécutions de contrôle (écran existant) |
| **Direction de département** | 1) Désignations à proposer (processus sans RO, sans Délégué, contrôles sans Exécuteur) ; 2) désignations refusées à reprendre |
| **Admin du Dispositif** (`riskframework.update`) | Checklist de mise en place ; versions en DRAFT et leur état d'approbation |
| **Approbateur de configuration** (Audit ou Comité) | Versions de Dispositif en attente ; pour le Comité : ordre du jour asynchrone |
| **Risk Committee** | Évaluations/Treatment Decisions au-dessus du seuil, vote asynchrone avec échéance |
| **Audit** (lecture) | Pas de file d'actions sauf rôle d'approbateur ; accès direct à la recherche et à l'historique ; l'interface n'affiche jamais de conclusion « conforme » à sa place |
| **Tout utilisateur** | Bouton permanent « Signaler un risque » (hors Dispositif, hors mode) |

## 2. Parcours clés

Nombre d'actions = clics ou sélections de l'utilisateur, hors saisie de texte et lecture.

### P1. Mise en place du Dispositif — checklist + formulaire de création

**Tranche** : une **checklist « Prêt à créer des risques ? »** (conforme à l'avis UX/Frontend du §6.3) comme page de pilotage, et un **formulaire linéaire unique** (4 sections repliables) pour la création du Dispositif. Pas d'assistant bloquant : l'ordre est imposé par les prérequis visibles (section non atteignable = grisée avec raison), pas par des étapes obligatoires.

| # | Étape de la checklist | Prérequis | Actions visées |
|---|---|---|---|
| 1 | Créer le Dispositif | — | ~8 (voir ci-dessous) |
| 2 | Approbation de la configuration | 1 | 0 pour le créateur ; 2 pour l'approbateur |
| 3 | Rattacher les Processus et désigner RO/DEL | 2 | 1 par Processus (cf. P2) |
| 4 | Désigner un Exécuteur par contrôle | 3 | 1 par contrôle (en lot) |
| 5 | Prêt : « Créer un risque » devient actif | 2, 3, 4 | — |

Chaque ligne affiche : statut (badge texte), responsable, ce qui manque. Une ligne bloquée dit pourquoi et à qui s'adresser.

**Formulaire de création (cible ~8 décisions)** : (a) mode par défaut (Classique préselectionné), (b) Hybride oui/non (non par défaut), (c) taille d'échelle 3/4/5/6 (choix unique pour probabilité et tous les axes), (d) axes d'impact cochés (≤ 7, compteur visible « 4 / 7 »), (e) seuil « faible », (f) approbateur Audit ou Comité (voir état « groupe vide » en §5), (g) paramètres avancés (Maîtrise, cumul DEL+EXEC, durée de délégation, validateur) **repliés avec défauts du §10**, (h) envoyer pour approbation.

**Descriptifs (point le plus lourd : N niveaux x (probabilité + axes))** : une **grille unique** lignes = niveaux, colonnes = probabilité + axes ; navigation clavier cellule à cellule ; indicateur « 31 / 35 renseignés » ; enregistrement brouillon automatique ; envoi bloqué tant que des cellules sont vides, avec saut vers la première vide. Si une grille de cotation existante peut servir de point de départ, proposer « Partir de la grille active » (sous réserve du contrat, §6).

### P2. Désignation des rôles (RO, Délégué, Exécuteur)

| Étape | Actions |
|---|---|
| Direction de département ouvre la ligne Processus depuis « À faire » ou la checklist | 0 |
| Choisit une personne dans la liste d'éligibles (choix **exclusif** RO / DEL par personne : l'autre rôle disparaît de la liste) | 1 |
| Saisit le motif (obligatoire) | 0 |
| Envoie : la demande part à l'équipe risque | 1 |
| Équipe risque : ouvre la demande (valeur précédente, motif, auteur visibles), approuve ou refuse avec motif | 2 |

Cible : **2 actions** côté direction, **2** côté approbateur. Délégué « Non désigné (équipe trop réduite) » est un état normal, non bloquant. Cumuls : badges neutres « RO + EXEC » / « DEL + EXEC » dans la liste ; au-delà du seuil « faible », la demande indique « exception à approuver » et alimente la file de l'approbateur. Désignation en lot : sélectionner N processus ou N contrôles, un seul choix de personne et un seul motif pour tous, validation unitaire côté serveur et résultat par ligne.

### P3. Saisie et revue d'une évaluation selon le mode

L'écran est le même (voir §3) ; le mode effectif est figé sur l'évaluation et affiché en en-tête.

| Étape | Classique | Participatif |
|---|---|---|
| Entrée | File « À faire » de l'équipe risque, un clic ouvre l'évaluation | File « À faire » de l'Exécuteur (ou contributeur désigné) |
| Inhérent | Équipe risque saisit : probabilité + un niveau par axe ; 1 sélection par champ | Exécuteur saisit de même ; envoi |
| Revue de l'Inhérent | — (pas de revue) | Un autre membre de l'équipe risque : **Retenir** (1 action) ou **Retourner/rejeter** (2 actions : annotation obligatoire + confirmer) |
| Maîtrise | Selon le paramètre : champs de l'acteur désigné ; si deux saisies, les deux sont visibles, celle qui fait foi est marquée ; commentaire obligatoire en cas d'écart | Idem |
| Résiduel | Équipe risque, toujours | Équipe risque, déverrouillé uniquement quand l'Inhérent est « retenu » |
| Appétence | Comparaison affichée automatiquement après saisie | Idem |
| Envoi à validation | 1 action | 1 action |

**Actions visées par risque, hors sélections de valeurs** : Classique 2 (ouvrir, envoyer) ; Participatif 2 côté Exécuteur + 1 (retenir) côté réviseur + 1 côté équipe risque pour envoyer. L'impact retenu (MAX des axes) et la maîtrise globale (MIN) sont ceux renvoyés par le backend, présentés avec leur formule en texte.

### P4. Inhérent retourné ou rejeté

L'Exécuteur reçoit une notification et une ligne « Retourné » en tête de « À faire ». À l'ouverture : **l'annotation du réviseur est en bandeau fixe**, les valeurs précédentes sont préremplies et la différence avec la saisie initiale reste consultable. Il corrige et renvoie : **2 actions** (modifier ce qui doit l'être, renvoyer). Le Résiduel reste verrouillé, avec la raison « Inhérent non retenu ». Distinction visuelle et textuelle entre « Retourné » (à corriger) et « Rejeté » : l'état définit s'il reste une action possible (voir question 3).

### P5. Validation

Le validateur ouvre l'évaluation depuis « À faire » ; en tête : **résumé de l'objet, statut, auteurs de chaque saisie** (prévention de l'erreur d'objet). Il valide ou rejette avec motif : **2 actions**. S'il a saisi, revu ou exécuté quoi que ce soit sur cette évaluation, les boutons sont désactivés avec la raison (« Vous avez saisi l'Inhérent de cette évaluation »), sans le retirer de l'écran. Au-dessus du seuil Comité, l'écran indique « Transmis au Comité » plutôt qu'un bouton de validation.

### P6. Comité asynchrone

Membre du Comité : « À faire » liste les objets avec échéance ; ouverture sur un dossier unique (résumé, valeurs, écart d'appétence, historique) ; vote/décision + commentaire : **2 actions**. L'écran montre l'avancement (« 3 sur 5 ont répondu »), la règle de clôture telle que définie par le backend, et ce qui se passe à l'échéance (à fournir par le contrat). Si le Comité n'a aucun membre, voir §5.

### P7. Contribution (Participatif)

Le RO (ou le Délégué) désigne la personne en **2 actions** depuis la fiche risque (choisir parmi RO, DEL, EXEC des contrôles couvrants ; envoyer). La personne désignée voit la demande dans « À faire », ouvre un panneau « Contribuer » dans l'écran d'évaluation (type : Identification, Analyse, Inherent ou Maîtrise ; texte obligatoire) et envoie : **2 actions**. Le panneau rappelle en clair « Une contribution n'est pas une cotation ». Aucun champ Résiduel n'est proposé.

### P8. Changement de paramètre

L'admin ouvre le Dispositif, clique « Modifier » : une **nouvelle version DRAFT** est créée en copie de l'active (le pré-remplissage évite la ressaisie) ; il change les champs voulus et saisit le motif ; envoi : **3 actions** hors édition. En tête de page, deux versions côte à côte : « Active v3 » et « Brouillon v4, en attente de <approbateur> », avec un tableau d'écarts (champs modifiés, ancienne et nouvelle valeur). Message permanent : « Effet au cycle suivant ; les évaluations en cours gardent leurs paramètres actuels ». Pour un paramètre de séparation des tâches, l'approbateur affiché est le Comité et l'écran ne promet aucune date.

### P9. Refus d'action (DECISION-011)

Un seul composant `Modal` réutilisable pour tout refus. Contenu : 1) titre « Action non autorisée » ; 2) une phrase qui nomme l'action ; 3) liste **« Peuvent le faire »** ; 4) liste **« Peuvent vous donner les droits »** ; 5) bouton « Copier la demande » ou « Envoyer la demande » (si le backend le permet) ; 6) bouton Fermer. Les boutons ne sont jamais cachés : ils restent visibles, `aria-disabled`, avec le même texte d'explication au focus, et le clic ouvre la fenêtre. Par défaut, pour un refus sur le périmètre métier, on propose RO/DEL comme interlocuteurs ; pour une saisie, l'équipe risque (§6.3). Listes plafonnées à 5 noms avec « et N autres » ; aucune donnée de permission technique n'est montrée (pas de noms de rôles internes ni de chaînes de permission).

## 3. Patterns d'interaction communs et réduction de charge

| Pattern | Comportement | Charge supprimée |
|---|---|---|
| **Écran d'évaluation unique** | Mêmes sections (contexte cumulatif en lecture seule, Inhérent, Maîtrise, Résiduel, Appétence, Décision, Historique). Chaque zone a 4 états : éditable (pour moi), lecture seule (autre rôle ou autre étape), verrouillée avec raison, masquée si sans objet. Le `ContextRail` porte Dispositif/version, mode effectif, RO/DEL/EXEC, badges de cumul | 1 écran à apprendre au lieu de 3 modes ; aucune navigation entre écrans pour comprendre |
| **File « À faire »** | Une liste unique par utilisateur, groupes par type, compteur dans la sidebar, tri par échéance ; chaque ligne = objet, action attendue, qui attend, ancienneté ; un clic ouvre l'objet à la bonne zone | Plus de recherche de « où est-ce que je dois agir » |
| **Statuts et badges** | `StatusBadge` avec **texte + icône + couleur**, vocabulaire commun : Brouillon, À revoir, Retourné, Retenu, En attente de validation, Au Comité, Validé, Rejeté, Archivé ; badge de cumul neutre | Lecture immédiate sans ouvrir ; pas de couleur seule |
| **Notifications** | Dans l'application d'abord (cloche + file), liées à l'objet ; uniquement les événements qui créent une action pour moi ou changent l'état d'un objet que j'attends ; pas de notification des événements dont je suis l'auteur ; regroupement par objet | Moins de relances manuelles et de bruit |
| **Actions en lot** | Dans les listes (désignations, revues d'Inhérent, validations de faible criticité) : sélection multiple, un motif commun, résultat ligne par ligne ; **jamais** de validation en lot d'objets au-dessus du seuil ou qui impliquent un cumul | Réduit les répétitions sans supprimer la confirmation |
| **Valeurs par défaut** | Défauts du §10 préselectionnés ; paramètres avancés repliés ; mode, validateur, approbateur résolus par le Dispositif | Moins de décisions à la création et à chaque évaluation |
| **Pré-remplissage du cycle précédent** | Une réévaluation ouvre avec les valeurs précédentes, marquées « Cycle N-1 » ; on modifie seulement ce qui change ; une valeur inchangée se confirme en bloc (« Confirmer tout sans changement » avec récapitulatif) | Une réévaluation stable coûte 2 actions au lieu de la ressaisie complète. Le cycle précédent n'est jamais réécrit |
| **Prévention d'erreur** | Listes d'éligibles uniquement, résumé de l'objet avant toute action critique, annotation obligatoire pour retourner, motif pour désigner/modifier | Moins de corrections et de retours |
| **Fenêtre de refus** | Voir P9 | Un refus devient une démarche de 1 clic |
| **Signalement** | Formulaire court, 3 champs, choix « confidentiel » ou « nominatif » avec une phrase expliquant ce que chaque choix implique (le mot « anonyme » n'apparaît pas) ; accusé de réception sans exposer d'identité | Aucun obstacle pour le signalant |

## 4. Architecture de navigation

Sidebar repliable déjà décidée : groupes et libellés actuels de `App.tsx` conservés autant que possible ; icônes seules + info-bulle en mode replié. Le badge de compteur reste visible même replié.

| Groupe | Entrées | Contient |
|---|---|---|
| (en tête, hors groupe) | **À faire** (par défaut à l'arrivée) | File personnelle, notifications |
| **Risques** | Cartographie (hors périmètre) ; Registre (inclut Risk 360) ; Évaluations ; Appétence ; Grilles de cotation | Évaluations : liste filtrable par statut/étape/mode et l'écran unique. Registre : fiche risque (porte le cycle, contributions, Treatment Decision) |
| **Dispositif** (remplace le placeholder « Dispositif de risque ») | Dispositif (onglets : Checklist · Paramètres · Échelles et descriptifs · Versions) ; Processus et rôles | Checklist de mise en place, historique des versions et approbations ; Processus avec RO/DEL, contrôles sans Exécuteur |
| **Contrôle interne** | inchangé | Exécuteur désigné visible dans Contrôles |
| **Plans & revues** | Plans d'action, Cycles de revue | inchangé |
| **Audit** | inchangé | Consultation lecture seule de l'historique |
| **Administration** | IAM · Rôles et groupes ; Feedback ; Paramètres | Groupes : départements, Risk Manager, Risk Committee, Audit, techniques ; approbations de rôles |
| (en-tête global) | « Signaler un risque », cloche, fenêtre de refus | Accessibles de partout |

Appétence et Grilles de cotation existent déjà comme entrées ; le Dispositif en est le propriétaire logique (échelles et descriptifs). Proposition : conserver les entrées actuelles et les relier depuis l'onglet « Échelles et descriptifs » plutôt que les déplacer (voir question 5).

## 5. États à prévoir et accessibilité

| État | Comportement |
|---|---|
| **Vide** | « Aucune tâche en attente » dans À faire, avec lien vers la checklist si le Dispositif est incomplet ; premier usage de chaque liste : une phrase et l'action de création ; résultat filtré vide : « Aucun résultat pour ces filtres » + « Effacer les filtres » |
| **En attente d'approbation** | Badge « En attente de <fonction> », nom de l'approbateur ou du groupe, date de demande, ce qui reste utilisable en attendant (la version active continue de s'appliquer) |
| **Retourné** | Bandeau avec l'annotation, auteur, date ; l'action « Corriger et renvoyer » est le bouton principal |
| **Bloqué faute de prérequis** | Bouton désactivé (`aria-disabled`) + ligne « Il manque : Exécuteur pour CTRL-088 » avec lien vers la désignation ; jamais un message d'erreur technique. Cotation Participative sans Exécuteur relié : indiqué comme tel |
| **Groupe approbateur vide** | Pour Audit ou Comité vide : le choix est proposé mais marqué « Groupe vide » ; l'envoi pour approbation est bloqué avec la phrase « Aucun membre dans <groupe> : ajoutez un membre ou choisissez un autre approbateur » et un lien vers l'admin des groupes (ou la fenêtre de refus si l'utilisateur n'a pas le droit). Risk Manager ne peut pas être vide : le retirer du dernier membre est refusé avec explication |
| **Auteur = validateur** | Actions désactivées avec raison nominative |
| **Session expirée / hors délai / erreur** | Message en trois temps (quoi, pourquoi, que faire), brouillon conservé, aucune perte de saisie |
| **Chargement** | Squelettes ; action longue : bouton en état « En cours » + `aria-busy`, jamais d'écran figé |

**Accessibilité (cible WCAG 2.1 AA, à confirmer par le projet)** : tout parcours réalisable au clavier ; ordre de focus = ordre de lecture ; focus visible sur tous les composants ; focus placé sur le titre de la `Modal` à l'ouverture et rendu au déclencheur à la fermeture, piège de focus et Échap ; la grille de descriptifs navigue aux flèches avec libellés de ligne/colonne lus ; chaque statut combine texte, icône et couleur ; échelles de cotation lisibles par leur valeur et leur descriptif, pas par la teinte ; erreurs de formulaire annoncées (`aria-live`) et liées au champ ; zones interactives ≥ 24 px ; compteur de notifications annoncé en texte ; sidebar repliée : info-bulles accessibles au focus.

## 6. Contrats backend nécessaires et questions au PO

**Contrats nécessaires (rien d'inventé : ce sont des besoins à confier à l'Architecte, propriétaire du contrat)**

1. Endpoint « À faire » agrégé par utilisateur (type, objet, action attendue, échéance, ancienneté) et compteur ; sinon l'UI devrait combiner N listes.
2. Listes d'éligibles par action (RO/DEL/EXEC, réviseur, validateur) avec la raison d'exclusion.
3. Code d'erreur stable de refus + payload de la fenêtre DECISION-011 (noms autorisés, noms à qui demander), revue Security/Privacy requise avant code.
4. Prévisualisation du calcul (impact MAX, maîtrise MIN, écart d'appétence) sans persister, ou affichage après enregistrement du brouillon.
5. Brouillon enregistrable pour une évaluation et pour la version de Dispositif ; versions comparables champ à champ (écarts).
6. Pré-remplissage : lecture de l'évaluation du cycle précédent ; état de « confirmation sans changement ».
7. Statuts de revue (`PENDING|RETAINED|RETURNED`) et distinction Retourné/Rejeté ; annotation exposée avec auteur et date.
8. Règle de clôture du vote Comité asynchrone et échéance (inexistante dans les documents lus).
9. Notifications : événements, destinataires, canal (in-app seulement en V1 ?), état lu/non lu.
10. Actions en lot avec résultat par ligne.
11. Indicateur de cumul calculé à la lecture (déjà prévu B-5) ; indicateur d'état « groupe vide ».
12. Modèle de départ des descriptifs (grille existante) : à confirmer, sinon saisie complète.

**Questions au PO (5 maximum)**

1. **Checklist + formulaire linéaire** (recommandé) plutôt qu'un assistant pas à pas pour la mise en place : validez-vous ?
2. **Notifications en V1** : dans l'application seulement, ou aussi par e-mail ? (sans e-mail, la file « À faire » est le seul rappel)
3. **« Retourné » et « Rejeté »** : sont-ils deux états distincts (rejeté = clos, pas de nouvelle saisie ; retourné = à corriger) ou un seul état avec annotation ? Le contrat les nomme ensemble.
4. **Comité asynchrone** : quelle règle de clôture (majorité, tous les membres, un délai) et que se passe-t-il à l'échéance ? Sans cela l'écran ne peut pas annoncer la suite.
5. **Regroupement** : les entrées « Appétence » et « Grilles de cotation » restent-elles dans « Risques » (recommandé, reliées depuis le Dispositif) ou migrent-elles dans le groupe « Dispositif » ?

Après validation : maquette Penpot de (1) À faire, (2) checklist et création du Dispositif, (3) écran d'évaluation unique avec ses zones, (4) fenêtre de refus.
