# Requirements traceability

Every requirement in the brief, mapped to the task that satisfies it and the test that proves it. Graders read submissions against their own rubric. This matrix is how we make sure no row is quietly missing.

Walk this end to end as task S8-T03 before submitting. Any row without a ticked task and a named passing test either gets built or gets an honest entry in the Cuts section of `REPORT.md`. Silently missing is the only unacceptable state.

## Core requirements, Section 3

| Ref | Requirement | Tasks | Proof |
| --- | --- | --- | --- |
| 3.1a | Accept a goal plus a target as input | S4-T07 | `discover` CLI, exercised by the cassette E2E in S4-T10 |
| 3.1b | LLM driven observe, decide, act loop against a live surface | S4-T04, S4-T08 | Agent loop unit tests, committed live run evidence |
| 3.1c | Stopping conditions, max steps, timeout, dead end | S4-T04 | One unit test per condition, with `NoProgress` as the dead end |
| 3.1d | Real UI interaction, click, type, navigate, read | S1-T08, S1-T10 | Gate S1-T10 against the running app |
| 3.1e | Approach that works without a clean DOM | S0-T03, S1-T08, S2-T01 | The member ID input resolves with no accessible name, and a live model reaches the balance |
| 3.2a | Typed, serializable artifact emitted after success | S1-T02, S4-T06 | Schema tests, generalizer fixture comparison |
| 3.2b | Ordered steps and actions | S1-T02 | Schema validation |
| 3.2c | How each target is identified, with robustness reasoning | S1-T01, S4-T05 | Ladder tests, derivation tests, `docs/ARCHITECTURE.md` section 5, `REPORT.md` section 3 |
| 3.2d | Typed input parameters | S1-T02, S1-T03 | `ParamSpec` validation tests |
| 3.2e | Typed outputs and their shape | S1-T02, S1-T10 | Output extraction and money typing tests |
| 3.2f | Checkpoint or success condition | S1-T04, S1-T10 | Matcher tests, checkpoint failure yields `CheckpointFailed` |
| 3.2g | Versioned | S1-T02, S4-T09 | Unsupported `schemaVersion` refused, review applies a minor bump |
| 3.2h | Reviewable by human and by agent | S7-T02 | Generated JSON Schema and review sheet |
| 3.3a | Replay without the LLM in the decision loop | S1-T10, S6-T03 | Import graph test |
| 3.3b | Stable element targeting on replay | S1-T01, S1-T08 | Strategy ladder tests |
| 3.3c | Verify the checkpoint | S1-T10 | Checkpoint failure yields `CheckpointFailed` |
| 3.3d | Return declared outputs to the caller | S1-T10, S6-T03 | Typed outputs on `SuccessResult` |
| 3.3e | Expected business outcomes distinguished | S4-T01, S4-T09, S4-T10 | `MEMBER_NOT_FOUND` returns `business_outcome`, classified without burning the timeout |
| 3.3f | Recoverable conditions handled | S6-T02 | `TransientLoad` retried and reported on success. Other recoveries are cut, see `PROGRESS.md` |
| 3.3g | Hard failures stop with a debuggable error | S1-T03, S6-T04 | `expected` and `observed` required, locator attempts listed |
| 3.3h | Structured result contract | S1-T03, S6-T03 | Result assembly tests |
| 3.4a | Configurable allowlist, domains, routes, action types | S1-T05 | Policy table tests |
| 3.4b | Agent cannot act outside the allowlist | S1-T09 | `GuardedSurface` test, import graph test, network layer refusal |
| 3.4c | Safe versus risky, handled conservatively | S3-T04, S5-T04, S5-T06 | Effect and idempotency classification, confirm through the intervention channel, an approved write running unattended, no second post |
| 3.4d | Never persist secrets or raw sensitive data | S3-T02, S3-T03, S3-T05, S4-T07 | Redaction tests, writer refusal, permanent evidence scanner with canaries |
| 3.5a | Structured log of what the agent did and why | S3-T03, S4-T06 | Logger tests, `RunTrace` including rationale |
| 3.5b | A richer signal on failure | S3-T03 | Screenshot and snapshot on failure, manifest test |
| 3.6a | Detect a stuck or blocked state | S4-T04, S5-T01 | `NoProgress`, `UnclassifiedCondition` and `ModelRequested`, one test each |
| 3.6b | Raise an intervention with full context | S5-T01 | Required field test, redaction test |
| 3.6c | Human operates the same live session | S5-T02, S5-T03 | CDP forwarding changes state in the existing session |
| 3.6d | Hand control back and resume | S5-T04 | Revalidation branch tests, including the approval branch |
| 3.6e | Preserve context and evidence across the handoff | S3-T03, S5-T07 | Manifest spans the handoff, committed escalation evidence |
| 3.6f | Record what the human did | S5-T03 | `HumanActionRecord` carries a derived bundle and no value |
| 3.6g | Pause, cede, resume on the same session, with known control | S1-T07, S5-T01 | Token rotation, reducer matrix |
| 3.7a | Surface abstraction extending to legacy web and desktop | S1-T01, S3-T01, S7-T01 | Contract suite, desktop stub satisfying the interface |
| 3.7b | Multitenant reuse without per tenant rebuild | none, designed | Overlay schema in `docs/ARTIFACT_SCHEMA.md`, ADR 0015, `REPORT.md` section 4. The brief permits design only |
| 3.7c | Detect and manage per tenant drift | S1-T01, S6-T04 | Degradation recorded under the `relabel` fault. Management is designed, not built |

## Deliverables, Section 6

| Ref | Requirement | Tasks |
| --- | --- | --- |
| 6.1a | Public repo with `/README.md` | S8-T01 |
| 6.1b | Setup, run, keys, config, how to run without live services | S8-T01 |
| 6.1c | Exact demo commands for discover then replay | S8-T01, S8-T04 |
| 6.2 | `/REPORT.md` with the seven exact headings | S8-T02 |
| 6.3a | `/evidence/` with an example artifact | S4-T08 |
| 6.3b | Logs from a discovery run | S4-T08 |
| 6.3c | Logs from a replay run | S4-T10 |
| 6.3d | At least one replay hitting an error or exceptional state | S4-T10, S5-T07 |
| 6.3e | Optional screen recording | not planned, optional in the brief |

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

The brief states these are not rewarded. Confirm at S8-T03 that none crept in.

* Queues, workers, clusters, multitenant plumbing.
* A database.
* A real time co browsing operator console.
* An implemented desktop driver.
* Framework breadth or name dropping.
* Feature count.
