# Requirements traceability

Every requirement in the brief, mapped to the task that satisfies it and the test that proves it. Graders read submissions against their own rubric. This matrix is how we make sure no row is quietly missing.

Walk this end to end as task P10-T03 before declaring the project done. Any row without a ticked task and a named passing test either gets built or gets an honest entry in the Cuts section of `REPORT.md`. Silently missing is the only unacceptable state.

## Core requirements, Section 3

| Ref | Requirement | Tasks | Proof |
| --- | --- | --- | --- |
| 3.1a | Accept a goal plus a target as input | P6-T08 | `discover` CLI e2e |
| 3.1b | LLM driven observe, decide, act loop against a live surface | P6-T04, P8-T03 | Agent loop unit tests, committed live run evidence |
| 3.1c | Stopping conditions, max steps, timeout, dead end | P6-T04 | One unit test per condition |
| 3.1d | Real UI interaction, click, type, navigate, read | P3-T04, P3-T05 | Contract suite against the target app |
| 3.1e | Approach that works without a clean DOM | P3-T04, P1-T05 | Accessibility first driver, `anchor-relative` resolution under the `relabel` fault |
| 3.2a | Typed, serializable artifact emitted after success | P1-T01, P6-T07 | Schema tests, generalizer snapshot test |
| 3.2b | Ordered steps and actions | P1-T01 | Schema validation |
| 3.2c | How each target is identified, with robustness reasoning | P1-T05, P1-T06 | Locator tests, `docs/ARCHITECTURE.md` section 5, `REPORT.md` section 3 |
| 3.2d | Typed input parameters | P1-T01, P1-T04 | `ParamSpec` validation tests |
| 3.2e | Typed outputs and their shape | P1-T01, P5-T08 | Output extraction and typing tests |
| 3.2f | Checkpoint or success condition | P5-T04 | Checkpoint evaluation tests |
| 3.2g | Versioned | P1-T02, P1-T15 | Compatibility refusal, version bump classification |
| 3.2h | Reviewable by human and by agent | P1-T01, P9-T01 | `intent` and `describedAs` required by schema, generated tool schema |
| 3.3a | Replay without the LLM in the decision loop | P5-T02, P5-T11 | Import graph test |
| 3.3b | Stable element targeting on replay | P3-T05, P1-T06 | Strategy ladder tests |
| 3.3c | Verify the checkpoint | P5-T04 | Checkpoint failure yields `CheckpointFailed` |
| 3.3d | Return declared outputs to the caller | P5-T08, P5-T09 | Typed outputs on `SuccessResult` |
| 3.3e | Expected business outcomes distinguished | P1-T09, P5-T10 | `MEMBER_NOT_FOUND` returns `business_outcome` |
| 3.3f | Recoverable conditions handled | P5-T06 | One integration test per recovery, each against its fault |
| 3.3g | Hard failures stop with a debuggable error | P1-T07, P5-T10 | `expected` and `observed` required, locator attempts listed |
| 3.3h | Structured result contract | P5-T09 | Result assembly tests |
| 3.4a | Configurable allowlist, domains, routes, action types | P1-T10 | Policy table tests |
| 3.4b | Agent cannot act outside the allowlist | P3-T07 | `GuardedSurface` test, import graph test |
| 3.4c | Safe versus risky and irreversible, handled conservatively | P1-T10, P7-T11 | Risk classification tests, confirm routed to intervention |
| 3.4d | Never persist secrets or raw sensitive data | P1-T11, P1-T12, P8-T08 | Redaction tests, permanent evidence scanner test |
| 3.5a | Structured log of what the agent did and why | P0-T07, P6-T06 | Logger tests, `RunTrace` including `intent` |
| 3.5b | A richer signal on failure | P3-T06, P8-T01 | Screenshot and snapshot on failure, manifest test |
| 3.6a | Detect a stuck or blocked state | P7-T01 | One test per detector |
| 3.6b | Raise an intervention with full context | P7-T02 | Required field test, redaction test |
| 3.6c | Human operates the same live session | P4-T03, P7-T06 | CDP forwarding changes state in the existing session |
| 3.6d | Hand control back and resume | P7-T08 | Five branch revalidation tests |
| 3.6e | Preserve context and evidence across the handoff | P8-T01, P8-T07 | Manifest spans the handoff, committed escalation evidence |
| 3.6f | Record what the human did | P7-T07, P7-T09 | `HumanActionRecord` tests, draft step proposal test |
| 3.6g | Pause, cede, resume on the same session, with known control | P4-T01, P4-T02 | Reducer matrix, token rotation |
| 3.7a | Surface abstraction extending to legacy web and desktop | P3-T01, P3-T08 | Contract suite, desktop stub satisfying the interface |
| 3.7b | Multitenant reuse without per tenant rebuild | P1-T14, P9-T03 | Overlay merge tests, cross tenant replay |
| 3.7c | Detect and manage per tenant drift | P1-T06, P5-T09 | Degradation recorded, `surfaceFingerprint` mismatch reported as drift |

## Deliverables, Section 6

| Ref | Requirement | Tasks |
| --- | --- | --- |
| 6.1a | Public repo with `/README.md` | P10-T01 |
| 6.1b | Setup, run, keys, config, how to run without live services | P10-T01 |
| 6.1c | Exact demo commands for discover then replay | P10-T01, P10-T05 |
| 6.2 | `/REPORT.md` with the seven exact headings | P10-T02 |
| 6.3a | `/evidence/` with an example artifact | P8-T03 |
| 6.3b | Logs from a discovery run | P8-T03 |
| 6.3c | Logs from a replay run | P8-T05 |
| 6.3d | At least one replay hitting an error or exceptional state | P8-T06, P8-T07 |
| 6.3e | Optional screen recording | P10-T06 |

## Evaluation criteria, Section 7

Weighted in the brief's stated order. This is where to spend remaining effort if time runs short.

| Criterion | Where it is earned | Risk if rushed |
| --- | --- | --- |
| System design | `docs/ARTIFACT_SCHEMA.md`, `docs/ARCHITECTURE.md`, `REPORT.md` sections 1 and 2 | Highest weight in the brief. Do not compress the schema work |
| Correctness of the core loop | P6, P8-T03, P5 | Without a real live run the submission fails its one stated hard requirement |
| Robustness and error handling | P5-T10, P1-T09 | The thirteen row matrix is the single best evidence of this. Build all of it |
| Human in the loop escalation | P7 | Explicitly called out as the thing candidates fake. Build P7-T06 for real |
| Generalisation to the real environment | P3-T08, P1-T14, P9-T03, `REPORT.md` section 4 | Design alone scores here, but P9-T03 converts it to demonstrated |
| Safety and data handling | P1-T10, P1-T11, P8-T08 | The permanent evidence scanner test is cheap and highly visible |
| Code quality | Whole project, TDD discipline | Coverage gates and the contract suite carry this |
| Communication | `REPORT.md` | One to three pages. A long report scores worse, not better |

## Explicit non goals

The brief states these are not rewarded. Confirm at P10-T04 that none crept in.

* Queues, workers, clusters, multitenant plumbing.
* A database.
* A real time co browsing operator console.
* An implemented desktop driver.
* Framework breadth or name dropping.
* Feature count.
