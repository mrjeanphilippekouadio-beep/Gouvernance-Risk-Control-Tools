-- DECISION-006 follow-up (.claude/agent-context/ACTION_ITEMS.md, wiring
-- batch, 2026-09-30): `resolveInheritedEvaluationMode`/
-- `ProcessService.resolveEvaluationMode` (030_evaluation_mode.sql) exist
-- but have never had a consumer — RiskEvaluationService never resolved
-- or stored a mode. This migration gives RiskEvaluation a place to keep
-- the snapshot: the mode is resolved exactly once, at creation time
-- (mirrors RiskEvaluation.subCategory/entity, already captured as a
-- point-in-time snapshot rather than a live reference, for the same
-- reason — a validated evaluation must never change meaning under it
-- because a process's mode or the tenant default was edited later).
--
-- Expand-only, nullable, no default: existing risk_evaluations rows were
-- created before this concept existed and never had a mode resolved for
-- them — backfilling one now would be inventing a value never actually
-- in force at that evaluation's creation time, the same "don't guess"
-- posture already taken by 029_risks_process_id.sql /
-- 031_controls_process_id.sql for their own nullable FKs. Every new
-- evaluation from this point on has it set by
-- RiskEvaluationService.create (never null going forward, even absent a
-- resolvable process — it falls back to Config.evaluation_mode's tenant
-- default, same as resolveInheritedEvaluationMode itself).
--
-- Numbering: 033_process_evaluation_mode_requests.sql is the latest
-- migration in this repo at the time this file was authored — confirmed
-- by listing the migrations directory directly before writing
-- (anti-collision protocol, GRC_Migration_Plan.md §1).

ALTER TABLE risk_evaluations ADD COLUMN evaluation_mode text
  CHECK (evaluation_mode IN ('CLASSIQUE', 'PARTICIPATIF'));
