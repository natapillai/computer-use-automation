export interface DocumentText {
  readonly path: string;
  readonly text: string;
}

export interface TaskReference {
  readonly path: string;
  readonly line: number;
  readonly id: string;
}

const DEFINITION = /^\* \[[ x]\] \*\*(S\d-T\d{2})\*\*/gm;

// An ID written as `retired S0-T08` is a deliberate historical reference, per S0-T01.
const REFERENCE = /(retired\s+)?\b(S\d-T\d{2})\b/g;

export function findUndefinedTaskReferences(
  documents: ReadonlyArray<DocumentText>,
  planText: string,
): TaskReference[] {
  const defined = new Set<string>();
  for (const match of planText.matchAll(DEFINITION)) {
    const id = match[1];
    if (id !== undefined) {
      defined.add(id);
    }
  }

  const undefinedReferences: TaskReference[] = [];
  for (const document of documents) {
    document.text.split('\n').forEach((text, index) => {
      for (const [, retired, id] of text.matchAll(REFERENCE)) {
        if (retired === undefined && id !== undefined && !defined.has(id)) {
          undefinedReferences.push({ path: document.path, line: index + 1, id });
        }
      }
    });
  }

  return undefinedReferences;
}
