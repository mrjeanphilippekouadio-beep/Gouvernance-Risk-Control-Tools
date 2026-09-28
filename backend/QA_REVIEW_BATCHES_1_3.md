# QA Review — Batches 1-3 (9 new domain modules)

**Reviewer:** A08 QA (independent pass — no code in this review's scope was
written by the author of the modules under review).
**Scope:** Kpi/KpiMeasure, RiskAppetite, RatingScale, User, RiskEvaluation,
Kri/KriMeasure, RiskOwnership (+ RiskService extensions), ActionPlan,
Cartography. Service + repository-interface + test-double level only (no
Postgres integration environment available in this pass — see finding
QA-04 for why that specifically matters here).

**Method:** for every module, read the service, its own test file, and
(where relevant) the real `Postgres*Repository` implementation, then
checked the five angles requested by the dispatch: cross-module
integration paths, tenant isolation, terminal-state/immutability,
maker-checker self-action, and permission-gating completeness. Every
finding below states a concrete input/state that would slip through
today, per the discipline `SecurityBoundaries.test.ts` already uses in
this codebase.

**What's genuinely solid** (called out so it isn't lost in the findings
below): `RiskEvaluationService.test.ts` exercises a *realistic* multi-axis
active `RatingScale` (3 impact axes, MAX rule, 3-line mastery config) —
not a minimal stub — and covers immutability after both VALIDATED and
REJECTED, self-validation and self-rejection, and double-finalization.
`CartographyService.test.ts` has exactly the multi-evaluation-state test
the dispatch worried might be missing (older VALIDATED / newer REJECTED /
most-recent VALIDATED, on the same risk) and a genuine two-tenant leakage
test. `RiskOwnershipService.test.ts` and `UserService.test.ts` both seed
two tenants into one shared in-memory repository instance and assert the
cross-tenant read returns nothing — the strong form of a tenant-isolation
test, not just "tenantId is passed to the repository call".
`RatingScaleService.test.ts` correctly proves sub-config mutation is
rejected once a version is ARCHIVED, not just that the ARCHIVE transition
itself works.

---

## Findings, ranked by severity

### HIGH — QA-01: ActionPlanService's CONTROL/KRI cross-entity validation branches were never exercised by any test

**Module:** ActionPlanService (`src/services/ActionPlanService.ts`)

`assertSourceExists`/`assertLinkTargetExists` branch on `sourceType`/
`resourceType` to call `RiskRepository`, `ControlRepository`, or
`KriRepository` respectively. Before this review, `ActionPlanService.test.ts`'s
`fakeControlRepository()`/`fakeKriRepository()` **always returned `null`
from `getById`, unconditionally** — so every test that needed a source/link
to actually resolve used `sourceType: "RISK"` / `resourceType: "RISK"`.
No test ever created an action plan with `sourceType: "CONTROL"` or
`"KRI"` and a *valid* id, and no test ever asserted the "does not exist"
rejection for those two branches either — only for RISK.

**Concrete failure scenario:** the four branches
(`RISK`/`CONTROL`/`KRI` in `assertSourceExists`, plus `ANOMALY` in
`assertLinkTargetExists`) are positional-constructor-argument dependent
(`risks, controls, kris, anomalies` passed in that order from
`server.ts`). A wiring bug that swaps `controls`/`kris` when constructing
`ActionPlanService` in `server.ts`, or a future refactor that breaks the
`else if` chain for one branch, would make every CONTROL- or KRI-sourced
action plan either wrongly accept a foreign-tenant id or wrongly reject a
valid one — and the existing suite would stay green throughout, because
it never calls those branches at all.

**Fix direction:** done in this pass — `fakeControlRepository`/
`fakeKriRepository` in the test file now take a list (mirroring
`fakeRiskRepository`) and four new tests cover the CONTROL/KRI accept +
reject paths for `create()`. `setLinks()`'s `ANOMALY` resourceType branch
is still untested; the same pattern (parameterize `fakeAnomalyRepository`,
add two tests) is a 10-minute follow-up.

