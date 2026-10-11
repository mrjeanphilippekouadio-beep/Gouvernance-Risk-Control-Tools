# Revue DS-V1 vs fichier Penpot « charte Djamo »

Comparaison entre `packages/design-system/src/` (tokens.css + 20 composants) et le fichier Penpot connecté via le MCP Penpot (pages « 00 — README » à « 05 — Patterns »), réalisée le 2026-10-11. Portée : les 20 composants présents dans `packages/design-system/src/` (Breadcrumb, Button, Card, DashboardGrid, DatePicker, FileUpload, FormField, Grid, Menu, MessageBanner, Modal, Pagination, Panel, SegmentedControl, Slider, StatusBadge, Table, Tabs, Timeline, charts/ProgressBar).

**Note sur le périmètre demandé** : le chemin `frontend/src/catalog/main.tsx` n'existe pas dans ce dépôt (`frontend/src` ne contient que `index.css`, `main.tsx`, `App.css`, `App.tsx` ; aucun dossier `catalog` n'existe nulle part dans le repo). Cette partie de la demande n'a donc pas pu être vérifiée et n'est pas couverte ci-dessous — le reste de la revue (tokens + 20 composants du design-system) a été mené normalement.

**Méthode** : lecture de `tokens.css` + chaque `.tsx`/`.css` du design-system, puis exploration via `mcp__penpot__execute_code` de la page « 02 — Tokens » (ramps de fondation, section Semantic) et de la page « 03 — Components » (Button, FormField, Card, Modal, Table, StatusBadge, Tabs — les seuls composants documentés dans le fichier Penpot). Les pages « 04 — Variants & States » et « 05 — Patterns » sont vides dans le fichier Penpot (aucun contenu).

---

## Nouveautés à vérifier

### 1. Couleur « information » #0c6ba5 sur fond #e4f1fa

