# Community update — local implementation, 2026-11-10

> Implementation snapshot, not a current deployment report. Read [Opus visual handoff](opus-visual-handoff.md) first. Later stall work supersedes the old campfire shrine portal: the current entrance is at the back wall, (0, -15.8).

## Usable now

- **Match corner:** existing TV interaction and new T1 shortcut open an accessible match panel. Running/upcoming/past tabs, spoilers hidden by default, source and freshness warnings, 30-second visible-panel refresh. Empty/error/disabled states never fabricate matches or scores. Provider support for in-progress scores remains unverified/off. This is periodic match data, not second-by-second game telemetry.
- **Same-room invitation:** copy a room locator, join that exact room. Full/closed room reports failure instead of silently finding another room. Link strips access codes, userinfo, hash, and debug flags. Close-test gate still applies independently.
- **Shared altar:** walk to the reddish floor marker to the right of the central fire (4,4), stay within 3m, choose prayer/cheer. Server owns a 30-second round and eight-second results. Solo supported. Leaving range, disconnecting or losing active seat removes eligibility. A temporary badge is valid only for that room session; there is no persistent currency reward.
- **Chat safety:** preserve server message IDs, report recent messages, locally hide one sender for the current session. Report persistence requires the game DATABASE_URL (added to Compose). This is not a persistent account block and there is no moderation dashboard; see moderation-operations.md.

## Written but deliberately OFF

Persistent guest, daily check-in, earned-currency shop, inventory and equipped avatar are implemented behind `PROGRESSION_ENABLED=false` by default. No real persistent sessions were issued and migration003 was not applied to the existing user database during this update.

Enabling requires approval to retain a 30-day HttpOnly guest-session cookie and applying db/003_progression.sql. The API stores only a token hash. Exact Origin/custom-header checks protect mutations; session ID is never accepted from arbitrary client UUID. Enable the same flag on API/game, use one exact origin (HTTPS in production), then verify real PostgreSQL concurrent transactions before broader release.

Check-in resets at 00:00 UTC (07:00 Vietnam), once per account/day. Currency is earned, nontransferable and has no cash value. Catalog offers existing fan outfit assets (red cap, white hoodie, headband); no real-money payments, loot boxes or commercial rights claim. Equip saves to the profile and becomes visible to all players on next room join. Current prices/rewards are provisional balancing, not a validated retention loop. Altar rewards are not connected to this wallet yet.

## Video

No channel or stream is guessed. Optional explicit official-source configuration is documented in match-zone.md; disabled by default. YouTube/Twitch use their own player only after a user click; no download/proxy/rebroadcast. Mobile Twitch falls back to a source link if the minimum player dimensions cannot fit. A verified licensed source and deployment hostname are still required.

## Verification

- 136/136 unit/integration tests, TypeScript and production build passed on the final tree; Vite still warns about the existing large main bundle.
- Real localhost API/game and two SDK clients: same-room join, initial altar sync, far-away refusal, movement into altar, 30-second solo completion exactly once.
- Desktop 1280×720 + mobile390×844 real-browser match panel QA: no fake data; disabled source/video shown. Mobile refresh, spoiler toggle, focus wrap, Escape/reopen and overflow checked.
- Progression transaction tests use isolated PGlite and synthetic test fixtures, not the live account database. Real PostgreSQL multi-connection contention and live enabled-cookie browser flows remain untested.
- Provider currently has no ongoing T1 match, so real live latency and score updates remain unverified.

## Remaining scope before public launch

Persistent-session approval/activation + database concurrency QA; real group altar test and telemetry; account-level durable block/mute and operator workflow; persistent altar rewards/first-session progression balance; verified video source/rights; public deployment/observability/capacity review. No push, deploy or public publication performed.

Local preview: http://127.0.0.1:5191/ (API3310, game2571). Preview now reads the existing real cached T1 feed:15 historical matches,0 running/0 upcoming at verification time. This is a local process, not an installed service; closing/sleeping the Mac stops availability.


## Shrine revision
The earlier30-second floor-circle flow is superseded by the dedicated temple, selectable stone seats and synced prayer/bow actions. See shrine-update.md for current behavior and158-test acceptance.
