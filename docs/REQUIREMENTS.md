# Requirements traceability

Every requirement in the brief, mapped to the task that satisfies it and the test that proves it. Graders read submissions against their own rubric. This matrix is how we make sure no row is quietly missing.

Walk this end to end as task S8-T03 before submitting. Any row without a ticked task and a named passing test either gets built or gets an honest entry in the Cuts section of `REPORT.md`. Silently missing is the only unacceptable state.

## Core requirements, Section 3

| Ref | Requirement | Tasks | Proof |
| --- | --- | --- | --- |
| 3.1a | Accept a goal plus a target as input | S4-T07 | `src/cli/discoverCommand.test.ts`, the request is a file and an input is never an argument. `tests/e2e/discover.cli.test.ts` runs the bin. |
| 3.1b | LLM driven observe, decide, act loop against a live surface | S4-T04, S4-T08 | `src/discovery/agentLoop.test.ts`, and the live run at `evidence/discovery/run_84705a0a`. |
| 3.1c | Stopping conditions, max steps, timeout, dead end | S4-T04 | `src/discovery/agentLoop.test.ts`, one case per stopping condition, with `NoProgress` as the dead end. |
| 3.1d | Real UI interaction, click, type, navigate, read | S1-T08, S1-T10 | `tests/integration/webSurfaceDriver.test.ts` and `tests/integration/replay.readSavingsBalance.test.ts` against the running app. |
| 3.1e | Approach that works without a clean DOM | S0-T03, S1-T08, S2-T01 | `src/core/surfaceModel/derivedLabel.test.ts`, the member ID input with no accessible name, and `tests/integration/webSurfaceDriver.test.ts` resolving it on the real page. |
| 3.2a | Typed, serializable artifact emitted after success | S1-T02, S4-T06 | `src/core/capability/load.test.ts` and `src/discovery/generalizer.test.ts` against a committed fixture. |
| 3.2b | Ordered steps and actions | S1-T02 | `src/core/capability/load.test.ts`. |
| 3.2c | How each target is identified, with robustness reasoning | S1-T01, S4-T05 | `src/core/locator/derive.test.ts` and `src/core/locator/resolve.test.ts`, with the reasoning in `docs/ARCHITECTURE.md` section 5 and `REPORT.md` section 3. |
| 3.2d | Typed input parameters | S1-T02, S1-T03 | `src/core/capability/inputs.test.ts`. |
| 3.2e | Typed outputs and their shape | S1-T02, S1-T10 | `src/core/outcome/money.test.ts` and `tests/integration/replay.readSavingsBalance.test.ts`. |
| 3.2f | Checkpoint or success condition | S1-T04, S1-T10 | `src/core/outcome/evaluate.test.ts` and the `CheckpointFailed` rows of `tests/integration/resultMatrix.test.ts`. |
| 3.2g | Versioned | S1-T02, S4-T09 | `src/core/capability/load.test.ts` refuses an unsupported `schemaVersion`, `src/discovery/outcomeProbe.test.ts` applies the minor bump. |
| 3.2h | Reviewable by human and by agent | S7-T02 | `src/core/capability/publish.test.ts`, the tool definition and the review sheet, and the committed schema at `docs/capability.schema.json` which that file checks for drift. |
| 3.3a | Replay without the LLM in the decision loop | S1-T10, S6-T03 | `src/replay/imports.test.ts` walks the graph transitively. Mutation checked by adding a model import three levels deep. |
| 3.3b | Stable element targeting on replay | S1-T01, S1-T08 | `src/core/locator/resolve.test.ts`, and the `relabel` row of `tests/integration/resultMatrix.test.ts`. |
| 3.3c | Verify the checkpoint | S1-T10 | `tests/integration/resultMatrix.test.ts`, the `duplicateIds` row. |
| 3.3d | Return declared outputs to the caller | S1-T10, S6-T03 | `src/core/outcome/result.test.ts` and `src/cli/replayCommand.test.ts`. |
| 3.3e | Expected business outcomes distinguished | S4-T01, S4-T09, S4-T10 | `tests/integration/resultMatrix.test.ts`, the unknown member row and the below minimum row, both `business_outcome` well inside the step timeout. |
| 3.3f | Recoverable conditions handled | S6-T02 | `src/replay/executor.test.ts` for the backoff bound on a test clock, `tests/integration/resultMatrix.test.ts` for the recovery end to end. Other recoveries are cut, see `REPORT.md` section 7. |
| 3.3g | Hard failures stop with a debuggable error | S1-T03, S6-T04 | `src/core/outcome/result.test.ts` requires `expected` and `observed`, and the failure rows of `tests/integration/resultMatrix.test.ts` carry them. |
| 3.3h | Structured result contract | S1-T03, S6-T03 | `src/core/outcome/result.test.ts`, all four result shapes carrying `recoveries`, `interventions` and `drift`. |
| 3.4a | Configurable allowlist, domains, routes, action types | S1-T05 | `src/core/policy/allowlist.test.ts` and `src/core/policy/authorize.test.ts`. |
| 3.4b | Agent cannot act outside the allowlist | S1-T09 | `src/surface/guardedSurface.test.ts`, `src/replay/imports.test.ts`, and `tests/integration/profileGuard.test.ts` for the per step network refusal. |
| 3.4c | Safe versus risky, handled conservatively | S3-T04, S5-T04, S5-T06 | `src/core/policy/profile.test.ts` for effect and idempotency, and the four write rows of `tests/integration/resultMatrix.test.ts`, including an approved write running unattended and a 503 on the submit posting once. |
| 3.4d | Never persist secrets or raw sensitive data | S3-T02, S3-T03, S3-T05, S4-T07 | `src/core/redaction/redactor.test.ts`, `src/core/redaction/resultProjection.test.ts`, `src/evidence/capabilityStore.test.ts` for the writer refusal, and `src/evidence/scanner.test.ts` which scans the committed directories with canaries. |
| 3.5a | Structured log of what the agent did and why | S3-T03, S4-T06 | `src/evidence/sink.test.ts` for the redacting logger, and `src/discovery/trace.test.ts` for the trace keeping observation hashes, decisions and authorization verdicts. The model's own reasoning is in the redacted `transcript.jsonl`, not the trace, which records the action it chose rather than the words it chose it in. |
| 3.5b | A richer signal on failure | S3-T03 | `src/evidence/interventionCapture.test.ts` and `tests/integration/screenshotMask.test.ts`, which is a pixel test inside the content frame. |
| 3.6a | Detect a stuck or blocked state | S4-T04, S5-T01 | `src/discovery/agentLoop.test.ts` for `NoProgress` and `ModelRequested`, and `src/escalation/unclassified.test.ts` for the dialog no rule claims, which is what raises `UnclassifiedCondition`. |
| 3.6b | Raise an intervention with full context | S5-T01 | `src/escalation/intervention.test.ts`, every required field present and none of them carrying a value. |
| 3.6c | Human operates the same live session | S5-T02, S5-T03 | `tests/integration/humanInput.test.ts`, a forwarded click lands on the element under the point and changes the same session. |
| 3.6d | Hand control back and resume | S5-T04 | `src/replay/resume.test.ts`, one case per revalidation branch including the approval grant. |
| 3.6e | Preserve context and evidence across the handoff | S3-T03, S5-T07 | `tests/integration/handoff.test.ts`, and the committed runs at `evidence/replay/escalated` and `evidence/discovery/run_e5b46f88`. |
| 3.6f | Record what the human did | S5-T03 | `tests/integration/humanInput.test.ts` records a keystroke with no element and no value, and `tests/integration/handoff.test.ts` asserts the manifest lists `humanActions.jsonl` as its own kind. |
| 3.6g | Pause, cede, resume on the same session, with known control | S1-T07, S5-T01 | `src/control/controlToken.test.ts` for rotation and `src/control/controlPlane.test.ts` for the reducer matrix. |
| 3.7a | Surface abstraction extending to legacy web and desktop | S1-T01, S3-T01, S7-T01 | `tests/contract/surfaceDriver.fake.contract.test.ts` and `tests/integration/surfaceDriver.web.contract.test.ts` run one suite against both drivers, and `src/surface/desktop/desktopSurfaceDriver.test.ts` holds the stub to the same interface. |
| 3.7b | Multitenant reuse without per tenant rebuild | none, designed | Not built. Overlay schema in `docs/ARTIFACT_SCHEMA.md` section 5, ADR 0015, `REPORT.md` section 4 and the first Cuts entry. The brief permits design only. |
| 3.7c | Detect and manage per tenant drift | S1-T01, S6-T04 | `tests/integration/resultMatrix.test.ts` records degradation under the `relabel` fault. Management is designed, not built, and is in Cuts. |

