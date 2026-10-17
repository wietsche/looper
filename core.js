// Pure helpers for the Song Looper. No DOM, no network — unit-testable.
// Imported as an ES module by looper.html and by test/core.test.mjs.

export const SEEK_COOLDOWN_MS = 400;   // §7 guard after a seek
export const RESYNC_BEHIND_MS = 1500;  // §7 seek to A if this far before A
export const RTT_ALPHA = 0.3;          // §7 EMA smoothing

/** m:ss, or m:ss.t when tenths are wanted (markers, nudges). */
export function fmt(ms, tenths = false) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${m}:${ss}`;
}

/** Keep a marker/position inside [0, duration]. */
export function clampMs(ms, duration) {
  if (!Number.isFinite(ms)) return 0;
  const hi = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.max(0, Math.min(ms, hi));
}

/**
 * Local position estimate between polls (§7).
 * pos: {ms, at, playing}. Extrapolates only while playing.
 */
export function estimatePosition(pos, now = Date.now(), duration = Infinity) {
  if (!pos || !Number.isFinite(pos.ms)) return 0;
  if (!pos.playing) return clampMs(pos.ms, duration);
  const elapsed = Math.max(0, now - (pos.at || now));
  return clampMs(pos.ms + elapsed, duration);
}

/** Exponential moving average, used for RTT smoothing. */
export function ema(prev, sample, alpha = RTT_ALPHA) {
  if (!Number.isFinite(sample) || sample < 0) return prev;
  if (!Number.isFinite(prev)) return sample;
  return prev + alpha * (sample - prev);
}

/** Loop is armed only with a sane A < B. */
export function loopIsValid(A, B) {
  return Number.isFinite(A) && Number.isFinite(B) && A >= 0 && B > A + 100;
}

/** True when the estimate has reached the loop end, latency included (§7). */
export function shouldLoopBack({ est, A, B, rtt = 0 }) {
  if (!loopIsValid(A, B)) return false;
  return est >= B - rtt / 2;
}

/** True when playback has wandered well before A and needs pulling back (§7). */
export function shouldResync({ est, A, B }) {
  if (!loopIsValid(A, B)) return false;
  return est < A - RESYNC_BEHIND_MS;
}

/** Seek guard: one in flight at a time, plus a cooldown (§7). */
export function canSeek({ inFlight, lastSeekAt = 0, now = Date.now(), cooldown = SEEK_COOLDOWN_MS }) {
  if (inFlight) return false;
  return now - lastSeekAt >= cooldown;
}

/** Clamp a marker pair into range and keep A < B; returns a new pair. */
export function normalizeAB({ A, B, duration }) {
  let a = Number.isFinite(A) ? clampMs(A, duration) : null;
  let b = Number.isFinite(B) ? clampMs(B, duration) : null;
  if (a !== null && b !== null && b <= a) b = clampMs(a + 100, duration);
  if (a !== null && b !== null && b <= a) a = clampMs(b - 100, duration);
  return { A: a, B: b };
}

/** Move one marker by delta, staying in range (nudge buttons). */
export function nudge(value, deltaMs, duration) {
  if (!Number.isFinite(value)) return value;
  return clampMs(value + deltaMs, duration);
}

/** Fraction 0..1 for the timeline. */
export function fraction(ms, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, ms / duration));
}

/** Retry-After header -> ms to wait (§6). Seconds or HTTP-date. */
export function parseRetryAfter(header, now = Date.now()) {
  if (!header) return 1000;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, Math.min(secs, 300)) * 1000;
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, Math.min(when - now, 300000));
  return 1000;
}

/** localStorage wrapper — the app must survive storage being unavailable (§9). */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  del(key) {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  },
};

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** PKCE code verifier (43-128 chars of the unreserved set). */
export function makeVerifier(length = 96, rnd = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = rnd(length);
  let out = '';
  for (const b of bytes) out += B64URL[b % B64URL.length];
  return out;
}

export function base64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** S256 challenge for a verifier. */
export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

/** Redirect URI per §6: origin + pathname, no query or hash. */
export function redirectUriFrom(loc) {
  return loc.origin + loc.pathname;
}

/** Saved-loop list validation for import (§8 nice-to-have). */
export function sanitizeLoops(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [trackId, list] of Object.entries(raw)) {
    if (!Array.isArray(list) || !/^[A-Za-z0-9]+$/.test(trackId)) continue;
    const clean = list
      .filter((l) => l && Number.isFinite(l.A) && Number.isFinite(l.B) && l.B > l.A)
      .map((l) => ({ name: String(l.name || 'Loop').slice(0, 60), A: Math.round(l.A), B: Math.round(l.B) }))
      .slice(0, 50);
    if (clean.length) out[trackId] = clean;
  }
  return out;
}
