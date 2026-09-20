# Computer use automation for back office banking

A model drives a legacy banking application until a goal is met. The successful run is generalized into a typed, versioned capability artifact. That artifact is then re executed with no model anywhere in the decision loop, returning typed outputs and classifying what went wrong. When the system cannot safely proceed it hands the same live browser session to a person, records what they did, and takes control back.

`REPORT.md` is the write up. This file is how you run it.

## What you need

* Node 22.12 or later. The repository pins `^22.12.0`.
* About 400MB for the Chromium that Playwright downloads.
* An Anthropic API key, only if you want to run live discovery. Everything else in this README runs offline.

## Setup

```
npm ci
npx playwright install chromium
```

Then copy `.env.example` to `.env` and fill in every key. The values below are the ones this repository is built around.

| Key | Value to use | Why |
| --- | --- | --- |
| `TARGET_BASE_URL` | `http://localhost:4010` | Where the local fixture application listens. It is in `policy/allowlist.yaml` by exact origin, so changing it here alone will get every action denied. |
| `TARGET_USERNAME` | `operator` | The fixture login. Any value works as long as it matches what you start the app with. |
| `TARGET_PASSWORD` | `meridian-fixture` | The same. It is a fixture credential and it is never written to evidence, logs or a model prompt. |
| `INTERVENTION_CLAIM_TIMEOUT_MS` | `300000` | How long a stopped run waits for a person to claim it on the console before it gives up. Five minutes is comfortable for a demo. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Discovery only. The model id is configuration rather than a constant, see ADR 0011 in `docs/DECISIONS.md`. |
| `ANTHROPIC_API_KEY` | your key | Discovery only, and only for a live run. The Anthropic SDK reads it directly and this project never parses it. |

Nothing needs a hosts file change, a container, or a database. The fixture application is an Express server on `http://localhost:4010` and every artifact is a file on disk.

## Run the tests

```
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
```

`npm run test` is the fast unit and contract loop. The integration suite starts its own copy of the fixture application on a free port in every file, so nothing has to be running first. The end to end suite drives the three commands against the live application with a recorded model transcript, so it makes no API calls either.

The end to end suite starts its own application on port 4010, because that is the port the allowlist names. Stop `npm run target` before running it. If you forget, it says so and stops rather than testing against whatever is already there.

## The demo path

Start the fixture application and leave it running.

```
npm run target
```

It prints `MERIDIAN Core listening on http://localhost:4010`. Sign in with the username and password from your `.env` if you want to look around. Member `10001` is the one the committed runs use, and `00000` is the one that does not exist.

Then, in a second terminal, three commands in order. Every one of them writes into `./out`, so following this literally never touches the committed artifacts or the committed evidence. Drop the two flags to write where the system normally would.

### 1. Discover

An LLM driven observe, decide, act loop drives the application until the goal in the request is met, and generalizes the successful run into a capability.

```
'{"memberId":"10001"}' | node --env-file-if-exists=.env --import tsx src/cli/discover.ts --request requests/member.readSavingsBalance.json --model-cassette tests/fixtures/cassettes/discovery.readSavingsBalance.json --capabilities ./out/capabilities --evidence ./out/evidence
```

`--model-cassette` replays the exchange a live run recorded, so this costs nothing and reaches the same capability every time. Drop it to run live against the model named in `ANTHROPIC_MODEL`.

The inputs are piped as JSON on stdin and are never passed as arguments, because an argument ends up in a shell history and a process list. The line above is the PowerShell form and works unchanged in bash.

While it runs it hosts the operator console on `http://localhost:4021`. It writes `out/capabilities/member.readSavingsBalance@1.0.0.json` and a run directory under `out/evidence/discovery/`. It prints five model calls and three actions, which is what the live run it was recorded from did.

### 2. Review

A draft declares no business outcomes, because a run that succeeded never saw one. Review probes the draft with an input chosen to fail, derives a detector from the real element on the screen it stops on, and writes a new version. Nothing is written until a second replay of the reviewed version returns the outcome, so a detector that does not work never reaches an artifact.

```
'{"memberId":"00000"}' | node --env-file-if-exists=.env --import tsx src/cli/review.ts --capability ./out/capabilities/member.readSavingsBalance@1.0.0.json --decision requests/member.readSavingsBalance.MEMBER_NOT_FOUND.review.json --evidence ./out/evidence
```

