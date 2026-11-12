import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { registerMatchRoutes } from '../apps/api/src/matches/routes.js';
import { readFileSync } from 'node:fs';

test('disabled feed stays independent from DB/provider and guest rate bucket', async () => {
  const old = process.env.MATCH_FEED_ENABLED;
  process.env.MATCH_FEED_ENABLED = 'false';
  const app = Fastify();
  try {
    await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
    await registerMatchRoutes(app, null);
    app.get('/guest-probe', () => ({ ok: true }));
    for (let i = 0; i < 3; i++) {
      const response = await app.inject('/v1/matches/t1');
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().enabled, false);
      assert.equal(response.json().source, 'Source: PandaScore');
    }
    assert.equal((await app.inject('/guest-probe')).statusCode, 200);
    assert.equal((await app.inject('/guest-probe')).statusCode, 429);
  } finally {
    await app.close();
    if (old === undefined) delete process.env.MATCH_FEED_ENABLED; else process.env.MATCH_FEED_ENABLED = old;
  }
});
test('feed route does not import provider or expose credential', () => {
  const route = readFileSync('apps/api/src/matches/routes.ts', 'utf8');
  assert.equal(route.includes("from './provider"), false);
  assert.equal(route.includes('PANDASCORE_TOKEN'), false);
});
