# DESIGN_NOTES — Critique UX/UI et spécification de direction visuelle

**Auteur** : Agent UX Designer (A04)
**Portée** : `frontend/src/` en l'état au 2026-09-27 — 4 écrans/composants
audités : `RisksPage`, `AdminPage` (+ `RolesAdmin`, `FeedbackAdmin`),
`FeedbackWidget`.
**Statut** : `UNDER_REVIEW` — ce document est une spécification de
conception, pas du code. Aucun fichier `.tsx`/`.css` n'a été modifié.

**Important sur la charte graphique** : je n'ai trouvé aucune charte
graphique Djamo (couleurs de marque, logo, typographie officielle) dans
le repo. `frontend/src/index.css` contient un accent violet (`#aa3bff`)
et une mise en page centrée — c'est le **thème par défaut du template
Vite React** (`npm create vite`), pas une décision de marque : rien
n'indique qu'il ait été choisi intentionnellement (voir section 2). Je
ne prétends donc pas connaître une identité Djamo ; la direction
proposée en section 4 est une **direction neutre et professionnelle**,
à valider ou remplacer si une charte existe ailleurs (Figma, brand
guide externe non fourni ici).

---

## 1. Hiérarchie visuelle actuelle

**Ce qui fonctionne :**
- La structure `h1`/`h2`/`section` est sémantiquement correcte et
  cohérente sur les 3 pages métier.
- Les erreurs utilisent systématiquement `role="alert"` — bon réflexe
  d'accessibilité déjà en place, à conserver tel quel dans toute
  nouvelle page.
- Les messages d'erreur (`describeError` dans `RisksPage.tsx`,
  `RolesAdmin.tsx`, `FeedbackAdmin.tsx`) affichent le message métier
  renvoyé par le backend **et** un `requestId` — c'est exactement ce
  qu'il faut pour la traçabilité support (section 42 — Auditability by
  UX) sans exposer de détail technique sensible. À généraliser tel
  quel dans le design system.

