# Requirements traceability

Every requirement in the brief, mapped to the task that satisfies it and the test that proves it. Graders read submissions against their own rubric. This matrix is how we make sure no row is quietly missing.

Walk this end to end as task S8-T03 before declaring the project done. Any row without a ticked task and a named passing test either gets built or gets an honest entry in the Cuts section of `REPORT.md`. Silently missing is the only unacceptable state.

## Core requirements, Section 3

| Ref | Requirement | Tasks | Proof |
| --- | --- | --- | --- |
| 3.1a | Accept a goal plus a target as input | S5-T11 | `discover` CLI e2e |
| 3.1b | LLM driven observe, decide, act loop against a live surface | S5-T04, S5-T12 | Agent loop unit tests, committed live run evidence |
| 3.1c | Stopping conditions, max steps, timeout, dead end | S5-T04, S4-T09 | One unit test per condition |
| 3.1d | Real UI interaction, click, type, navigate, read | S1-T16 | Gate S1-T24 against the running app |
| 3.1e | Approach that works without a clean DOM | S1-T02, S1-T16, S2-T01 | The member ID input resolves with no accessible name, and a live model reaches the balance |
| 3.2a | Typed, serializable artifact emitted after success | S1-T03, S5-T09 | Schema tests, generalizer snapshot test |
| 3.2b | Ordered steps and actions | S1-T03 | Schema validation |
| 3.2c | How each target is identified, with robustness reasoning | S1-T02, S5-T05, S5-T06 | Ladder tests, derivation tests, `docs/ARCHITECTURE.md` section 5, `REPORT.md` section 3 |
| 3.2d | Typed input parameters | S1-T03, S4-T02 | `ParamSpec` validation tests |
| 3.2e | Typed outputs and their shape | S1-T03, S1-T23 | Output extraction and typing tests |
| 3.2f | Checkpoint or success condition | S1-T22 | Checkpoint evaluation tests |
| 3.2g | Versioned | S1-T05, S7-T02 | Compatibility refusal, version bump classification |
| 3.2h | Reviewable by human and by agent | S7-T08 | Generated JSON Schema and review sheet, unconditional rather than stretch |
| 3.3a | Replay without the LLM in the decision loop | S1-T20, S4-T10 | Import graph test |
| 3.3b | Stable element targeting on replay | S1-T02, S1-T16 | Strategy ladder tests |
| 3.3c | Verify the checkpoint | S1-T22 | Checkpoint failure yields `CheckpointFailed` |
| 3.3d | Return declared outputs to the caller | S1-T23, S4-T11 | Typed outputs on `SuccessResult` |
| 3.3e | Expected business outcomes distinguished | S4-T04, S4-T05, S5-T13, S5-T15 | `MEMBER_NOT_FOUND` returns `business_outcome`, classified without burning the timeout |
| 3.3f | Recoverable conditions handled | S4-T07 | One integration test per recovery, each against its fault |
| 3.3g | Hard failures stop with a debuggable error | S1-T07, S4-T12 | `expected` and `observed` required, locator attempts listed |
| 3.3h | Structured result contract | S4-T11 | Result assembly tests |
| 3.4a | Configurable allowlist, domains, routes, action types | S1-T10 | Policy table tests |
| 3.4b | Agent cannot act outside the allowlist | S1-T17, S1-T18 | `GuardedSurface` test, import graph test, network layer refusal |
| 3.4c | Safe versus risky, handled conservatively | S4-T01, S6-T11, S6-T13 | Effect and idempotency classification, confirm routed to intervention, an approved write running unattended |
| 3.4d | Never persist secrets or raw sensitive data | S3-T04, S3-T05, S5-T10, S3-T08 | Redaction tests, writer refusal, permanent evidence scanner with canaries |
| 3.5a | Structured log of what the agent did and why | S3-T06, S5-T08 | Logger tests, `RunTrace` including intent and rationale |
| 3.5b | A richer signal on failure | S3-T07 | Screenshot and snapshot on failure, manifest test |
| 3.6a | Detect a stuck or blocked state | S6-T02 | One test per detector |
| 3.6b | Raise an intervention with full context | S6-T03 | Required field test, redaction test |
| 3.6c | Human operates the same live session | S6-T05, S6-T07 | CDP forwarding changes state in the existing session |
| 3.6d | Hand control back and resume | S6-T09 | Revalidation branch tests, including the approval branch |
| 3.6e | Preserve context and evidence across the handoff | S3-T07, S6-T15 | Manifest spans the handoff, committed escalation evidence |
| 3.6f | Record what the human did | S6-T07, S6-T08, S6-T10 | `HumanActionRecord` carries a derived bundle, draft step proposal test |
| 3.6g | Pause, cede, resume on the same session, with known control | S1-T14, S6-T01 | Token rotation, reducer matrix |
| 3.7a | Surface abstraction extending to legacy web and desktop | S1-T01, S3-T01, S7-T07 | Contract suite, desktop stub satisfying the interface |
| 3.7b | Multitenant reuse without per tenant rebuild | S7-T01, S7-T06 | Overlay merge tests, cross tenant replay. S7-T06 is cuttable, S7-T01 is not |
| 3.7c | Detect and manage per tenant drift | S1-T02, S7-T03 | Degradation recorded, fingerprint mismatch reported as drift in the state sidecar |

## Deliverables, Section 6

| Ref | Requirement | Tasks |
| --- | --- | --- |
| 6.1a | Public repo with `/README.md` | S8-T01 |
| 6.1b | Setup, run, keys, config, how to run without live services | S8-T01 |
| 6.1c | Exact demo commands for discover then replay | S8-T01, S8-T05 |
| 6.2 | `/REPORT.md` with the seven exact headings | S8-T02 |
| 6.3a | `/evidence/` with an example artifact | S5-T12 |
| 6.3b | Logs from a discovery run | S5-T12 |
| 6.3c | Logs from a replay run | S5-T15 |
| 6.3d | At least one replay hitting an error or exceptional state | S5-T15, S6-T15 |
| 6.3e | Optional screen recording | S8-T06 |

## Evaluation criteria, Section 7

Weighted in the brief's stated order. This is where to spend remaining effort if time runs short.

| Criterion | Where it is earned | Risk if rushed |
| --- | --- | --- |
| System design | `docs/ARTIFACT_SCHEMA.md`, `docs/ARCHITECTURE.md`, `REPORT.md` sections 1 and 2 | Highest weight in the brief. Do not compress the schema work |
| Correctness of the core loop | Gate S1-T24, Gate S5-T15 | Without a real live run the submission fails its one stated hard requirement |
| Robustness and error handling | S4-T04, S4-T05, S4-T12 | The matrix is the single best evidence of this. Build all of it |
| Human in the loop escalation | Slice 6 | Explicitly called out as the thing candidates fake. Build S6-T07 for real |
| Generalisation to the real environment | S7-T01, S7-T06, S7-T07, `REPORT.md` section 4 | Design alone scores here. S7-T06 converts it to demonstrated and is the first thing cut |
| Safety and data handling | S1-T10, S4-T01, S3-T04, S3-T08 | The permanent evidence scanner is cheap and highly visible |
| Code quality | Whole project, TDD discipline | Coverage gates and the contract suite carry this |
| Communication | `REPORT.md` | One to three pages. A long report scores worse, not better |

## Explicit non goals

The brief states these are not rewarded. Confirm at S8-T04 that none crept in.

* Queues, workers, clusters, multitenant plumbing.
* A database.
* A real time co browsing operator console.
* An implemented desktop driver.
* Framework breadth or name dropping.
* Feature count.