---

### HIGH — QA-02: No test proves ActionPlanService.list()/dashboard() actually excludes another tenant's action plans

**Module:** ActionPlanService

Before this review, every test in `ActionPlanService.test.ts` used a
single tenant (`"tenant-1"`). `ActionPlanRepository.list()`'s tenant
filter was only ever implicitly relied upon (it happens to be correct in
the in-memory fake), never actually exercised with two tenants' rows
sharing one repository instance and asserted leak-free — unlike
`RiskOwnershipService.test.ts`, `UserService.test.ts`, and
`CartographyService.test.ts`, which all do this correctly for their own
modules.

**Concrete failure scenario:** `ActionPlan` carries `responsibleUserId`
and `title`/`description`, which can contain free-text about an
individual's performance ("Late again on KYC remediation — 3rd
occurrence"). A regression that dropped `actor.tenantId` from the
`this.actions.list(...)` call in `ActionPlanService.list`/`dashboard`
(e.g. during a refactor to add a new filter) would leak one tenant's
action-plan text and assignee identities into another tenant's dashboard,
and no test in this file would fail.

**Fix direction:** done in this pass — added
`"never leaks another tenant's action plans into the dashboard"`, seeding
one shared `ActionPlanRepository` instance with a `tenant-1` and a
`tenant-2` action plan and asserting `dashboard(tenant-1 actor)` returns
only the `tenant-1` row.

---

### MEDIUM-HIGH — QA-03: RiskService.escalate() has no maker-checker guard, unlike every other terminal/attestation action in this batch

**Module:** RiskService (`escalate`/`assignSuperiorOwner`, ACT-122/125)

The dispatch brief explicitly names "RiskOwnership escalate" alongside
RiskEvaluation validate/reject and ActionPlan close as a module expected
to have a maker-checker rule. `assignSuperiorOwner` only blocks
`superiorOwnerId === before.ownerId` (owner and superior can't be the
same person) — it does **not** check `superiorOwnerId === actor.userId`.
`escalate()` itself has no check that `actor.userId` differs from the
risk's `ownerId` or `superiorOwnerId` at all.

