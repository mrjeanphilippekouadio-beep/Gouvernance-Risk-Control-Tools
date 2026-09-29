# @djamo/design-system

Bibliothèque de composants React (18 atomes UI, 6 composants de graphiques, 1 wrapper de dashboard) et de tokens CSS de la charte Djamo, packagée pour être réutilisée au-delà de GRC Tools.

## 1. Présentation

### Ce que c'est

`@djamo/design-system` est né dans GRC Tools (Gouvernance / Risque / Contrôle), extrait progressivement au fil des écrans du produit — chaque composant porte encore, en commentaire de code, la référence au besoin qui l'a fait naître (`DESIGN_NOTES.md`, sections citées dans chaque fichier `.tsx`). Mais le package lui-même ne dépend d'aucun concept métier GRC : pas de `Risk`, pas de `Role`, pas de `Feedback`, pas de RACI. Il expose des primitives génériques — un bouton, un tableau, un badge de statut, un graphique en courbes — que n'importe quel produit Djamo peut consommer.

Le socle technique : React 19 (peer dependency `>=18`), Chart.js 4 + react-chartjs-2 pour les graphiques, GridStack pour la grille de dashboard, et `lucide-react` comme bibliothèque d'icônes.

### Ce que ce n'est pas

- **Pas de composants métier.** `RaciPanel` (matrice RACI) reste dans l'application GRC Tools, à `frontend/src/design-system/RaciPanel.tsx` — il n'a jamais été porté dans ce package et ne doit pas l'être : il encode un concept (les rôles RACI) propre au domaine gouvernance/risque, pas une primitive UI générique.
- **Pas un framework d'application.** Pas de routeur, pas de gestion d'état, pas d'appels réseau. Uniquement des composants de présentation.
- **Pas un thème imposé.** La charte Djamo (couleurs, typographies, rayons) vit dans `tokens.css`, entièrement redéfinissable par le projet consommateur — voir section 3.

## 2. Installation

### Dans GRC Tools (déjà en place)

Le package fait partie du workspace npm racine (`packages/*`, voir le `package.json` racine — `"workspaces": ["frontend", "packages/*"]`). `frontend/package.json` le référence en `"@djamo/design-system": "*"` et npm le résout localement, sans publication : aucune installation supplémentaire n'est nécessaire dans ce repo.

### Dans un autre projet Djamo

Il n'existe aujourd'hui **aucun registre npm privé configuré** pour ce repo (pas de `.npmrc`, pas de scope `@djamo` pointé vers un registre dans `package.json`). Deux voies s'offrent donc à un autre projet, selon que le package est publié ou non :

