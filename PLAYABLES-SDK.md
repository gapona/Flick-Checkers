# YouTube Playables SDK — Reference for this project

Distilled from the CGDealers Publisher Portal SDK docs (mirror of the official
YouTube Playables SDK reference) + official Google docs. Claude Code: consult this
file for ALL `ytgame` integration work. The wrapper lives in `src/platform/yt.ts`;
game code must never call `ytgame` directly.

## Loading the SDK

`index.html` must be at the bundle root and load the SDK **before any game code**
(validated during publishing):

```html
<script src="https://www.youtube.com/game_api/v1"></script>
```

- The SDK runs as a **no-op when served locally** — but `ytgame` may be undefined
  outside YouTube, so always guard: `typeof ytgame !== "undefined" && ytgame.IN_PLAYABLES_ENV`.
- Delay Phaser `new Game()` until both DOM and SDK are ready.
- `ytgame` is a global; MUST NOT be overridden.
- TypeScript type definitions are available from Google (download, put in `src/types/`).

## Required lifecycle calls (certification-critical)

| Call | When | Rule |
|---|---|---|
| `ytgame.game.firstFrameReady(): void` | First frame rendered (Boot scene) | MUST call, otherwise game is never shown. MUST come before `gameReady()` |
| `ytgame.game.gameReady(): void` | Game is interactable (MainMenu shown, Preloader gone) | MUST NOT be called while a loading screen is visible — certification failure |

## Save / Load — `ytgame.game`

- `saveData(data: string): Promise<void>` — string MUST be well-formed UTF-16
  (`String.isWellFormed()` check), max **3 MiB** (else `SIZE_LIMIT_EXCEEDED`).
- `loadData(): Promise<string>` — game parses the string itself.
- Signed-out users: promise still resolves, but with **empty data** — must handle
  both signed-in and signed-out gracefully (tested in certification).
- Dev fallback (official pattern):

```js
if (ytgame?.IN_PLAYABLES_ENV) {
  ytgame.game.saveData(dataStr);
} else {
  window.localStorage.setItem("SAVE_DATA", dataStr);
}
```

- Save on milestones and on `onPause`, NOT every frame.

## System — `ytgame.system`

- `isAudioEnabled(): boolean` — SHOULD use to initialize audio state.
- `onAudioEnabledChange(cb: (enabled: boolean) => void): () => void` — MUST use
  to react to YouTube mute/unmute. Platform mute overrides in-game settings.
- `onPause(cb: () => void): () => void` — fires for ALL pause types incl. user
  exiting. Short window to save state before eviction; resume is NOT guaranteed →
  autosave here.
- `onResume(cb: () => void): () => void` — resume gameplay/audio.
- `getLanguage(): Promise<string>` — BCP-47 tag (e.g. "en-US", "es-419"). MUST
  be the only source of locale; do NOT store language in cloud save.

## Engagement — `ytgame.engagement`

- `sendScore({ value: number }): Promise<void>` — ONE dimension of progress,
  integer ≤ Number.MAX_SAFE_INTEGER. YouTube UI shows the highest sent score;
  in-game high-score UI must match what is sent.
- `openYTContent({ id: string, contentType?: ContentType }): Promise<void>` —
  `ContentType.VIDEO` (default) or `ContentType.PLAYABLE`. Web: new tab;
  mobile: video → miniplayer, playable → replaces current.

## Ads — `ytgame.ads`

- `requestInterstitialAd(): Promise<void>` — no guarantee ad is shown; NEVER
  reward players for interstitials. Call at natural breaks (game over, level end).
- `requestRewardedAd(rewardId: string): Promise<boolean>` — resolves `true` if
  reward earned. `rewardId`: stable unique ID per reward TYPE, hard-coded, no
  user data (e.g. `"extra-life"`, `"double-coins"`). Wrap all calls in try/catch —
  thrown error may be `undefined`.
- Pre-roll ads are handled by YouTube automatically — no integration needed.

## Health — `ytgame.health`

- `logError(): void` / `logWarning(): void` — best-effort, rate-limited. Hook
  into global error handler.

## Errors

`SdkError extends Error` with `errorType: SdkErrorType`:
`API_UNAVAILABLE` (retry later) | `INVALID_PARAMS` | `SIZE_LIMIT_EXCEEDED` | `UNKNOWN`.
All promise-based APIs reject with SdkError; caught error may be `undefined`.

## Bundle & submission requirements (CGDealers portal)

- ZIP with `index.html` at root; max 200 MB total, **max 30 MB per file**.
  Project target: ≤ 15 MB total.
- Fully offline — only YouTube service connections allowed (strict CSP: no
  external CDNs, fonts from Google Fonts allowed, everything else self/blob/data).
- Metadata: App ID, Title ≤ 50 chars, Description ≤ 150 chars, primary genre
  (Action / Arcade / Brain and Puzzle / Board and Card / Music / Racing /
  RPG and Strategy / Simulation / Sports / Trivia and Word), engine = Phaser.
- Thumbnails: 1:1 ≥ 512×512, 5:7 ≥ 270×378 (540×756 recommended), 16:9 ≥ 1280×720.
- Publisher requirements: PC (mouse/keyboard) + mobile (touch) controls;
  settings menu with separate sound/music toggles; responsive UI for all aspect
  ratios; copyright-free audio only (top rejection reason); no freezes/lag.

## Testing

- Test Suite: https://developers.google.com/youtube/gaming/playables/test_suite —
  enter `http://localhost:8080` as Game URL against the dev server.
- Test locally with a CSP override in Chrome to catch violations early (see
  official test suite guide for the exact CSP string).
- Test save/load both signed-in and signed-out.
- CGDealers portal flow: Game details → Age Rating → Verify and Test (Test Suite
  Link + Startup Certification, 16:9 / 9:16 / mobile iframes) → Submit.

## Reference implementation

Official Phaser template: https://github.com/phaserjs/template-youtube-playables
(Phaser 3 + Vite). Includes `YouTubePlayables.js` — engine-agnostic open-source
wrapper handling UTF-16 checks, JSON parsing, SDK-ready waiting. Use it as the
reference when implementing `src/platform/yt.ts`; the sample game "Basketball
Shoot Out" demonstrates every SDK feature.
