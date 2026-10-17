# Song Looper — Handoff Spec

Mobile web app for musicians to practise a song section on loop,
using Spotify as the audio source. Personal use only.

## 1. Goal

- Log in with Spotify.
- Pick a song.
- Mark a section (A → B).
- Loop that section on the phone's Spotify app.

## 2. Hard constraints (do not try to work around)

- **No raw audio from Spotify.** DRM. No waveform possible.
- **No audio-analysis / audio-features endpoints.** Removed for
  apps created after Nov 2024.
- **Development Mode only.** Max 5 allowlisted users. Extended
  quota needs a registered org with 250k+ MAU. Not an option.
- **Premium required** for app owner and for playback control.
- **Web Playback SDK does not support mobile browsers.**
  Therefore the app *remote-controls* the Spotify app on the phone
  via the Web API (Spotify Connect).
- **No speed or pitch control** via Spotify.

## 3. Accepted limitations

- Loop gap of roughly 0.5–1s at each repeat.
- Loop point accuracy depends on network latency.
- Mobile browsers throttle timers when the tab is backgrounded or
  the screen is off. Loop only works with the page in front.

## 4. Architecture

- Single static page. No backend.
- Hosted on HTTPS (GitHub Pages or similar).
- Auth: OAuth Authorization Code + PKCE, fully client-side.
- Storage: `localStorage` only.

```
Phone browser (looper page)
   │  Web API (HTTPS, Bearer token)
   ▼
api.spotify.com  ──Connect──►  Spotify app on phone (plays audio)
```

## 5. Current state

- `looper.html` exists: a working first draft, untested against a
  live Spotify account. Vanilla HTML/CSS/JS, one file.
- Treat it as the reference implementation. Refactor freely.

## 6. Spotify integration

**Scopes**
- `user-read-playback-state`
- `user-modify-playback-state`

**Endpoints**

| Purpose | Call |
|---|---|
| Playback state | `GET /me/player` |
| Devices | `GET /me/player/devices` |
| Play track | `PUT /me/player/play?device_id=…` body `{uris:[…]}` |
| Resume | `PUT /me/player/play?device_id=…` |
| Pause | `PUT /me/player/pause` |
| Seek | `PUT /me/player/seek?position_ms=…` |
| Search | `GET /search?type=track&limit=10&q=…` |

**Auth details**
- Redirect URI = `location.origin + location.pathname`.
  Shown on the setup screen so the user can paste it into the
  dashboard.
- Client ID entered in the UI, stored in `localStorage`.
- Refresh token flow with `client_id` (no secret).
- On 401: clear token, return to setup.
- On 429: respect `Retry-After`, back off polling.

## 7. Loop engine

- Poll `GET /me/player` every 1000 ms.
- Store `progress_ms` plus local timestamp. Add half the request
  RTT to compensate for latency.
- Estimate position locally between polls:
  `pos + (now − fetchedAt)` while playing.
- Tick every 50 ms. When loop is on and
  `estimate ≥ B − rtt/2`, seek to A.
- Also seek to A if position is more than 1.5s before A.
- Guard: no new seek while one is in flight (+400 ms cooldown).
- Track a smoothed RTT (EMA, α ≈ 0.3) from polls and seeks.

## 8. Features

**Must have (in draft)**
- Setup screen: redirect URI display, Client ID input, login.
- Now playing: art, title, artist.
- Timeline: scrubber, A/B markers, shaded loop region.
- Controls: play/pause, −5s, jump to A.
- Set A / Set B at current position.
- Nudge A and B by ±0.25s.
- Loop toggle. Requires valid A < B.
- Saved loops per track (name, A, B). Load, delete.
- Last A/B per track restored on track change.
- Track search; tap result to play on active device.
- Screen Wake Lock while looping.
- Light and dark mode. Narrow, phone-first layout.

**Nice to have (next)**
- Count-in or short pause before each repeat (seek to A, pause,
  resume after N seconds) — useful for practice.
- Loop counter.
- Export/import saved loops as JSON.
- PWA manifest and icon (add to home screen).
- Adjustable nudge step.
- Better "no active device" guidance.

## 9. Data model (`localStorage`)

| Key | Value |
|---|---|
| `clientId` | string |
| `verifier` | PKCE verifier (temp) |
| `tok` | `{access, refresh, exp}` |
| `last:<trackId>` | `{A, B}` in ms |
| `loops` | `{ <trackId>: [{name, A, B}] }` |

Wrap all access in try/catch. App must work if storage fails.

## 10. Acceptance criteria

1. Fresh load shows setup screen with the correct redirect URI.
2. Login completes and returns to the app screen.
3. With Spotify open on the phone, "now playing" updates within 2s.
4. Searching and tapping a result starts that track on the phone.
5. Set A, Set B, Loop on → playback returns to A at each B,
   repeatedly, for at least 5 minutes without drifting.
6. Nudges move markers and persist after reload.
7. Saved loops survive reload and load correctly.
8. Token refresh works after 1 hour without re-login.
9. No active device → clear message, no crash.
10. Works on iOS Safari and Android Chrome.

## 11. Test plan

- Manual testing on a real phone with Premium account.
- Measure loop gap on Wi-Fi and mobile data. Log RTT values.
- Unit-test pure functions (time format, A/B clamping, position
  estimate) if the code is split into modules.

## 12. Setup for testing

1. Create app in Spotify Developer Dashboard (Web API).
2. Deploy page to HTTPS host.
3. Add the page URL as Redirect URI.
4. Add test accounts under User Management (max 5).
5. Open page on phone, enter Client ID, log in.

## 13. Out of scope

- Waveform display.
- Native apps.
- Public release / multi-user.
- Speed or pitch change.
- Any non-Spotify audio source.
