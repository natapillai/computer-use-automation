# Evidence

Two live discovery runs are kept on purpose. `discovery/run_56fc6b06-577b-4f04-86c0-4fba6cc659bf/` is the first one, and its own manifest and log carry two defects the pipeline had when it ran, an absolute path from the machine that produced it and a capability file name that the redaction patterns read as an email address. `discovery/run_84705a0a-7840-4584-b39a-035d9f9d81f8/` is the same goal discovered again after both were fixed, and it is the run the README and `REPORT.md` point at, with `review/`, `replay/success/` and `replay/businessOutcome/` all produced from the artifact it discovered.

The pair is the point. The first run is the evidence path being exercised rather than asserted, because the system's own output is what surfaced the defects, and keeping it costs a reader nothing while replacing it silently would have cost the proof.

S8-T03 expands this file with a line per directory and the single most interesting file in each.
