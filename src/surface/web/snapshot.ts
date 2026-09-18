import { z } from 'zod';
import { INTERACTIVE_ROLES, VALUE_ROLES } from '../../core/surfaceModel/roles.js';
import type { Box, UINode } from '../../core/surfaceModel/types.js';

// Translates page.ariaSnapshotJSON({ mode: 'ai', boxes: true }) into the surface model,
// see ADR 0012. Boxes are relative to each frame's own viewport. That is what relations
// need, because a relation never crosses a frame.

interface SnapshotNode {
  readonly role?: string | undefined;
  readonly name?: string | undefined;
  readonly text?: string | undefined;
  readonly ref?: string | undefined;
  readonly cursor?: string | undefined;
  readonly active?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly checked?: boolean | 'mixed' | undefined;
  readonly selected?: boolean | undefined;
  readonly box?: Box | undefined;
  readonly children?: readonly (string | SnapshotNode)[] | undefined;
}

type SnapshotEntry = string | SnapshotNode;

const SnapshotBox = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

// Loose, because Playwright adds properties such as level and url that this driver does
// not read, and a new one should not break perception.
const SnapshotNode: z.ZodType<SnapshotNode> = z.lazy(() =>
  z.looseObject({
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    ref: z.string().optional(),
    cursor: z.string().optional(),
    active: z.boolean().optional(),
    disabled: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    selected: z.boolean().optional(),
    box: SnapshotBox.optional(),
    children: z.array(z.union([z.string(), SnapshotNode])).optional(),
  }),
);

const Snapshot = z.union([z.array(z.union([z.string(), SnapshotNode])), SnapshotNode]);

const NO_BOX: Box = { x: 0, y: 0, width: 0, height: 0 };

interface Parent {
  readonly ref: string;
  readonly box: Box;
  readonly framePath: readonly string[];
}

interface Converted {
  readonly node: UINode;
  readonly active: boolean;
}

export function iframeRefsOf(snapshot: unknown): readonly string[] {
  const refs: string[] = [];
  const visit = (entry: SnapshotEntry): void => {
    if (typeof entry === 'string') return;
    if (entry.role === 'iframe' && entry.ref !== undefined) refs.push(entry.ref);
    for (const child of entry.children ?? []) visit(child);
  };
  for (const entry of topLevel(snapshot)) visit(entry);
  return refs;
}

// frameNames maps an iframe ref to the name of the frame it hosts. An iframe the driver
// could not name gets a segment built from its ref, which no real frame name matches.
export function toUINodeTree(snapshot: unknown, frameNames: ReadonlyMap<string, string>): UINode {
  const top: Parent = { ref: 'root', box: NO_BOX, framePath: [] };
  const converted = topLevel(snapshot).map((entry, index) => convert(entry, index, top, frameNames).node);
  const [only] = converted;
  if (converted.length === 1 && only !== undefined) return only;
  return { ref: 'root', role: 'document', name: '', state: hiddenState(), framePath: [], box: NO_BOX, clickableHint: false, children: converted };
}

function topLevel(snapshot: unknown): readonly SnapshotEntry[] {
  const parsed = Snapshot.safeParse(snapshot);
  if (!parsed.success) throw new TypeError('The accessibility snapshot does not have the shape this driver reads.');
  return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
}

// The name of the option a list is showing. Chromium marks exactly one, and a list with
// nothing chosen still marks its first option, so this never invents a value.
function selectedOption(children: readonly (string | SnapshotNode)[] | undefined): string | undefined {
  for (const child of children ?? []) {
    if (typeof child === 'string' || child.role !== 'option') continue;
    if (child.selected === true) return child.name ?? '';
  }
  return undefined;
}

function convert(entry: SnapshotEntry, index: number, parent: Parent, frameNames: ReadonlyMap<string, string>): Converted {
  // A bare text fragment has no ref and no box of its own. It takes its parent's box, and
  // a ref with a character Playwright never emits, so acting on it can only miss.
  if (typeof entry === 'string') {
    return {
      active: false,
      node: {
        ref: `${parent.ref}~${index}`,
        role: 'text',
        name: entry,
        state: { disabled: false, visible: isVisible(parent.box), focused: false },
        framePath: parent.framePath,
        box: parent.box,
        clickableHint: false,
        children: [],
      },
    };
  }

  const role = entry.role ?? 'generic';
  const ref = entry.ref ?? `${parent.ref}~${index}`;
  const box = entry.box ?? NO_BOX;
  const childFramePath = role === 'iframe' ? [...parent.framePath, frameNames.get(ref) ?? `#${ref}`] : parent.framePath;
  const children = (entry.children ?? []).map((child, i) => convert(child, i, { ref, box, framePath: childFramePath }, frameNames));
  const activeBelow = children.some((child) => child.active);
  const holdsValue = VALUE_ROLES.has(role);
  // A native list carries no text of its own. What it holds is the option marked selected,
  // which is also what a person reads off the screen. Without this the tree says a list is
  // empty however it was set, so a choice is invisible to progress, to checkpoints and to the
  // generalizer, which then drops the step that made it.
  const chosen = entry.text ?? selectedOption(entry.children);

  const node: UINode = {
    ref,
    role,
    name: entry.name ?? (holdsValue ? '' : (entry.text ?? '')),
    ...(holdsValue && chosen !== undefined ? { value: chosen } : {}),
    state: {
      disabled: entry.disabled === true,
      visible: isVisible(box),
      // Chromium marks every ancestor of the focused element active. Focus is the deepest.
      focused: entry.active === true && !activeBelow,
      ...(typeof entry.checked === 'boolean' ? { checked: entry.checked } : {}),
    },
    framePath: parent.framePath,
    box,
    clickableHint: entry.cursor === 'pointer' && !INTERACTIVE_ROLES.has(role),
    children: children.map((child) => child.node),
  };
  return { node, active: entry.active === true || activeBelow };
}

function isVisible(box: Box): boolean {
  return box.width > 0 && box.height > 0;
}

function hiddenState(): UINode['state'] {
  return { disabled: false, visible: false, focused: false };
}
