# RM V1 — Panel « Principes de gouvernance non respectés » (A04, UX Designer)

**Statut** : DRAFT pour validation PO. Spécification d'écran, pas de maquette, pas de code.
**Base** : DECISION-073 (panel), DECISION-072 (`guard:noSelfValidation`, `riskappetite.update`, cumuls visibles), DECISION-071 q132 (onglet Seuils d'appétence), DECISION-030 (WCAG 2.1 AA), `RM-V1-Navigation-Risques.md`, `DS-V1-inventaire.md`.
**Dépendances ouvertes** : catalogue des principes, texte des indications TPE / PME / GE et règle de détection de la taille (A13) ; contrat de calcul serveur (A05). Tant que A13 n'a pas livré, tout le contenu métier de cette note est un **exemple générique** (marqué « Exemple » à l'écran et dans le doc). Les seuils et textes passent en question cockpit avant implémentation.

## 1. Règle directrice

Le frontend affiche ce que le serveur calcule. Il ne détecte aucun principe, ne déduit pas la taille, ne compte pas les personnes, ne choisit pas la colonne à surligner : le serveur renvoie tout cela (voir §9). Le panel est en **lecture seule** : il ne corrige rien, il renvoie vers l'écran d'Administration qui permet de corriger (liens, jamais de second formulaire — règle 2 de la spec de navigation).

## 2. Emplacement dans la navigation

```
Administration
  Méthodologie      Dispositif de risque · Grilles de cotation · Appétence
  Référentiels      Processus · Départements · Catégories de risque
  Plateforme        IAM · Rôles · Feedback · Paramètres & référentiels
  Gouvernance       Principes de gouvernance          <- nouveau séparateur + 1 entrée
```

- Un séparateur « Gouvernance » avec une seule entrée « Principes de gouvernance » (même mécanique que les autres séparateurs : pas de nouveau niveau de menu). Raison : ce n'est ni un réglage de méthodologie ni un référentiel, c'est un contrôle de l'organisation ; le mettre sous « Plateforme » le noierait.
- **Compteur** sur l'entrée de menu : nombre de principes non respectés, annoncé en texte (« 4 principes non respectés »). Visible même en barre latérale repliée (E27 du DS).
- **Raccourcis entrants** (liens, aucune écriture) : depuis la notification « principes non respectés » et depuis le bandeau « Action sans seconde validation » de l'écran Appétence (voir §10). Cible `NotificationCenter` à ajouter.
- **Qui le voit** : administrateur, équipe risque (Risk Manager), membres d'Audit et de Comité, en lecture. Le périmètre exact de la permission de lecture est une décision A05 / A13 (question Q1). Le serveur décide ; sans droit, l'entrée est présente mais l'écran affiche le message « Vous n'avez pas le droit de consulter cette page » et ouvre `PermissionDeniedDialog` au clic (comportement de la spec de navigation §1.4).
- Le panel n'affiche aucun nom de permission technique : les « permissions » s'écrivent en libellé métier (« Modifier les seuils d'appétence »).

## 3. Onglet « Seuils d'appétence » du Dispositif (DECISION-071 q132)

Placement dans la spec de navigation : le **détail d'une version de Dispositif** (Administration > Méthodologie > Dispositif de risque > version) porte désormais les onglets **Checklist · Paramètres · Échelles · Seuils d'appétence · Versions**. L'onglet « Seuils d'appétence » remplace l'éditeur de la fenêtre « Modifier le brouillon » (qui n'a plus de champ de seuil).