That declares `MEMBER_NOT_FOUND` and writes `1.1.0` beside the draft. A person then signs it off, which is what makes it replayable unattended.

```
node --env-file-if-exists=.env --import tsx src/cli/review.ts --capability ./out/capabilities/member.readSavingsBalance@1.1.0.json --approve your-name --evidence ./out/evidence
```

The console is on `http://localhost:4022` while a probe is running.

### 3. Replay

Deterministic. No model is loaded, and a test walks everything `src/replay` imports transitively and fails if the graph ever reaches a model client.

```
'{"memberId":"10001"}' | node --env-file-if-exists=.env --import tsx src/cli/replay.ts --capability ./out/capabilities/member.readSavingsBalance@1.1.0.json --evidence ./out/evidence
```

That returns `status: success` with `savingsBalance` as typed money, 425075 minor units of USD. Now the same capability with a member who does not exist.

```
'{"memberId":"00000"}' | node --env-file-if-exists=.env --import tsx src/cli/replay.ts --capability ./out/capabilities/member.readSavingsBalance@1.1.0.json --evidence ./out/evidence
```

That returns `status: business_outcome`, code `MEMBER_NOT_FOUND`, and **exit code 0**. No member is an answer, not a failure, and an exit code is the first thing a caller branches on. A real failure exits 1 and a usage error exits 2.

The console is on `http://localhost:4020` while a run is live.

### The write path and the handoff

`member.openSubAccount` opens a sub account, which is the only thing in the fixture application that changes anything. Replaying it as a draft stops before the submit and prints an intervention URL on stderr. Open that URL, claim the session, and you are looking at the live browser. You can click the picture, type into it, send a frame to a path, and then release with or without an approval. An approval is spent as a one shot grant on exactly one action.

```
'{"memberId":"10001","accountType":"Holiday Club","openingAmount":"250.00"}' | node --env-file-if-exists=.env --import tsx src/cli/replay.ts --capability ./capabilities/member.openSubAccount@1.0.0.json --evidence ./out/evidence
```

Releasing without approving refuses the write, and the run says so rather than carrying on.

## On npm and PowerShell

Every command above is the direct `node` form on purpose. The `package.json` scripts exist and work, but on PowerShell this silently drops the flag.

```
npm run replay -- --capability ./out/capabilities/member.readSavingsBalance@1.1.0.json
```

PowerShell removes the bare `--`, npm then eats `--capability` as one of its own options, and the command receives only the path. It exits 2 with a usage error, which is at least loud. Quoting the separator works.

```
npm run replay '--' --capability ./out/capabilities/member.readSavingsBalance@1.1.0.json
```

On bash both forms are fine. The direct `node` form is fine everywhere, which is why this README uses it.

## What is in the repository

```
capabilities/   the saved artifacts, one file per version
requests/       discovery goals and review decisions, none of which ever holds an input value
policy/         the allowlist, the one file that says what may be reached at all
profiles/       per application route classification and sensitive field maps
evidence/       committed runs, including ones kept to show defects the system found in its own output
docs/           the design documents, indexed in CLAUDE.md section 12
apps/target/    the fixture application
src/            the system
```

`evidence/README.md` says which run is worth opening and why.

## About the fixture application

`apps/target/` is a fixture, not part of the system. It exists because the brief needs a legacy surface to drive and there is no public one that behaves like a nineteen nineties banking terminal. It is a frameset with generated element ids that change on every restart, which is the whole point, because it makes a capability that depends on an id worthless. It also injects faults on demand under `TARGET_TEST_MODE=1`, through routes the allowlist denies outright, so the automation cannot reach its own fault injection.

It is Express with EJS templates. The operator console is Fastify. That split is deliberate rather than an accident of drift. The fixture is meant to look and behave like something somebody else wrote and I have to drive blind, so it uses a different stack from the system, and nothing in `src/` may import from `apps/`.

## Known limits

`REPORT.md` section 7 is the honest list. The short version is that the desktop driver is a documented stub that satisfies the interface and throws per verb, there is one tenant, and two test failures that happened once each have never been explained.