## Deliverables, Section 6

| Ref | Requirement | Tasks | Where it is |
| --- | --- | --- | --- |
| 6.1a | Public repo with `/README.md` | S8-T01 | `README.md` |
| 6.1b | Setup, run, keys, config, how to run without live services | S8-T01 | `README.md`, every key in `.env.example` with the value to use, and the whole thread offline from `tests/fixtures/cassettes/discovery.readSavingsBalance.json` |
| 6.1c | Exact demo commands for discover then replay | S8-T01, S8-T04 | `README.md`, each command run on PowerShell from a fresh clone installed with `npm ci` before it was written down |
| 6.2 | `/REPORT.md` with the seven exact headings | S8-T02 | `REPORT.md`, headings checked against the brief character for character |
| 6.3a | `/evidence/` with an example artifact | S4-T08 | `evidence/discovery/run_84705a0a/artifact.json`, and the same artifact in `capabilities/` |
| 6.3b | Logs from a discovery run | S4-T08 | `evidence/discovery/run_84705a0a/`, log, trace and redacted transcript |
| 6.3c | Logs from a replay run | S4-T10 | `evidence/replay/success/` |
| 6.3d | At least one replay hitting an error or exceptional state | S4-T10, S5-T07, S8-T03 | `evidence/replay/businessOutcome/` for a not found result, and `evidence/replay/escalated/` for an injected dialog the run refused to click through |
| 6.3e | Optional screen recording | not planned | Optional in the brief. Cut. |

