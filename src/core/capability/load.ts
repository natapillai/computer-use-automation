import { Capability, SUPPORTED_SCHEMA_VERSION } from './schema.js';

export interface LoadIssue {
  readonly path: string;
  readonly message: string;
}

export type CapabilityParseResult =
  | { readonly ok: true; readonly capability: Capability }
  | { readonly ok: false; readonly failure: 'SchemaIncompatible'; readonly detail: string }
  | { readonly ok: false; readonly failure: 'CapabilityInvalid'; readonly issues: readonly LoadIssue[] };

// Pure. The caller reads the file, so core stays free of IO. The schema version is
// checked before anything else, because an artifact from a future engine may not even
// have the shape this engine would validate against.
export function parseCapability(input: unknown): CapabilityParseResult {
  const declared = declaredSchemaVersion(input);
  if (declared !== SUPPORTED_SCHEMA_VERSION) {
    const detail =
      declared === null
        ? `The artifact declares no schemaVersion. This engine supports ${SUPPORTED_SCHEMA_VERSION}.`
        : `The artifact declares schemaVersion ${declared}. This engine supports ${SUPPORTED_SCHEMA_VERSION}.`;
    return { ok: false, failure: 'SchemaIncompatible', detail };
  }

  const parsed = Capability.safeParse(input);
  if (parsed.success) {
    return { ok: true, capability: parsed.data };
  }

  return {
    ok: false,
    failure: 'CapabilityInvalid',
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
  };
}

function declaredSchemaVersion(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || !('schemaVersion' in input)) return null;
  return typeof input.schemaVersion === 'string' ? input.schemaVersion : null;
}