- Il est éditable seulement sur un brouillon (même circuit d'approbation, aucun nouveau chemin d'écriture) ; sur une version active ou ancienne, il est en lecture seule avec le motif « Version approuvée : créez un brouillon pour modifier ».
- Le raccourci S2 (« Voir le seuil d'appétence ») et l'écran Administration > Appétence (liste en lecture) pointent vers cet onglet, ligne de la sous-catégorie.
- La sous-catégorie se choisit dans la liste des catégories de risque du référentiel (q133), jamais en texte libre.
- Lorsqu'un administrateur seul modifie un seuil (régime une personne), l'onglet affiche le bandeau « Modification sans seconde validation » (voir §6) ; c'est ce qui alimente le panel.
- Onglets : navigation aux flèches, onglet courant annoncé, onglet désactivé avec raison (E18, E19 du DS).

## 4. Structure de l'écran

Écran à deux niveaux : **liste** (page) puis **détail** d'un principe (volet ou page dédiée). Sur ordinateur, liste à gauche et détail à droite (même page, l'URL porte le principe sélectionné) ; sur mobile, deux pages successives (§8).

### 4.1 Synthèse (en haut, toujours visible)

Une carte unique, trois blocs, tous des textes :

1. **Taille détectée** : libellé en toutes lettres (« Petite structure (TPE) », « Entreprise de taille moyenne (PME) », « Grande entreprise ») précédé de « Taille de votre organisation estimée : ».
2. **Pourquoi** : phrase fournie par le serveur, qui cite les faits utilisés, p. ex. (**Exemple**) « Estimée d'après vos rôles : 1 administrateur, 1 Risk Manager, aucun membre d'Audit ni de Comité. » Lien « Voir les rôles » vers Administration > Rôles. Cette phrase est la transparence de la déduction : l'utilisateur doit pouvoir contester l'estimation (Q2).
3. **Principes non respectés** : total, puis décompte par gravité avec libellé + icône + nombre : « 1 critique · 2 importants · 1 mineur ». Jamais la couleur seule.

Sous la synthèse : phrase de cadrage permanente « Ce panel signale des écarts à de bonnes pratiques de gouvernance. Il ne remplace ni l'avis de votre Risk Manager ni celui de l'audit. » (le panel n'émet pas de conclusion d'audit ni de « conforme / non conforme » global).

### 4.2 Liste des principes

Tableau (composant Table) ; une ligne par principe non respecté. Colonnes : **Gravité** (StatusBadge texte + icône), **Principe** (titre court), **Objets en cause** (« 2 rôles, 1 utilisateur » ou « 1 paramètre »), **Depuis** (date de première détection), **Statut** (Nouveau / Déjà signalé). Tri par gravité décroissante puis ancienneté par défaut ; tri au clavier avec `aria-sort` (E10). Filtre par gravité (SegmentedControl : Tous · Critique · Important · Mineur) avec décompte et « Effacer le filtre ». Ligne ouvrable au clavier (Entrée) et nom accessible du tableau (E11, E12).

Les actions faites par un administrateur seul « sans seconde validation » apparaissent comme **principes à part entière** dans cette liste (voir §6), pas dans une section cachée.

### 4.3 Détail d'un principe

