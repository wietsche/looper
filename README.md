# Song Looper

Phone-first web app for practising a section of a song on loop, using Spotify
as the audio source. It remote-controls the Spotify app on your phone over
Spotify Connect — see [spec.md](spec.md) for why that is the only option.

Personal use, Development Mode only (max 5 allowlisted accounts), Premium required.

## Files

| File | What it is |
|---|---|
| `index.html` | The app. The only page you need to deploy. |
| `core.js` | Pure helpers (time format, A/B clamping, position estimate, PKCE, storage). |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | Add-to-home-screen bits. |
| `test/core.test.mjs` | Unit tests for `core.js` — `npm test`. |
| `test/mock.html` | Dev harness: runs the real page against a fake Spotify API. **Do not deploy.** |
| `serve.mjs` | Local static server — `npm run serve`. |

## Setup

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard),
   Web API only. No secret is needed — auth is Authorization Code + PKCE.
2. Deploy `index.html`, `core.js`, the manifest and icons to an HTTPS host
   (GitHub Pages works). Spotify will not redirect to plain `http://`.
3. Add the page's full URL as a Redirect URI, exactly as the setup screen
   shows it. The app derives it from `location.origin + location.pathname`, so
   `https://you.github.io/looper/` must be registered verbatim, trailing slash
   included.
4. Under User Management, add the Spotify account you will log in with.
5. Open the page on your phone, paste the Client ID, log in.

This repo deploys from the `main` branch, so everything in it is served.
`.github/workflows/pages.yml` is an alternative Actions-based deploy that runs
the tests and publishes only the app files; pushing it needs a token with the
`workflow` scope (`gh auth refresh -h github.com -s workflow`).

## Using it

1. Open Spotify on the phone and start playing anything, so there is an active
   Connect device. Tap ↻ in the app if it does not show up.
2. Search for a track and tap Play, or just play it from Spotify directly.
3. Play to the start of the section, tap **Set A**; play to the end, tap **Set B**.
4. Nudge either marker with − / + (step configurable: 0.1–1 s).
5. Tap **Loop on**. Playback jumps back to A at every B.
6. **Save** names the section; saved loops are listed per track. The last A/B
   for each track is restored automatically the next time it plays.
7. *Pause each repeat* inserts a 1–4 s gap at each repeat, for practice.

Keep the page in front with the screen on. Mobile browsers throttle timers in
background tabs, which stops the loop; the app takes a Screen Wake Lock while
looping where the browser supports it.

Expect a 0.5–1 s gap at each repeat. That is the Connect round-trip and cannot
be removed — the page compensates for measured latency (shown as `rtt` under
Diagnostics) but cannot pre-buffer audio it is not allowed to touch.

## Development

```bash
npm test        # unit tests for core.js
npm run serve   # http://localhost:8080/
```

`localhost` is a secure context, so PKCE works without TLS — but Spotify will
not accept a plain-http redirect URI, so logging in for real still needs HTTPS.

To work on the loop engine without a phone or a Premium account, open
`http://localhost:8080/test/mock.html`. It loads the real page against a fake
Spotify API and exposes `window.__mock` with `seeks`, `pauses`, `plays` and a
`latency` knob, so you can verify loop timing from the console:

```js
__mock.seeks.slice(1).map((s, i) => s.at - __mock.seeks[i].at)  // repeat interval
```

## Known limits

Set by Spotify, not by this code: no raw audio or waveform, no audio-analysis
endpoints, no speed or pitch control, no Web Playback SDK on mobile browsers,
and a 5-user cap in Development Mode.
