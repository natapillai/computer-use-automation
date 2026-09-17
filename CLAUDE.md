# CLAUDE.md

Operating manual for this repository. Read this fully at the start of every session, then read `PROGRESS.md` to find out where we are.

## 1. What we are building

A computer use automation system for back office banking applications that have no API.

The through line, and the sentence every design decision must serve:

> The model discovers. The artifact becomes a reusable capability. Deterministic replay is how the AI agent invokes it in production.

Four moving parts.

1. **Discovery.** An LLM driven observe, decide, act loop drives a live application surface until a natural language goal is met.
2. **Capability artifact.** The successful run is generalized into a typed, versioned, parameterized artifact that is decoupled from the model transcript.
3. **Deterministic replay.** The artifact is re executed with no model in the decision loop, returning typed outputs, classifying runtime error states, and verifying checkpoints.
4. **Escalation.** When the system cannot safely proceed it hands the *same live session* to a human operator, records what they did, and takes control back.

This is a take home assessment. The full brief is at `docs/ASSIGNMENT.md` and is the final authority. When this file and the brief disagree, the brief wins and you should flag the conflict.

That file is gitignored and stays local. The brief is interface.ai material and the submission repository is public, so it is never committed. A cloner will not find it and that is deliberate.

## 2. Non negotiables

These are not preferences. Violating any of them is a defect.

1. **Test driven development.** No production code is written before a failing test exists for it. Red, green, refactor, one behaviour at a time. The full rules are in `docs/TESTING.md`. If you are about to write an implementation file and no test currently fails because of its absence, stop and write the test.
2. **The plan is the checklist.** `docs/PLAN.md` holds every task with a stable ID and acceptance criteria. `PROGRESS.md` holds current state. You tick boxes only when the acceptance criteria are met and the suite is green. Boxes tick per task. `PROGRESS.md` updates once per slice, when the slice closes or its forecast changes.
3. **Policy is a single choke point.** Every action reaching a surface passes through `PolicyEngine.authorize()`. The agent loop never calls a surface driver directly. Fail closed.
4. **No secrets, no raw PII.** Nothing sensitive is written to artifacts, logs, evidence, screenshots, or model prompts. Redaction happens at the sink, not at the call site. See `docs/SAFETY.md`.
5. **Locators are derived, never invented.** The model selects an element by reference. The recorder derives the locator bundle from the real element. The model never writes a CSS selector.
6. **Business outcomes are not failures.** "No such member" is a legitimate typed result. Conflating the two is the single most penalised mistake in this brief. See `docs/ERROR_TAXONOMY.md`.
7. **Deterministic tests.** No network in unit or integration tests. No real model calls in the test suite. No `sleep` based waits anywhere, in tests or in production code.
8. **Decisions get recorded, in proportion.** A new ADR only when a decision supersedes an existing ADR or changes an answer in `REPORT.md`. Anything smaller is recorded in the commit body.
9. **Never read or print credential files.** Not `.npmrc`, `.env`, cloud credentials or key files, not even to check one setting. Use targeted commands such as `npm config get strict-ssl` that return a single value.
10. **A verification runs bare.** Any command whose exit code decides something runs on its own, with its exit code checked directly. Never pipe it into `head`, `tail`, `grep` or anything else that replaces the exit code, and never suppress its stderr. A check whose failure mode is silence is worse than no check, so a check that cannot fail loudly does not ship.

## 3. Stack

Decided already. Do not re litigate without an ADR.

| Concern | Choice |
| --- | --- |
| Language | TypeScript, strict mode, Node 22 LTS, ESM |
| Runtime validation and types | Zod as the single source of truth, types inferred from schemas |
| Browser automation | Playwright, Chromium, driven primarily through the accessibility tree |
| Model | Anthropic Claude Sonnet 5 via the official SDK, tool use, model id from `ANTHROPIC_MODEL`, no sampling parameters |
| Test runner | Vitest |
| Target application | A local legacy styled banking app we build, see `docs/TARGET_APP.md` |
| Operator console | Fastify plus one static HTML page, no frontend framework |
| Logging | Structured JSON lines through a redacting logger |
| Config | Zod validated env plus `policy/allowlist.yaml` |

## 4. Repository map

