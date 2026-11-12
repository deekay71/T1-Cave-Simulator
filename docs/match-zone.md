# T1 match-watching zone

The TV interaction now opens a match-watching panel with keyboard-accessible **Đang đấu / Sắp tới / Kết quả** tabs, source timestamps, stale/offline states, local-device times, and manual refresh. The first nonempty bucket is selected on first load; subsequent refreshes preserve the viewer's tab. Scores, winner styling, and forfeit results are hidden by default each time the panel is opened.

The existing backend feed remains the only schedule/result source. The browser refreshes the cached API approximately every 30 seconds while the panel and browser tab are visible. Closing the panel aborts the request and stops polling. Returning to the browser tab immediately restarts the request. Failed reads preserve the last good snapshot and its original source timestamp. In-progress score capability remains **false**, including the public client schema. No live-score coverage or latency has been verified, and no second-by-second result is promised.

## Optional official video

**Disabled by default. No video/channel is selected by this change.** A deployment owner must first independently verify the actual broadcaster, official account, embedding permission, and current source. The URL validator cannot prove official ownership or rights. Only after that review, set these public, build-time Vite values and rebuild the web app:

```dotenv
VITE_MATCH_VIDEO_ENABLED=true
VITE_MATCH_VIDEO_OFFICIAL_VERIFIED=true
VITE_MATCH_VIDEO_URL=<verified HTTPS YouTube video/live URL or Twitch channel URL>
VITE_MATCH_VIDEO_LABEL=<human-readable broadcaster or event label>
```

Do not copy placeholder values into a deployment. Never put PandaScore tokens, other credentials, or secrets into VITE variables. They are included in public browser JavaScript. These settings are not runtime server settings; existing Docker builds need an explicit build-time configuration step before use.

Accepted source shapes:

- YouTube `youtube.com/watch?v=<11-character-video-id>`, `youtube.com/live/<11-character-video-id>`, or `youtu.be/<11-character-video-id>`.
- Twitch `twitch.tv/<channel>`.

The code rejects unverified settings, arbitrary hosts, lookalike domains, non-HTTPS source URLs, credentials, nondefault ports, generic YouTube channel pages, and Twitch VOD/embed URLs. It rebuilds a canonical source URL and drops supplied query parameters. There is no guessed official channel and no scraping, proxy, download, rebroadcast, or restream.

A valid source displays a local text poster. **No iframe, remote thumbnail, or preconnect is created until the viewer clicks Play.** Before that click the panel explains that playback connects to YouTube/Twitch and can expose spoilers regardless of the score toggle. YouTube uses its privacy-enhanced embed host. Twitch receives only the actual page hostname as its required `parent` and requires HTTPS except local development; at widths under 400px the panel offers the original Twitch link instead of an undersized player. Twitch player height is at least 300px. The original-source link is always available as a fallback; broadcaster restrictions, end of stream, autoplay rules, or third-party outages may prevent playback.

Video is independent of fixture data: the interface does not claim the configured broadcast is currently showing T1. Hiding the browser tab, stopping playback, or closing the panel removes the player. Returning to a hidden tab requires another Play click. Disabling either enable/verification flag and rebuilding disables the video.

## Verification

- `npm run check`
- `npx tsx --test scripts/matches-ui.test.ts scripts/match-video.test.ts`
- `npm test`
- `npm run build`

The added tests exercise opt-in/verification gating, strict URLs and Twitch parent validation, no pre-click media markup, default spoiler protection, unknown and unverified live scores, tabs, source metadata, and explicit failure states. They do not establish broadcast rights, upstream freshness, or successful third-party playback. No official source has been configured or tested for playback as part of this update.

For browser acceptance, open the TV from its world interaction or navigation shortcut. Check desktop and narrow mobile layout, arrow/Home/End tab keys, score toggle, repeated refresh, source link, close/Escape/reopen, and offline/stale cached feed. Only after a real source is approved/configured, additionally check click-to-play, Stop focus restoration, hidden-tab suspension, blocked playback fallback and Twitch parent/size behavior.
