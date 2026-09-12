# Target application: MERIDIAN Core

A local, deliberately legacy styled back office banking application. It stands in for the real thing.

## 1. Why we build one instead of using a public demo site

Public demo sites are faster to start with and worse at everything the brief actually grades.

* We need to inject a session timeout, a permission denial, a transient 503, an unexpected dialog, and a validation error on demand. No public site gives us that.
* We need the hostile surface the brief describes. Framesets, nested tables, no test IDs, generated IDs, server rendered HTML. Most demo sites are clean React apps, which lets a candidate get away with CSS selectors and proves nothing.
* We need a second tenant variant of the same vendor product to demonstrate cross tenant reuse. Cloning a public site is not possible.
* We need hermetic, offline, deterministic integration tests. A third party site is a flake source and a rate limit we have to respect.
* No terms of service risk, no real credentials, no real PII, which the brief's ground rules require.

The cost is a day of work on something that is not the deliverable. The return is that every interesting requirement becomes demonstrable. This is ADR 0002.

Keep it small. It is a fixture, not a product. Express plus EJS plus a JSON seed file. No database, no build step, no client framework.

## 2. Domain

A credit union servicing console. Three flows, chosen to cover the brief's examples.

1. **Read.** Search for a member by ID, open their detail screen, read the savings balance. This is the primary capability we record.
2. **Write.** Open a new sub account for a member, a multi field form with a confirmation step. This is the irreversible action that exercises the confirm path.
3. **Auth.** A login screen with a session that can be expired on demand.

## 3. Deliberately hostile surface characteristics

Every one of these exists because it breaks a naive automation approach.

* **Frameset.** The shell is a real `<frameset>` with `nav`, `content`, and `status` frames. Anything that ignores frame context fails immediately. It also forces `framePath` to be a first class concept in our locator model rather than an afterthought.
* **Table layout.** Forms are laid out in nested `<table>` elements. Labels are `<td>` siblings, not `<label for>`. This is what makes `anchor-relative` locators necessary.
* **No test IDs.** None. Anywhere.
* **Generated IDs.** Element IDs look like `ctl00_cph_txt_7f3a2` and change per server restart, so an artifact that captured one will break. This is deliberate, and our locator strategy must rank them low.
* **Non semantic controls.** At least one control is a `<td onclick>` styled as a button, with no role and no accessible name. It carries inner text only. A `title` attribute would defeat the point, because Chromium feeds `title` into the accessible name computation, so the control would quietly become nameable and the fallback would never be exercised. Its test asserts what is actually true of the accessible name rather than what the document wishes were true. This is the case where the accessibility tree degrades and we have to fall back, which makes the ladder honest instead of decorative.
* **Server rendered with full page reloads.** No SPA routing. Navigation is real.
* **Inconsistent casing and whitespace** in labels, because real legacy apps have `Member  ID:` with two spaces.

We add a small number of accessible controls too. A surface where nothing works would just prove the fallback path, and we need to prove the primary path as well.

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

Armed through `POST /__control__/fault`, always with a route scope and a count. Query parameter arming is gone. Replay controls its own URLs, so a fault that can only be armed by appending a parameter is unreachable from the code path it is supposed to test, and a fault that fires on an unspecified first request is a coin toss rather than a test.

| Fault | Behaviour | Exercises |
| --- | --- | --- |
| `slow` | Fixed configurable delay, default 2000ms, under the step timeout | Condition based waiting |
| `flaky503` | 503 for N requests on the scoped route, then success | `TransientLoad` recovery and retry |
| `hang` | Never responds, and the held response is released by `/__control__/reset` | `Timeout` failure with a named condition |
| `500` | Application error page | `SurfaceUnavailable` |
| `denied` | Permission denied panel on member detail | `ACCOUNT_RESTRICTED` business outcome |
| `interstitial` | A known "System maintenance tonight" overlay with a dismiss button | `KnownInterstitial` recovery |
| `surpriseDialog` | An undeclared HTML modal with two ambiguous buttons | Escalation, must not be clicked through |
| `expireSession` | Clears the session, next request redirects to login | `SessionExpired` and re auth |
| `validation` | Sub account form rejects with a field level error | Validation error as a typed business outcome |
| `duplicateIds` | Search returns two members with the same displayed ID | `LocatorAmbiguous` |
| `relabel` | Renames `Member ID` to `Account Holder ID` | Locator drift and fallback ladder. The drift row of the result matrix depends on this one, so it is not cuttable |

## 6. Seed data

Small, synthetic, obviously fake, committed as `apps/target/seed.json`. No real PII, not even plausible looking.

| Member ID | Name | State |
| --- | --- | --- |
| `10001` | Test Member One | Normal, savings 4,250.75 |
| `10002` | Test Member Two | Restricted, triggers `ACCOUNT_RESTRICTED` without a fault flag |
| `10003` | Test Member Three | Has three sub accounts, exercises multi row tables |
| `10004` | Test Member Four | Zero balance, exercises money parsing of `$0.00` |
| `00000` | not present | Triggers `MEMBER_NOT_FOUND` |

Balances are rendered inconsistently on purpose, one as `$4,250.75`, another as `4250.75 USD`, another as `(125.00)` for a negative. Money parsing has to be real, and the parser gets unit tests from these three formats.

## 7. Tenant variants

The same Express app serves two tenants from one engine plus a config file. This demonstrates cross tenant reuse for near zero cost.

```
apps/target/tenants/
  acme.json        the base, which we record against
  borealis.json    the variant, which we replay against with an overlay
```

Differences in `borealis`.

* Branding and page titles.
* `Member ID` is labelled `Member Number`.
* The search form has an extra optional `Branch` dropdown before the submit button.
* The savings balance sits in a different column of the accounts table.
* An extra confirmation interstitial appears after login.

Selected by `Host` header, with `acme.localhost:4010` and `borealis.localhost:4010` both listed in the allowlist so tenant selection never needs a policy exception. Same routes, same engine, different rendering. That is exactly the real situation the brief describes, hundreds of tenants running the same vendor product configured differently.

The demonstration is that an artifact recorded on `acme` replays on `borealis` with a sparse overlay, rather than being re recorded. The overlay rebinds the member ID locator and the balance output, and declares the post login interstitial as an `onCondition` rule. Rebinding an output is the case ADR 0007 forbade and ADR 0015 permits, and it is the most common real difference between two tenants on one product. Without the overlay it fails with `LocatorNotFound` and names every strategy it tried, which is the honest failure mode and also good evidence.

## 8. Constraints on building it

* No database. A JSON seed loaded into memory, reset by `/__control__/reset`.
* No build step. EJS templates served directly.
* Deterministic. Same request plus same state gives the same HTML, apart from the intentionally generated IDs which are seeded per process.
* Starts in under two seconds, because integration tests start it.
* Fully documented in `README.md` as a fixture, so a reviewer does not mistake it for the deliverable.
* It gets a small test of its own, asserting each fault actually produces its documented behaviour. A broken fixture that silently stops injecting faults would quietly turn the error handling tests green for the wrong reason.