**Ce qui ne guide pas l'œil :**
- **Aucune hiérarchie entre action primaire et action secondaire.**
  Tous les `<button>` (Créer, Créer le rôle, Assigner, Révoquer,
  Désactiver, Déconnexion, changement d'onglet) ont exactement le même
  style — celui du navigateur, non stylé (`App.css` ne cible aucune
  classe de bouton). Dans `RolesAdmin.tsx` lignes 165-170, un rôle a
  trois boutons côte à côte (Assigner / Révoquer / Désactiver) avec un
  poids visuel identique alors que « Désactiver » est une action bien
  plus destructive que « Assigner ».
- **Les onglets utilisés comme sélecteur de vue n'ont pas d'état
  "sélectionné" visuel** : `App.tsx` ligne 25-30 et `AdminPage.tsx`
  ligne 22-27 utilisent `disabled={view === "risks"}` pour marquer
  l'onglet actif. C'est un problème double :
  1. **Accessibilité** : un bouton `disabled` sort de l'ordre de
     tabulation et est annoncé par les lecteurs d'écran comme
     "désactivé", pas comme "onglet courant". Le pattern correct est
     `aria-current="page"` + une classe visuelle, bouton toujours
     activable au clavier.
  2. **Lisibilité** : le seul indice visuel de "où je suis" est
     l'opacité grisée par défaut du navigateur sur `disabled` — un
     signal faible, souvent confondu avec "action indisponible".
- **Aucune distinction visuelle des statuts** : `RisksPage.tsx` ligne
  88 affiche le statut brut (`DRAFT` / `ACTIVE` / `ARCHIVED`) en texte
  simple dans une cellule de tableau, sans couleur, icône ni badge.
  Pour un outil GRC où le statut d'un risque est l'information la
  plus consultée d'un coup d'œil, c'est actuellement invisible dans le
  flux de lecture du tableau (section 25 — Workflow à états : l'état
  courant doit être immédiatement visible).
- **Densité de titre disproportionnée** : `index.css` fixe `h1` à
  `56px` (36px en dessous de 1024px) — hérité du template Vite, pensé
  pour une page d'accueil marketing, pas pour un bandeau d'app métier
  qui affiche "GRC Tools" en permanence au-dessus d'un tableau de
  travail. Ça mange de la hauteur d'écran utile sans apporter
  d'information.

## 2. Cohérence entre les 4 écrans

**Verdict : chaque écran a été construit indépendamment, avec une base
commune involontaire (le CSS du navigateur) plutôt qu'un langage
partagé.**

Preuves concrètes :

- **Deux systèmes de design tokens coexistent sans lien.**
  `index.css` définit des custom properties (`--text`, `--text-h`,
  `--bg`, `--border`, `--accent`, `--shadow`, …) — mais `App.css`, écrit
  après coup pour les vrais écrans métier, n'en réutilise **aucune** :
  il code en dur `#ddd` (bordures de tableau, ligne 18), `#b00020`
  (erreurs, ligne 28), `#666` (texte atténué, ligne 99). Résultat : si
  quelqu'un change `--border` ou `--accent` en pensant "personnaliser
  le thème", rien ne bouge dans les tableaux Risques/Rôles/Feedback.
- **Deux systèmes de layout en conflit.** `index.css` ligne 53-63 fixe
  `#root` à une largeur de `1126px`, centré, avec `border-inline` et
  `text-align: center` — pensé pour une landing page. `App.css` ligne
  1-6 fixe ensuite `main` à `max-width: 960px` centré à l'intérieur.
  Un tableau de risques avec beaucoup de colonnes (à venir : KRI, KPI,
  scoring inhérent/résiduel…) va donc être compressé dans ~960px au
  milieu d'un cadre de 1126px, avec un `text-align: center` hérité qui
  ne devrait jamais s'appliquer à du contenu tabulaire ou à des
  formulaires.
- **Deux conventions de formulaire différentes.** `FeedbackWidget.tsx`
  (lignes 68-87) enveloppe chaque champ dans un `<label>` avec un texte
  visible ("Catégorie", "Message") — bon pattern. `RisksPage.tsx`
  (lignes 56-67) et `RolesAdmin.tsx` (lignes 105-110) utilisent des
  `<input placeholder="...">` **sans aucun `<label>`** : le placeholder
  disparaît dès que l'utilisateur tape, et rien ne garantit une
  association label/champ correcte pour les lecteurs d'écran. Un même
  produit a donc deux conventions de formulaire simultanées écrites à
  quelques jours d'intervalle.
- **Boutons non différenciés entre écrans** : aucune classe `.btn`,
  `.btn-primary`, `.btn-secondary` nulle part — chaque écran retombe
  sur le style natif du navigateur, ce qui les rend cohérents *par
  défaut*, mais seulement parce que rien n'a été stylé, pas parce qu'un
  choix a été fait.
- **`FeedbackWidget`** est le composant le plus visuellement abouti
  (coins arrondis, ombre, panneau flottant) mais n'a **aucun lien
  stylistique** avec les tableaux/formulaires des pages "sérieuses" —
  il ressemble à un composant issu d'un tutoriel différent inséré tel
  quel.

**Conclusion pour la suite** : sans un point de convergence explicite
(design tokens partagés + composants de base), chaque nouveau domaine
(KPI, RiskAppetite, RatingScale, Cartography…) va reproduire une
troisième, quatrième, cinquième variante de tableau/formulaire, avec
un coût de refonte qui grandit à chaque module ajouté.

## 3. Lisibilité des tableaux et formulaires

**Tableaux (`RisksPage`, `RolesAdmin`, `FeedbackAdmin`) :**
- Densité correcte pour le volume actuel (quelques lignes en dev), mais
  aucune des trois pages ne gère les cas qui arrivent nécessairement en
  production : **pagination**, **tri**, ni même un indicateur de nombre
  de résultats. `AuditLog`, `KRI`, `RiskEvaluation` (11 actions rien que
  dans le backlog) vont produire des volumes de lignes bien supérieurs
  à ce que `RisksPage.tsx` peut afficher lisiblement sans ces
  mécanismes (section 31 — Search & Filtering UX).
- **Aucun état vide dédié dans `RisksPage`** : si `risks` est vide, le
  composant affiche un `<table>` avec juste l'en-tête et un `<tbody>`
  vide — silence total, pas de "Aucun risque enregistré" ni d'invite à
  en créer un. `FeedbackAdmin.tsx` ligne 65-66 fait ça bien
  ("Aucun feedback pour ce filtre.") ; c'est l'exception, pas la norme.
- **`RolesAdmin`** mélange dans une même cellule (ligne 150) la liste
  brute des permissions jointes par virgule — pour un rôle avec 15+
  permissions (probable une fois `RBAC` complet avec 9 actions dans le
  backlog), cette cellule devient un mur de texte illisible. Pas de
  troncature, pas de "voir plus", pas de regroupement par domaine.
  Idem pour la colonne "Assigner / révoquer" (lignes 159-171) qui
  combine un input libre + deux boutons dans une seule cellule de
  tableau — dense au point de nuire à la lecture des lignes voisines.
- **Le format de date est incohérent** : `FeedbackAdmin.tsx` ligne 84
  utilise `new Date(entry.createdAt).toLocaleString()`, qui dépend de
  la locale du navigateur de l'utilisateur — deux Risk Managers dans
  deux fuseaux/langues de navigateur différents peuvent voir deux
  formats différents pour la même donnée d'audit. Pas de problème dans
  les autres écrans simplement parce qu'aucun autre n'affiche encore de
  date.

**Formulaires :**
- Le formulaire de création de risque (`RisksPage.tsx` lignes 55-69)
  est un formulaire inline à 2 champs sans labels visibles, sans texte
  d'aide, sans validation avant soumission (uniquement `required` HTML
  natif) — acceptable pour 2 champs, mais ce pattern **ne passera pas à
  l'échelle** : `RiskEvaluation` (11 actions), `RiskAppetite`,
  `RatingScale` vont nécessiter des formulaires à 6-15 champs
  (probabilité, impact, contrôles liés, département propriétaire,
  échelle de notation…). Un formulaire inline en `display: flex` sur
  une seule ligne (`App.css` ligne 21-25) devient inutilisable au-delà
  de 3-4 champs.
