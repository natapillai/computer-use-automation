# Evidence

One line per directory, and the one file worth opening in each.

| Directory | What it is | Open this |
| --- | --- | --- |
| `discovery/run_e5b46f88` | The live write that opened an account, approved on the console. | `captures/decision-01.png`, the screen the approver was looking at when they decided |
| `discovery/run_666b7c9f` | The same write with the approval refused. | `captures/final.png`, still on the form rather than a confirmation, which is what says the submit never happened |
| `discovery/run_84705a0a` | The live read discovery, on the fixed pipeline. This is the one the README and `REPORT.md` point at. | `transcript.jsonl`, five model calls with every observation the model was given, redacted |
| `discovery/run_56fc6b06` | The first live read discovery, kept unedited. | `log.jsonl`, which carries both defects the run found in the system's own output |
| `discovery/run_adf04d79` | The first live write attempt, which had nowhere to go. | `log.jsonl`, the second intervention raised rather than a failure reported |
| `discovery/run_dd3f4ee4` | An earlier write attempt ended at the console. | `trace.jsonl`, two interventions in one run |
| `discovery/run_28c9652e` | A run abandoned before the model acted. | `captures/step-00-initial.png`, the masked first screen |
| `review/run_bc3879b1` | The negative probe on the write capability, which declared `AMOUNT_BELOW_MINIMUM`. | `captures/stop.png`, the screen the probe stopped on and the message the detector was derived from |
| `review/run_be7fd34c` | The same mechanism on the read capability, which declared `MEMBER_NOT_FOUND`. | `artifact.diff.json`, exactly what the review added between 1.0.0 and 1.1.0 |
| `replay/success/run_44fa5a49` | The deterministic thread, no model loaded. | `log.jsonl`, the typed money output and the steps that produced it |
| `replay/businessOutcome/run_1749a087` | The same capability, member `00000`. | `log.jsonl`, a typed outcome and exit code 0 |
| `replay/escalated/run_d4553686` | `surpriseDialog` on the search, nobody claimed it. | `captures/intervention-01.png`, the dialog still open with its OK button never pressed |
| `replay/failure/run_9dab6126` | The core banking service stopped answering on the member page. | `captures/failure.png`, the screen the run gave up on, beside a result that says which step, what it expected and why nothing was retried |

The escalated run carries no `humanActions.jsonl`, because nobody came. The handoffs a person actually took are in the two write discoveries at the top.

The failure run is the richer signal on a hard failure. The result names the step, what it expected and what it observed, and the capture is the page that produced it, which is the part a structured result cannot carry. The step that failed is the one that is not idempotent, so the run refused to retry a load it could not prove was safe to repeat, and the result says so rather than leaving a reader to work it out.

## Why the first run is kept

Two live discovery runs of the same goal are here on purpose. `discovery/run_56fc6b06-577b-4f04-86c0-4fba6cc659bf/` is the first one, and its own manifest and log carry two defects the pipeline had when it ran, an absolute path from the machine that produced it and a capability file name that the redaction patterns read as an email address. `discovery/run_84705a0a-7840-4584-b39a-035d9f9d81f8/` is the same goal discovered again after both were fixed, and it is the run the README and `REPORT.md` point at, with `review/`, `replay/success/` and `replay/businessOutcome/` all produced from the artifact it discovered.

The pair is the point. The first run is the evidence path being exercised rather than asserted, because the system's own output is what surfaced the defects, and keeping it costs a reader nothing while replacing it silently would have cost the proof.

## The write runs

`discovery/run_adf04d79-f2f9-4b25-9f99-d212b2a459a6/` is the first live attempt at the write goal, and it is kept because of what it proves rather than what it produced. Claude Sonnet 5 navigated the content frame to the member detail page and then had nowhere to go, because the sub account form is not linked from anywhere after the decision to keep the member page unchanged. Three actions in a row changed nothing, `NoProgress` fired, and the run raised a live intervention and stopped.

The project owner claimed the session on the console, looked at the masked screen, and released it. The run took control back on a fresh token, re observed, found itself still stuck and raised a second intervention rather than reporting a failure. That is the resume ladder running outside a test for the first time, and the two captures are the two screens a person was shown. `discovery/run_28c9652e-e2e6-4c3d-a030-d1283bb359ca/` is a first attempt abandoned before the model acted.

