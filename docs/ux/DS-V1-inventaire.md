# DS V1 — Inventaire du design system et plan de construction (A04)

**Statut** : DRAFT, lecture seule du code. **Base** : DECISION-028 (design system d'abord, revue Penpot ensuite), `RM-V1-Experience-Dispositif.md`, `ADMIN-et-RRI-cadrage.md`, `EVD-Import-Excel-cadrage.md`, `ROADMAP-V1.md` (R1 à R4), `RM-V1-Lots-contrat-amende.md` (F-1, F-2). Cartographie exclue. Aucun composant ne porte de règle métier : les composants affichent, le backend décide.

**Constat de départ** : 18 atomes (Breadcrumb, Button, Card, DatePicker, FileUpload, FormField, Grid, Menu, MessageBanner, Modal, Pagination, Panel, SegmentedControl, Slider, StatusBadge, Table, Tabs, Timeline), 6 graphiques, DashboardGrid. Hors package : la sidebar (`App.tsx`), `ContextRail` et `RaciPanel` (`frontend/src/design-system`). Les pages utilisent 107 `input/select/textarea` natifs bruts (hors Cartographie) : il n'existe aucun atome de champ de saisie.

## 1. Existant × besoin V1 × écarts

Colonnes d'états : survol, focus clavier, désactivé, chargement, erreur, vide, lecture seule. Seuls les écarts constatés dans le code sont listés ; « n/a » = sans objet pour ce composant.

| Composant | Besoin V1 (écran / lot) | Écarts |
|---|---|---|
| Button | Tous les écrans ; envoi à validation, retourner, valider (B-1, B-10) ; boutons de refus P9 (R2.2) | E1 pas d'état chargement (`aria-busy`, « En cours »). E2 seul `disabled` natif : le bouton sort de l'ordre de tabulation et ne peut pas porter la raison au focus ni ouvrir la fenêtre de refus ; il faut un mode `aria-disabled` + raison. E3 pas de `:focus-visible` dans le CSS du composant (hover, active, disabled seulement) |
| FormField | Création du Dispositif (R1.4), désignation (R2.1), signalement (R4.2), import (EVD-5) | E4 label, aide et erreur non reliés au champ (`aria-describedby`, `aria-invalid`). E5 pas de marqueur « obligatoire ». E6 pas de rendu lecture seule / désactivé (écran d'évaluation : zones éditable, lecture seule, verrouillée avec raison) |
| Table | Registre, Évaluations, À faire, Processus et rôles, Versions, résultats d'import | E7 chargement = texte « Chargement… », ni squelette ni `aria-busy`. E8 un seul message vide : pas de distinction premier usage / filtre sans résultat, pas d'action. E9 pas de sélection multiple (désignation en lot). E10 pas de tri (`aria-sort`). E11 ligne non ouvrable au clavier (file À faire : un clic ouvre l'objet). E12 pas de nom accessible / légende. E13 responsive = défilement horizontal seulement |
| Modal | Fenêtre de refus (P9), confirmations critiques (retour, rejet, archivage) | E14 focus non placé sur le titre, pas d'`aria-labelledby`. E15 actions sans état occupé |
| StatusBadge | Vocabulaire commun : Brouillon, À revoir, Retourné, Retenu, En attente de validation, Au Comité, Validé, Rejeté, Archivé ; badge de cumul | E16 texte + couleur seulement, l'icône exigée (texte + icône + couleur) manque. E17 le vocabulaire des 9 statuts n'est pas mappé sur les 5 tons |
| Tabs | Onglets du Dispositif (Checklist, Paramètres, Échelles, Versions), Administration | E18 `nav` + `aria-current` mais pas de navigation aux flèches. E19 ni onglet désactivé avec raison ni compteur |
| Panel | Listes secondaires attachées à un objet | E20 `role=tab` sans `tabpanel` ni flèches |
| Menu | Actions contextuelles | E21 `role=menu` sans navigation aux flèches ; `disabled` ignoré pour les liens |
| MessageBanner | Bandeau « Retourné » avec annotation, « Effet au cycle suivant », « Groupe vide » | E22 pas d'emplacement d'action (« Corriger et renvoyer », lien vers l'admin des groupes) |
| Timeline | Historique, trail d'approbation de version | E23 l'état (fait / en cours / à venir) n'est que visuel, non annoncé |
| FileUpload | Import d'évidences et de registre (.xlsx, plafonds 5 Mo, E.2) | E24 aucun état erreur, chargement ni consigne de contrainte (type, taille) |
| Sidebar (`App.tsx`) | Navigation repliable, entrée « À faire » avec compteur, groupe Dispositif | E25 hors package, non réutilisable ni testable isolément. E26 info-bulle en repli par attribut `title` seulement (pas fiable au focus clavier). E27 pas de badge compteur, visible même replié |
| ContextRail, RaciPanel (local) | Commentaires, RACI, preuves, occurrence ; panneau Contributions (F-2) | E28 hors package, onglets sans `role=tab`, panneaux Commentaires et RACI encore à l'état « non relié » |
| Pagination, DatePicker, Slider, Breadcrumb, Card, Grid, SegmentedControl, DashboardGrid, graphiques | Lots F-* en général | Non audités état par état ici (aucun écart constaté en lecture rapide) : audit S à faire en vague 2, dont alternative textuelle des graphiques |

**Total : 28 écarts** (E1 à E28), dont 11 d'accessibilité (E2, E3, E4, E11, E12, E14, E18, E20, E21, E23, E26), 7 d'états manquants (E1, E6, E7, E8, E15, E24, E27) et 1 de responsive (E13).

## 2. Composants manquants (justifiés par les documents)

| # | Composant | Lot / source | Note |
|---|---|---|---|
| M1 | Champs de saisie : Input, Select, Textarea, Checkbox, Radio (états complets, lecture seule) | Tous ; 107 natifs bruts aujourd'hui | Base de FormField (E4 à E6) |
| M2 | Fenêtre de refus (sur Modal) : action nommée, listes « Peuvent le faire » / « Peuvent vous donner les droits » plafonnées à 5 noms, « Copier la demande ». Variante « Contactez la fonction conformité » pour les permissions sensibles | R2.2, F-1, DECISION-011, DECISION-025 q02 | Contenu fourni par le backend ; aucun nom de permission affiché |
| M3 | Grille éditable de descriptifs (niveaux × probabilité + axes, navigation cellule à cellule, « 31 / 35 renseignés », saut à la première cellule vide) et éditeur d'échelle (3 à 6 niveaux, 1 à 7 axes, compteur « 4 / 7 ») | B-9 (R1.3), B-6 (R1.4) | Le nombre de niveaux et d'axes est une donnée, jamais codée en dur |
| M4 | Vue matrice P × I en lecture (dimensions variables) avec valeur et libellé, pas la couleur seule | B-9 ; comparaison à l'import (DECISION-027 q15) | Affiche, ne calcule pas l'impact retenu ni l'appétence |
| M5 | Stepper + assistant pas à pas (mode expert) | R3.1 (F-3), EVD-5 (4 écrans), RRI-2 | Voir point PO 1 |
| M6 | Section repliable (accordéon) pour paramètres avancés et formulaire en sections | P1, ADMIN §1 | |
| M7 | Info-bulle accessible (focus, Échap) | Sidebar repliée, bouton grisé avec raison (§5) | Corrige E26 |
| M8 | Badge d'état de réglage « Configuré / À compléter / Défaut actif » + badge de portée « Plateforme / Dispositif » | ADMIN §1 | Variante de StatusBadge |
| M9 | Ligne de checklist « Prêt à créer des risques ? » (statut, responsable, ce qui manque, lien) | P1, F-1 | Motif, pas un nouvel atome si Panel/PanelRow suffit |
| M10 | Gabarit « page de réglage » + recherche d'administration | ADMIN §1 | Un seul gabarit, pas un second formulaire |
| M11 | Liste « À faire » (ligne : objet, action attendue, qui attend, ancienneté ; groupée par type ; compteur) | F-1 (R3.2) | S'appuie sur Table (E11) |
| M12 | Panneau latéral générique (commentaires, contributions : type, texte obligatoire, mention « Une contribution n'est pas une cotation ») | F-2 (B-3, bloqué OD-4 jusqu'à q04) | Généralise `ContextRail` (E28) |
| M13 | Vote de comité : avancement « 3 sur 5 ont répondu », vote + commentaire, échéance | B-12 (R2.6), P6, DECISION-026 | Règle de clôture fournie par le contrat |
| M14 | Barre d'actions en lot (sélection, motif commun, résultat par ligne) | P2, UX §3 | Dépend du contrat « lot avec résultat par ligne » |
| M15 | Tableau de comparaison de versions (champs modifiés, ancienne / nouvelle valeur) | P8, B-6 | |
| M16 | Récapitulatif d'import éditable : feuilles, lignes, colonnes, types, avertissements, rapprochement explicite des colonnes et objets (jamais implicite), erreurs ligne / colonne / valeur / cause | EVD-5, RRI-2, DECISION-027 q14 | Le plus lourd des écrans d'import |
| M17 | Centre de notifications (cloche, compteur annoncé en texte, regroupé par objet) | UX §3, R1.6 (B-11 e-mail) | Voir point PO 2 |
| M18 | Squelette de chargement | UX §5 | Corrige E7 |

Non retenus (rien ne les justifie) : toasts, avatars génériques (RaciPanel les porte déjà), éditeur de texte riche.

## 3. Ordre de construction en 3 vagues

Taille : S = moins d'un jour, M = 1 à 3 jours, L = plus de 3 jours.

**Vague 1 — débloque R1 (Dispositif, échelles, groupes) et R2 (désignation, saisie, refus)**

| Élément | Taille | Lot |
|---|---|---|
| M1 champs de saisie + E4 à E6 | M | tous |
| E1, E2, E3 Button (chargement, aria-disabled + raison, focus-visible) | S | R2.2, B-1 |
| E16, E17, M8 StatusBadge (icône, vocabulaire, état de réglage) | S | R1, R2 |
| E14, E15 + M2 Modal durcie puis fenêtre de refus | M | R2.2, F-1 |
| M7 info-bulle accessible, M18 squelette | S | transverse |
| E7, E8, E11, E12 Table (états, ligne au clavier, nom accessible) | M | R1, R2 |
| M6 section repliable, M9 ligne de checklist | S | R1.4 |
| M3 grille éditable de descriptifs et éditeur d'échelle | L | R1.3, R1.4 |

**Vague 2 — saisie, validation, administration (R2 fin, R3)**

| Élément | Taille | Lot |
|---|---|---|
| E9, E10 Table : sélection, tri ; M14 barre d'actions en lot | M | B-5 |
| M11 liste « À faire » + E27 compteur sidebar | M | R3.2 |
| E25 à E28 sidebar et rail packagés, accessibles ; M12 panneau latéral générique | M | F-1, F-2 |
| M13 vote de comité | M | R2.6 |
| M5 stepper / assistant | M | R3.1 |
| M10 gabarit page de réglage + recherche d'administration ; M15 comparaison de versions | M | ADMIN, P8 |
| E18 à E23 Tabs, Panel, Menu, MessageBanner (slot action), Timeline | M | transverse |
| Audit des atomes non couverts (dont graphiques) | S | — |

**Vague 3 — import, notifications, finitions**

| Élément | Taille | Lot |
|---|---|---|
| E24 FileUpload + M16 récapitulatif d'import éditable et rapprochement | L | EVD-5, RRI-2 |
| M4 vue matrice P × I | M | B-9, RRI |
| M17 centre de notifications | M | UX §3 |
| E13 responsive (Table empilée, sidebar mobile) | M | transverse |

## 4. Décisions déjà prises et point restant

Déjà tranchés par le PO (vérifié par l'orchestrateur dans le Decision Log) :

1. **Création du Dispositif** : assistant pas à pas activé par défaut, avec configuration directe pour les experts (DECISION-017). Le Stepper (M4) passe donc en **vague 1**, partagé avec l'import EVD / RRI.
2. **Notifications V1** : dans l'application **et** par e-mail (DECISION-017 ; envoi configurable, DECISION-024). La cloche et la file « À faire » restent la base ; l'e-mail est porté par B-11.
3. **« Retourné » et « Rejeté »** : deux états distincts (DECISION-017).
4. **Comité asynchrone** : règles prédéfinies (Léger, Standard, Strict) et règle personnalisée (groupes qui valident, quorum, majorité, délai, relances), avec des règles fixes non configurables (DECISION-026). Cela fixe le contenu de M13.

Point restant pour le PO : **cible d'accessibilité WCAG 2.1 AA** comme critère de sortie de chaque composant (conditionne 11 écarts). Recommandation : la confirmer (question q20 de la page de pilotage).