**Concrete failure scenario:** any actor holding `risk.escalate` (not
necessarily the risk's owner) can call `assignSuperiorOwner(risk,
actor.userId)` — allowed, since the only guard compares against
`ownerId`, not against the caller — and then call `escalate(risk,
reason)`, producing an append-only `RiskEscalation` row and an audit
event that reads as "escalated to superior owner X" where X is the same
person who filed the escalation. `RiskService.test.ts` has no test
either confirming this is intended (e.g. "an admin filing on behalf of an
absent owner may name themselves") or rejecting it — the behavior is
simply undefined and unasserted either way.

**Fix direction:** either (a) add
`if (actor.userId === risk.superiorOwnerId) throw ForbiddenError(...)` in
`escalate()`, mirroring the evaluator/validator and
creator/closer checks elsewhere in this batch, or (b) if self-escalation
is intentional (e.g. for a solo-owner risk with no N+1 yet assigned), add
a regression test that states that explicitly so the next reader doesn't
have to re-derive the intent from the code.

---

### MEDIUM — QA-04: RiskAppetiteService's in-memory `upsert()` test double diverges from PostgresRiskAppetiteRepository's real conflict semantics after an archive

**Module:** RiskAppetiteService / its test double

`PostgresRiskAppetiteRepository.upsert` relies on a **partial** unique
index — `ON CONFLICT (tenant_id, sub_category, (COALESCE(entity, ''))) WHERE deleted_at IS NULL`
— so calling `setThreshold()` again for a `(subCategory, entity)` pair
whose only existing row is soft-deleted correctly **inserts a new row**
(the old archived row stays archived, untouched, with its own id).

The in-memory test double's `upsert()` does not replicate this: it looks
up the existing row by natural key via a plain `Map` (`byKey`) with **no
`deletedAt` filter**, so calling `setThreshold()` again after `archive()`
for the same key **reuses the archived row's id and silently clears
`deletedAt`** — i.e. the fake resurrects a soft-deleted row that the real
database would never resurrect.

**Concrete failure scenario:** no test in `RiskAppetiteService.test.ts`
exercises "archive, then set the same threshold key again" at all, so
this divergence has never actually been triggered — but it means the
existing suite provides **zero protection** against a real regression in
this area (e.g. a future migration that drops the `WHERE deleted_at IS
NULL` clause from the partial index, which would make Postgres start
behaving like the current, wrong fake). Per this codebase's own QA
discipline (`CLAUDE.md` §"Adding a new domain module" + this agent's
system prompt §24): in-memory tests are not proof Postgres works
correctly, and here the fake actively hides a real semantic difference
rather than merely being silent about it.

**Fix direction:** fix the fake's `upsert()` to only match an existing
row via `byKey` when that row is not soft-deleted (mirroring the partial
index), then add a test: "archiving a threshold and calling
`setThreshold` again for the same (subCategory, entity) creates a new,
independent row — the archived one is untouched." Not implemented in
this pass (touches the shared test-double helper and the fix itself
needs to be verified against the real partial-index DDL in
`database/postgresql/migrations/`, which is more than a "obvious,
low-risk" change per the dispatch's constraints).

---

### MEDIUM — QA-05: KriMeasureService's threshold-breach Notifier is never tested for a *transition* vs. a repeated breach

**Module:** KriMeasureService (ACT-135)

`record()` calls `computeKriStatus(kri, measure.value)` fresh on every
call and notifies whenever the result is `ORANGE`/`ROUGE` — there is no
state carried between calls, so **every single measurement** that lands
in a breach band re-fires the notification, including two consecutive
measurements that are both `ROUGE`. The existing tests
(`"notifies once when the recorded value breaches the ORANGE threshold"`,
etc.) only ever record **one** measurement before asserting the
notifier's message count, so this behavior — repeat-notify vs.
notify-only-on-transition — is neither asserted nor documented as an
intentional design choice.

**Concrete failure scenario:** a KRI recorded daily that stays `ROUGE`
for two weeks straight sends fourteen identical alert broadcasts through
`Notifier` — plausible alert fatigue, and nothing in the test suite
would fail whether that's fixed (debounced) or made worse (e.g. someone
"optimizes" by removing the check and always notifying).

**Fix direction:** add a test recording two consecutive `ROUGE` values
and asserting the current (repeat-every-time) behavior explicitly, so a
deliberate future debounce is a visible before/after in the diff rather
than a silent behavior change. Left as a recommendation, not added here,
since it requires a genuine design decision (should it debounce?) that
this agent cannot make on Risk/Product's behalf.

---

### MEDIUM — QA-06: Permission-denial tests are incomplete for several `*.update`/`*.validate` permissions

**Modules:** RiskEvaluationService, ActionPlanService

Cross-checking every permission string touched by these 9 modules
against `domain/permissions.ts`'s `ALL_PERMISSIONS` union:

- `riskevaluation.update` — no test asserts `ForbiddenError` for a caller
  missing it calling `recordInherentScoring`/`recordMasteryAssessment`/
  `recordResidualScoring`. All such tests use `evaluatorActor`, who
  *has* `riskevaluation.update`.
- `riskevaluation.validate` — the two self-action tests
  (`evaluatorActor` validating/rejecting their own evaluation) throw
  `ForbiddenError` for the *self-action* reason, not because the actor
  lacks the permission (`evaluatorActor` doesn't hold
  `riskevaluation.validate` at all in the fixture, but the self-check
  fires first in the code path exercised, so the "missing permission"
  branch specifically is never the asserted reason). No test uses a
  *different* actor who simply lacks `riskevaluation.validate` outright.
- `actionplan.update` — `updateProgress`, `start`, `setLinks`, and
  `escalateIfOverdue` all call `requirePermission(actor,
  "actionplan.update")` first, but no test in `ActionPlanService.test.ts`
  asserts `ForbiddenError` for a caller missing it on any of the four
  (only `actionplan.create`, `actionplan.validate`, and `actionplan.read`
  are checked this way).

**Concrete failure scenario:** each of these is a one-line
`requirePermission(...)` call that a future edit (e.g. someone
copy-pastes a sibling method and forgets to update the permission
string, or accidentally checks `riskevaluation.read` instead of
`.update`) could silently weaken, and none of the tests above would
catch it.

**Fix direction:** for each permission listed, add one `it()` using an
actor whose `roles` includes every *other* relevant permission except
the one under test, asserting `ForbiddenError` — the same pattern
already used correctly for `kri.create`/`kri.delete` in
`KriService.test.ts`/`KriMeasureService.test.ts`. Not added in this pass
to keep the diff focused on the higher-severity findings above.

---

### MEDIUM — QA-07: Missing two-tenant leakage tests for four modules (KriMeasureService partially fixed in this pass, others open)

**Modules:** KpiService/KpiMeasureService, RatingScaleService,
ActionPlanService (fixed, QA-02)

Consistent gap across the batch: several modules' tests exclusively use
a single tenant (`"tenant-1"`) and rely on the fact that the in-memory
fake's `list()`/`getById()` *happens* to filter by the `tenantId`
argument, without ever actually populating a second tenant's data in the
same repository instance to prove the filter holds. `KpiService.test.ts`,
`KpiMeasureService.test.ts`, and `RatingScaleService.test.ts` all fall
into this category (none of the modules above them in this list did).
`KriMeasureService.test.ts`'s gap is closed in this pass (see below).

**Concrete failure scenario:** same shape as QA-02 — a dropped
`tenantId` argument in a future edit to any of these three services'
`list`/`get` methods would not be caught by their own test suites.

**Fix direction:** applied to `KriMeasureService.test.ts` in this pass —
new test `"never mixes another tenant's measures into this tenant's
history, even with the same kriId and a shared repository"`, seeding a
`kri-1` for both `tenant-1` and `tenant-2` against one shared
`KriMeasureRepository` instance. The same ~10-line pattern applies
directly to `KpiService`/`KpiMeasureService`/`RatingScaleService` and is
recommended as a fast follow-up, not attempted here to keep this pass
scoped to the four modules with the most severe individual findings.