Both runs were ended at the console rather than allowed to finish, so neither carries a trace, a transcript or a manifest. Those are written when the loop returns, and a process that is killed never gets there. That is a real limit of the evidence sink and it is recorded in `REPORT.md` rather than tidied away here.

What the run found is recorded honestly. The console could show a person the session and could not let them touch it, because the page never called the input endpoint that sits under it. The goal named no route to a form nothing links to. Both are fixed after this run, and the evidence of them failing is the reason the fixes exist.

### The declined write, run_666b7c9f

`discovery/run_666b7c9f-ad89-4650-9fe4-16fcf36b8432/` is the live write run with the approval refused. Claude Sonnet 5 read the goal, navigated the content frame to the sub account form by path, chose the account type, filled the opening amount, and declared the submit a write by setting the flag the request permits. Policy answered confirm, the run stopped, and the console URL went to stderr.

I claimed the session on the console, read the screen, and released it without approving. The run was told the action was declined. It did not try the submit again. It asked for guidance instead, which raised a second intervention that nobody claimed, and the run ended as escalated with no capability written and no account opened. The final capture shows the session still on the form rather than on a confirmation screen, which is what says the submit never happened.

`captures/decision-01.png` is the picture the console had in front of me when I decided, taken from the bytes it served rather than from a screenshot taken afterwards. `captures/intervention-01.png` is the screen at the moment the run stopped. The member number and the member name are masked in both.

The opening amount and the account type are readable in those images, and that is deliberate. The masking comes from the app profile's field map, which covers member data, and a person cannot meaningfully approve a change they are not allowed to see. Both are values the caller supplied rather than anything read out of the system of record, and both appear only as `{{inputs.openingAmount}}` and `{{inputs.accountType}}` everywhere text is written.

### The approved write, run_e5b46f88

`discovery/run_e5b46f88-d93c-4efc-8137-6abc2372e48f/` is the live write run that opened an account. Claude Sonnet 5 navigated the content frame to the sub account form by path, chose the account type, filled the opening amount, declared the submit a write, and stopped. The project owner claimed the session on the console, read the screen and approved. The run performed that one action once with a one shot grant, reached the confirmation screen, extracted the suffix and produced version 1.0.0 of `member.openSubAccount`. Six model calls and four actions.

`captures/decision-01.png` is the screen the console had in front of the approver at the moment they decided, taken from the bytes it served rather than a screenshot taken afterwards. `artifact.json` is the capability the run produced, and the same artifact sits in `capabilities/` under that id and version, where a caller would look for it.

`discovery/run_dd3f4ee4-dfeb-4b72-a6ba-cfa3731de01e/` is an earlier attempt on the same goal, ended at the console rather than approved, and kept because it carries two interventions rather than one.

That run found the defect worth reading about. The approver could not establish which member the change was for. The screen masks the member number and the name, the trace records the navigate as `/member/{{inputs.memberId}}/subaccount`, and the console panel showed the goal with its placeholders unresolved. The only place the value existed was the command they had typed, so the approval rested on reasoning rather than observation. One redaction rule was serving two audiences. A claimed operator holding a live session now sees the resolved inputs in the console, and nothing written down does. It is in `REPORT.md` section 6.

### The review of the write, run_bc3879b1

`review/run_bc3879b1-fca9-49d3-9e86-3d58a9359aee/` is the negative probe review of `member.openSubAccount`, run live with the project owner approving both stops. The probe submitted an opening amount below the minimum, which is a write, so it stopped for a person before it reached the surface. The console panel showed the resolved inputs on that first claim, which is the fix from `REPORT.md` section 6 demonstrated on a live session rather than in a test.

The probe ended as `CheckpointFailed` on the submit, because the confirmation screen it expected never arrived. The reviewer named the outcome, the detector was derived from the message on the screen the probe stopped on, and `1.1.0` was written only after a second replay returned `AMOUNT_BELOW_MINIMUM` rather than a failure. That second replay stopped for a person too, and was approved too, because a review of a write is a replay of a write.

Neither submission opened an account. The negative probe mechanism now has two flows behind it, a read and a write, which is what `REPORT.md` section 2 means by both capabilities getting their outcome the same way.
