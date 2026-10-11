# Mémoire — @dev-frontend

Créée le 2026-10-11 (vague 2 du design system). À lire en premier par tout agent Dev Frontend ; la mettre à jour en fin de tâche.

## Principes retenus

1. Après `git checkout -B <branche> origin/<branche>`, vérifier `git log -1` avant toute modification (le worktree peut rester sur `main`).
2. Le script `test` n'existe PAS dans `frontend/` ; les tests du design system sont dans `packages/design-system` (`npx vitest run`, jsdom + vitest-axe). Chaque composant/variante : test de comportement + `axe` sans violation, et une entrée dans `frontend/src/catalog/main.tsx` (données factices « Exemple »).
3. Le harnais refuse les commandes Bash composées (`cd` calculé, heredoc enchaîné) dans un worktree : séparer en appels simples, utiliser Write/Edit pour les fichiers.
4. Nouvelles variantes = prop optionnelle dont la valeur par défaut reproduit l'existant (Button `size="md"`, Modal `size="sm"` 340 px, Table sans sélection) : aucun écran existant ne change.
5. États « indisponible » : `aria-disabled` + raison masquée reliée par `aria-describedby` (pattern Button, repris pour Tabs) ; état « sélectionné » jamais par la couleur seule (bordure épaisse + texte masqué / `aria-selected`).
6. Jetons ajoutés vague 2 : `--gs-space-2-5: 12px`, `--gs-font-size-display: 30px`. Pas de nouvelle couleur.
7. Cartographie : ne jamais toucher.

## Historique

- 2026-10-11 — Vague 2 (`feat/ds-wave2`, DECISION-039 pt 4) : Button sm/md/lg, Modal sm/md/lg, Table compact/zébré/sélection/tri, Tabs désactivé, Card sélectionnée/désactivée, Checkbox `indeterminate`, BulkActionBar (M14), VersionComparison (M15), MatrixView (M4).

## Reste de l'inventaire (après vague 2)

M10 gabarit page de réglage, M11 liste « À faire », M12 panneau latéral, M13 vote de comité, M16 récapitulatif d'import, M17 centre de notifications ; E11 ligne cliquable au clavier, E13 responsive, E18-E22 (flèches Tabs/Panel/Menu, slot action MessageBanner), E23 Timeline annoncée, E24 FileUpload états, E25-E28 sidebar/ContextRail packagés ; rayons 2/4/8/16 (décision d'alignement non prise).

## Leçons correctifs vague 2 (QA/Sécu, branche `fix/ds-wave2`)

- Les types TS sont effacés à l'exécution : tout composant qui affiche une valeur venue de l'API doit tolérer un objet (jamais passer un non-scalaire à React comme enfant) -> `VersionComparison` affiche « (valeur complexe) ».
- Dans un composant, `{...rest}` va AVANT les props internes (`ref`) pour ne pas les écraser.
- Un état « désactivé » d'un conteneur doit bloquer réellement : `inert` + capture du clic (jsdom n'implémente pas `inert`).
- Ids ARIA dérivés de l'index, jamais d'une valeur libre (espaces = IDREF coupé).
- `.btn` inline-flex : garder un padding vertical, hauteurs en `min-height`.
- Les tests qui lisent le CSS avec `node:fs` exigent `/// <reference types="node" />` pour le typecheck du package.
