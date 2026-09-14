# Target application: MERIDIAN Core

A local, deliberately legacy styled back office banking application. It stands in for the real thing.

## 1. Why we build one instead of using a public demo site

Public demo sites are faster to start with and worse at everything the brief actually grades.

* We need to inject a permission denial, a transient 503, a hang, an unexpected dialog, locator drift and an ambiguous result on demand. No public site gives us that.
* We need the hostile surface the brief describes. Framesets, nested tables, no test IDs, generated IDs, server rendered HTML. Most demo sites are clean React apps, which lets a candidate get away with CSS selectors and proves nothing.
* We need hermetic, offline, deterministic integration tests. A third party site is a flake source and a rate limit we have to respect.
* No terms of service risk, no real credentials, no real PII, which the brief's ground rules require.

The cost is work on something that is not the deliverable. The return is that every interesting requirement becomes demonstrable. This is ADR 0002.

Keep it small. It is a fixture, not a product. Express plus EJS plus a JSON seed file. No database, no build step, no client framework. Express rather than the Fastify our own services use is deliberate, because the fixture emulates a legacy stack and should not look like the code under test. See ADR 0011.

## 2. Domain

A credit union servicing console. Three flows, chosen to cover the brief's examples.

1. **Read.** Search for a member by ID, open their detail screen, read the savings balance. This is the primary capability we record.
2. **Write.** Open a new sub account for a member, a form with field validation and a confirmation screen. This is the write that exercises the confirm path, and it is all of requirement 3.4.
3. **Auth.** A login screen and a session cookie. The session does not expire, because session expiry and re authentication were cut.

## 3. Deliberately hostile surface characteristics

Every one of these exists because it breaks a naive automation approach.

* **Frameset.** The shell is a real `<frameset>` with `nav`, `content`, and `status` frames. Anything that ignores frame context fails immediately. It also forces `framePath` to be a first class concept in our locator model rather than an afterthought.
* **Table layout.** Forms are laid out in nested `<table>` elements. Labels are `<td>` siblings, not `<label for>`. This is what makes `anchor-relative` locators necessary.
* **No test IDs.** None. Anywhere.
* **Generated IDs.** Element IDs look like `ctl00_cph_txt_7f3a2` and are generated from a per process seed, so an artifact that captured one would break across restarts. Our locator strategy must rank them low.
* **Non semantic controls.** At least one control is a `<td onclick>` styled as a button, with no role and no accessible name. It carries inner text only. A `title` attribute would defeat the point, because Chromium feeds `title` into the accessible name computation, so the control would quietly become nameable and the fallback would never be exercised. Its test asserts what is actually true of the accessible name rather than what the document wishes were true.
* **Server rendered with full page reloads.** No SPA routing. Navigation is real.
* **Inconsistent casing and whitespace** in labels, because real legacy apps have `Member  ID:` with two spaces.

We add a small number of accessible controls too. A surface where nothing works would just prove the fallback path, and we need to prove the primary path as well.

The first page of this app is the page built for the perception spike at S0-T03. The surface the spike proved is the surface every test runs against.

## 4. Routes

```
GET  /                          redirect to /auth/login or /servicing
GET  /auth/login                login form
POST /auth/login                sets a session cookie
GET  /servicing                 frameset shell
GET  /servicing/nav             nav frame
GET  /servicing/search          member search form, content frame
POST /servicing/search          results, or the no records banner
GET  /member/:id                member detail, accounts table, savings balance
GET  /member/:id/subaccount     new sub account form
POST /member/:id/subaccount     validation, then a confirmation screen
GET  /servicing/status          status frame

GET  /__control__/reset         reset all state, test only
POST /__control__/fault         arm a fault, test only
GET  /__control__/state         inspect state, test only
```

`/__control__/**` is mounted only when `TARGET_TEST_MODE=1` and is in the allowlist's denied paths, so the agent cannot reach its own fault injection controls. That detail is worth keeping. It is a small proof that the allowlist actually constrains something.

## 5. Fault injection

Armed through `POST /__control__/fault`, always with a route scope and a count. There is no query parameter arming. Replay controls its own URLs, so a fault that could only be armed by appending a parameter would be unreachable from the code path it is supposed to test.

| Fault | Behaviour | Exercises |
| --- | --- | --- |
| `flaky503` | 503 for N requests on the scoped route, then normal responses | `TransientLoad` recovery on an idempotent step, and no retry on the sub account submit |
| `hang` | Never responds on the scoped route, and the held response is released by `/__control__/reset` | `Timeout` failure with a named condition |
| `denied` | A permission denied panel on member detail | `ACCOUNT_RESTRICTED` business outcome |
| `surpriseDialog` | An undeclared HTML modal with two ambiguous buttons | Escalation. It must never be clicked through |
| `duplicateIds` | Search returns two rows with the same displayed member ID | `LocatorAmbiguous` |
| `relabel` | Renames `Member ID` to `Account Holder ID` | Locator drift recorded when a lower ranked strategy wins |

Validation on the sub account form is not a fault. The form validates real input, and an invalid opening amount returns a field level error, which the write capability declares as a business outcome.

## 6. Seed data

Small, synthetic, obviously fake, committed as `apps/target/seed.json`. No real PII, not even plausible looking.

| Member ID | Name | Savings balance as rendered |
| --- | --- | --- |
| `10001` | Test Member One | `$4,250.75` |
| `10002` | Test Member Two | `1980.40 USD` |
| `10003` | Test Member Three | `(125.00)`, and three sub accounts to exercise multi row tables |
| `10004` | Test Member Four | `$0.00` |
| `00000` | not present | Triggers `MEMBER_NOT_FOUND` |

Balances are rendered inconsistently on purpose. Money parsing has to be real, and the parser gets unit tests from these formats.

The seed also carries canaries for the evidence scanner. The member names, the balances and the member IDs are distinctive strings, and member `10001` shows the card number `4111 1111 1111 1111`, a well known test number that passes Luhn. If any of them appears unredacted in evidence, an artifact or a cassette, the scanner fails the suite.

## 7. One tenant

The app serves one tenant on `http://localhost:4010`. There is no second tenant variant and no `Host` based selection. Cross tenant reuse is designed, not built. The overlay design is in `docs/ARTIFACT_SCHEMA.md` section 5 and ADR 0015, and `REPORT.md` section 4 says so.

## 8. Constraints on building it

* No database. A JSON seed loaded into memory, reset by `/__control__/reset`.
* No build step. EJS templates served directly.
* Deterministic. Same request plus same state gives the same HTML, including the generated IDs, which come from a fixed per process seed.
* Starts in under two seconds, because integration tests start it.
* Documented in `README.md` as a fixture, so a reviewer does not mistake it for the deliverable.
* It gets a small test of its own, asserting each fault actually produces its documented behaviour. A broken fixture that silently stops injecting faults would quietly turn the error handling tests green for the wrong reason.