- **Aucune validation en temps réel, aucun message d'erreur par
  champ** — seule une erreur globale de type "toast" apparaît après
  soumission (`role="alert"` en haut de la liste). Pour des champs
  numériques sensibles (score de risque, seuils d'appétit), l'absence
  de validation avant soumission augmente le risque d'erreur de saisie
  qu'un Risk Manager découvrira seulement après coup.
- **Aucun champ marqué "sensible"** dans les formulaires actuels — pas
  un souci aujourd'hui (aucune donnée personnelle dans Risk/Role/
  Feedback), mais aucune convention n'existe encore pour le signaler
  quand `Department`/`UserManagement` amèneront des données RH/PII.

## 4. Direction proposée

Contrainte fixée par le rôle UX lui-même, non négociable pour un outil
de gouvernance-risques utilisé quotidiennement par des professionnels :
**pas d'effet flashy, pas d'animation qui nuit à la lisibilité ou au
temps de tâche**. La direction ci-dessous est austère par choix, pas
par manque d'ambition.

### 4.1 Palette (valeurs hex proposées — direction neutre, sans charte
Djamo connue)

**Neutres (structure, texte, fond) :**
| Rôle | Hex | Usage |
|---|---|---|
| Fond page | `#F7F8FA` | fond général de l'app |
| Fond surface (cartes, tableaux, panneaux) | `#FFFFFF` | conteneurs de contenu |
| Bordure / séparateur | `#DDE1E6` | lignes de tableau, contours de champ |
| Texte principal | `#1A2027` | titres, valeurs de données |
| Texte secondaire | `#5A6472` | labels, texte d'aide, métadonnées |
| Texte désactivé | `#9AA3AE` | placeholders, éléments inactifs |

**Accent de marque neutre (à remplacer si une charte Djamo existe) :**
| Rôle | Hex | Usage |
|---|---|---|
| Primaire | `#1F4B99` | bouton d'action primaire, liens, onglet actif |
| Primaire (hover/pressed) | `#173B7A` | interaction sur primaire |
| Primaire (fond léger) | `#E7EEF9` | fond de badge/état "sélectionné" léger |

Un bleu marine plutôt qu'un violet vif ou un bleu vif "startup" : plus
proche des codes visuels des outils de gouvernance/risque professionnels
(sobriété perçue = crédibilité perçue pour un outil qui documente des
décisions auditables).

**Sémantique de statut/risque (jamais la couleur seule — voir section
32 des principes ACF : toujours coupler à un label texte) :**
| Statut/Niveau | Hex | Usage |
|---|---|---|
| Critique / Élevé | `#B3261E` (texte/icône sur fond `#FBEAE9`) | risque élevé, erreur bloquante |
| Attention / Moyen | `#8A5A00` (texte/icône sur fond `#FCF1D9`) | risque moyen, avertissement |
| Faible / OK | `#1E7A46` (texte/icône sur fond `#E7F5EC`) | risque faible, succès |
| Neutre / Brouillon | `#5A6472` (texte/icône sur fond `#EEF0F2`) | DRAFT, désactivé, en attente |
| Info | `#1F4B99` (texte/icône sur fond `#E7EEF9`) | information neutre |

Ces 5 paires (texte foncé sur fond clair) sont la base d'un composant
**Badge de statut** unique — voir section 5.

### 4.2 Typographie (3 rôles, pas plus)

