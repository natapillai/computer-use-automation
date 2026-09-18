import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { SessionControl } from '../control/controlPlane.js';
import type { HumanActionRecord, HumanInputPort } from './humanInput.js';
import type { InterventionStore } from './intervention.js';
import { OPERATOR_PAGE } from './operatorPage.js';

// The operator API of docs/ESCALATION.md section 5, hosted by the run itself so the person it
// calls can reach the live session, see ADR 0016. Every state changing call proves it holds the
// session first. This path never goes through act(), so it cannot inherit the fencing ADR 0008
// put there and has to carry it explicitly.

export interface OperatorApiOptions {
  readonly store: InterventionStore;
  readonly control: SessionControl;
  // Already masked. There is no unmasked screenshot anywhere in this system.
  readonly screenshot: (sessionId: string) => Promise<Uint8Array>;
  // How a person acts on the live session. Without it the run shows a screenshot and takes no
  // input, which is a console that can only watch.
  readonly input?: HumanInputPort;
  readonly onHumanAction?: (record: HumanActionRecord) => void;
  readonly host?: string;
  readonly port?: number;
}

export interface InjectedResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly body: string;
  readonly rawPayload: Buffer;
}

export interface InjectedRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface OperatorApi {
  // In process, for tests and for the mock operator. No socket is opened.
  inject(request: InjectedRequest): Promise<InjectedResponse>;
  listen(): Promise<string>;
  close(): Promise<void>;
}

type WithId = { Params: { id: string } };

export async function createOperatorApi(options: OperatorApiOptions): Promise<OperatorApi> {
  const app = Fastify({ logger: false });

  // The token the claim handed out. A forged or stale one is refused before anything moves,
  // because the whole point of the handover is that exactly one holder is valid at a time.
  const holds = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const offered = request.headers['x-control-token'];
    const current = options.control.current();
    if (current === null || current.holder !== 'human' || offered !== current.value) {
      void reply.code(403).send({ error: 'That token does not hold this session.' });
      return false;
    }
    return true;
  };

  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(OPERATOR_PAGE));

  app.get('/interventions', async () => options.store.list());

  // One link for both readers. The run prints this URL, and a person opening it in a browser
  // gets the console while anything else gets the intervention itself.
  app.get<WithId>('/interventions/:id', async (request, reply) => {
    const intervention = options.store.get(request.params.id);
    if (intervention === null) return reply.code(404).send({ error: 'No such intervention.' });
    const wantsPage = (request.headers.accept ?? '').includes('text/html');
    return wantsPage ? reply.type('text/html; charset=utf-8').send(OPERATOR_PAGE) : reply.send(intervention);
  });

  app.get<WithId>('/sessions/:id/screenshot', async (request, reply) => {
    if (request.params.id !== options.control.snapshot().sessionId) return reply.code(404).send({ error: 'No such session.' });
    return reply.type('image/png').send(Buffer.from(await options.screenshot(request.params.id)));
  });

  // The forwarding path. It never goes through act(), so the holder check here is the only
  // thing standing between a stale operator and the live page.
  app.post<{ Params: { id: string }; Body: { kind?: string; x?: number; y?: number; key?: string } }>('/sessions/:id/input', async (request, reply) => {
    if (request.params.id !== options.control.snapshot().sessionId || options.input === undefined) return reply.code(404).send({ error: 'No such session.' });
    if (!holds(request, reply)) return reply;

    const body = request.body ?? {};
    const record =
      body.kind === 'press' && typeof body.key === 'string'
        ? await options.input.press(body.key)
        : typeof body.x === 'number' && typeof body.y === 'number'
          ? await options.input.click({ x: body.x, y: body.y })
          : null;
    if (record === null) return reply.code(400).send({ error: 'Input is a click with x and y, or a press with a key.' });

    options.onHumanAction?.(record);
    return reply.send(record);
  });

  // Clicking cannot reach a page nothing links to, so a person who holds the session can send
  // a named frame to a path. The same allowlist bounds it and the top window is never moved,
  // both decided under the port rather than here, and a refusal says which rule stopped it.
  app.post<{ Params: { id: string }; Body: { path?: string; framePath?: unknown } }>('/sessions/:id/navigate', async (request, reply) => {
    if (request.params.id !== options.control.snapshot().sessionId || options.input === undefined) return reply.code(404).send({ error: 'No such session.' });
    if (!holds(request, reply)) return reply;

    const path = request.body?.path;
    const framePath = request.body?.framePath;
    if (typeof path !== 'string' || !Array.isArray(framePath) || !framePath.every((segment) => typeof segment === 'string')) {
      return reply.code(400).send({ error: 'A navigation is a path and a framePath of frame names.' });
    }

    const sent = await options.input.navigate({ path, framePath });
    if (!sent.ok) return reply.code(409).send({ reason: sent.reason, error: sent.detail });

    options.onHumanAction?.(sent.record);
    return reply.send(sent.record);
  });

  app.post<WithId>('/interventions/:id/claim', async (request, reply) => {
    const intervention = options.store.get(request.params.id);
    if (intervention === null) return reply.code(404).send({ error: 'No such intervention.' });
    if (options.store.status(intervention.id) !== 'open' || options.control.snapshot().state !== 'pending_human') {
      return reply.code(409).send({ error: 'That intervention is not waiting for someone.' });
    }

    const { token } = options.control.apply('claim', { interventionId: intervention.id });
    if (token === null) return reply.code(500).send({ error: 'The session issued no token.' });
    options.store.settle(intervention.id, 'claimed');
    return reply.send({ humanToken: token.value, sessionId: intervention.sessionId });
  });

  app.post<{ Params: { id: string }; Body: { outcome?: string; approval?: boolean } }>('/interventions/:id/release', async (request, reply) => {
    if (options.store.get(request.params.id) === null) return reply.code(404).send({ error: 'No such intervention.' });
    if (!holds(request, reply)) return reply;

    options.control.apply('release');
    // An approval is one action approved, not performed. The run performs it with a one shot
    // grant, see docs/ESCALATION.md section 5.
    options.store.settle(request.params.id, 'released', { approved: request.body?.approval === true });
    return reply.send({ state: options.control.snapshot().state });
  });

  app.post<WithId>('/interventions/:id/abort', async (request, reply) => {
    if (options.store.get(request.params.id) === null) return reply.code(404).send({ error: 'No such intervention.' });
    if (!holds(request, reply)) return reply;

    options.control.apply('abort');
    options.store.settle(request.params.id, 'aborted');
    return reply.send({ state: options.control.snapshot().state });
  });

  await app.ready();

  return {
    inject: async (request) => {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        ...(request.headers === undefined ? {} : { headers: { ...request.headers } }),
        ...(request.payload === undefined ? {} : { payload: { ...request.payload } }),
      });
      return { statusCode: response.statusCode, headers: response.headers, body: response.body, rawPayload: response.rawPayload };
    },
    listen: () => app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 4020 }),
    close: async () => {
      await app.close();
    },
  };
}
