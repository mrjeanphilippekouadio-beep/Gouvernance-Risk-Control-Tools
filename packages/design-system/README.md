# @djamo/design-system

React components + design tokens (Djamo brand chart), reusable outside GRC Tools.

## Install

```bash
npm install @djamo/design-system
```

Peer deps: `react` / `react-dom` >= 18.

## Use

```ts
// once, at the app entry (CSS or JS)
import "@djamo/design-system/tokens.css"; // theme: colors, fonts, spacing, radius
import "@djamo/design-system/styles.css"; // component styles

import { Button, FormField, StatusBadge, Table, Tabs, TrendChart } from "@djamo/design-system";
```

Theming: override any `--gs-*` custom property after importing `tokens.css`.

## Build

```bash
npm run build   # tsup → dist/ (ESM + .d.ts + index.css)
```