Garder une pile de polices système (pas de police custom à charger —
un outil interne n'a pas besoin d'identité typographique de marque
grand public, et une police système garantit un rendu net sur tous les
postes de travail Djamo sans dépendance réseau) :

```
--font-ui: system-ui, "Segoe UI", Roboto, sans-serif;
```

| Rôle | Taille | Graisse | Usage |
|---|---|---|---|
| **Titre** | 20px (page/section `h1`/`h2`), 16px (sous-titre de bloc) | 600 | Titres de page, en-têtes de section — jamais 56px : ce n'est pas une landing page |
| **Corps** | 14px | 400 (500 pour labels de champ) | Labels, texte de formulaire, boutons, navigation, texte d'aide |
| **Données** | 14px, `font-variant-numeric: tabular-nums` | 400 (500 pour valeurs mises en avant, ex. score de risque) | Cellules de tableau, valeurs numériques, dates, identifiants |

Le rôle "Données" avec `tabular-nums` est important spécifiquement pour
un outil GRC : les colonnes de score (probabilité × impact), de KRI/KPI
et de montants doivent s'aligner verticalement chiffre par chiffre pour
un scan visuel rapide — actuellement aucune règle ne le garantit.

### 4.3 Principes de layout

1. **Un seul système de conteneur.** Supprimer la contrainte de largeur
   fixe héritée du template Vite (`#root` à 1126px + `text-align:
   center`, `index.css` lignes 53-63) au profit d'un conteneur de
   contenu unique, aligné à gauche, avec une largeur max autour de
   `1280–1400px` — les tableaux de gouvernance ont besoin de largeur
   (beaucoup de colonnes : statut, propriétaire, échéance, score
   inhérent/résiduel, contrôles liés…), une page centrée à 960px les
   compressera.
2. **Grille d'espacement à 3-4 paliers**, pas de valeurs `rem`
   arbitraires au coup par coup : `4px / 8px / 16px / 24px / 32px`.
   Chaque marge/padding du design system doit venir de cette échelle.
3. **Navigation qui scale au-delà de 2 modules.** Le pattern actuel de
   `<nav>` avec des `<button>` disposés en ligne (`view-tabs`,
   `admin-tabs`) fonctionne à 2-3 entrées. Avec 15+ domaines métier
   annoncés (Risk, Evidence, Control, KRI, KPI, RiskAppetite,
   RatingScale, Cartography, ActionPlan, Reporting, Governance, …), une
   rangée d'onglets horizontaux devient illisible et cassera le layout
   en dessous de la largeur d'un écran standard. Recommandation :
   passer à une **navigation latérale (sidebar) regroupée par domaine
   fonctionnel** (Risques / Contrôles / Indicateurs / Gouvernance /
   Administration) avant qu'un 4e ou 5e module n'arrive — voir section
   5, priorité n°1.
4. **Pas d'animation de transition sur les données.** Chargement,
   changement d'onglet, mise à jour de tableau : changements d'état
   instantanés ou fade très court (≤150ms) au maximum. Un Risk Manager
   qui valide une évaluation ne doit jamais se demander si un
   changement visuel est une animation cosmétique ou un vrai
   changement d'état système (section 29 — Performance UX : la
   confusion entre décoratif et informatif est une source d'erreur).
5. **États systématiques par écran** (voir section 19 des principes
   ACF, actuellement respecté seulement partiellement) : chaque liste
   doit définir explicitement `Default / Loading / Empty / Error`
   — aujourd'hui seul `FeedbackAdmin` couvre les 4 ; `RisksPage` et
   `RolesAdmin` n'ont pas d'état vide dédié.

## 5. Priorisation — qu'est-ce qui doit être résolu en premier

Le backlog (`​.claude/backlog/grc-actions.yaml`) confirme l'ampleur à
venir : au-delà des 3 écrans actuels, au moins **KRI (10 actions), KPI
(5), RiskEvaluation (11), RiskAppetite (4), RatingScale (8),
Cartography (5), ActionPlan (7), Reporting (6), Governance,
UserManagement (8), RBAC (9), Config (7), Notification, Dashboard**
sont prévus — presque tous avec la même forme sous-jacente : une liste
d'objets métier (tableau) + un formulaire de création/édition + des
statuts + des relations entre objets. Reconstruire ce trio à chaque
domaine, comme cela a été fait 3 fois indépendamment jusqu'ici (section
2), est le risque principal pour la vélocité des prochains mois.

**Ordre de priorité pour le design system (ce qui doit exister avant
le 4e module, pas après) :**