```
CLAUDE.md              this file
README.md              deliverable, setup and demo path, written in Slice 8
REPORT.md              deliverable, the seven required headings, written in Slice 8
PROGRESS.md            living state, updated once per slice
policy/allowlist.yaml  the safety allowlist
profiles/              app profiles, conditions and sensitivity true of a whole application
requests/              discovery requests, a goal and input specs that never hold a value
capabilities/          saved capability artifacts, one file per version
evidence/              committed run evidence, deliverable
docs/                  design documents, read on demand
src/
  core/                pure domain, zero IO
    surfaceModel/      UINode, Observation, geometry, the action vocabulary
    capability/        artifact schema, loader, templating
    locator/           locator bundle types, derivation, ranking, resolution policy
    outcome/           result contract, error taxonomy, condition detectors
    policy/            policy engine, allowlist, risk classification
    redaction/         redactor, sensitivity propagation
  surface/             perception and action
    types.ts           the SurfaceDriver interface only, the central seam
    web/               Playwright driver
    fake/              in memory driver for fast tests
    desktop/           documented stub, proves the seam
  discovery/           agent loop, model client, prompts, recorder, generalizer
  replay/              deterministic executor, waits, checkpoints, classifier
  control/             session broker, control tokens, control state machine
  escalation/          intervention store, operator HTTP API, mock console
  evidence/            structured logger, artifact store, screenshot store
  cli/                 discover, review and replay commands
  runtime/             Clock, IdProvider, env config, the one place a raw timer is allowed
apps/target/           the local legacy banking app, one tenant
tests/
  contract/            one suite run against every SurfaceDriver implementation
  integration/         replay and escalation against the real local app
  e2e/                 the full demo thread with a recorded model transcript
  fixtures/            sample artifacts, cassettes, snapshots
```

Unit tests are colocated as `*.test.ts` beside the file they cover. Everything else lives under `tests/`.

## 5. Commands

Each script lands in `package.json` with the task that makes it work, as listed in S0-T01, and stays working from then on. A script defined before it works is a broken script.

```
npm run test              vitest, unit and contract, the fast loop
npm run test:watch        the TDD loop
npm run test:integration  needs the target app, starts it automatically
npm run test:e2e          full thread with the recorded model transcript
npm run typecheck         tsc --noEmit
npm run target            start the local banking app on :4010
npm run discover          CLI, real model, writes a capability and evidence
npm run review            CLI, negative probe review and approval
npm run replay            CLI, deterministic, hosts the operator console on :4020 while it runs
```

## 6. The working loop

For every task in `docs/PLAN.md`:

1. Read the task ID, its acceptance criteria, and its required tests.
2. Read any design doc the task references. Do not guess at a design that is already written down.
3. Write the failing test. Run it. Confirm it fails for the intended reason and not for a typo or an import error.
4. Write the smallest implementation that passes.
5. Refactor with the test green.
6. Run `npm run test` and `npm run typecheck`.
7. Tick the box in `docs/PLAN.md` and commit with the task ID in the message, for example `S4-T05 derive locator bundles from AX nodes`. Update `PROGRESS.md` when the slice closes.

If a task turns out to be wrong or underspecified, do not silently improvise. Update `docs/PLAN.md`, and write an ADR only if the change supersedes an existing ADR or changes an answer in `REPORT.md`.

## 7. Definition of done, per task

* A test exists that would fail if the behaviour regressed.
* Types are explicit at module boundaries. No `any`. No unchecked casts.
* Errors are typed values in the result contract, not thrown strings.
* Anything user facing or persisted has passed through the redactor.
* `docs/PLAN.md` reflects reality. `PROGRESS.md` does at the end of each slice.

## 8. Definition of done, whole project

The brief is graded against a rubric. `docs/REQUIREMENTS.md` maps every requirement in the brief to the task that satisfies it and the test that proves it. Before declaring the project complete, walk that matrix and confirm every row has a task ticked and a passing test named. Any row you decide to cut moves to the Cuts section of `REPORT.md` with a reason.

## 9. Scope discipline

The brief explicitly does not reward breadth, framework name dropping, or scaling infrastructure. It rewards a complete vertical slice through every core requirement.

Build none of the following. No queues, no workers, no database beyond the filesystem, no auth system, no Docker orchestration, no React, no real time co browsing console, no desktop automation implementation, no multitenant plumbing. Where the brief permits a stub, stub it at a clean seam and document the seam.

If you find yourself building infrastructure, stop and re read this section.

## 10. Writing style for all prose in this repo

This applies to every document you write or edit. `README.md`, `REPORT.md`, everything under `docs/`, code comments, log messages, and commit messages.

**Never use an em dash.** Not once, anywhere, in any file. The same goes for en dashes and for hyphens used as connectors mid sentence. If a sentence feels like it needs one, split it into two sentences. This is the most common thing to get wrong when generating documentation, so check for it before you consider a document finished.

The rest of the rules.

