# Audit du design system — pages de suivi des contrôles et d'audit

Date : 2026-09-30  
Périmètre : `packages/design-system`, `frontend/src/design-system`, PR #71 (Exécutions & efficacité) et PR #72 (Constats & recommandations).

## 1. Sources de référence vérifiées

- `Revue Visuelle GRC.html` : référence visuelle demandée, incluant couleurs, typographies, états de survol/focus/désactivé/chargement/erreur et exemples d'écrans.
- `packages/design-system/README.md` : catalogue et signatures publiques.
- `packages/design-system/src/index.ts` : exports réellement disponibles.
- `packages/design-system/src/tokens.css` : valeurs de la charte Djamo.
- CSS/TSX des composants : référence finale en cas d'écart avec la documentation.

## 2. Tokens graphiques à respecter

| Domaine | Token / valeur vérifiée |
|---|---|
| Fond de page | `--gs-bg-page: #f8f7fc` |
| Surface | `--gs-bg-surface: #f2effb` |
| Bordure | `--gs-border: #e0dbf1` |
| Texte principal / secondaire / désactivé | `#1b1a2c` / `#54536d` / `#9995ae` |
| Action principale | `--gs-primary: #2a3fff` |
| Survol de l'action principale | `--gs-primary-hover: #1f2fd6` |
| Fond d'accent | `--gs-primary-bg: #e3e5ff` |
| Danger | `#b3261e`, fond `#fbeae9` |
| Avertissement | `#8a5a00`, fond `#fcf1d9` |
| Succès | `#1e7a46`, fond `#e7f5ec` |
| Typographie titres | Plus Jakarta Sans |
| Typographie interface | IBM Plex Sans |
| Chiffres/tabulaire | IBM Plex Mono |
| Rayons | standard 8px, bouton 10px, carte 14px, pilule 999px |
| Espacements | 4 / 8 / 16 / 24 / 32px via `--gs-space-1…5` |

Les états hover/focus/disabled/error ne doivent pas être redéfinis localement lorsqu'ils sont déjà fournis par le composant.

## 3. Inventaire des 19 composants réutilisables ciblés

Les 18 primitives génériques exportées et le composant métier GRC `RaciPanel` sont le périmètre « 19 composants » retenu pour cet audit. `DashboardGrid` est un wrapper de layout/dashboard distinct, pas un atome de formulaire ou de registre. Les six graphiques sont aussi un groupe distinct.

| # | Composant | Propriétés publiques principales | Règle de réutilisation |
|---:|---|---|---|
| 1 | `Breadcrumb` | `items`, `ariaLabel?` | Utiliser pour la hiérarchie de navigation d'un objet. |
| 2 | `Button` | `variant?` = primary/secondary/destructive ; attributs natifs du bouton | Aucune classe de bouton ou état hover local. |
| 3 | `Card` | `header?`, `footer?`, `children`, `className?` | Encadrer sections, formulaires, résumés et registres. |
| 4 | `DatePicker` | `value`, `onChange`, `label?`, `placeholder?`, `disabled?`, `locale?`, `todayLabel?`, `clearLabel?` | Ne pas recréer le calendrier ou le format de date. |
| 5 | `FileUpload` | `onSelect`, `buttonLabel?`, `fileName?`, `accept?`, `disabled?` | Pour les pièces jointes/preuves. |
| 6 | `FormField` | `label`, `htmlFor`, `help?`, `error?`, `children` | Tout contrôle de formulaire doit avoir un libellé et un état d'erreur accessibles. |
| 7 | `Grid` / `GridItem` | `columns?`, `className?`; item : `span?`, `className?` | Mise en page responsive, pas de grille CSS répétée sans nécessité. |
| 8 | `Menu` | `groups`, `ariaLabel`, `className?`; item : `label`, `href?`, `onSelect?`, `icon?`, `active?`, `disabled?` | Actions groupées avec sémantique lien/bouton cohérente. |
| 9 | `MessageBanner` | `tone`, `title?`, `showIcon?`, `children` | Erreur, succès, avertissement, état vide/informatif ; ne pas construire une bannière maison. |
| 10 | `Modal` | `open`, `onClose`, `title`, `children?`, `actions?` | Confirmations et saisie de commentaires, jamais `window.prompt`. |
| 11 | `Pagination` | `page`, `pageCount`, `onChange`, `previousLabel?`, `nextLabel?`, `ariaLabel?` | Ajouter pour les registres paginés côté appelant. |
| 12 | `Panel` / `PanelRow` | panneau : `title?`, `tabs?`, `activeTab?`, `onTabChange?`, `className?`; ligne : `icon?`, `trailing?`, `children` | Panneaux de données liées et lignes structurées. |
| 13 | `SegmentedControl` | `options`, `value`, `onChange`, `ariaLabel?` | Basculer une lecture d'une même vue, distinct de la navigation par onglets. |
| 14 | `Slider` | `value`, `onChange`, `label?`, `min?`, `max?`, `step?`, `disabled?`, `formatValue?` | Pour une valeur continue/pondération, pas pour un choix catégoriel. |
| 15 | `StatusBadge` | `label`, `tone` = danger/warning/success/neutral/info | Statut toujours exprimé par un libellé et une couleur sémantique. |
| 16 | `Table` | `columns`, `rows`, `rowKey`, `loading?`, `emptyMessage?` | Utiliser les colonnes typées, état de chargement et état vide du composant. |
| 17 | `Tabs` | `items`, `active`, `onChange` | Navigation entre vues d'une même page. |
| 18 | `Timeline` | `items`, `className?`; étape : `label`, `detail?`, `state?` | Historique/étapes de workflow sans refaire le rail graphique. |
| 19 | `RaciPanel` (GRC) | Props à relire dans `frontend/src/design-system/RaciPanel.tsx` avant usage | Composant métier déjà existant : ne pas recréer de matrice RACI dans une page. |