---

### MEDIUM — QA-08: UserService.update() has no guard (or test) for editing a suspended user's profile

**Module:** UserService

`suspend()` explicitly rejects a second `suspend()` call
(`"User is already suspended"`), but `update()` has no equivalent check:
it calls `get(actor, id)` → `users.getById(...)`, which (correctly,
matching `PostgresUserRepository.getById`, which does **not** filter
`deleted_at`) returns a suspended user just like an active one. So a
caller holding `user.update` can successfully change `displayName` on an
already-suspended account, and nothing in `UserService.test.ts` asserts
either that this should be blocked or that it's intentionally allowed
(e.g. for record-keeping/cleanup after suspension).

**Concrete failure scenario:** none of this is exploitable for
privilege escalation (a suspended user still can't authenticate — see
the class doc comment on why `suspend()`'s soft-delete alone is
sufficient for session revocation), but it is an unasserted, silent gap
in an otherwise carefully-guarded terminal-state module (this is the
same service that correctly gates `suspend`/`reactivate` behind their
own permissions and blocks self-suspension) — exactly the kind of
inconsistency a second pair of eyes is meant to catch.

**Fix direction:** either add `if (before.deletedAt) throw new
ValidationError("Cannot edit a suspended user's profile — reactivate
first")` to `update()`, or add a test explicitly documenting that
editing a suspended user's profile is allowed by design. Not fixed here
— this is a product/policy call, not an obvious bug fix.