**A. Si le package est publié sur un registre (npm public, GitHub Packages, registre privé d'entreprise, etc.)**

Une fois publié — par exemple avec `npm publish` depuis `packages/design-system/` après configuration d'un registre cible dans `.npmrc` (`@djamo:registry=https://…`) et authentification (`npm login` ou token CI) — un autre projet l'installe normalement :

```bash
npm install @djamo/design-system
```

**B. Si le package n'est pas (encore) publié**

Deux options sans registre :

- **Dépendance git**, en pointant sur ce repo et ce sous-dossier (nécessite que le consommateur ait accès au repo git) :

  ```bash
  npm install "github:<org>/Gouvernance-Risk-Control-Tools#feature/design-system-package" --save
  ```

  Attention : npm installe alors la racine du repo, pas seulement `packages/design-system`. Pour une dépendance git propre sur un sous-dossier, préférer un `git subtree`/`subrepo` dédié, ou publier un tarball (option suivante).

- **Tarball local**, généré une fois le package buildé :

  ```bash
  cd packages/design-system
  npm run build
  npm pack   # produit djamo-design-system-0.1.0.tgz
  ```

  puis, dans le projet consommateur :

  ```bash
  npm install /chemin/vers/djamo-design-system-0.1.0.tgz
  ```

Dans tous les cas, `react` et `react-dom` (>=18) restent des peer dependencies : le projet consommateur doit déjà les avoir installées.

## 3. Démarrage rapide

### Importer un composant

```tsx
import { Button, StatusBadge } from "@djamo/design-system";

function Example() {
  return (
    <div>
      <Button variant="primary">Créer</Button>
      <StatusBadge label="Actif" tone="success" />
    </div>
  );
}
```

### Importer les styles

Les styles des composants sont regroupés par `tsup` dans un unique fichier CSS, à importer une fois à l'entrée de l'application :

```ts
import "@djamo/design-system/styles.css";
```

### Importer et personnaliser les tokens

Les tokens (couleurs, typographies, espacements, rayons, ombres) vivent dans `tokens.css`, sous forme de custom properties CSS préfixées `--gs-` :

```ts
import "@djamo/design-system/tokens.css";
```

Ce fichier charge par défaut la charte Djamo — palette bleu CTA `#2a3fff`, typographies Plus Jakarta Sans / IBM Plex Sans / IBM Plex Mono (chargées depuis Google Fonts), thème clair uniquement (pas de mode sombre, choix produit assumé). Pour adapter à une autre marque, il **n'est pas nécessaire de forker le fichier** : les composants ne lisent que les noms de variables, jamais les valeurs par défaut. Il suffit de redéfinir les `--gs-*` voulues après l'import, dans le CSS du projet consommateur :

```css
@import "@djamo/design-system/tokens.css";

:root {
  /* Réhabillage marque */
  --gs-primary: #ff5a1f;
  --gs-primary-hover: #d9490f;
  --gs-primary-bg: #ffe6da;

  --gs-font-display: "Inter", system-ui, sans-serif;
  --gs-font-ui: "Inter", system-ui, sans-serif;
  --gs-font-mono: "JetBrains Mono", ui-monospace, monospace;

  --gs-radius-btn: 6px;
  --gs-radius-card: 10px;
}
```

Les variables sémantiques (`--gs-danger`, `--gs-warning`, `--gs-success`, `--gs-neutral`, `--gs-info`) sont volontairement découplées de `--gs-primary` — redéfinir la couleur de marque ne change jamais le sens des badges de statut. La liste complète des tokens disponibles est dans `packages/design-system/src/tokens.css`.

## 4. Référence des composants

Composants groupés par catégorie. Chaque signature de props ci-dessous est recopiée depuis le fichier `.tsx` source — se référer au fichier cité en cas de doute.

### 4.1 Atomes

#### Button — `src/Button.tsx`

```tsx
<Button variant="primary" onClick={handleCreate}>Créer</Button>
<Button variant="destructive" onClick={handleDisable}>Désactiver</Button>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "destructive"` | `"secondary"` | Hiérarchie visuelle de l'action. |
| `...rest` | `ButtonHTMLAttributes<HTMLButtonElement>` | — | Tous les attributs natifs d'un `<button>` (`onClick`, `disabled`, `className`, etc.). `type` par défaut `"button"`. |

#### FormField — `src/FormField.tsx`

```tsx
<FormField label="Nom" htmlFor="name" error={errors.name}>
  <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
</FormField>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `label` | `string` | — | Libellé du champ, rendu en `<label>` accessible. |
| `htmlFor` | `string` | — | Doit correspondre à l'`id` du contrôle enfant. |
| `help` | `string` | — | Texte d'aide, affiché seulement si pas d'erreur. |
| `error` | `string` | — | Message d'erreur, `role="alert"`. |
| `children` | `ReactNode` | — | Le contrôle (input, select, …). |

#### StatusBadge — `src/StatusBadge.tsx`

```tsx
<StatusBadge label="En retard" tone="danger" />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `label` | `string` | — | Texte affiché (toujours couplé à la couleur, jamais couleur seule). |
| `tone` | `"danger" \| "warning" \| "success" \| "neutral" \| "info"` | — | Sémantique de la couleur. |

#### Table — `src/Table.tsx`

```tsx
<Table
  columns={[
    { key: "name", header: "Nom", render: (row) => row.name },
    { key: "status", header: "Statut", render: (row) => <StatusBadge label={row.status} tone="info" /> },
  ]}
  rows={items}
  rowKey={(row) => row.id}
  loading={isLoading}
  emptyMessage="Aucun élément."
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `columns` | `TableColumn<T>[]` (`{ key, header, render(row) }`) | — | Colonnes, dans l'ordre d'affichage. |
| `rows` | `T[]` | — | Données. |
| `rowKey` | `(row: T) => string` | — | Clé React par ligne. |
| `loading` | `boolean` | — | Affiche l'état de chargement à la place du corps. |
| `emptyMessage` | `string` | — | Affiché si `rows` est vide et `loading` est faux. |

Pas de pagination/tri intégrés — volontairement laissés hors du composant tant qu'aucun écran n'en a le besoin réel ; combiner avec `Pagination` côté appelant si nécessaire.

#### Tabs — `src/Tabs.tsx`

```tsx
<Tabs
  items={[{ value: "overview", label: "Vue d'ensemble" }, { value: "history", label: "Historique" }]}
  active={tab}
  onChange={setTab}
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `items` | `TabItem<T>[]` (`{ value, label }`) | — | Onglets. |
| `active` | `T` | — | Valeur de l'onglet courant. |
| `onChange` | `(value: T) => void` | — | Appelé au clic. |

Utilise `aria-current="page"` (jamais `disabled`) pour marquer l'onglet actif — corrige un bug d'accessibilité identifié dans l'ancien pattern.

#### Breadcrumb — `src/Breadcrumb.tsx`

```tsx
<Breadcrumb items={[{ label: "Risques", href: "/risks" }, { label: "RSK-042" }]} />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `items` | `BreadcrumbItem[]` (`{ label, href? }`) | — | Fil d'ancêtres ; omettre `href` sur le dernier élément (rendu en texte, jamais cliquable). |
| `ariaLabel` | `string` | `"Fil d'Ariane"` | Nom accessible du landmark `<nav>`. |

#### Card — `src/Card.tsx`

```tsx
<Card header={<h3>Résumé</h3>} footer={<Button variant="primary">Voir tout</Button>}>
  Contenu libre.
</Card>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `header` | `ReactNode` | — | Zone d'en-tête, rendue seulement si fournie. |
| `footer` | `ReactNode` | — | Zone de pied, rendue seulement si fournie. |
| `children` | `ReactNode` | — | Corps de la carte. |
| `className` | `string` | — | Classe additionnelle. |

Pas de `max-width` intégrée : la largeur appartient à la mise en page appelante, pas à la carte.

#### Menu — `src/Menu.tsx`

```tsx
<Menu
  ariaLabel="Actions"
  groups={[
    { label: "Export", items: [{ label: "CSV", onSelect: exportCsv }, { label: "PDF", onSelect: exportPdf }] },
  ]}
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `groups` | `MenuGroup[]` (`{ label?, items: MenuItem[] }`) | — | Groupes ; `label` omis = bloc sans en-tête. |
| `ariaLabel` | `string` | — | Nom accessible du menu. |
| `className` | `string` | — | Classe additionnelle. |

`MenuItem` : `{ label, href?, onSelect?, icon?, active?, disabled? }` — rendu en `<a>` si `href` est fourni, en `<button>` sinon.

#### MessageBanner — `src/MessageBanner.tsx`

```tsx
<MessageBanner tone="warning" title="Attention">
  Cette action est irréversible.
</MessageBanner>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `tone` | `"info" \| "success" \| "warning" \| "danger"` | — | Détermine l'icône Lucide et le `role` ARIA (`alert` pour warning/danger, `status` sinon). |
| `title` | `string` | — | Première ligne en gras ; omis = bannière à un seul paragraphe. |
| `children` | `ReactNode` | — | Corps du message. |
| `showIcon` | `boolean` | `true` | Masque l'icône de tête si `false`. |

Nommé `MessageBanner` (pas `Message`) délibérément — évite la collision avec l'export `Message` d'autres kits UI (antd et consorts) susceptibles de coexister dans une app.

#### Pagination — `src/Pagination.tsx`

```tsx
<Pagination page={page} pageCount={totalPages} onChange={setPage} />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `page` | `number` | — | Page courante, 1-indexée. |
| `pageCount` | `number` | — | Nombre total de pages. |
| `onChange` | `(page: number) => void` | — | Appelé au changement de page. |
| `previousLabel` | `string` | `"Précédent"` | Libellé du bouton précédent. |
| `nextLabel` | `string` | `"Suivant"` | Libellé du bouton suivant. |
| `ariaLabel` | `string` | `"Pagination"` | Nom accessible du landmark `<nav>`. |

Ne rend rien en dessous de 2 pages. Au-delà de 7 pages, affiche première/dernière + fenêtre autour de la page courante, avec ellipses.

#### Panel / PanelRow — `src/Panel.tsx`

```tsx
<Panel title="Contrôles associés" tabs={[{ value: "active", label: "Actifs" }]} activeTab="active" onTabChange={setTab}>
  <PanelRow icon={<ShieldCheck />} trailing={<StatusBadge label="OK" tone="success" />}>
    CTRL-012
  </PanelRow>
</Panel>
```

| Prop (`Panel`) | Type | Défaut | Description |
|---|---|---|---|
| `title` | `ReactNode` | — | En-tête ; omis = panneau sans titre. |
| `tabs` | `PanelTab[]` (`{ value, label }`) | — | Bandeau d'onglets optionnel sous le titre. |
| `activeTab` | `string` | — | Onglet actif. |
| `onTabChange` | `(value: string) => void` | — | Appelé au changement d'onglet. |
| `children` | `ReactNode` | — | Lignes, typiquement des `PanelRow`. |
| `className` | `string` | — | Classe additionnelle. |

| Prop (`PanelRow`) | Type | Défaut | Description |
|---|---|---|---|
| `icon` | `ReactNode` | — | Icône de tête. |
| `children` | `ReactNode` | — | Libellé de la ligne. |
| `trailing` | `ReactNode` | — | Emplacement droit (badge, compteur, action). |

Distinct du panneau latéral métier de GRC Tools, qui reste hors de cette bibliothèque.

#### FileUpload — `src/FileUpload.tsx`

```tsx
<FileUpload accept=".pdf,image/*" onSelect={(file) => setEvidence(file)} />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `onSelect` | `(file: File \| null) => void` | — | Appelé à chaque sélection. |
| `buttonLabel` | `string` | `"Choisir un fichier"` | Texte du déclencheur. |
| `fileName` | `string` | — | Nom de fichier contrôlé ; omis = le composant affiche sa dernière sélection. |
| `accept` | `string` | — | Filtre natif, ex. `".pdf,image/*"`. |
| `disabled` | `boolean` | `false` | Désactive le sélecteur. |

#### Grid / GridItem — `src/Grid.tsx`

```tsx
<Grid columns={3}>
  <GridItem span={2}><Card>…</Card></GridItem>
  <GridItem><Card>…</Card></GridItem>
</Grid>
```

| Prop (`Grid`) | Type | Défaut | Description |
|---|---|---|---|
| `columns` | `number` | `4` | Colonnes au-dessus de 640px ; toujours 2 colonnes en dessous. |
| `children` | `ReactNode` | — | Cellules, typiquement des `GridItem`. |
| `className` | `string` | — | Classe additionnelle. |

| Prop (`GridItem`) | Type | Défaut | Description |
|---|---|---|---|
| `span` | `number` | `1` | Nombre de colonnes occupées. |
| `children` | `ReactNode` | — | Contenu de la cellule. |
| `className` | `string` | — | Classe additionnelle. |

Grille de mise en page générique (dashboards, tuiles d'indicateurs) — à ne pas confondre avec `DashboardGrid` (section 4.3), qui gère le drag/resize.

#### Slider — `src/Slider.tsx`

```tsx
<Slider label="Pondération" value={weight} onChange={setWeight} min={0} max={5} step={1} />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `value` | `number` | — | Valeur courante. |
| `onChange` | `(value: number) => void` | — | Appelé au changement. |
| `label` | `string` | — | Libellé optionnel. |
| `min` | `number` | `0` | Borne basse. |
| `max` | `number` | `100` | Borne haute. |
| `step` | `number` | `1` | Pas. |
| `disabled` | `boolean` | `false` | Désactive le curseur. |
| `formatValue` | `(value: number) => string` | `String` | Formatte le nombre affiché à côté du curseur. |

Basé sur `input[type=range]` natif — clavier et sémantique ARIA gratuits, pas de réimplémentation custom.

#### DatePicker — `src/DatePicker.tsx`

```tsx
<DatePicker label="Date d'échéance" value={dueDate} onChange={setDueDate} />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `value` | `string \| null` | — | Date ISO `YYYY-MM-DD`, ou `null` si vide. |
| `onChange` | `(value: string \| null) => void` | — | Appelé à la sélection ou à l'effacement. |
| `label` | `string` | — | Libellé du champ. |
| `placeholder` | `string` | `"jj/mm/aaaa"` | Placeholder du champ texte. |
| `disabled` | `boolean` | `false` | Désactive le sélecteur. |
| `locale` | `string` | `"fr-FR"` | Tag BCP-47 pilotant noms de mois, initiales de jours et format d'affichage (`Intl`). |
| `todayLabel` | `string` | `"Aujourd'hui"` | Libellé du bouton de sélection rapide. |
| `clearLabel` | `string` | `"Effacer"` | Libellé du bouton d'effacement. |

Volontairement pas un `<input type="date">` natif — rendu et format varient trop selon le navigateur. Tout le vocabulaire (mois, jours) passe par `Intl`, donc le composant n'est pas figé au français malgré ses valeurs par défaut.

#### SegmentedControl — `src/SegmentedControl.tsx`

```tsx
<SegmentedControl
  ariaLabel="Vue du risque"
  options={[{ value: "inherent", label: "Inhérent" }, { value: "residual", label: "Résiduel" }]}
  value={view}
  onChange={setView}
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `options` | `SegmentedOption<T>[]` (`{ value, label }`) | — | Options du groupe. |
| `value` | `T` | — | Option active. |
| `onChange` | `(value: T) => void` | — | Appelé au changement. |
| `ariaLabel` | `string` | — | Nom accessible du groupe. |

À la différence de `Tabs`, ne navigue pas entre vues : bascule la *lecture* d'une même vue (ex. inhérent/résiduel).

#### Timeline — `src/Timeline.tsx`

```tsx
<Timeline
  items={[
    { label: "Créé", detail: "2026-09-01", state: "done" },
    { label: "En revue", detail: "2026-09-15", state: "current" },
    { label: "Clôture", state: "pending" },
  ]}
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `items` | `TimelineItem[]` (`{ label, detail?, state? }`) | — | Étapes, dans l'ordre d'affichage. |
| `className` | `string` | — | Classe additionnelle. |

`state` : `"done" \| "current" \| "pending"`, défaut `"pending"`. Sert aussi bien un parcours d'approbation qu'un historique (tout en `"done"`) — aucun champ métier, le formatage de `label`/`detail` est laissé à l'appelant.

#### Modal — `src/Modal.tsx`

```tsx
<Modal
  open={confirmOpen}
  onClose={() => setConfirmOpen(false)}
  title="Supprimer ce contrôle ?"
  actions={<>
    <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Annuler</Button>
    <Button variant="destructive" onClick={confirmDelete}>Supprimer</Button>
  </>}
>
  Cette action est irréversible.
</Modal>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `open` | `boolean` | — | Affiche/masque la modale. |
| `onClose` | `() => void` | — | Appelé à chaque fermeture (Escape, bouton de fermeture natif, backdrop). |
| `title` | `string` | — | Titre de la modale. |
| `children` | `ReactNode` | — | Corps. |
| `actions` | `ReactNode` | — | Rangée d'actions, généralement annuler + confirmer. |

Construit sur `<dialog>` natif — piégeage du focus, fond inerte, `::backdrop` et fermeture Escape gratuits, plutôt que réimplémentés.

### 4.2 Graphiques

Tous basés sur Chart.js 4 via `react-chartjs-2`, sauf `ProgressBar` (CSS pur). Sans exception, ces composants ne portent aucune sémantique métier : l'appelant décide ce que représentent les nombres. La palette par défaut est dérivée de `tokens.css` (`--gs-primary/success/warning/danger/neutral`) et dupliquée en dur dans `src/charts/shared.ts` — Chart.js peint sur un canvas et ne peut pas lire les custom properties CSS ; toute évolution de palette doit être répercutée dans les deux fichiers.

#### LineChart — `src/charts/LineChart.tsx`

```tsx
<LineChart
  labels={["Jan", "Fév", "Mar"]}
  series={[{ label: "Incidents", data: [3, 5, 2] }]}
  fill="linear-gradient"
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `labels` | `string[]` | — | Axe des x. |
| `series` | `LineSeries[]` (`{ label, data: (number \| null)[], color? }`) | — | Une ou plusieurs séries ; `null` laisse un trou dans la ligne. |
| `fill` | `"solid" \| "linear-gradient" \| "radial-gradient"` | — | Remplissage sous la courbe ; omis = pas de remplissage. |
| `stacked` | `boolean` | `false` | Empile les séries plutôt que de les superposer. |
| `progressive` | `boolean` | `false` | Anime le tracé de gauche à droite au premier rendu. |
| `height` | `number` | `240` | Hauteur en pixels. |

Remplace l'ancien `TrendChart` : une « tendance » n'est qu'une ligne sur des libellés ordonnés, donc pas de second composant à maintenir — voir section 7.

#### BarChart — `src/charts/BarChart.tsx`

```tsx
<BarChart
  labels={["Q1", "Q2", "Q3"]}
  series={[{ label: "Risques ouverts", data: [12, 9, 14] }]}
  orientation="horizontal"
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `labels` | `string[]` | — | Axe catégoriel. |
| `series` | `BarSeries[]` (`{ label, data: (number \| null)[], color? }`) | — | Séries. |
| `stacked` | `boolean` | `false` | Une barre empilée par libellé plutôt que des barres groupées. |
| `orientation` | `"vertical" \| "horizontal"` | `"vertical"` | `"horizontal"` place les libellés sur l'axe y (`indexAxis: "y"`). |
| `height` | `number` | `240` | Hauteur en pixels. |

#### BubbleChart — `src/charts/BubbleChart.tsx`

```tsx
<BubbleChart
  series={[{ label: "Contrôles", points: [{ x: 2, y: 3, r: 8, label: "CTRL-012" }] }]}
  xLabel="Probabilité"
  yLabel="Impact"
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `series` | `BubbleSeries[]` (`{ label, points: BubblePoint[], color? }`) | — | `BubblePoint` : `{ x, y, r, label? }` — `r` est le rayon en pixels, `label` remplace les coordonnées brutes dans l'infobulle. |
| `xLabel` | `string` | — | Titre de l'axe x. |
| `yLabel` | `string` | — | Titre de l'axe y. |
| `height` | `number` | `280` | Hauteur en pixels. |

#### DoughnutChart — `src/charts/DoughnutChart.tsx`

```tsx
<DoughnutChart segments={[{ label: "Ouvert", value: 8 }, { label: "Clos", value: 22 }]} />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `segments` | `DoughnutSegment[]` (`{ label, value, color? }`) | — | Répartition à représenter. |
| `cutout` | `string` | `"60%"` | Taille du trou central, en pourcentage ; `"0%"` donne un camembert. |
| `height` | `number` | `240` | Hauteur en pixels. |

#### ScatterChart — `src/charts/ScatterChart.tsx`

```tsx
<ScatterChart
  series={[{ label: "Vélocité", points: pointsA }, { label: "Charge", points: pointsB, secondary: true }]}
  secondaryYAxis
  yLabel="Vélocité"
  secondaryYLabel="Charge"
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `series` | `ScatterSeries[]` (`{ label, points: {x,y}[], color?, secondary? }`) | — | `secondary: true` bascule la série sur l'axe y secondaire. |
| `secondaryYAxis` | `boolean` | `false` | Ajoute un second axe y (droite), à échelle indépendante. |
| `xLabel` | `string` | — | Titre de l'axe x. |
| `yLabel` | `string` | — | Titre de l'axe y principal. |
| `secondaryYLabel` | `string` | — | Titre de l'axe y secondaire. |
| `height` | `number` | `280` | Hauteur en pixels. |

#### ProgressBar — `src/charts/ProgressBar.tsx`

```tsx
<ProgressBar value={72} animated label="Avancement du plan d'action" />
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `value` | `number` | — | Pourcentage, 0-100 (clampé hors bornes). |
| `animated` | `boolean` | `false` | Anime le remplissage (y compris depuis 0 au montage) plutôt que de le poser directement. |
| `label` | `string` | — | Nom accessible — requis si aucun libellé visible n'accompagne la barre. |
| `hideValue` | `boolean` | `false` | Masque le pourcentage affiché à droite. |
| `color` | `string` | — | Couleur CSS du remplissage ; défaut = accent de marque. |

Volontairement pas un graphique Chart.js : un pourcentage unique n'a besoin que d'une `div` et d'une transition CSS.

### 4.3 Layout & Dashboard

#### DashboardGrid — `src/DashboardGrid.tsx`

```tsx
<DashboardGrid
  editable
  widgets={[
    { id: "kpi-1", x: 0, y: 0, w: 4, h: 2, content: <Card>KPI</Card> },
    { id: "chart-1", x: 4, y: 0, w: 8, h: 4, content: <LineChart labels={labels} series={series} /> },
  ]}
  onLayoutChange={setWidgets}
/>
```

| Prop | Type | Défaut | Description |
|---|---|---|---|
| `widgets` | `DashboardWidget[]` (`{ id, x, y, w, h, content: ReactNode }`) | — | `id` doit rester stable entre rendus : GridStack indexe la disposition dessus. |
| `onLayoutChange` | `(widgets: DashboardWidget[]) => void` | — | Appelé après chaque glisser/redimensionner, avec les mêmes widgets et une nouvelle géométrie. |
| `editable` | `boolean` | `true` | Active/désactive glisser-déposer et redimensionnement. |
| `columns` | `number` | `12` | Nombre de colonnes de la grille. |
| `cellHeight` | `number` | `80` | Hauteur d'une rangée, en pixels. |
| `margin` | `number` | `12` | Espacement entre widgets, en pixels. |

Wrapper GridStack écrit à la main (pas `gridstack-react`, voir section 7). **Purement structurel** : il positionne le `ReactNode` de chaque widget et remonte la géométrie ; il ne décide de rien quant à ce qu'un widget affiche. Quel widget un rôle donné voit, et ce qu'il contient, reste un arbitrage produit ouvert (GRC Tools DECISION-002 point 5) — cette décision appartient à qui compose le dashboard, pas à la bibliothèque.

Note d'implémentation : le ré-init de GridStack est déclenché uniquement par la liste des `id` des widgets. Une géométrie poussée par le parent après montage n'est pas réappliquée automatiquement (dette assumée, commentée `ponytail:` dans le code) — si une remise à zéro externe de la disposition s'avère nécessaire, exposer une API par ref (`grid.load()`) plutôt que de recharger sur chaque changement de géométrie.

## 5. Icônes

`lucide-react` n'est pas un composant de ce package — c'est une dépendance directe du package (utilisée en interne par `MessageBanner`, `Pagination`, `FileUpload`, `DatePicker`) et il est recommandé de l'utiliser aussi côté consommateur pour rester visuellement cohérent, plutôt que de mélanger plusieurs bibliothèques d'icônes.

```tsx
import { ShieldCheck } from "lucide-react";
import { Button } from "@djamo/design-system";

<Button variant="primary">
  <ShieldCheck size={16} aria-hidden="true" />
  Valider
</Button>
```

Comme `lucide-react` figure déjà dans les `dependencies` du package, il est disponible transitivement une fois `@djamo/design-system` installé — mais mieux vaut le déclarer explicitement en dépendance directe du projet consommateur (`npm install lucide-react`) plutôt que de compter sur la résolution transitive, qui peut changer avec une future version du design system.

## 6. Build & contribution

### Commandes

Depuis `packages/design-system/` :

```bash
npm run typecheck   # tsc --noEmit
npm run build        # tsup → dist/ (ESM + .d.ts + index.css)
```

`tsup` (voir `tsup.config.ts`) part de `src/index.ts`, produit du ESM uniquement, génère les déclarations de types, et regroupe tous les `import "./X.css"` des composants dans un unique `dist/index.css`, exposé en `@djamo/design-system/styles.css`.

### Pas de test runner

Il n'y a pas de suite de tests automatisés pour ce package à ce stade — dette assumée, cohérente avec le rapport précédent sur l'état du package. La garantie de non-régression repose aujourd'hui sur `typecheck` + `build` (les deux doivent passer sans erreur) et sur la relecture visuelle dans l'application consommatrice. Ajouter un test runner (Vitest + Testing Library serait le choix naturel vu la stack) reste une amélioration ouverte, pas un prérequis actuel.

### Ajouter un nouvel atome

Calquer le style des composants existants :

1. Un fichier `NomDuComposant.tsx` à la racine de `src/` (ou `src/charts/` pour un graphique), avec son `NomDuComposant.css` associé importé en tête de fichier (`import "./NomDuComposant.css";`).
2. Une interface de props locale, non exportée sauf si elle doit être réutilisable par l'appelant (dans ce cas, l'exporter et l'ajouter à `src/index.ts`).
3. Un commentaire JSDoc au-dessus du composant expliquant le *pourquoi* (quel besoin il couvre, quel choix il tranche) plutôt que de reparaphraser les props.
4. Zéro dépendance à un concept métier — si le composant a besoin de savoir ce qu'est un `Risk` ou un `Role`, il n'a pas sa place ici, mais dans l'application consommatrice (voir section 1, « Ce que ce n'est pas »).
5. Export du composant (et de ses types publics) dans `src/index.ts`, en respectant l'ordre alphabétique déjà en place.
6. `npm run typecheck && npm run build` avant de considérer le composant terminé.

## 7. Décisions de conception notées

Choix assumés, à ne pas remettre en cause sans raison nouvelle et documentée :

- **`TrendChart` → `LineChart`.** Une « tendance » n'est qu'une ligne sur des libellés ordonnés ; `LineChart` couvre ce cas et ajoute remplissage/empilement/animation progressive. Un seul composant, pas deux qui se recouvrent.
- **Wrapper GridStack écrit à la main**, pas `gridstack-react` : ce paquet est dépublié, et son modèle (widgets sérialisables `component` + `props`, rendus via portails) ne convient de toute façon pas à un `content: ReactNode` direct.
- **`MessageBanner`, pas `Message`** : évite la collision de nom avec l'export `Message` d'autres bibliothèques UI (antd et consorts) susceptibles de coexister dans la même application consommatrice.
- **Un seul badge de statut, `StatusBadge`** : couvre tout affichage de statut/niveau (au sens large — pas seulement les statuts GRC), pas de duplication par domaine.
- **`DashboardGrid` purement structurel** : il positionne des widgets et remonte leur géométrie, un point c'est tout. Quel widget un rôle voit et ce qu'il contient est un arbitrage produit resté ouvert côté GRC Tools (DECISION-002 point 5) — volontairement hors du périmètre de cette bibliothèque, quel que soit le produit qui la consomme.
