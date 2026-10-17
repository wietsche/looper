import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmt, clampMs, estimatePosition, ema, loopIsValid, shouldLoopBack, shouldResync,
  canSeek, normalizeAB, nudge, fraction, parseRetryAfter, makeVerifier, challengeFor,
  redirectUriFrom, sanitizeLoops, store,
} from '../core.js';

test('fmt renders m:ss and tenths', () => {
  assert.equal(fmt(0), '0:00');
  assert.equal(fmt(61_000), '1:01');
  assert.equal(fmt(125_400), '2:05');
  assert.equal(fmt(125_400, true), '2:05.4');
  assert.equal(fmt(9_500, true), '0:09.5');
  assert.equal(fmt(-5), '0:00');
  assert.equal(fmt(NaN), '0:00');
});

test('clampMs keeps values inside the track', () => {
  assert.equal(clampMs(-10, 1000), 0);
  assert.equal(clampMs(5000, 1000), 1000);
  assert.equal(clampMs(500, 1000), 500);
  assert.equal(clampMs(500, 0), 500, 'unknown duration does not clamp');
});

test('estimatePosition extrapolates only while playing', () => {
  const at = 10_000;
  assert.equal(estimatePosition({ ms: 1000, at, playing: true }, at + 500, 60_000), 1500);
  assert.equal(estimatePosition({ ms: 1000, at, playing: false }, at + 500, 60_000), 1000);
  assert.equal(estimatePosition({ ms: 59_900, at, playing: true }, at + 5000, 60_000), 60_000, 'clamped to duration');
  assert.equal(estimatePosition(null, at), 0);
});

test('ema smooths and ignores junk samples', () => {
  assert.equal(ema(100, 200, 0.3), 130);
  assert.equal(ema(100, NaN), 100);
  assert.equal(ema(NaN, 200), 200);
});

test('loopIsValid demands a 100ms-plus forward section', () => {
  assert.ok(loopIsValid(1000, 2000));
  assert.ok(!loopIsValid(1000, 1050));
  assert.ok(!loopIsValid(2000, 1000));
  assert.ok(!loopIsValid(null, 1000));
});

test('shouldLoopBack fires early by half the RTT', () => {
  const L = { A: 10_000, B: 20_000, rtt: 400 };
  assert.ok(!shouldLoopBack({ est: 19_700, ...L }));
  assert.ok(shouldLoopBack({ est: 19_800, ...L }), 'B - rtt/2');
  assert.ok(shouldLoopBack({ est: 25_000, ...L }));
  assert.ok(!shouldLoopBack({ est: 99_000, A: null, B: null }));
});

test('shouldResync pulls back only when well before A', () => {
  const L = { A: 10_000, B: 20_000 };
  assert.ok(!shouldResync({ est: 9_000, ...L }));
  assert.ok(shouldResync({ est: 8_400, ...L }));
});

test('canSeek enforces in-flight and cooldown guards', () => {
  assert.ok(!canSeek({ inFlight: true, lastSeekAt: 0, now: 10_000 }));
  assert.ok(!canSeek({ inFlight: false, lastSeekAt: 9_800, now: 10_000 }));
  assert.ok(canSeek({ inFlight: false, lastSeekAt: 9_500, now: 10_000 }));
});

test('normalizeAB clamps and keeps A before B', () => {
  assert.deepEqual(normalizeAB({ A: 500, B: 2000, duration: 10_000 }), { A: 500, B: 2000 });
  assert.deepEqual(normalizeAB({ A: 3000, B: 1000, duration: 10_000 }), { A: 3000, B: 3100 });
  assert.deepEqual(normalizeAB({ A: -100, B: 99_000, duration: 10_000 }), { A: 0, B: 10_000 });
  assert.deepEqual(normalizeAB({ A: null, B: null, duration: 10_000 }), { A: null, B: null });
  assert.deepEqual(normalizeAB({ A: 10_000, B: 10_000, duration: 10_000 }), { A: 9_900, B: 10_000 },
    'at the very end, A moves back instead of B past the end');
});

test('nudge moves markers inside range', () => {
  assert.equal(nudge(1000, 250, 10_000), 1250);
  assert.equal(nudge(1000, -2000, 10_000), 0);
  assert.equal(nudge(9_900, 250, 10_000), 10_000);
  assert.equal(nudge(null, 250, 10_000), null);
});

test('fraction maps position to the timeline', () => {
  assert.equal(fraction(5000, 10_000), 0.5);
  assert.equal(fraction(-1, 10_000), 0);
  assert.equal(fraction(99_000, 10_000), 1);
  assert.equal(fraction(5000, 0), 0);
});

test('parseRetryAfter handles seconds, dates and nonsense', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(null), 1000);
  assert.equal(parseRetryAfter('garbage'), 1000);
  assert.equal(parseRetryAfter('99999'), 300_000, 'capped');
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(parseRetryAfter(new Date(now + 5000).toUTCString(), now), 5000);
});

test('PKCE verifier and challenge are well formed', async () => {
  const v = makeVerifier();
  assert.equal(v.length, 96);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/);
  assert.notEqual(v, makeVerifier());
  const c = await challengeFor('abc123');
  assert.match(c, /^[A-Za-z0-9\-_]+$/);
  assert.equal(c, await challengeFor('abc123'), 'deterministic');
});

test('redirectUriFrom drops query and hash', () => {
  assert.equal(
    redirectUriFrom({ origin: 'https://x.github.io', pathname: '/looper/looper.html' }),
    'https://x.github.io/looper/looper.html',
  );
});

test('sanitizeLoops rejects malformed import data', () => {
  const ok = sanitizeLoops({ '4cOdK2wGLETKBW3PvgPWqT': [{ name: 'Solo', A: 1000.4, B: 2000.6 }] });
  assert.deepEqual(ok, { '4cOdK2wGLETKBW3PvgPWqT': [{ name: 'Solo', A: 1000, B: 2001 }] });
  assert.deepEqual(sanitizeLoops(null), {});
  assert.deepEqual(sanitizeLoops({ 'bad id!': [{ name: 'x', A: 1, B: 2 }] }), {});
  assert.deepEqual(sanitizeLoops({ abc: [{ name: 'x', A: 2000, B: 1000 }] }), {}, 'B must follow A');
  assert.deepEqual(sanitizeLoops({ abc: 'nope' }), {});
});

test('store degrades quietly when localStorage is unavailable', () => {
  // No localStorage in Node: every call must be a safe no-op (§9).
  assert.equal(store.get('missing', 'dflt'), 'dflt');
  assert.equal(store.set('k', 1), false);
  assert.equal(store.del('k'), false);
});
