# Audit du design system — GRC Tools
Date : 2026-09-30

## Références prises comme source de vérité

- Bibliothèque de référence : `Revue Visuelle GRC.html` (onglet Design System), qui décrit la charte et les états des composants.
- Implémentation : `packages/design-system/README.md`, `packages/design-system/src/index.ts`, `packages/design-system/src/tokens.css`.
- Intégration : `frontend/src/index.css`, `frontend/src/design-system/RaciPanel.tsx`, `frontend/src/design-system/ContextRail.tsx`.

## Charte graphique à conserver

- Bleu principal : `#2A3FFF`; survol : `#1F2FD6`; fond accent : `#E3E5FF`.
- Fonds : page `#F8F7FC`, surface `#F2EFFB`, bordure `#E0DBF1`.
- Texte : `#1B1A2C`, secondaire `#54536D`, désactivé `#9995AE`.
- Statuts : danger `#B3261E`, warning `#8A5A00`, success `#1E7A46`, neutral `#5A6472`; ne jamais réutiliser le bleu de marque comme sens de statut.
- Titres : Plus Jakarta Sans ; UI et libellés : IBM Plex Sans ; données tabulaires numériques : IBM Plex Mono.
- Rayons : 8 px générique, 10 px boutons, 14 px cartes, pilule 999 px.
- Espacements de base : 4 / 8 / 16 / 24 / 32 px. Thème clair uniquement.
- Les boutons doivent distinguer primaire, secondaire et destructif ; le survol et le focus clavier sont visibles. Les libellés de statut doivent toujours accompagner la couleur.

## Inventaire

La bibliothèque générique exporte 18 atomes :
1. `Button` — variantes primary / secondary / destructive, attributs natifs de bouton.
2. `FormField` — label, htmlFor, help, error, children ; assure le libellé accessible.
3. `StatusBadge` — label et tone danger / warning / success / neutral / info.
4. `Table` — columns, rows, rowKey, loading, emptyMessage ; états chargement et vide intégrés.
5. `Tabs` — items, active, onChange ; onglet courant marqué par aria-current, jamais disabled.
6. `Breadcrumb` — items et ariaLabel.
7. `Card` — header, footer, children, className.
8. `Menu` — groups, ariaLabel, className ; item avec label/href/onSelect/icon/active/disabled.
9. `MessageBanner` — tone info / success / warning / danger, title, children, showIcon ; rôles ARIA adaptés.
10. `Pagination` — page, pageCount, onChange, previousLabel, nextLabel, ariaLabel.
11. `Panel` / `PanelRow` — titre, onglets optionnels et lignes avec icon/trailing.
12. `FileUpload` — accept, onSelect, buttonLabel, fileName, disabled.
13. `Grid` / `GridItem` — colonnes, span et className pour la composition.
14. `Slider` — value, onChange, label, min, max, step, disabled, formatValue.
15. `DatePicker` — value ISO ou null, onChange, label, placeholder, disabled, locale, todayLabel, clearLabel.
16. `SegmentedControl` — options, value, onChange, ariaLabel.
17. `Timeline` — items avec label/detail/state done/current/pending, className.
18. `Modal` — open, onClose, title, children, actions.

Composants de visualisation exportés séparément : `BarChart`, `BubbleChart`, `DoughnutChart`, `LineChart`, `ProgressBar`, `ScatterChart`, et `DashboardGrid`.

Le composant `RaciPanel` est spécifique à GRC et vit dans `frontend/src/design-system/RaciPanel.tsx`. Il ne faut ni le dupliquer ni le déplacer dans la bibliothèque générique sans décision d'architecture. La revue visuelle montre aussi le rail contextuel Comments/RACI/Evidence/Occurrence ; celui-ci est une composition applicative, pas un nouvel atome générique.

## États à contrôler

La revue visuelle recense, selon l'atome : défaut, survol, focus clavier, désactivé, chargement, vide et erreur. Tous les états ne s'appliquent pas à tous les composants. Au minimum :
- Bouton : défaut, hover, focus visible, disabled, loading si l'action le nécessite.
- Formulaire : label visible, aide, erreur par champ, focus, disabled.
- Table : loading, empty, contenu, statuts lisibles et actions autorisées.
- Badge : libellé et ton sémantique.
- Modal : ouverture/fermeture accessible, annulation et confirmation explicite.
- Notification : message d'erreur traçable (inclure requestId lorsque fourni par l'API), succès non intrusif.
- Onglets : état courant accessible au clavier.
- Panneau contextuel : ne pas afficher des commentaires, identités ou attributions RACI fictifs comme s'il s'agissait de données réelles.

## Constats de l'audit initial des pages #71 et #72

Avant correction, ces deux pages utilisaient `CorePages.css` pour redéfinir cartes, boutons, badges, tableaux, onglets et champs, avec des éléments HTML natifs et sans import direct de `@djamo/design-system`. C'était une duplication de la bibliothèque existante.

La correction remplace ces éléments par `Button`, `Card`, `DatePicker`, `FormField`, `Grid`, `GridItem`, `MessageBanner`, `Modal`, `StatusBadge`, `Table` et `Tabs`. La feuille ajoutée ne définit que la composition et la disposition des pages ; elle ne redéfinit pas les styles des atomes.
