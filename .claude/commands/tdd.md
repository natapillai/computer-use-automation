---
description: Run one strict red green refactor cycle on the named behaviour
---

One red green refactor cycle on the behaviour I name. One behaviour only.

**Red.** Write a single test for that one behaviour. Run it. Show me the output. Confirm the failure message describes the missing behaviour, not a missing module or a syntax error. If the failure is structural, fix the structure and get back to a meaningful failure before continuing.

**Green.** Write the least code that makes it pass. Not the code you expect to need in two tasks. Run the test. Show me it passing.

**Refactor.** Improve the shape with the test green. Run again.

Then run `npm run test` and `npm run typecheck` to confirm nothing else broke.

Rules.
* If three assertions are about three different things, that is three tests. Say so and do them one at a time.
* Never edit a test to match an implementation that surprised you. Work out which one is wrong first and tell me.
* If you cannot write the test, the design is unclear. Stop and resolve the design.