## 4. Revue des pages #71 et #72

| Besoin | #71 Exécutions & efficacité | #72 Constats & recommandations |
|---|---|---|
| Encadrement des sections | `Card` | `Card` |
| Formulaires | `FormField` + contrôles HTML natifs | `FormField` + contrôles HTML natifs |
| Date | `DatePicker` | À prévoir pour les échéances des plans d'action |
| Registres | `Table` | `Table` |
| Statuts | `StatusBadge` | `StatusBadge` |
| Erreurs / succès / états vides | `MessageBanner` | `MessageBanner` |
| Mise en page responsive | `Grid` / `GridItem` | `Grid` / `GridItem` |
| Onglets | `Tabs` | Non requis à ce stade |
| Confirmation / commentaire | `Modal` | `Modal` pour commentaire de clôture |
| CSS local | Composition, espacements, largeur et adaptation responsive uniquement | Composition, espacements, largeur et adaptation responsive uniquement |
| Panneau contextuel | États explicites ; pas de données fictives présentées comme réelles | Même règle ; liens métier à connecter avant d'afficher des éléments associés |

### Écarts restant à contrôler

1. La CI TypeScript/build/lint ne prouve pas le rendu visuel réel : une revue navigateur reste nécessaire.
2. Les endpoints doivent être exercés en E2E avec les réponses réelles, les permissions, les erreurs API et les transitions métier.
3. Les panneaux contextuels ne doivent pas afficher de compteurs fictifs ni prétendre que commentaires/RACI/preuves/occurrences sont connectés si ce n'est pas le cas.
4. Les actions de clôture/validation doivent conserver les règles serveur (maker-checker, commentaire obligatoire si applicable, permissions).
5. Les prochaines pages doivent réutiliser les mêmes composants et la navigation commune ; aucune copie locale des styles de bouton/champ/tableau/badge/modale.
6. Les styles propres aux pages doivent se limiter au layout et employer les tokens `--gs-*`, sans couleurs ou typographies de marque codées en dur.

## 5. Critères d'acceptation avant fusion

- [ ] Tous les composants existants sont inventoriés et leurs props vérifiées dans les sources.
- [ ] Pas de réimplémentation locale des composants génériques.
- [ ] Tous les champs ont un libellé accessible, et une erreur associée lorsqu'elle existe.
- [ ] Les états loading, empty, success et error sont cohérents.
- [ ] Navigation et panneau contextuel ne présentent pas de données inventées.
- [ ] CI frontend, backend/tests et contrôles de sécurité au vert.
- [ ] Test E2E ou preuve manuelle documentée des workflows critiques contre API.
- [ ] Capture/revue visuelle comparée à `Revue Visuelle GRC.html`, incluant hover, focus, disabled, erreurs et responsive.
