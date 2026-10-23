/**
 * Actual Next HTTP-server proof for public/protected page routing and operator
 * session hand-off. This complements direct route-handler tests: it validates
 * filesystem route mapping, server redirects, cookies, and compiled page output
 * over TCP without treating static HTML as proof of browser interaction.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPin } from '../../src/auth/hash.js';
import { ar } from '../../src/ui/copy/ar.js';
import { freshRealDatabase, seedYard, stopServer, type Seed, type TestDb } from '../db/pg-harness.js';

let t: TestDb;
let A: Seed;
let baseUrl: string;
let server: ChildProcessWithoutNullStreams | undefined;
let previousDatabaseUrl: string | undefined;

async function freePort(): Promise<number> {
  const probe: Server = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('could not allocate a TCP port');
  const { port } = address;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function waitForNext(url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/login`, { redirect: 'manual' });
      if (response.status === 200) return;
      lastFailure = `status ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next server did not start: ${lastFailure}`);
}

async function stopNext(): Promise<void> {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.get('set-cookie');
  const matched = cookie?.match(new RegExp(`(?:^|,\\s*|;)${name}=([^;,]+)`));
  if (!matched?.[1]) throw new Error(`Missing ${name} cookie`);
  return decodeURIComponent(matched[1]);
}

beforeAll(async () => {
  t = await freshRealDatabase();
  A = await seedYard(t.admin, 'شبكة', await hashPin('4271'));
  previousDatabaseUrl = process.env.DATABASE_URL;
  const port = await freePort();
  // Next dev normalizes its request URL host to localhost, so use the same
  // browser-visible host for the Origin double-submit check.
  baseUrl = `http://localhost:${port}`;
  const environment = { ...process.env };
  delete environment.SUPABASE_URL;
  delete environment.SUPABASE_PUBLISHABLE_KEY;
  delete environment.SUPABASE_ANON_KEY;
  delete environment.NEXT_PUBLIC_SUPABASE_URL;
  delete environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  environment.DATABASE_URL = `postgres://${t.runtimeUser}:rtpw@localhost:${process.env.TEST_PG_PORT ?? '55433'}/${t.dbName}`;
  environment.NEXT_TELEMETRY_DISABLED = '1';
  server = spawn(process.execPath, [
    './node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd: process.cwd(), env: environment, stdio: 'pipe' });
  server.stderr.on('data', () => undefined);
  server.stdout.on('data', () => undefined);
  await waitForNext(baseUrl);
}, 180_000);

afterAll(async () => {
  await stopNext();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  await t?.close();
  await stopServer();
});

describe('Next page routing over HTTP', () => {
  it('serves public pages, redirects anonymous protected deep links, and does not mistake a stale opaque cookie for an authenticated API session', async () => {
    const root = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    expect(root.status).toBe(307);
    expect(root.headers.get('location')).toBe('/login');

    const login = await fetch(`${baseUrl}/login`);
    expect(login.status).toBe(200);
    expect(await login.text()).toContain(ar.auth.operatorTitle);

    const anonymous = await fetch(`${baseUrl}/today`, { redirect: 'manual' });
    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get('location')).toBe('/login');

    const staleShell = await fetch(`${baseUrl}/today`, {
      headers: { cookie: 'kayyal_operator_session=not-a-real-session' }, redirect: 'manual',
    });
    expect(staleShell.status).toBe(200);
    expect(await staleShell.text()).toContain(ar.state.sessionCheckingTitle);
    const staleApi = await fetch(`${baseUrl}/api/session`, { headers: { cookie: 'kayyal_operator_session=not-a-real-session' } });
    expect(staleApi.status).toBe(401);
    expect(await staleApi.json()).toMatchObject({ error: { code: 'unauthenticated' } });

    for (const path of ['/forbidden', '/offline']) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(ar.common.returnToLogin);
    }
    const missing = await fetch(`${baseUrl}/does-not-exist`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain(ar.state.notFoundTitle);
    const preview = await fetch(`${baseUrl}/ui-preview?role=operator`);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain(ar.preview.operatorTitle);
  });

  it('creates an operator browser session over HTTP and admits every implemented protected page/deep-link route to the server-side shell', async () => {
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
    expect(csrfResponse.status).toBe(200);
    const csrf = cookieValue(csrfResponse, 'kayyal_csrf');
    expect(csrf, csrfResponse.headers.get('set-cookie') ?? 'missing set-cookie').toHaveLength(43);
    const code = (await t.admin.query<{ operator_login_code: string }>(
      'SELECT operator_login_code FROM app.yards WHERE id = $1', [A.yardId],
    )).rows[0]!.operator_login_code;
    const signedIn = await fetch(`${baseUrl}/api/auth/operator/session`, {
      method: 'POST',
      headers: {
        origin: baseUrl,
        cookie: `kayyal_csrf=${encodeURIComponent(csrf)}`,
        'content-type': 'application/json',
        'x-kayyal-csrf': csrf,
      },
      body: JSON.stringify({ operator_login_code: code, display_name: 'عامل شبكة', pin: '4271' }),
    });
    expect(signedIn.status, await signedIn.text()).toBe(201);
    const token = cookieValue(signedIn, 'kayyal_operator_session');
    const sessionCookie = `kayyal_operator_session=${encodeURIComponent(token)}`;

    const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie: sessionCookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ data: { role: 'operator' } });

    const randomId = randomUUID();
    const protectedPaths = [
      '/cash', '/expense', '/history', '/inventory', `/inventory/${A.copperId}`, '/materials', '/parties',
      `/parties/${randomId}`, '/payment?party=' + randomId, '/purchase', '/sale', '/today',
      `/transactions/${randomId}`, `/transactions/${randomId}/receipt`, `/transactions/${randomId}/cost-adjustment`,
    ];
    for (const path of protectedPaths) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: sessionCookie }, redirect: 'manual' });
      expect(response.status, path).toBe(200);
      const html = await response.text();
      expect(html, path).toContain(ar.state.sessionCheckingTitle);
      expect(html, path).not.toContain(A.yardId);
    }
  });
});
