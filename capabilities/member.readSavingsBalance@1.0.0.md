# Read member savings balance

member.readSavingsBalance version 1.0.0, draft.

Looks up a member by ID and returns the current balance of their primary savings account.

## What it does

1. Enter the memberId input into textbox Member ID:
2. Click cell Search
3. Click link the memberId input

## Inputs

* memberId, string, required, pii. Institution member number

## Outputs

* savingsBalance, money, pii. The value read from cell right of Savings

## Declared outcomes

* none, so any state this capability does not expect reports as a failure

## What approving it allows

* Highest effect any step may have: read.
* May run unattended once approved: no.
* Bounded at 120000ms in total and 20000ms per step.

Discovered by claude-sonnet-5 on run run_84705a0a-7840-4584-b39a-035d9f9d81f8.
