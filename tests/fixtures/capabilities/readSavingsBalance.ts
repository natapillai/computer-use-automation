import type { LocatorBundle } from '../../../src/core/locator/schema.js';
import type { CapabilityInput } from '../../../src/core/capability/schema.js';

// The hand authored fixture for member.readSavingsBalance. It is a test fixture and
// never the evidence artifact, see ADR 0018. Every input value is a template, so no
// member ID appears here as a literal.
export function readSavingsBalanceFixture(): CapabilityInput {
  const memberIdField: LocatorBundle = {
    framePath: ['content'],
    strategies: [
      {
        kind: 'anchor-relative',
        anchor: { kind: 'text', text: 'Member ID:', exact: false, confidence: 0.8 },
        relation: 'sameRow',
        role: 'textbox',
        confidence: 0.8,
      },
      {
        kind: 'anchor-relative',
        anchor: { kind: 'role-name', role: 'heading', name: 'Member Search', exact: true, confidence: 0.9 },
        relation: 'firstBelow',
        role: 'textbox',
        confidence: 0.6,
      },
    ],
    matchPolicy: 'unique',
    describedAs: 'Member ID input',
  };

  const searchButton: LocatorBundle = {
    framePath: ['content'],
    strategies: [
      { kind: 'role-name', role: 'cell', name: 'Search', exact: true, confidence: 0.7 },
      { kind: 'text', text: 'Search', exact: true, confidence: 0.6 },
    ],
    matchPolicy: 'unique',
    describedAs: 'Search button',
  };

  const resultLink: LocatorBundle = {
    framePath: ['content'],
    strategies: [{ kind: 'role-name', role: 'link', name: '{{inputs.memberId}}', exact: true, confidence: 0.9 }],
    matchPolicy: 'unique',
    describedAs: 'Result row link for the member',
  };

  const balanceCell: LocatorBundle = {
    framePath: ['content'],
    strategies: [
      {
        kind: 'anchor-relative',
        anchor: { kind: 'text', text: 'Savings', exact: true, confidence: 0.8 },
        relation: 'rightOf',
        role: 'cell',
        confidence: 0.8,
      },
    ],
    matchPolicy: 'unique',
    describedAs: 'Savings balance cell',
  };

  const noRecordsBanner: LocatorBundle = {
    framePath: ['content'],
    strategies: [{ kind: 'text', text: 'No records found', exact: false, confidence: 0.8 }],
    matchPolicy: 'unique',
    describedAs: 'No records banner',
  };

  return {
    schemaVersion: '1.0.0',
    id: 'member.readSavingsBalance',
    version: '1.0.0',
    name: 'Read member savings balance',
    description: 'Looks up a member by ID and returns the current balance of their primary savings account.',
    app: { appId: 'meridian-core', vendor: 'meridian', entryPath: '/servicing' },
    surface: { kind: 'legacy-web', minDriverVersion: '1.0.0', capabilitiesRequired: ['frames'] },
    inputs: [
      {
        name: 'memberId',
        type: 'string',
        required: true,
        sensitivity: 'pii',
        description: 'Institution member number',
        constraints: { pattern: '^[0-9]{5,10}$' },
      },
    ],
    outputs: [
      {
        name: 'savingsBalance',
        type: 'money',
        required: true,
        sensitivity: 'pii',
        description: 'Current balance of the primary savings account',
        source: {
          stepId: 'openMemberDetail',
          target: balanceCell,
          attribute: 'text',
          parse: { kind: 'money', currency: 'USD' },
        },
      },
    ],
    outcomes: [
      {
        code: 'MEMBER_NOT_FOUND',
        description: 'No member exists with the supplied ID.',
        terminal: true,
        detect: { kind: 'textMatches', target: noRecordsBanner, pattern: 'No records found' },
        provenance: 'manual',
      },
    ],
    steps: [
      {
        id: 'openSearch',
        index: 0,
        intent: 'Open the member search screen inside the content frame',
        action: { kind: 'navigate', path: '/servicing/search', framePath: ['content'] },
        effect: 'read',
        idempotent: true,
        retry: { attempts: 2, backoffMs: 500 },
        postcondition: { description: 'Search form is present', condition: { kind: 'elementPresent', target: memberIdField } },
      },
      {
        id: 'fillMemberId',
        index: 1,
        intent: 'Enter the member ID',
        action: { kind: 'fill' },
        target: memberIdField,
        value: '{{inputs.memberId}}',
        effect: 'read',
        idempotent: true,
        retry: { attempts: 2, backoffMs: 250 },
        postcondition: {
          description: 'Member ID field holds the supplied value',
          condition: { kind: 'textMatches', target: memberIdField, pattern: '^{{inputs.memberId}}$' },
        },
      },
      {
        id: 'submitSearch',
        index: 2,
        intent: 'Submit the member search form',
        action: { kind: 'click' },
        target: searchButton,
        effect: 'read',
        idempotent: false,
        retry: { attempts: 0 },
        postcondition: { description: 'A result row for the member is present', condition: { kind: 'elementPresent', target: resultLink } },
        onCondition: [
          { when: { kind: 'elementPresent', target: noRecordsBanner }, classify: 'business_outcome', code: 'MEMBER_NOT_FOUND' },
        ],
      },
      {
        id: 'openMemberDetail',
        index: 3,
        intent: 'Open the member detail screen',
        action: { kind: 'click' },
        target: resultLink,
        effect: 'read',
        idempotent: true,
        retry: { attempts: 2, backoffMs: 250 },
        postcondition: { description: 'The accounts table is present', condition: { kind: 'elementPresent', target: balanceCell } },
      },
    ],
    successCondition: {
      description: 'Member detail screen shows a savings balance',
      condition: {
        kind: 'all',
        of: [
          { kind: 'elementPresent', target: balanceCell },
          { kind: 'outputResolvable', outputName: 'savingsBalance' },
        ],
      },
    },
    policy: {
      maxEffect: 'read',
      requiresApproval: true,
      allowUnattendedReplay: false,
      maxStepDurationMs: 20_000,
      maxTotalDurationMs: 120_000,
    },
    provenance: {
      recordedAt: '2026-09-14T00:00:00.000Z',
      discoveryRunId: 'hand_authored_fixture',
      model: 'none, hand authored',
      promptVersion: '0.0.0',
      recorderVersion: '0.0.0',
      generalizerVersion: '0.0.0',
      redactionApplied: true,
    },
    lifecycle: { status: 'draft' },
  };
}
