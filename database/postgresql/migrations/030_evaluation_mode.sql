-- DIV-06 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
-- 2026-09-29): storage for the Classique/Participatif risk evaluation
-- methodology. Depends on 029_risks_process_id.sql only by ordering
-- convention (DECISION-006's imposed order: (a) risks.process_id,
-- (b) Config.evaluationMode, (c) Process.evaluationMode), not by any FK
-- or data relationship between the two migrations. Kept as a separate
-- file from 029 for exactly that reason — two independent, individually
-- revertible changes shouldn't share one down migration.
--
-- Not read yet by RiskEvaluationService (see ConfigService.ts's file
-- header for the same kind of "storage now, wiring later" note already
-- established for scoreFormula/impactRetenuRule/appetiteMode) — this
-- migration and its backend counterpart are storage + a pure resolution
-- function only.
--
-- Numbering: 029_risks_process_id.sql is the latest migration in this
-- repo at the time this file was authored — confirmed by listing the
-- migrations directory directly before writing (anti-collision
-- protocol, GRC_Migration_Plan.md §1).

-- Config: one row per tenant (024_config.sql) — a real default, like
-- appetite_mode, not nullable: every tenant needs a methodology even if
-- it never explicitly picks one.
ALTER TABLE configs ADD COLUMN evaluation_mode text NOT NULL DEFAULT 'CLASSIQUE'
  CHECK (evaluation_mode IN ('CLASSIQUE', 'PARTICIPATIF'));

-- Process: nullable, no default — null means "inherit from parent
-- process, or from Config.evaluation_mode if every ancestor is also
-- null" (resolved at read time by resolveInheritedEvaluationMode /
-- ProcessService.resolveEvaluationMode, never dénormalisé onto the row).
ALTER TABLE processes ADD COLUMN evaluation_mode text
  CHECK (evaluation_mode IN ('CLASSIQUE', 'PARTICIPATIF'));