Le fichier Penpot définit une rampe `foundation.color.info` dédiée (`#E2F0F9` / `#0B6FA8` / `#08557F`, commentée « Cyan-bleu, volontairement éloigné de l'indigo accent pour ne pas lire comme une action »), exposée en semantic sous `feedback.info.surface|accent|text`. Les valeurs sont proches de celles citées dans la demande (#e4f1fa / #0c6ba5) sans être identiques au pixel — écart négligeable, probablement une approximation de mémoire côté demande.

En revanche, `tokens.css` ne porte **aucune couleur info distincte** : `--gs-info: #2a3fff` et `--gs-info-bg: #e3e5ff` sont des alias exacts de `--gs-primary`/`--gs-primary-bg`. `MessageBanner.css` (`.gs-msg-info`) et `StatusBadge.css` (`.status-badge-info`) héritent donc tous les deux de la couleur de marque au lieu de la teinte info dédiée — un ton « information » est aujourd'hui visuellement indiscernable d'une action primaire. À noter aussi : le composant `StatusBadge` côté Penpot (« StatusBadge — Variants ») ne définit que 5 tons (`default`, `critical`, `warning`, `success`, `neutral`) — **pas de ton `info`** sur ce composant précis ; le ton `info` du code sur StatusBadge est donc une extension non spécifiée, au-delà d'être mal colorée.

**Gravité : bloquant** (teinte sémantique absente, confusion marque/information).

### 2. Anneau de focus clavier

Le fichier Penpot spécifie un token `focus.ring` (→ `accent.500` = `#2F4BBF`) + `focus.offset` (blanc) + `focus.ringInverse`, matérialisé sur Button (anneau 2px solid, rayon 8, avec un board d'encart simulant l'offset) et sur FormField (`control` + `focus ring` tous deux en stroke 2px `#2F4BBF`, offset ≈ `spacing.100` = 2px). `focus.ring` est aussi listé comme token semantic consommé par Tabs.

Côté code, le focus clavier n'est implémenté que sur 3 composants sur 20 : `DatePicker.css` (`:focus-visible`), `FormField.css` (`:focus` — `outline: 2px solid var(--gs-primary); outline-offset: 1px`) et `FileUpload.css` (`:focus-visible`). **Button, Card, Modal, Table, Tabs, StatusBadge et les 13 autres composants n'ont aucune règle `:focus`/`:focus-visible` dans leur CSS** — aucune feuille de style globale (`frontend/src/index.css`) ne restaure un anneau par défaut à la place. La couleur utilisée là où un anneau existe (`var(--gs-primary)` = `#2a3fff`) diverge en outre de la couleur spécifiée (`#2F4BBF`), et l'offset (1px) diverge de la valeur de token (2px).

**Gravité : bloquant** (accessibilité clavier absente sur la majorité des composants interactifs, dont le bouton — composant le plus utilisé de l'app).

### 3. Bouton avec état de chargement

Le fichier Penpot définit un état `loading` pour chacune des 3 variantes de Button (`primary`/`neutral`/`danger`), aux côtés de `default`/`hover`/`active`/`focus-visible`/`disabled` — board « Button / loading » avec une ellipse `spinner` et un label texte (« Chargement », 14px, blanc).

`Button.tsx` ne porte **aucune prop de chargement** : `ButtonVariant` ne couvre que `"primary" | "secondary" | "destructive"`, et il n'existe ni prop `loading`/`isLoading`, ni `aria-busy`, ni rendu de spinner dans `Button.tsx`/`Button.css`. L'état n'existe pas dans le code.

**Gravité : bloquant** (état spécifié et probablement nécessaire pour les actions asynchrones déjà présentes dans l'app — ex. workflow Treatment Decision — mais totalement absent du composant).

---

## Écarts par composant

### Button

| Composant | Écart | Gravité |
|---|---|---|
| Button | Pas de prop `loading`/spinner alors que Penpot documente un état `loading` complet pour les 3 variantes | bloquant |
| Button | Aucun style `:focus-visible` dans `Button.css` ; Penpot spécifie un anneau 2px `#2F4BBF`, rayon 8, offset 2px | bloquant |
| Button | `border-radius` : `var(--gs-radius-pill)` (999px, variante primary) / `var(--gs-radius-btn)` (10px, secondary/destructive) alors que Penpot fixe `button.radius = 4` pour les 3 variantes (aucune variante pilule) | bloquant |
| Button | Couleur primaire : `var(--gs-primary)` = `#2a3fff` vs `action.primary.default` Penpot = `#2F4BBF` (idem hover `#1f2fd6` vs `#27409F`) | bloquant |
| Button | Nommage des variantes : code `"primary"/"secondary"/"destructive"` vs Penpot `primary`/`neutral`/`danger` | cosmétique |
| Button | Pas de prop `size` (sm/md/lg) alors que Penpot définit `button.height` = 32/40/48 et `button.padding.inline` = 12/16/24 ; le padding actuel (`11px 24px`) correspond à la taille "lg" seule | à corriger |
| Button | État `:disabled` géré par simple `opacity: 0.6` alors que Penpot définit des tokens `disabled.surface|text|border` dédiés (contraste contrôlé 3.1:1) | à corriger |
| Button | `.btn-secondary` : `border-color: var(--gs-border)` (`#e0dbf1`, teinte périwinkle) vs `border.strong` Penpot = `neutral.400` = `#8A93A3` (gris neutre) | à corriger |

### FormField

| Composant | Écart | Gravité |
|---|---|---|
| FormField | État erreur : le bordereau du `<input>` ne change pas de couleur (pas d'`aria-invalid`, pas de bordure rouge, pas d'icône) ; Penpot spécifie une bordure 2px `#C2283C` + icône d'erreur + texte `#96182A` | bloquant |
| FormField | Aucun style `:disabled`/`[disabled]` dans `FormField.css` ; Penpot définit surface `#EDEFF3`, bordure `#C3C9D4`, label `#6B7483` pour l'état désactivé | à corriger |
| FormField | Anneau de focus : `outline: 2px solid var(--gs-primary)` (`#2a3fff`), offset 1px vs Penpot `focus.ring` = `#2F4BBF`, offset `spacing.100` = 2px | à corriger |
| FormField | `.form-field label` : 13px/700/uppercase, valeur en dur (pas de token) ; aucune correspondance exacte dans l'échelle typographique Penpot (`scale.label` = 14/500, `scale.micro` = 11/500) | cosmétique |

### Card

| Composant | Écart | Gravité |
|---|---|---|
| Card | `border-radius: 16px` en dur dans `Card.css` — ignore à la fois `--gs-radius-card` (14px, défini mais inutilisé ici) et `card.radius` Penpot (8px) | à corriger |
| Card | Aucun état `selected`/`disabled` dans `Card.tsx`/`Card.css` ; Penpot définit `selected.surface|border|text` et `disabled.surface|text|border` comme tokens semantic consommés par Card | à corriger |
| Card | `.gs-card-body` padding = `var(--gs-space-3)` (16px) vs `spacing.400` Penpot = 12px | cosmétique |

### Modal

| Composant | Écart | Gravité |
|---|---|---|
| Modal | Largeur fixe `340px` (`calc(100vw - 32px)` en max) ; Penpot définit un axe de taille `modal.maxWidth` = 560/800 (md/lg), aucune taille ne correspond à 340px | à corriger |
| Modal | Aucune zone de statut « busy »/« error » dans `Modal.tsx` ; Penpot consomme `surface.subtle` (busy) et `feedback.error.*` (error) comme tokens semantic dédiés au composant | à corriger |
| Modal | `border-radius: var(--gs-radius-card)` (14px) vs `modal.radius` Penpot = 8px | à corriger |
| Modal | `padding: var(--gs-space-4)` (24px) vs `modal.padding` Penpot = 32px | cosmétique |
| Modal | Titre : `var(--gs-font-display)` ("Plus Jakarta Sans"), 15px/700 vs `typography.scale.heading` Penpot = IBM Plex Sans, 20px/600 | bloquant |
| Modal | `::backdrop` : `rgba(27, 26, 44, 0.42)` vs `surface.scrim` Penpot = `#12161DB3` (≈70% d'opacité, teinte neutre différente) | cosmétique |

### Table

| Composant | Écart | Gravité |
|---|---|---|
| Table | En-têtes en majuscules, 12px/700, `letter-spacing: 0.05em` vs `typography.scale.label` Penpot = 14px/500, pas de transformation en majuscules documentée | à corriger |
| Table | Aucune hauteur de ligne ni variante compacte ; Penpot définit `table.row.height.default|compact` = 40/32 | à corriger |
| Table | Pas de zébrage (`table.row.surface.zebra` pour les lignes paires) ni d'état ligne sélectionnée (`table.row.surface.selected`) | à corriger |
| Table | `.table-status` : texte simple, aucun style d'erreur alors que Penpot consomme `feedback.error.surface|accent|text` pour le statut de table | à corriger |
| Table | Padding cellule : `var(--gs-space-3)` (16px) vs `table.cell.padding.inline` Penpot = 12px | cosmétique |
| Table | `border-radius: var(--gs-radius-card)` (14px) vs conteneur Penpot = `radius.200` (4px) | cosmétique |

### StatusBadge

| Composant | Écart | Gravité |
|---|---|---|
| StatusBadge | Ton `info` (`.status-badge-info`) présent dans le code mais absent de l'axe Status Penpot (5 valeurs documentées : `default`/`critical`/`warning`/`success`/`neutral`, pas d'`info`) | à corriger |
| StatusBadge | Couleurs des tons communs légèrement décalées : danger `#b3261e`/`#fbeae9` vs `critical` Penpot `#96182a`/`#fbe7ea` ; success `#1e7a46`/`#e7f5ec` vs Penpot `#165c3a`/`#e3f2e9` ; neutral `#5a6472`/`#eef0f2` vs Penpot `#4d5563`/`#edeff3` (warning est le plus proche : `#8a5a00`/`#fcf1d9` vs `#8a5600`/`#fdf2dc`) | cosmétique |
| StatusBadge | Nommage : code `"danger"` vs Penpot `"critical"` ; code n'a pas de ton `"default"` distinct de `"neutral"` | cosmétique |

### Tabs

| Composant | Écart | Gravité |
|---|---|---|
| Tabs | Aucun style `:focus-visible` sur `.gs-tab` alors que `focus.ring` est listé comme token semantic consommé par Tabs | bloquant |
| Tabs | Couleur de l'indicateur actif : `var(--gs-primary)` (`#2a3fff`) vs `tabs.indicator.color` Penpot = `#2F4BBF` (valeur de composant explicite, pas seulement sémantique) | à corriger |
| Tabs | `gap: var(--gs-space-2)` (8px) vs `tabs.gap` Penpot = 12px ; padding `var(--gs-space-2) var(--gs-space-1)` (8px/4px) vs `tabs.padding.inline` Penpot = 16px | à corriger |
| Tabs | Aucun style pour un onglet désactivé alors que Penpot définit `text.disabled` comme token semantic consommé | à corriger |
| Tabs | Hauteur de la barre non fixée explicitement vs `tabs.height` Penpot = 48 | cosmétique |

### Tokens globaux (transversal, affecte tous les composants)

| Composant | Écart | Gravité |
|---|---|---|
| tokens.css (palette) | Rampe neutre à teinte périwinkle (`--gs-bg-page #f8f7fc`, `--gs-border #e0dbf1`, `--gs-text #1b1a2c`) vs rampe `foundation.color.neutral` Penpot, gris pur (`#f7f8fa` → `#12161d`) — toute la base neutre diverge de teinte, pas seulement de valeur | bloquant |
| tokens.css (marque) | `--gs-primary #2a3fff` vs `action.primary.default` Penpot = `#2F4BBF` (`accent.500`) ; même écart sur hover et le fond `subtle` | bloquant |
| tokens.css (typographie) | `--gs-font-display: "Plus Jakarta Sans"` : ce nom de police n'apparaît nulle part dans le fichier Penpot ; `scale.display` et `scale.heading` y sont spécifiés en IBM Plex Sans 600 | bloquant |
| tokens.css (typographie) | Échelle à 4 rôles (title 20 / subtitle 16 / body 14 / data 14) vs échelle Penpot à 8 paliers (display 30, heading 20, body 16, bodyDense 14, label 14, caption 12, micro 11, mono 12) — `display` (30px) n'a pas d'équivalent dans le code | à corriger |
| tokens.css (rayons) | `--gs-radius-btn: 10px` et `--gs-radius-card: 14px` ne correspondent à aucun palier de `foundation.radius.*` Penpot (100=2, 200=4, 300=8, 400=16, full=999) | à corriger |
| tokens.css (espacements) | Échelle à 5 paliers (4/8/16/24/32) vs échelle Penpot à 9 paliers (2/4/8/12/16/24/32/48/64) — le palier 12px (`spacing.400`, utilisé par Card/Modal/Table dans le fichier Penpot) n'a pas de token dans le code | à corriger |
| tokens.css (ombres) | `--gs-elev-1/2/3` + `--gs-shadow-card` (4 tokens) vs `foundation.elevation.*` Penpot nommé par usage (`0`=aucune, `100`=carte, `200`=survol/popover, `300`=modale) — correspondance non vérifiable terme à terme sans comparer les valeurs de `box-shadow` exactes du fichier Penpot | cosmétique |

### Composants sans équivalent documenté dans le fichier Penpot

Les 13 composants suivants n'ont **aucun board correspondant** dans la page « 03 — Components », et les pages « 04 — Variants & States » et « 05 — Patterns » sont vides (aucun contenu) : Breadcrumb, DashboardGrid, DatePicker, FileUpload, Grid, Menu, MessageBanner, Pagination, Panel, SegmentedControl, Slider, Timeline, charts/ProgressBar.

| Composant | Écart | Gravité |
|---|---|---|
| Breadcrumb, DashboardGrid, DatePicker, FileUpload, Grid, Menu, MessageBanner, Pagination, Panel, SegmentedControl, Slider, Timeline, ProgressBar | Non trouvé dans Penpot — aucun board/spécimen dans « 03 — Components », « 04 — Variants & States » ou « 05 — Patterns » ; comparaison impossible au-delà des tokens de fondation déjà vérifiés | à corriger |

---

## Tri de l'orchestrateur (2026-10-11)

La revue a été faite sur une copie locale **antérieure à la vague 1** du design
system (les commandes `git` enchaînées par `&&` ont échoué sous Windows
PowerShell 5, la copie n'était donc pas sur `staging`). Vérification faite sur
`origin/staging` :

**Déjà corrigé par la vague 1 (DS-1a/1b/1c, PR #141 à #143)** — à ne pas
reprendre :
- couleur « information » propre (`--gs-info: #0c6ba5`, `--gs-info-bg: #e4f1fa`) ;
- anneau de focus clavier commun (`src/a11y.css`) sur Button, Tabs et les
  composants interactifs ;
- Button `loading` (et `disabledReason`), états désactivés par
  `aria-disabled` ;
- états erreur et désactivé des champs (`Fields.tsx` / `Fields.css`) ;
- le catalogue existe (`frontend/catalog.html`, `frontend/src/catalog/`).

**Écarts voulus — la marque Djamo prime sur les valeurs génériques du fichier
Penpot** (charte validée par le PO, V1→V6 et DECISION-030 ;
`docs/architecture/PEOS_GRC_TOKEN_MAPPING.md`) : bleu de marque `#2A3FFF`
(djamo.com) au lieu de `#2F4BBF`, police de titre Plus Jakarta Sans, rampe
neutre teintée, rayon pilule du bouton principal. Le fichier Penpot sert de
référence de **structure** (états, tailles, tokens sémantiques), pas de
valeurs de marque.

**Vrais écarts restants → candidats vague 2** :
1. Button : tailles sm / md / lg (hauteurs 32 / 40 / 48).
2. Modal : tailles md / lg (560 / 800) au lieu d'une largeur fixe de 340px.
3. Table : hauteur de ligne normale / compacte, zébrage, ligne sélectionnée.
4. Tabs : onglet désactivé ; Card : états sélectionné et désactivé.
5. Tokens : palier d'espacement 12px, palier typographique « display » (30px),
   rayons alignés sur l'échelle 2 / 4 / 8 / 16.
6. 13 composants sans fiche dans Penpot (Breadcrumb, DatePicker, FileUpload,
   Menu, MessageBanner, Pagination, …) et pages « 04 — Variants & States » /
   « 05 — Patterns » vides : à documenter côté Penpot (UX Designer, depuis
   votre terminal).
