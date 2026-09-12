# Evidence

The brief asks for a demonstration in `/evidence/`, containing a saved example artifact plus logs from a discovery run and a replay run, ideally including one replay that hits an error state. This is a graded deliverable and it is easy to under deliver on, so it gets a spec.

Evidence has two jobs. It proves the discovery run really happened, which is the brief's one non negotiable. And it is what an engineer would actually use to debug a failed run in production, which is the real test of whether the observability is any good.

## 1. Layout

```
evidence/
  README.md                              what each directory shows, read this first
  discovery/
    <runId>/
      manifest.json
      artifact.json                      the capability this run produced
      trace.jsonl                        every observation, decision, authorization, action
      transcript.jsonl                   the model exchange, redacted
      log.jsonl                          the structured application log
      captures/
        step-00-initial.png
        step-00-initial.a11y.json
        ...
  review/
    <runId>/                             the negative probe run that declared MEMBER_NOT_FOUND
      artifact.diff.json                 1.0.0 to 1.1.0, the outcome that was added
  replay/
    success/<runId>/
    businessOutcome/<runId>/             MEMBER_NOT_FOUND
    escalated/<runId>/                   surpriseDialog, includes the handoff
      intervention.json
      humanActions.jsonl
  crossTenant/                           optional, S6-T05
    withoutOverlay/<runId>/              fails with LocatorNotFound
    withOverlay/<runId>/                 succeeds
```

## 2. The manifest

Every run directory has one. It is the index a human reads first.

```ts
interface RunManifest {
  runId: string;
  phase: 'discovery' | 'replay';
  startedAt: string;
  endedAt: string;

  capability: { id: string; version: string; variant: string } | null;
  goal: string | null;
  target: { appId: string; tenant: string; baseUrl: string };

  result: { status: ResultStatus; code?: string; summary: string };

  counts: {
    steps: number; modelCalls: number; actions: number;
    recoveries: number; drift: number; escalations: number;
  };

  files: Array<{ path: string; kind: EvidenceKind; description: string }>;

  environment: { driver: string; driverVersion: string; model: string | null; promptVersion: string | null };
  redaction: { applied: true; patternsMatched: Record<string, number> };
}
```

`redaction.patternsMatched` gives counts, never values. A reviewer can see that four account numbers were redacted without seeing one. That is the right shape for a redaction report.

## 3. The trace

`trace.jsonl`, one JSON object per line, append only. This is the debugging surface.

```ts
type TraceEvent =
  | { t: 'observation'; at: string; stepIndex: number; url: string; framePaths: string[]; a11yHash: string; nodeCount: number; captureRef?: string }
  | { t: 'decision'; at: string; stepIndex: number; tool: string; args: unknown; rationale: string; latencyMs: number }
  | { t: 'authorization'; at: string; action: string; verdict: Verdict; rule?: string; reason?: string }
  | { t: 'resolution'; at: string; stepId: string; attempts: LocatorAttempt[]; winner?: string; degraded: boolean }
  | { t: 'action'; at: string; stepId: string; kind: string; ok: boolean; durationMs: number }
  | { t: 'derivation'; at: string; stepId: string; bundle: LocatorBundle; dropped: DroppedStrategy[]; neighbourhood: UINode }
  | { t: 'checkpoint'; at: string; stepId: string; passed: boolean; expected: string; observed: string }
  | { t: 'condition'; at: string; matcher: string; classification: string; code: string }
  | { t: 'recovery'; at: string; condition: string; strategy: string; attempt: number; resolved: boolean }
  | { t: 'control'; at: string; from: ControlState; to: ControlState; holder: string | null }
  | { t: 'escalation'; at: string; interventionId: string; reason: string; atStepId: string | null }
  | { t: 'humanAction'; at: string; kind: string; target?: { role: string; name: string } }
  | { t: 'result'; at: string; status: ResultStatus; code?: string };

```

Two properties make this useful rather than decorative.

`resolution` events record every strategy attempted and why each was rejected, not just the winner. When a replay breaks in three months, that line is the whole diagnosis. It tells you whether the primary locator drifted or whether the page changed shape entirely.

`authorization` events are emitted for allow verdicts too, not only denials. An audit trail that only records refusals cannot answer "what was this automation permitted to do against that member account".

`derivation` events carry the acted element and its redacted neighbourhood, which is what makes re deriving a better locator bundle from an old trace a real capability. ADR 0004 claimed that was possible while the capture policy stored only a hash on a successful step, so the claim was false. Storing the neighbourhood rather than the whole tree keeps the trace small and keeps the claim true. `dropped` records the strategies that failed their own record time check, which is the other half of the diagnosis when a bundle turns out to be thin.

## 4. Capture policy

| Moment | Screenshot | Accessibility snapshot |
| --- | --- | --- |
| Run start | yes | yes |
| Before a `write` action | yes | yes |
| Checkpoint failure | yes | yes |
| Any failure | yes | yes |
| Any escalation | yes | yes |
| Every control transfer | yes | no |
| Each successful step | no | hash only |
| Steps marked `sensitive` | only if evidence capture is explicitly enabled | redacted |

Capturing every step produces megabytes nobody reads. Capturing only at the moments where something went wrong or something irreversible was about to happen produces a directory a person will actually open. The accessibility hash on every step is what lets us reconstruct where divergence began without storing the tree each time.

## 5. Redaction of evidence

Evidence is committed to a public GitHub repository. It receives the strictest treatment in the system.

* Screenshots are masked before the bytes are written. The unmasked buffer never reaches disk.
* Accessibility snapshots pass through the object redactor.
* The model transcript passes through the redactor before it is written, and again the assistant turns are checked, because a model can echo a value back.
* URLs are redacted for path segments bound to sensitive inputs. `/member/10001` becomes `/member/{{memberId}}`.
* S6-T07 is a permanent test in the suite, not a pre commit script. It walks `evidence/`, `capabilities/` and `tests/fixtures/cassettes/`, and fails the build on a hit. Running it as a one off script means it stops running the day someone forgets.
* It searches for seeded canaries as well as the redaction patterns. The seed member names, the seed balances, the member IDs and a Luhn valid card number planted in the fixture. A scanner that only knows the redactor's own patterns can only find what the redactor would already have caught, which makes it close to a tautology. Canaries are what turn it into a test of whether every sink actually went through the redactor.

Because the target app is a fixture with obviously synthetic data there is no real PII at risk. We redact anyway. The mechanism is what is being demonstrated, and a reviewer checking whether redaction actually runs will look here first.

## 6. `evidence/README.md`

Short, written for a reviewer with limited time. It says what each directory demonstrates, in one or two sentences each, and names the single most interesting file in each. A reviewer reading three submissions in an afternoon should be able to find the proof of the live discovery run in under thirty seconds.