## Evaluation criteria, Section 7

Weighted in the brief's stated order.

| Criterion | Where it is earned | Risk if rushed |
| --- | --- | --- |
| System design | `docs/ARTIFACT_SCHEMA.md`, `docs/ARCHITECTURE.md`, `REPORT.md` sections 1 and 2 | Highest weight in the brief. Do not compress the schema work |
| Correctness of the core loop | Gate S1-T10, Gate S4-T10 | Without a real live run the submission fails its one stated hard requirement |
| Robustness and error handling | S4-T01, S6-T02, S6-T04 | The matrix is the best evidence of this |
| Human in the loop escalation | Slice 5 | Explicitly called out as the thing candidates fake. S5-T03 is the real control transfer |
| Generalisation to the real environment | S7-T01, `REPORT.md` section 4 | Design only for 3.7b and 3.7c, which the brief permits. The report has to carry it |
| Safety and data handling | S1-T05, S3-T02, S3-T04, S3-T05 | The permanent evidence scanner is cheap and highly visible |
| Code quality | Whole project, TDD discipline | The contract suite and the import graph tests carry this |
| Communication | `REPORT.md` | One to three pages. A long report scores worse, not better |

## Explicit non goals

The brief states these are not rewarded. Confirmed at S8-T03, none crept in.

* Queues, workers, clusters, multitenant plumbing. No queue, worker or cluster library appears anywhere. One tenant, one profile.
* A database. The filesystem is the only store.
* A real time co browsing operator console. The console polls a masked screenshot and forwards one input at a time, which `REPORT.md` section 7 states plainly.
* An implemented desktop driver. `src/surface/desktop` is a stub that satisfies the interface and rejects per verb.
* Framework breadth or name dropping. Seven runtime dependencies. The Anthropic SDK, Playwright, Zod, YAML, Fastify for the console, and Express with EJS for the fixture application only.
* Feature count.

## The walk

Done at S8-T03 on 2026-09-19. Every task referenced by this file is ticked in `docs/PLAN.md`, checked by script rather than by eye. Every proof above names a file that exists and a test that passes. The suites were 525 unit across 68 files, 96 integration across 21 files and 5 end to end across 2 files, green, and green again from a clone of the remote installed with `npm ci`. The two rows that are not built, 3.7b and 3.7c in part, say so here and appear in the Cuts section of `REPORT.md`.
