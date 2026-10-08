---
name: penpot-atomic-design-djamo
description: Djamo-specific layer on top of the `penpot-atomic-design` plugin (id 70b40136-e0c6-459b-b6b3-86c3b8c73302). Use whenever a Penpot file is structured, created or audited for GRC Tools / Djamo — token sets, pages, component naming, variants, shared library, handoff. Applies the plugin's Atomic Design method but with Djamo's real tokens, component inventory and already-made PO decisions.
---

# Penpot Atomic Design — Djamo GRC Tools

This skill **customizes** the generic `penpot-atomic-design` plugin skill
(`70b40136-e0c6-459b-b6b3-86c3b8c73302:penpot-atomic-design`). Load that
skill for the method (token sets, themes, page layout, variants, library,
handoff); everything below **overrides** its defaults wherever they
conflict.

## 0. Source of truth — non-negotiable

- **Code is the source of truth, Penpot is a mirror.** The design system
  lives in `packages/design-system/` (`@djamo/design-system`, DECISION-008)
  and its tokens in `packages/design-system/src/tokens.css`. Penpot must
  reflect these values, never redefine them.
- The validated visual reference is the commentable HTML artifact
  (`grc-review.html`, Option B — PO decision 2026-09-30, "Figma abandoned,
  we stay on the artifact"). Every new screen goes into that artifact
  first.
- **Making Penpot the reference instead of the artifact/code is a PO
  decision, not something this skill decides.** If a task implies it, stop
  and record an `Ouvert` / owner `HUMAN` item in
  `.claude/agent-context/ACTION_ITEMS.md` (CLAUDE.md rule 7bis) before going
  further.
- A token changed in Penpot must be ported to `tokens.css` with the **same
  `--gs-*` name** (only values change, so no component needs editing), and
  that port requires explicit PO validation (DECISION-001 precedent).

## 1. Token sets & themes

One theme only: **`djamo/light`**. No dark theme — dark mode was
intentionally removed (PO decision 2026-09-28, DECISION-001 addendum). Do
not create a dark set "for later".

Penpot token names = CSS names without the `--gs-` prefix, grouped by
dots. Sets, in this order:

| Penpot set | Tokens (`tokens.css`) |
|---|---|
| `core/color/neutral` | `bg-page #f8f7fc`, `bg-surface #f2effb`, `border #e0dbf1`, `text #1b1a2c`, `text-secondary #54536d`, `text-disabled #9995ae` |
| `core/color/brand` | `primary #2a3fff`, `primary-hover #1f2fd6`, `primary-bg #e3e5ff` |
| `core/color/status` | `danger #b3261e` / `danger-bg #fbeae9`, `warning #8a5a00` / `warning-bg #fcf1d9`, `success #1e7a46` / `success-bg #e7f5ec`, `neutral #5a6472` / `neutral-bg #eef0f2`, `info #2a3fff` / `info-bg #e3e5ff` |
| `core/spacing` | `space-1 4`, `space-2 8`, `space-3 16`, `space-4 24`, `space-5 32` |
| `core/typography` | `font-display` Plus Jakarta Sans (600/700/800), `font-ui` IBM Plex Sans (400–700), `font-mono` IBM Plex Mono (500/600); sizes `title 20`, `subtitle 16`, `body 14`, `data 14` |
| `core/radius` | `radius 8`, `radius-btn 10`, `radius-card 14`, `radius-pill 999` |
| `core/elevation` | `elev-1`, `elev-2`, `elev-3`, `shadow-card` (copy the shadow values from `tokens.css` verbatim) |

Rules carried over from the validated charter:
- **Brand blue `#2a3fff` is the single action accent.** It never encodes
  risk/status. Status colors (danger/warning/success/neutral) are never
  replaced or tinted by the brand color.
- A status color is **always paired with a text label**, never color alone
  (accessibility + audit readability).
- **IBM Plex Mono only for standalone numeric/tabular values** (scores,
  amounts, dates in tables) — never for labels or field names.
- Depth is expressed by elevation (shadow), never by a flat color swap.
- Excluded on purpose (artifact V3): lifestyle photos, the "savings" green
  accent, decorative yellow/orange, near-black sections, decorative
  serpentine strokes. Don't reintroduce them as tokens.

## 2. Pages of the Penpot file

```
00 — Cover & changelog        (link to the artifact + tokens.css commit)
01 — Tokens                   (visual swatches of the sets above)
02 — Atoms
03 — Molecules
04 — Organisms
05 — Templates
06 — Screens (GRC)            (Cartographie, Registre des risques, Évaluation, RACI, Audit trail…)
99 — Archive                  (never delete — soft-delete spirit applies here too)
```

## 3. Inventory → Atomic levels

Component names = the exported React name (`packages/design-system/src/index.ts`),
so design↔code handoff is 1:1. Penpot path: `<Level>/<Component>/<variant>`.

| Level | Components (React name) |
|---|---|
| Atoms | `Button`, `StatusBadge`, `FormField`, `Slider`, `DatePicker`, `SegmentedControl`, `FileUpload`, `ProgressBar` |
| Molecules | `Breadcrumb`, `Tabs`, `Menu`, `MessageBanner`, `Pagination`, `Card`, `PanelRow`, `Timeline` |
| Organisms | `Table`, `Panel`, `Modal`, `Grid`/`GridItem`, charts (`LineChart`, `BarChart`, `BubbleChart`, `DoughnutChart`, `ScatterChart`), `RaciPanel` (frontend) |
| Templates | `DashboardGrid` (structural only — per-role widget content is still open, DECISION-002 point 5) |

Variants must mirror the real props, not invent new ones:
- `Button` → `variant = primary | secondary | destructive` (default `secondary`).
- `StatusBadge` → `tone = danger | warning | success | neutral | info`.
- `FormField` → states `default | help | error`.

A variant that has no prop in code is a **new component request** — log
it for `@dev-frontend` in `.claude/agent-context/SHARED_LOG.md`, don't
just draw it.

## 4. Djamo GRC domain in screens

- Use the official nomenclature (CLOSED, PO 2026-09-30): **9 processes** —
  Gouvernance & Audit Interne; Crédit; Recouvrement & Expérience Client;
  Conformité LBC-FT/KYC; Juridique & Gestion des Tiers; Trésorerie, ALM &
  Fonds propres; Comptabilité, Fiscal & Reporting; RH; DSI &
  Cybersécurité. **15 directions** — Direction Générale, Risque, Audit
  Interne, Gouvernance, Crédit, Recouvrement, Conformité, Juridique,
  Trésorerie, Finance, Sécurité SI, Ingénierie, Data/BI, Data/Revenue
  Assurance, RH.
- Cartographie / concentration grids are **never a fixed N-cell grid**:
  size from active data, top-N + "Autres" at high N.
- Concentration maps are visible only to R/A holders (RACI) — annotate the
  screen with the required visibility rule.
- Control-effectiveness aggregation is **MIN** across the 3 lines of
  defense (non-compensatory, CHALLENGE-001) — any score/derivation preview
  must show the worst line, never an average or max.
- UI copy in French.

## 5. Handoff checklist

Before marking a Penpot page "ready to code":
1. Every color/spacing/radius/type value is a token from §1 — no raw hex.
2. Every component name matches an export of `@djamo/design-system`.
3. The screen exists in the artifact (`grc-review.html`).
4. Any new token, variant or component is listed in `SHARED_LOG.md`
   (`@dev-frontend`, `@ux-designer`) and, if it needs PO validation, in
   `ACTION_ITEMS.md` as `Ouvert` / `HUMAN`.