1. **Composant `Table` réutilisable** (le plus urgent). Doit
   encapsuler : en-tête sticky, colonne de statut standardisée (badge,
   section 4.1), état vide configurable, état de chargement,
   pagination/tri prêts même si non activés partout dès le premier
   jour, densité de ligne cohérente (padding vertical constant).
   Sans ça, chaque nouveau domaine (KRI, KPI, RiskEvaluation…)
   recopiera-collera un `<table>` en dur avec sa propre variante de
   "Chargement…" en texte brut — c'est déjà en train d'arriver (3
   implémentations légèrement différentes du même besoin dans les 3
   écrans actuels).
2. **Convention de formulaire** (juste derrière, quasi ex-aequo).
   Un pattern unique `Champ = Label visible + Contrôle + Texte d'aide
   optionnel + Message d'erreur inline`, utilisable aussi bien pour un
   formulaire inline à 2 champs (Risk) que pour un formulaire à 15
   champs en colonne (RiskEvaluation, RatingScale). Fixer maintenant
   lequel des deux patterns actuellement en concurrence
   (`placeholder`-only vs `<label>` explicite) devient la norme — je
   recommande `<label>` explicite partout, seul pattern accessible et
   qui reste lisible une fois le champ rempli.
3. **Composant `StatusBadge`** dérivé de la palette sémantique en 4.1.
   Concerne directement `Risk.status`, `Role`/`deletedAt` (Actif/
   Désactivé), `Feedback.status` (5 valeurs) déjà en place, et
   concernera chaque futur domaine avec un cycle de vie (Anomaly,
   ActionPlan, ControlExecution…). Un seul composant, alimenté par une
   table de correspondance statut→couleur→libellé, évite que chaque
   écran invente sa propre façon d'afficher un statut (aujourd'hui :
   texte brut dans `RisksPage`, texte + bouton inline dans
   `RolesAdmin`, texte seul dans `FeedbackAdmin` — 3 approches
   différentes pour le même concept).
4. **Hiérarchie de boutons** (`primaire` / `secondaire` /
   `destructif`). Peu coûteux à faire, fort impact sur la lisibilité
   immédiate (section 1) — distingue "Créer" de "Désactiver" de
   "Annuler" partout, y compris dans `FeedbackWidget`.
5. **Coquille de navigation par domaine** (sidebar, section 4.3 point
   3) — moins urgent tant qu'il y a 2 modules, devient bloquant dès le
   3e ou 4e (probablement dans les prochaines semaines vu le backlog).
6. **Tokens CSS unifiés** — fusionner les deux systèmes actuels
   (`index.css` custom properties vs valeurs codées en dur dans
   `App.css`) en un seul fichier de tokens (couleurs de la section 4.1,
   espacements de la section 4.3), pour que toute évolution de palette
   se propage sans repasser dans chaque fichier `.css` de chaque
   module.

Tout le reste (empty states par écran, format de date centralisé,
regroupement des permissions par domaine dans `RolesAdmin`,
pagination réelle) peut suivre une fois ces fondations posées — les
traiter avant reviendrait à peaufiner des écrans qui seront de toute
façon reconstruits sur les nouveaux composants.

## 6. Éléments hors périmètre de cette note

Conformément à la séparation des responsabilités (section 68 des
principes ACF) : cette note ne spécifie ni règles métier (ex. calcul
du score de risque), ni contrôles d'autorisation (déjà bien posés côté
backend — `AdminPage.tsx` documente correctement que le frontend ne
fait aucune vérification de permission et laisse le backend répondre
403), ni structure de données. Elle ne propose pas non plus de
masquer une action pour un rôle sans la permission correspondante
comme mesure de sécurité — seulement, à titre d'amélioration UX pure
et non de contrôle (section 26 : *UI Visibility ≠ Authorization*), de
désactiver visuellement une action via `permissionsApi.list` déjà
disponible côté client, pour éviter à un utilisateur sans droit de
remplir un formulaire entier avant de découvrir un 403 — le contrôle
réel reste et doit rester côté backend.

---

**Statut** : `IMPLEMENTED` (priorités 1 à 4, partiellement 6) — voir
`frontend/src/design-system/` (`Table`, `FormField`, `StatusBadge`,
`Button`, `Tabs`) et les tokens unifiés dans
`frontend/src/design-system/tokens.css`, appliqués aux 3 écrans audités.
Restent à faire : priorité 5 (sidebar de navigation par domaine — non
bloquant tant qu'il n'y a que 2 modules visibles côté frontend),
regroupement des permissions par domaine dans `RolesAdmin`, pagination
et tri des tableaux.
