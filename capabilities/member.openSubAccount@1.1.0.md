# Open a member sub account

member.openSubAccount version 1.1.0, draft.

Opens a new sub account of a given type for a member, with an opening deposit, and returns the suffix the system assigned. The form is reached by path because MERIDIAN Core links to it from nowhere, so the goal names it.

## What it does

1. Open /member/the memberId input/subaccount in the content frame
2. Choose the accountType input in combobox Account Type:
3. Enter the openingAmount input into textbox Opening Amount:
4. Click cell Open Account (writes)

## Inputs

* memberId, string, required, pii. Institution member number
* accountType, enum, required, internal. The kind of sub account to open
* openingAmount, string, required, pii. The opening deposit, at least $25.00

## Outputs

* suffix, string, internal. The value read from cell H01

## Declared outcomes

* AMOUNT_BELOW_MINIMUM, terminal. The opening amount is below the minimum this account type allows, so no account was opened.

## What approving it allows

* Highest effect any step may have: write.
* May run unattended once approved: no.
* Bounded at 120000ms in total and 20000ms per step.

Discovered by claude-sonnet-5 on run run_e5b46f88-d93c-4efc-8137-6abc2372e48f.
