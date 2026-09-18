// A person, headless. It is handed exactly what a real operator is handed, the URL the run
// announced, and it does everything else over the real HTTP API with the token the claim gives
// it. Nothing here reaches inside the run, because the whole point of the handoff is that an
// outside party can take the live session and give it back.

export interface OperatorSession {
  readonly interventionId: string;
  readonly sessionId: string;
  readonly token: string;
  readonly intervention: Readonly<Record<string, unknown>>;
  screenshot(): Promise<Uint8Array>;
  click(point: { readonly x: number; readonly y: number }): Promise<unknown>;
  press(key: string): Promise<unknown>;
}

export interface OperatorPlan {
  // What the person does while they hold the session. Omitted means they only looked.
  readonly work?: (session: OperatorSession) => Promise<void>;
  // How they hand it back. An approval is one action approved, never one performed.
  readonly finish: { readonly release: true; readonly approve?: boolean } | { readonly abort: true };
}

export interface HandledIntervention {
  readonly interventionId: string;
  readonly intervention: Readonly<Record<string, unknown>>;
  readonly screenshots: number;
}

// consoleUrl is the line the run printed, such as http://127.0.0.1:4020/interventions/int_000001.
export async function handleIntervention(consoleUrl: string, plan: OperatorPlan): Promise<HandledIntervention> {
  const url = new URL(consoleUrl);
  const interventionId = url.pathname.split('/').filter((part) => part !== '').at(-1) ?? '';
  const base = url.origin;

  const post = async (path: string, token: string | null, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        // Only when there is one. A content type with no body is a malformed request.
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === null ? {} : { 'x-control-token': token }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const answer: unknown = await response.json();
    if (!response.ok) throw new Error(`The console refused ${path} with ${response.status}. ${JSON.stringify(answer)}`);
    return answer;
  };

  const shown = await fetch(consoleUrl);
  if (!shown.ok) throw new Error(`The console did not show the intervention. ${shown.status}`);
  const intervention = (await shown.json()) as Record<string, unknown>;
  const sessionId = String(intervention['sessionId']);

  const claimed = await post(`/interventions/${interventionId}/claim`, null);
  const token = String(Reflect.get(claimed as object, 'humanToken'));
  let screenshots = 0;

  if (plan.work !== undefined) {
    await plan.work({
      interventionId,
      sessionId,
      token,
      intervention,
      screenshot: async () => {
        const response = await fetch(`${base}/sessions/${sessionId}/screenshot`, { headers: { 'x-control-token': token } });
        if (!response.ok) throw new Error(`The console refused the screenshot with ${response.status}.`);
        screenshots += 1;
        return new Uint8Array(await response.arrayBuffer());
      },
      click: (point) => post(`/sessions/${sessionId}/input`, token, { kind: 'click', x: point.x, y: point.y }),
      press: (key) => post(`/sessions/${sessionId}/input`, token, { kind: 'press', key }),
    });
  }

  if ('abort' in plan.finish) await post(`/interventions/${interventionId}/abort`, token, {});
  else await post(`/interventions/${interventionId}/release`, token, { approval: plan.finish.approve === true });

  return { interventionId, intervention, screenshots };
}
