// API tests for the dashboard's Express REST API.
// These run without a browser and without bank credentials, so they run on every CI build.
import { test, expect } from '@playwright/test';
import {
  testListSchema,
  logEventSchema,
  resultEventSchema,
  notFoundSchema,
} from './schemas';
import { expectToMatchSchema, parseNdjson } from '../support/schema';
import type { LogEvent, ResultEvent, TestListItem } from '../support/api-types';

test.describe('GET /api/tests', () => {
  test('returns 200 with a JSON list that matches the contract', { tag: '@R4' }, async ({ request }) => {
    const res = await request.get('/api/tests');

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expectToMatchSchema(await res.json(), testListSchema);
  });

  test('lists every test exactly once, for both engines', { tag: '@R4' }, async ({ request }) => {
    const tests: TestListItem[] = await (await request.get('/api/tests')).json();
    const names = tests.map((t) => t.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'login',
        'invalid-login-rejected',
        'login-playwright',
        'invalid-login-rejected-playwright',
      ])
    );
    expect(tests.some((t) => t.engine === 'selenium')).toBe(true);
    expect(tests.some((t) => t.engine === 'playwright')).toBe(true);
  });

  test('responds quickly', { tag: '@R11' }, async ({ request }) => {
    const start = Date.now();
    await request.get('/api/tests');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

test.describe('POST /api/tests/:name/run', () => {
  test('unknown test name returns 404 with an error body', { tag: '@R5' }, async ({ request }) => {
    const res = await request.post('/api/tests/does-not-exist/run');

    expect(res.status()).toBe(404);
    expectToMatchSchema(await res.json(), notFoundSchema);
  });

  const maliciousNames = [
    '..%2F..%2Fserver',
    '%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    "login'%20OR%20'1'%3D'1",
    'a'.repeat(500),
  ];

  for (const name of maliciousNames) {
    test(`rejects malicious test name: ${name.slice(0, 40)}`, { tag: '@R5' }, async ({ request }) => {
      const res = await request.post(`/api/tests/${name}/run`);
      expect(res.status()).toBe(404);
    });
  }

  test('GET on a run endpoint is not allowed', { tag: '@R5' }, async ({ request }) => {
    const res = await request.get('/api/tests/login/run');
    expect(res.status()).toBe(404);
  });

  test('streams NDJSON events that end in a single result', { tag: '@R6' }, async ({ request }) => {
    test.setTimeout(60_000);
    const res = await request.post('/api/tests/invalid-login-rejected-playwright/run', {
      timeout: 55_000,
    });

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/x-ndjson');

    const events = parseNdjson(await res.text());
    const results = events.filter((e): e is ResultEvent => e.type === 'result');
    const logs = events.filter((e): e is LogEvent => e.type === 'log');

    // Exactly one result, and it is the last event in the stream.
    expect(results).toHaveLength(1);
    expect(events[events.length - 1]?.type).toBe('result');
    expectToMatchSchema(results[0], resultEventSchema);
    expect(results[0].name).toBe('invalid-login-rejected-playwright');

    // Every log line belongs to the test that was run.
    for (const log of logs) {
      expectToMatchSchema(log, logEventSchema);
      expect(log.test).toBe('invalid-login-rejected-playwright');
    }
  });
});