---

### LOW — QA-09: KriService has no direct test that update()/measure recording is rejected after disable()

**Module:** KriService / KriMeasureService

`KriService.disable()` (ACT-132) is tested for making the KRI
unreachable via `get()` (`NotFoundError`), but there is no direct test
that `KriService.update()` or `KriMeasureService.record()` is also
rejected against a disabled KRI. Verified this *does* work correctly
today — both go through `getById`, which filters `deleted_at IS NULL` in
both the fake and `PostgresKriRepository` — but it's an inferred
guarantee, not an asserted one; a future change to either `getById`
implementation (e.g. adding an `includeDisabled` option analogous to
`RatingScaleRepository.list`) could silently reopen a disabled KRI to
mutation with no red test anywhere.

**Fix direction:** two small `it()`s — disable a KRI, then assert
`update()` throws `NotFoundError` and `KriMeasureService.record()` throws
`ValidationError`. Not added in this pass (Low severity, no reachable
bug today).

---

### LOW — QA-10: RiskEvaluationService's tenant-isolation tests are indirect (via RiskRepository), not a direct two-tenant test on RiskEvaluationRepository itself

**Module:** RiskEvaluationService

`"scopes listForRisk by tenant"` passes today only because the fixture's
single `risk` doesn't exist for `tenant-2` in `RiskRepository`, so the
tenant check never even reaches `RiskEvaluationRepository.listForRisk` —
unlike `RiskOwnershipService`/`CartographyService`, which populate a
second tenant's *evaluation* rows and assert they don't leak. This is a
weaker test than it looks (it proves the upstream `Risk` guard works, not
that `RiskEvaluationRepository`'s own tenant filter does).

**Fix direction:** add a variant where the same `riskId` string exists as
two separate `Risk` rows under `tenant-1` and `tenant-2`, with
evaluations recorded against each, and assert `listForRisk(tenant-1
actor, riskId)` never returns `tenant-2`'s rows. Not added in this pass
(Low severity — the current test still provides real, if narrower,
protection, and CartographyService already covers the same
`RiskEvaluationRepository.listForRisk` code path with a genuine two-tenant
test).

---

## Regression tests added in this pass

All added as new `it()` blocks in existing files, no restructuring:

- `backend/test/ActionPlanService.test.ts`:
  - Parameterized `fakeControlRepository`/`fakeKriRepository` (previously
    hardcoded to always return `null`) and extended `buildService` to
    accept `controls`/`kris` overrides.
  - Added `control()`/`kri()` fixtures.
  - 4 new tests: CONTROL/KRI sourceId accept + reject (QA-01).
  - 1 new test: tenant isolation on `dashboard()` (QA-02).
- `backend/test/KriMeasureService.test.ts`:
  - 1 new test: tenant isolation on `listForKri()` with a shared
    repository instance (QA-07, KriMeasureService slice).

## Verification

```
cd backend
npm run typecheck   # clean, no errors
npm test            # 25 files, 274 passed (268 baseline + 6 new), 0 failed
```

## Items explicitly deferred to other agents (per this agent's scope)

- QA-03 (RiskService.escalate maker-checker) and QA-08
  (UserService.update on a suspended user) both hinge on a product/policy
  decision, not just a test gap — flagged for Architect/Risk Manager per
  `.claude/agent-context/ACTION_ITEMS.md`'s existing open item on scoring
  methodology validation.
- This review is QA-only: it does not supersede or substitute for the
  still-open `@security` re-review or `@audit` append-only/soft-delete/
  tenant_id compliance pass tracked in
  `.claude/agent-context/ACTION_ITEMS.md`. Any finding above that reads as
  security-relevant (QA-01, QA-02, QA-03) should also be cross-checked by
  `@security`, not treated as closed by this pass alone.
