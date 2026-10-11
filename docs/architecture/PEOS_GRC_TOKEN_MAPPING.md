# PEOS ↔ GRC — Token Mapping Contract

**Status:** Adopted mapping baseline for frontend implementation
**Date:** 2026-10-05

## Purpose

This document prevents frontend agents from inferring token equivalence from names alone.

PEOS provides taxonomy and governance.
GRC `@djamo/design-system` provides the implementation tokens actually consumed by the application.

**The GRC Djamo values remain authoritative for the current product.**

## 1. Direct / mapped relationships

| GRC token | PEOS role/reference | Status | Rule |
|---|---|---|---|
| `--gs-font-ui` | `foundation.typography.fontFamily.sans` | DIRECT MATCH | Same value: IBM Plex Sans. |
| `--gs-font-mono` | `foundation.typography.fontFamily.mono` | DIRECT MATCH | Same value: IBM Plex Mono. |
| `--gs-space-1` | `foundation.spacing.200` | MAPPED | 4 px; name differs. |
| `--gs-space-2` | `foundation.spacing.300` | MAPPED | 8 px; name differs. |
| `--gs-space-3` | `foundation.spacing.500` | MAPPED | 16 px; name differs. |
| `--gs-space-4` | `foundation.spacing.600` | MAPPED | 24 px; name differs. |
| `--gs-space-5` | `foundation.spacing.700` | MAPPED | 32 px; name differs. |
| `--gs-radius` | `foundation.radius.300` | DIRECT MATCH | 8 px. |
| `--gs-radius-pill` | `foundation.radius.full` | DIRECT MATCH | 999 px. |
| `--gs-text` | `semantic.text.primary` | MAPPED | Role-equivalent; GRC value remains authoritative. |
| `--gs-text-secondary` | `semantic.text.secondary` | MAPPED | Role-equivalent. |
| `--gs-text-disabled` | `semantic.text.disabled` | MAPPED | Role-equivalent. |
| `--gs-bg-page` | `semantic.surface.canvas` | MAPPED | Role-equivalent; GRC value remains authoritative. |
| `--gs-bg-surface` | `semantic.surface.default` | MAPPED | Role-equivalent; GRC value remains authoritative. |
| `--gs-border` | `semantic.border.default` | MAPPED | Role-equivalent. |
| `--gs-primary` | PEOS primary/action semantic role | MAPPED WITH VALUE DIVERGENCE | Keep GRC `#2A3FFF`. |
| `--gs-danger` | `semantic.feedback.error.accent` | MAPPED WITH VALUE DIVERGENCE | Keep GRC `#B3261E`. |
| `--gs-warning` | `semantic.feedback.warning.accent` | MAPPED WITH VALUE DIVERGENCE | Keep GRC `#8A5A00`. |
| `--gs-success` | `semantic.feedback.success.accent` | MAPPED WITH VALUE DIVERGENCE | Keep GRC `#1E7A46`. |
| `--gs-info` | `semantic.feedback.info.accent` | MAPPED WITH VALUE DIVERGENCE | Resolved by DECISION-030 (q21): info is distinct from primary. GRC value `#0C6BA5` (4.99:1 on `--gs-info-bg`, 5.06:1 on `--gs-bg-surface`, WCAG 2.1 AA). Not a PEOS Foundation value. |
| `--gs-radius-btn` | GRC-specific brand/component choice | GRC SPECIFIC | 10 px; no PEOS equivalent proven. |
| `--gs-radius-card` | GRC-specific brand/component choice | GRC SPECIFIC | 14 px; no PEOS equivalent proven. |

## 2. GRC implementation tokens without a proven one-to-one PEOS equivalent

| GRC token | Current rule |
|---|---|
| `--gs-primary-hover` | Use existing GRC value; do not infer a PEOS replacement. |
| `--gs-primary-bg` | Use existing GRC value; do not infer a PEOS replacement. |
| `--gs-danger-bg` | Use existing GRC value; do not infer a PEOS replacement. |
| `--gs-warning-bg` | Use existing GRC value; do not infer a PEOS replacement. |
| `--gs-success-bg` | Use existing GRC value; do not infer a PEOS replacement. |
| `--gs-neutral` | Use existing GRC value; do not infer a PEOS replacement. |
| `--gs-neutral-bg` | Use existing GRC value; do not infer a PEOS replacement. |
| `--gs-info-bg` | `#E4F1FA`, paired with `--gs-info` (DECISION-030); do not infer a PEOS replacement. |
| `--gs-on-primary` | `#FFFFFF`, text/icon on a primary fill (DECISION-030); no proven PEOS equivalent. Not for white surfaces. |
| `--gs-font-display` | GRC-specific brand role; keep Plus Jakarta Sans. |
| `--gs-font-size-title` | GRC implementation scale; use existing token. |
| `--gs-font-size-subtitle` | GRC implementation scale; use existing token. |
| `--gs-font-size-body` | GRC implementation scale; use existing token. |
| `--gs-font-size-data` | GRC implementation scale; use existing token. |
| `--gs-elev-1` | Partial conceptual mapping to PEOS elevation 100; keep GRC value. |
| `--gs-elev-2` | Partial conceptual mapping to PEOS elevation 200; keep GRC value. |
| `--gs-elev-3` | Partial conceptual mapping to PEOS elevation 300; keep GRC value. |
| `--gs-shadow-card` | GRC-specific composition; use existing value. |

## 3. Component-level gaps

| PEOS area | GRC implementation | Decision |
|---|---|---|
| `component.button.height.md` = 40 px | Button has no explicit GRC height token | Non-blocking gap; do not add automatically. |
| `component.statusBadge.height` = 24 px | StatusBadge has no explicit GRC height token | Non-blocking gap; do not add automatically. |
| `component.modal.maxWidth.md/lg` = 560/800 | GRC Modal currently has one fixed width | Deferred; wait for a concrete business use case. |

## 4. Mandatory frontend rules

1. New pages use `@djamo/design-system` components.
2. New page CSS is composition/layout only; do not recreate generic component styling.
3. Prefer existing `--gs-*` tokens.
4. PEOS names do not override GRC names.
5. PEOS values do not override validated Djamo values.
6. A real token gap is reported and escalated before a new token is created.
7. No automatic mass migration of `--gs-*`.
8. No second token system.

## 5. Six future module groups

| Group | Modules |
|---|---|
| Risques | Dispositif de risque; Registre des risques |
| Contrôle | Plan de contrôle; Ligne de défense |
| Indicateurs | KRI; KPI; Dashboards |
| Plans & revues | Cycle de revue |
| Audit | Mission; Constats & recommandations |
| Administration | Paramètres et référentiels |

## 6. Authority model

```text
PEOS
= taxonomy + governance + design method

GRC
= implementation tokens + components + current Djamo brand values

Frontend
= page composition + feature implementation
```

Do not create a third source of truth.