* No colons or semicolons dropped mid sentence as a rhetorical device. Colons in code, YAML, JSON, and markdown tables are fine because they are syntax.
* Use `*` for bullet markers, never `-`. Task list items are `* [ ]`.
* Short, direct sentences. Prefer two sentences over one sentence joined by a connector.
* First person singular in `REPORT.md`, because a person is submitting it.
* No filler. `REPORT.md` is one to three pages and every paragraph must carry a decision or a trade off.

Before finishing any document, grep it for the em dash and the en dash characters and fix anything that turns up.

## 11. Git commits

### Attribution

Never add an AI attribution trailer to a commit. No `Co-Authored-By: Claude`, no `Generated with Claude Code`, no tool footer of any kind. The commits are mine and the brief's ground rules already say I own and can defend everything in the repository. A generated attribution line adds nothing and clutters the history a reviewer reads.

### Format

A commit that introduces a design decision, a new mechanism, or a safety property uses the full structure below. Every other commit is a subject line, a one line `Change`, and a `Tests` line naming the files. The full structure is the subject line, then a blank line, then five named sections in this order.

```
<TASK-ID> <imperative summary, under 72 characters>

Issue
What was wrong, missing, or unproven before this change.

Change
What this commit actually does. The mechanism, not a restatement of the summary.

Why
The reasoning, and the trade off if there was one. Name the alternative that lost.

Tests
Each test added or changed, and what it proves. Name the file.

Metrics
Any new counter, signal, threshold, or reported field introduced. Write "none" if there are none.
```

### Rules

* When the full structure applies, all five sections are present. `Metrics` saying `none` is correct. `Metrics` being absent is not, because then a reader cannot tell whether it was considered.
* The subject starts with the task ID from `docs/PLAN.md`, for example `S6-T02`. Chores with no task ID use `CHORE`.
* The subject is imperative mood. `add locator ambiguity rejection`, not `added` or `adds`.
* One task per commit. If the body has to describe two unrelated things, it is two commits.
* `Tests` names actual files. `added tests` is not an entry. `src/core/locator/resolve.test.ts covers ambiguity rejection under the unique match policy` is.
* `Why` is the section a reviewer reads in six months. Do not skip it because the change seems obvious today.
* The writing style rules in section 10 apply to the commit body. No em dashes.

### Example

```
S6-T02 add bounded TransientLoad recovery on idempotent steps

Issue
Replay treated a 503 as a hard failure. A transient load is routine on the target
surface and recoverable, so a capability that was working correctly reported as
broken.

Change
Adds a TransientLoad handler behind the condition classifier. It retries the step
with exponential backoff through Clock.delay, bounded at three attempts, and only
when the step is declared idempotent. Every invocation is appended to
result.recoveries, including on a run that succeeds.

Why
The brief separates recoverable conditions from hard failures, and a replay that
cannot absorb a transient load is not usable in production. Retries are restricted
to steps declared idempotent, because retrying a submit risks a double post. The
rejected alternative was a blanket retry on any failed step, which is simpler but
would make a write unsafe.

Tests
src/replay/recovery/transient.test.ts asserts backoff timing and the three attempt
bound using fake timers, and that a non idempotent step is never retried.
tests/integration/replay.faults.test.ts covers flaky503 end to end against the
target app and asserts the recovery appears in result.recoveries on a success.

Metrics
Adds recoveries[] to ReplayResult, reported on every result including success.
Adds RecoveryRecord with condition, strategy, attempt, and resolved.

```

## 12. Document index

Read these when the task references them.

| Document | What it settles |
| --- | --- |
| `docs/ASSIGNMENT.md` | The brief, verbatim, the final authority |
| `docs/PLAN.md` | Every task, its acceptance criteria, its tests, the checklist |
| `docs/REQUIREMENTS.md` | Traceability from brief requirement to task to test |
| `docs/ARCHITECTURE.md` | Components, seams, data flow, module boundaries |
| `docs/ARTIFACT_SCHEMA.md` | The capability schema and the reasoning behind each field |
| `docs/ERROR_TAXONOMY.md` | The result contract, failure classes, detectors, retries |
| `docs/ESCALATION.md` | Control transfer model, operator API, resume semantics |
| `docs/SAFETY.md` | Allowlist, risk classes, redaction, limits |
| `docs/TESTING.md` | TDD rules, the pyramid, fakes, cassettes, running the suite |
| `docs/TARGET_APP.md` | The local legacy app and its fault injection |
| `docs/EVIDENCE.md` | Exactly what must land in `/evidence/` and how |
| `docs/DECISIONS.md` | ADRs already made, plus the template for new ones |
