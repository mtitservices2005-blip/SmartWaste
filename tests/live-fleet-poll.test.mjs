import assert from 'node:assert/strict';
import { pollLiveFleet, POLL_INTERVAL_MS } from '../shared/live-fleet-poll.js';

function makeEnv() {
  let now = 0, seq = 0;
  const timers = new Map();
  const listeners = new Set();
  const doc = {
    hidden: false,
    addEventListener: (t, f) => { if (t === 'visibilitychange') listeners.add(f); },
    removeEventListener: (t, f) => { if (t === 'visibilitychange') listeners.delete(f); },
  };
  const api = {
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const advance = async (ms) => {
    const target = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    now = target;
  };
  const setHidden = (h) => { doc.hidden = h; listeners.forEach((f) => f()); };
  return { api, doc, advance, timers, listeners, setHidden };
}
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

assert.equal(POLL_INTERVAL_MS, 15000);

// immediate fetch, then every 15 s
{
  const env = makeEnv(); let calls = 0; const got = [];
  const h = pollLiveFleet({ fetchFleet: async () => ++calls, onData: (d) => got.push(d), onError() {}, timers: env.api, doc: env.doc });
  await tick();
  assert.equal(calls, 1);
  await env.advance(15000); assert.equal(calls, 2);
  await env.advance(15000); assert.equal(calls, 3);
  assert.deepEqual(got, [1, 2, 3]);
  h.stop();
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
  await env.advance(60000); assert.equal(calls, 3);
}

// no overlap
{
  const env = makeEnv(); let calls = 0; let release;
  const h = pollLiveFleet({ fetchFleet: () => { calls++; return new Promise((r) => { release = r; }); }, onData() {}, onError() {}, timers: env.api, doc: env.doc });
  await tick();
  h.refreshNow(); h.refreshNow(); await tick();
  assert.equal(calls, 1);
  release(1); await tick();
  h.stop();
}

// hidden pauses, visible triggers immediate fetch
{
  const env = makeEnv(); let calls = 0;
  const h = pollLiveFleet({ fetchFleet: async () => ++calls, onData() {}, onError() {}, timers: env.api, doc: env.doc });
  await tick(); assert.equal(calls, 1);
  env.setHidden(true);
  await env.advance(60000); assert.equal(calls, 1);
  env.setHidden(false); await tick();
  assert.equal(calls, 2);
  h.stop();
}

// backoff 30 -> 60 -> back to 15
{
  const env = makeEnv(); let calls = 0; let fail = true; const errs = [];
  const h = pollLiveFleet({ fetchFleet: async () => { calls++; if (fail) throw new Error('x'); return calls; }, onData() {}, onError: (e) => errs.push(e), timers: env.api, doc: env.doc });
  await tick(); assert.equal(calls, 1); assert.equal(errs.length, 1);
  await env.advance(15000); assert.equal(calls, 1);
  await env.advance(15000); assert.equal(calls, 2);
  await env.advance(59000); assert.equal(calls, 2);
  await env.advance(1000); assert.equal(calls, 3);
  fail = false;
  await env.advance(60000); assert.equal(calls, 4);
  await env.advance(15000); assert.equal(calls, 5);
  h.stop();
}
console.log('live-fleet-poll ok');
