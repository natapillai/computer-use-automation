import type Anthropic from '@anthropic-ai/sdk';

// The seam between the discovery loop and a model. The live client calls the API, the fake
// returns a script, and the cassette replays a recorded run. The loop never knows which.

// observationHash and observationText describe what the model is being shown in this
// request. A cassette asserts the hash and uses the text to explain a mismatch, per ADR 0017.
export interface ModelRequest {
  readonly params: Anthropic.MessageCreateParamsNonStreaming;
  readonly observationHash: string;
  readonly observationText?: string;
}

// A failed call is a typed value. The loop ends the run on it and never retries.
export type ModelResult =
  | { readonly ok: true; readonly response: Anthropic.Message }
  | { readonly ok: false; readonly failure: 'ModelCallFailed'; readonly detail: string };

export interface ModelClient {
  next(request: ModelRequest): Promise<ModelResult>;
}
