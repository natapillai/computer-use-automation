// The surface model. Every driver produces these types and core reasons over them,
// so no browser or platform type appears in this file. See docs/ARCHITECTURE.md
// section 3.

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NodeState {
  readonly disabled: boolean;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly checked?: boolean;
}

// There is no raw platform handle on a node. The driver resolves a ref to its live
// element, which keeps every node serialisable into a trace or a prompt.
export interface UINode {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly derivedLabel?: string;
  readonly value?: string;
  readonly state: NodeState;
  readonly framePath: readonly string[];
  readonly box: Box;
  readonly clickableHint: boolean;
  readonly children: readonly UINode[];
}

export interface FrameState {
  readonly framePath: readonly string[];
  readonly url: string;
  readonly lastStatus: number | null;
}

export interface Observation {
  readonly root: UINode;
  readonly frames: readonly FrameState[];
  readonly dialogOpen: boolean;
}

export const ACTION_VERBS = [
  'navigate',
  'click',
  'fill',
  'select',
  'press',
  'hover',
  'scroll',
  'waitFor',
  'extract',
  'assert',
  'dismiss',
] as const;

export type ActionVerb = (typeof ACTION_VERBS)[number];

// The verbs that touch the surface. waitFor, extract and assert are executor
// operations built on observe, so they never reach a driver as an action.
export type ResolvedAction =
  | { readonly kind: 'navigate'; readonly path: string; readonly framePath: readonly string[] }
  | { readonly kind: 'click'; readonly ref: string }
  | { readonly kind: 'fill'; readonly ref: string; readonly value: string }
  | { readonly kind: 'select'; readonly ref: string; readonly value: string }
  | { readonly kind: 'press'; readonly ref: string; readonly key: string }
  | { readonly kind: 'hover'; readonly ref: string }
  | { readonly kind: 'scroll'; readonly ref: string }
  | { readonly kind: 'dismiss'; readonly ref: string };

export type ActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'not_found' | 'disabled' | 'not_actionable' | 'navigation_failed';
      readonly detail: string;
    };
