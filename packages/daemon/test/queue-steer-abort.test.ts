import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Daemon } from '../src/server.js';

type Received = { type: string; correlationId?: string; sessionId?: string; error?: { message: string } };

class Client {
  ws: WebSocket;
  received: Received[] = [];
  #waiters: { predicate: (event: Received) => boolean; resolve: (event: Received) => void }[] = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
    this.ws.on('message', (data) => {
      const event = JSON.parse(String(data)) as Received;
      this.received.push(event);
      this.#waiters = this.#waiters.filter((waiter) => waiter.predicate(event) ? (waiter.resolve(event), false) : true);
    });
  }

  async open() {
    await new Promise<void>((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
  }

  waitFor(predicate: (event: Received) => boolean, timeout = 30_000) {
    const existing = this.received.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<Received>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('protocol event timed out')), timeout);
      this.#waiters.push({ predicate, resolve: (event) => { clearTimeout(timer); resolve(event); } });
    });
  }

  command(type: string, payload: unknown, sessionId?: string) {
    const id = `queue_${Math.random().toString(36).slice(2)}`;
    const response = this.waitFor((event) => event.correlationId === id);
    this.ws.send(JSON.stringify({ protocolVersion: 1, type, id, payload, sessionId }));
    return response;
  }
}

describe('queue, steer, and abort protocol integration', () => {
  let daemon: Daemon;
  let client: Client;
  let workspace = '';
  let sessionId = '';

  beforeAll(async () => {
    const available = await fetch('http://127.0.0.1:8788/v1/models').then((response) => response.ok).catch(() => false);
    if (!available) throw new Error('stub LLM is required for queue integration');
    workspace = mkdtempSync(join(tmpdir(), 'omp-webui-queue-ws-'));
    daemon = new Daemon({ host: '127.0.0.1', port: 0 });
    await daemon.start();
    client = new Client(daemon.port);
    await client.open();
    await client.waitFor((event) => event.type === 'connection.ready');
    const workspaceResponse = await client.command('workspace.open', { root: workspace });
    const workspaceId = (workspaceResponse as Received & { payload?: { workspace?: { id?: string } } }).payload?.workspace?.id;
    if (!workspaceId) throw new Error('workspace did not open');
    const created = await client.command('session.create', { workspaceId });
    sessionId = created.sessionId ?? '';
    if (!sessionId) throw new Error('session did not create');
    await client.waitFor((event) => event.type === 'worker.ready');
  }, 45_000);

  afterAll(async () => {
    client?.ws.close();
    await daemon?.stop();
  });

  it('accepts follow-up, steer, and abort commands while a long prompt is in flight', async () => {
    const submit = await client.command('prompt.submit', { message: 'long' }, sessionId);
    const queued = await client.command('prompt.queue', { message: 'queued work' }, sessionId);
    const steered = await client.command('prompt.steer', { message: 'steer this response' }, sessionId);
    const aborted = await client.command('prompt.abort', {}, sessionId);

    expect(submit.error).toBeUndefined();
    expect(queued.error).toBeUndefined();
    expect(steered.error).toBeUndefined();
    expect(aborted.error).toBeUndefined();
  }, 45_000);
});
