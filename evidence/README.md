# Evidence

Two live discovery runs are kept on purpose. `discovery/run_56fc6b06-577b-4f04-86c0-4fba6cc659bf/` is the first one, and its own manifest and log carry two defects the pipeline had when it ran, an absolute path from the machine that produced it and a capability file name that the redaction patterns read as an email address. `discovery/run_84705a0a-7840-4584-b39a-035d9f9d81f8/` is the same goal discovered again after both were fixed, and it is the run the README and `REPORT.md` point at, with `review/`, `replay/success/` and `replay/businessOutcome/` all produced from the artifact it discovered.

The pair is the point. The first run is the evidence path being exercised rather than asserted, because the system's own output is what surfaced the defects, and keeping it costs a reader nothing while replacing it silently would have cost the proof.

S8-T03 expands this file with a line per directory and the single most interesting file in each.

## The write run, 2026-09-18

`discovery/run_adf04d79-f2f9-4b25-9f99-d212b2a459a6/` is the first live attempt at the write goal, and it is kept because of what it proves rather than what it produced. Claude Sonnet 5 navigated the content frame to the member detail page and then had nowhere to go, because the sub account form is not linked from anywhere after the decision to keep the member page unchanged. Three actions in a row changed nothing, `NoProgress` fired, and the run raised a live intervention and stopped.

The project owner claimed the session on the console, looked at the masked screen, and released it. The run took control back on a fresh token, re observed, found itself still stuck and raised a second intervention rather than reporting a failure. That is the resume ladder running outside a test for the first time, and the two captures are the two screens a person was shown. `discovery/run_28c9652e-e2e6-4c3d-a030-d1283bb359ca/` is a first attempt abandoned before the model acted.

Both runs were ended at the console rather than allowed to finish, so neither carries a trace, a transcript or a manifest. Those are written when the loop returns, and a process that is killed never gets there. That is a real limit of the evidence sink and it is recorded in `REPORT.md` rather than tidied away here.

What the run found is recorded honestly. The console could show a person the session and could not let them touch it, because the page never called the input endpoint that sits under it. The goal named no route to a form nothing links to. Both are fixed after this run, and the evidence of them failing is the reason the fixes exist.