Ordre de lecture (hiérarchie d'information), de haut en bas :

1. **En-tête** : titre du principe, gravité, « Depuis le <date> ». Bouton retour à la liste.
2. **Le principe** : une phrase qui dit ce que la bonne pratique demande (fournie par A13).
3. **Ce qui ne le respecte pas** — « Objets en cause » : tableau avec une colonne par type d'objet présent, jamais de colonnes vides. Types prévus : Rôle ; Utilisateur ; Permission (libellé métier) ; Paramètre (nom + valeur actuelle) ; Action tracée (acteur, date, « sans seconde validation »). Une ligne = un objet, avec lien « Voir » vers l'écran d'Administration concerné. En tête du bloc : « <N> personnes concernées » (nombre fourni par le serveur). Les noms d'utilisateurs ne sont montrés qu'aux rôles qui y ont droit (§7, Q3) ; sinon « 2 personnes » sans nom. Pagination au-delà de 10 lignes (« Afficher 10 / 23 »).
4. **Conséquence** : encadré titré « Ce qui peut arriver si rien ne change », texte fourni par A13, 1 à 3 phrases, sans jargon technique.
5. **Comment le respecter** : trois colonnes **Petite structure (TPE) · Entreprise de taille moyenne (PME) · Grande entreprise**. Chaque colonne : titre, 2 à 4 puces d'actions concrètes, éventuellement lien « Aller à l'écran » (Administration, lien seulement).
   - La colonne correspondant à la taille détectée est **mise en surbrillance** (fond distinct) ET porte un **marqueur textuel + icône** dans son titre : « ★ Recommandé pour votre organisation » (le texte est le porteur d'information, le fond est un renfort). Elle reçoit `aria-current="true"` et le texte est lu par lecteur d'écran ; les deux autres colonnes restent entièrement lisibles, avec le même contraste.
   - Contraste du fond de surbrillance ≥ 4,5:1 avec le texte, et bordure de la colonne ≥ 3:1 avec le fond de page (WCAG 1.4.11) ; l'indicateur reste visible en contraste élevé forcé (bordure épaisse, pas seulement un fond).
   - Ordre des colonnes fixe (TPE, PME, GE), jamais réordonné selon la taille, pour que les utilisateurs retrouvent toujours la même place.
   - Si la taille n'a pas pu être déterminée (serveur renvoie `size = unknown`) : aucune colonne en surbrillance, bandeau « Taille non déterminée : consultez les trois indications » (voir Q2).
6. **Exemple** : tant que le contenu est provisoire, une pastille « Exemple — contenu à valider » sur le bloc 2, 4 et 5 (supprimée par configuration quand A13 valide, aucune règle côté écran).

## 5. États

| État | Comportement |
|---|---|
| **Chargement** | Squelette de la carte de synthèse et de 4 lignes de tableau (M18), `aria-busy="true"` sur la région, texte caché « Analyse de la gouvernance en cours ». Pas de spinner seul. |
| **Vide : tous respectés** | La synthèse reste affichée (taille + pourquoi). Zone principale : icône + titre « Aucun principe de gouvernance n'est actuellement non respecté. » + « Dernier contrôle : <date et heure>. » Pas de formule triomphante ni de « conforme » : ajout « Cet état dépend des règles de contrôle actuellement activées. » |
| **Vide : filtre sans résultat** | « Aucun principe de gravité "Critique" à afficher. » + bouton « Effacer le filtre ». |
| **Première utilisation / non encore calculé** | « Le premier contrôle n'a pas encore eu lieu. » + date du prochain calcul si le serveur la fournit. |
| **Erreur de chargement** | MessageBanner d'erreur : « Impossible de charger les principes de gouvernance. Réessayez dans un instant ; si le problème continue, contactez l'équipe qui administre l'application. » + bouton « Réessayer ». Aucun code ni message technique. La dernière liste connue n'est pas affichée comme à jour. |
| **Données périmées** | Date « Dernier contrôle » toujours affichée ; si le serveur signale un calcul en retard : bandeau « Cette liste date du <date> ». |
| **Droit manquant** | Message de refus clair, sans nom de permission ni de rôle requis ; `PermissionDeniedDialog`. |
| **Session expirée** | Comportement global de l'application (retour à la connexion, retour sur cet écran ensuite). |
| **Détail introuvable** (principe corrigé entre-temps) | « Ce principe n'est plus signalé. Il a peut-être été corrigé. » + retour à la liste. |
| **Détail : aucun objet nominatif visible** | Compteur seul « 2 personnes concernées » + « Les noms ne sont pas affichés pour votre profil. » |

## 6. Cas particulier : actions « sans seconde validation » (régime une personne)

Contenu attendu côté serveur : dès qu'au moins un membre d'Audit ou de Comité existe, chaque action effectuée par un administrateur seul sous le régime hybride (DECISION-072) devient un objet en cause d'un principe de type « Aucune action sans seconde validation ».

- **Libellé du principe** (exemple) : « Des modifications sensibles ont été faites sans seconde validation. »
- **Objets en cause** : lignes de type « Action tracée » = action (libellé métier, p. ex. « Modification d'un seuil d'appétence »), acteur, date, objet touché, mention « Sans seconde validation » en texte + icône. Lien vers l'objet et vers l'historique (journal d'audit) ; l'écran n'est **pas** la source d'audit.
- **Conséquence** et **indications TPE / PME / GE** : contenu A13 (ex. TPE : accepter et faire relire par un tiers externe ; PME : désigner un second valideur ; GE : activer le circuit à deux personnes).
- Tant qu'aucun membre d'Audit ni de Comité n'existe, ce principe n'apparaît pas (le serveur ne le renvoie pas) ; aucune règle côté écran. À la première apparition, la notification renvoie ici.
- **Rappel à la source** : sur l'écran où l'action a été faite (onglet Seuils d'appétence, etc.), un bandeau « Modification sans seconde validation » est affiché sur l'élément concerné, avec le lien « Voir le principe » (texte + icône, pas la couleur seule).
- Les cumuls de rôles (administrateur + Risk Manager, deux comptes d'un même humain) sont signalés comme objets en cause, jamais comme blocage (DECISION-072).

## 7. Qui voit quoi, confidentialité

- Données minimales : le panel montre des rôles, des nombres et des paramètres. Les noms d'utilisateurs ne sont affichés que si le serveur les renvoie ; le frontend ne les devine pas.
- L'action tracée montre l'acteur (nom affiché) uniquement aux profils qui ont déjà accès à l'audit trail (cohérent avec `audit.read`).
- Les libellés d'erreur et de refus restent génériques (spec Security Error UX) ; aucun détail sur la règle de détection.
- Chaque ouverture n'a pas à être tracée par l'écran ; la traçabilité reste côté Audit & Observability.

## 8. Mobile et responsive

- **Ordinateur** (≥ 1024 px) : synthèse en haut, liste à gauche (≈ 40 %), détail à droite, 3 colonnes d'indications côte à côte.
- **Tablette** : liste pleine largeur ; détail en page dédiée ; 3 colonnes si la largeur le permet, sinon empilées.
- **Mobile** : la liste devient une pile de cartes (gravité + titre + objets en cause) ; le détail est une page avec bouton retour. Les trois indications deviennent **trois sections repliables empilées dans le même ordre (TPE, PME, GE)**, la section recommandée **ouverte par défaut, placée en premier visuellement dans un groupe nommé « Recommandé pour votre organisation »**, les autres repliées mais visibles (titre cliquable, pas masquées). Le marqueur textuel de recommandation est conservé.
- Tableau des objets en cause : sur mobile, une carte par objet (champ : valeur), pas de défilement horizontal seul (E13).
- Zones tactiles ≥ 44 × 44 px.

## 9. Contrat de données attendu du serveur (à valider avec A05)

Le frontend ne reçoit que des résultats prêts à afficher. Proposition minimale :

- `detectedSize` : `TPE | PME | GE | unknown` ; `sizeReason` : texte + faits (rôles comptés) ; `highlightedColumn` : valeur renvoyée par le serveur (le frontend n'interprète pas `detectedSize` pour choisir la colonne) ; `lastComputedAt`.
- `summary` : total et décompte par gravité.
- Par principe : `id`, `title`, `severity`, `since`, `statement`, `consequence`, `guidance` { TPE, PME, GE : liste d'actions avec lien optionnel }, `affectedObjects` [{ `type`, libellé métier, valeurs, lien, `isNamed` }], `affectedCount`, `isExample`.
- Tri, filtre par gravité et pagination : décidés côté serveur ou, au plus, appliqués par le frontend sur la page reçue sans recalcul d'aucune règle.

## 10. Composants du design system

**Réutilisés tels quels** : Card (synthèse, encadré conséquence), Table (liste, objets en cause), StatusBadge (gravité : texte + icône + ton), Tabs (onglets du Dispositif), SegmentedControl (filtre de gravité), MessageBanner (erreur, retard, taille inconnue), Pagination, Button, Breadcrumb, Grid (3 colonnes), `PermissionDeniedDialog`, Sidebar (entrée + compteur).

**À corriger avant usage (écarts du DS)** : E7 + M18 (squelette de chargement), E8 (états vides distincts), E10 (tri), E11/E12 (ligne au clavier, nom du tableau), E16/E17 (icône et vocabulaire de gravité : Critique, Important, Mineur à mapper sur les tons), E22 (action dans MessageBanner, « Réessayer »), E27 (compteur de menu), E13 (tableau empilé mobile).

**Composants manquants à créer** :
1. **PrincipleComparisonColumns** (3 colonnes d'indications avec colonne recommandée : titre, marqueur textuel + icône, `aria-current`, version repliable mobile). Composant d'affichage pur ; la colonne mise en avant est une propriété reçue.
2. **SeverityBadge** (variante de StatusBadge ; si E16/E17 sont traités, un mapping suffit, pas un nouvel atome).
3. **Section repliable** (M6 existant dans la liste du DS) pour le mobile.
4. Pastille « Exemple — contenu à valider » : variante de StatusBadge, temporaire.

Aucun composant de graphique : le décompte par gravité est du texte (règle GRC : jamais la couleur seule).

## 11. Accessibilité (WCAG 2.1 AA, DECISION-030)

- **Surbrillance ≠ couleur seule** (1.4.1) : marqueur textuel « Recommandé pour votre organisation » + icône dans le titre, bordure épaisse, `aria-current="true"` ; testable en niveaux de gris et en contraste élevé forcé.
- Contrastes texte ≥ 4,5:1, composants et bordures ≥ 3:1 (1.4.3, 1.4.11).
- Structure : un seul `h1`, titres de principe en `h2`/`h3` ; les trois colonnes sont des régions nommées (`aria-labelledby`), pas un tableau de mise en page.
- Clavier : liste et détail entièrement opérables, ordre de focus = ordre de lecture, focus visible (E3), focus placé sur le titre du détail à l'ouverture et rendu à la ligne d'origine au retour.
- Annonces : changement de filtre et résultat annoncés (« 2 résultats »), chargement annoncé, erreur annoncée (`role="alert"`).
- Gravité annoncée en toutes lettres (« Gravité : critique »), jamais une icône seule.
- Textes en français clair, phrases courtes, pas d'abréviation sans définition (TPE, PME, GE développés à la première occurrence ; « GE » jamais seul à l'écran).
- Zoom 200 % et reflow 320 px sans perte d'information (1.4.4, 1.4.10).

## 12. Libellés (français métier)

Titre de page : « Principes de gouvernance ». Sous-titre : « Les bonnes pratiques de gestion des risques que votre organisation ne respecte pas encore ». Entrée de menu : « Principes de gouvernance ».
Libellés : « Taille de votre organisation estimée », « Pourquoi cette estimation », « Principes non respectés », « Ce qui ne respecte pas ce principe », « Ce qui peut arriver si rien ne change », « Comment le respecter », « Petite structure (TPE) », « Entreprise de taille moyenne (PME) », « Grande entreprise », « Recommandé pour votre organisation », « Sans seconde validation », « Dernier contrôle », « Voir », « Effacer le filtre », « Réessayer ».
Gravité : « Critique », « Important », « Mineur » (libellés finaux à confirmer par A13).
À bannir : noms de permissions techniques, `noSelfValidation`, `guard:*`, codes d'erreur, « rule engine ».

## 13. Contenu d'exemple (marqué « Exemple », à remplacer par A13)

Principe exemple : « Une même personne ne devrait pas valider ses propres décisions de risque. »
- Objets en cause (exemple) : rôle « Administrateur » (1 personne) cumulé avec « Risk Manager » ; paramètre « Double validation des seuils d'appétence : désactivée ».
- Conséquence (exemple) : « Une erreur ou un abus ne serait détecté par personne avant d'avoir des effets. »
- TPE (exemple) : accepter le cumul, mais faire relire chaque trimestre les décisions par un tiers (associé, expert externe). PME (exemple) : nommer un second validateur pour les seuils d'appétence. GE (exemple) : activer la validation à deux personnes pour toutes les modifications de méthodologie.

## 14. Impacts

- **Security** : lecture seule ; aucune règle ni permission décidée côté écran ; le masquage des noms est calculé par le serveur ; messages de refus génériques.
- **Privacy** : noms d'utilisateurs minimisés (compteur par défaut), aucune donnée ajoutée dans les URL.
- **Compliance / Audit** : le panel ne conclut pas à la conformité ; pas de « PASS ». Le contenu des principes et des indications est celui validé par A13, non reformulé par l'UX.
- **Risk** : réduit le risque de cumul silencieux (DECISION-072) en le rendant visible.
- **QA, critères testables** : (a) la colonne surlignée est celle renvoyée par le serveur, et elle est identifiable en niveaux de gris ; (b) les 3 colonnes sont toujours visibles ; (c) chaque état du §5 s'affiche ; (d) aucune permission technique à l'écran ; (e) action d'admin seul apparaît dès qu'un membre d'Audit ou de Comité existe, pas avant ; (f) navigation complète au clavier ; (g) aucune écriture atteignable depuis le panel.
- **Dev Frontend** : `App.tsx` (`NAV_GROUPS`, `View`, `PAGE_TITLES`), `NotificationCenter` (cible), nouvel écran, onglet « Seuils d'appétence » du détail de Dispositif.
- **Dev Backend / A05** : contrat §9 ; permission de lecture à nommer dans `permissions.ts`.

## 15. Questions au PO (max 3)

**Q1. Qui peut consulter le panel ?**
Contexte : le panel révèle les écarts de gouvernance et, parfois, des noms. L'Audit et le Comité en ont besoin ; un Risk Owner ou un simple lecteur de risques n'en a pas l'usage.
Options : (A) administrateur seul ; (B) administrateur, équipe risque, Audit et Comité en lecture ; (C) tous les rôles qui lisent les risques.
Recommandation : **B**, noms visibles seulement pour qui a déjà accès à l'audit trail.

**Q2. Que faire si la taille estimée est fausse ou indéterminable ?**
Contexte : la taille est déduite des rôles assignés ; une organisation peut avoir peu de rôles pour d'autres raisons. La surbrillance serait alors trompeuse.
Options : (A) aucune correction possible, la phrase « Pourquoi » suffit ; (B) l'administrateur peut forcer la taille (action tracée, paramètre d'Administration) ; (C) affichage « non déterminée » sans surbrillance quand le serveur n'est pas sûr.
Recommandation : **A + C** en V1 (« non déterminée » sans surbrillance), **B** reporté tant qu'aucun besoin n'est observé.

**Q3. Les principes peuvent-ils être traités ou masqués ?**
Contexte : une TPE choisira peut-être de ne pas appliquer un principe. Sans possibilité d'acquitter, la liste restera longue et sera ignorée ; avec, on risque de masquer un vrai écart.
Options : (A) aucun acquittement, le principe reste tant qu'il n'est pas respecté ; (B) « Accepté en connaissance de cause » avec motif obligatoire, trace et relecture annuelle, le principe reste visible avec ce statut ; (C) masquage libre.
Recommandation : **A** en V1 (simple, sans contournement) ; **B** en vague suivante si le PO le souhaite, jamais C.

Aucune de ces questions ne bloque le placement dans la navigation ni l'onglet « Seuils d'appétence ».
