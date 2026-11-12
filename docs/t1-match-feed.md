# T1 schedule/results feed

> Historical implementation and verification log. For current feature scope, setup and visual handoff, start with [Opus visual handoff](opus-visual-handoff.md). Local paths below use `${HOME}` as a portable placeholder.

## Delivery status
Implemented on `feat/t1-match-feed`, based on `9f2a1c81f2a029e254457c2276d4c8d786052c94`.
This is a disabled-by-default integration, not a verified live service. No account/token was created by the assistant and no deployment was performed. After user-created account and explicit credential approval, the user entered an existing token locally; verified T1 team ID is 126061. Current-match series scores are deliberately hidden until free-plan coverage and latency are verified. This is not real-time play-by-play.

## Architecture
One independent `matches` worker reads PandaScore all-plans list endpoints for upcoming, running and past matches. A dedicated Postgres session advisory lock elects one worker across replicas. Every page reserves durable shared quota (800 requests/hour, 45/minute) before network access, with no parallel polls. Keep separate credentials for other applications: account-wide requests outside this database are not covered by our budget.

Provider requests use server Bearer auth, fixed HTTPS origin and reject redirects. No token is exposed to the browser or logs. No paid match/game details fallback. Past reconciliation covers 90 days; at most ten pages per bucket. Incomplete pagination fails without replacing last good data. Expected query contract, coverage and source terms still require verification with a real free account.

Normalized data lives in Postgres; bucket snapshots cache briefly in Redis. API processes only read local snapshots, with a ten-second in-memory single-flight cache and DB fallback when Redis fails. There is no client-triggered upstream path. Match feed health is independent of game readiness. The optional API route has its own rate-limit group.

A failed refresh preserves checkedAt and existing records. 429 honors Retry-After with at least one-minute shared pause. Reported exhausted quota causes a conservative one-hour pause. 401/403 durably blocks provider calls across worker/container restarts. Correct the token, restart with updated configuration, then explicitly reset `UPDATE match_feed_control SET auth_blocked=false WHERE id=1`. Never auto-clear this flag. Worker uses `restart: unless-stopped` for host recovery; missing configuration parks the process idle instead of crash-looping. Other failures back off exponentially. Startup and failover may recheck buckets, but quota survives process restarts. A dedicated connection error aborts an in-flight request. A request already sent when a connection fails cannot be recalled; its quota reservation remains recorded.

Result corrections can reduce scores; fetched/provider-modified freshness wins. Preserve original schedule across reschedules. No winner or final result is inferred from disappearing running matches. Raw provider payload is not exposed. Null scores remain unknown.

TV displays three groups, Vietnamese status/time, data freshness and Source: PandaScore. Scores hidden by default. In-progress score capability is false. Fetching stops when TV closes or browser tab hides. Live data older than 90 seconds warns and over five minutes is marked interrupted; these are local UI thresholds, not a provider SLA.

## Enable only after verification
1. Obtain approval for account/credential setup as applicable; configure `PANDASCORE_TOKEN` in server secret storage, never in VITE variables, git or chat.
2. Verify primary League of Legends T1 team through `/lol/teams`; configure numeric `PANDASCORE_T1_TEAM_ID` (no guessed default).
3. Verify free-plan filtering `filter[opponent_id]`, past `range[begin_at]`, pagination/rate headers and actual T1 tournament coverage. Confirm terms permit this display; video/logo rights are separate.
4. Run migration `npm run db:migrate`; set `MATCH_FEED_ENABLED=true` on API and worker.
5. Local development: API as usual, `npm run dev:matches` separately. Container configuration: `docker compose --profile matches up -d --build`; public override requires both compose files. Do not run this command against production until deployment is explicitly approved.
6. Verify `/v1/matches/t1`, TV mobile/desktop/modal focus, rate-limit behavior, provider outage and a two-worker leadership failover. Do not turn on in-progress scores solely because the provider returns a numeric value.
7. Disable with `MATCH_FEED_ENABLED=false` and stop worker. Existing gameplay has no dependency on it.

## Scope exclusions / remaining validation
Live provider checks completed as recorded below; no production deployment. No new recurring charges. No video embed, rewards, leaderboard, shop or temple implementation. Browser visual/mobile QA and real Postgres multi-worker failover still need execution. Synthetic tests cannot establish data rights, upstream coverage or timing guarantees.

## Verification performed (2026-11-10)
- `npm test`: 82/82 passed (20 new feed tests plus 62 existing tests).
- `npm run build`: passed TypeScript, Vite frontend and all server bundles including matches worker. Existing large-web-chunk warning remains.
- `git diff --check`: passed.
- Built browser JavaScript contains neither `PANDASCORE_TOKEN` nor `api.pandascore.co`.
- Disabled worker parks idle without database/provider calls; signal shutdown is clean.
- PGlite verifies migration, history/corrections, quota persistence/cooldown and missing-control fail-closed behavior; Fastify injection verifies cold503, stale-cache fallback and feed/guest rate bucket separation.
- Docker/Compose not run: `docker` is not installed/available on the selected machine. Production PostgreSQL leadership/failover and browser visual/mobile QA are not claimed as passed.
- Both Docker stages now copy the existing `packages/security/package.json` before npm ci, addressing the pre-existing workspace-resolution build failure; actual Docker image verification remains pending.

Review fixes: cross-bucket transitions now update atomically and retain one source owner per match. Late response/revision cannot reintroduce the old bucket; explicit newer provider corrections may change status in either direction. Empty running snapshots never fabricate winners. Running buckets with no live match use idle freshness thresholds. Missing configuration and disabled-mode worker smoke tests both park without upstream calls and exit code 0 on SIGTERM. Auth-block persistence/reset is covered by PGlite tests; actual host reboot remains untested because Docker is unavailable.

## Authorized live verification (2026-11-10, approximately 12:19 UTC+7)
The user entered the existing token directly through the masked Terminal helper after explicitly approving local backend storage and Bearer transmission to api.pandascore.co. The ignored local configuration exists with mode0600; no token is stored in source, reports or chat. Feed was initially disabled, then enabled after the separately approved PostgreSQL setup below.

- `/lol/teams?search[name]=T1` returned primary T1, ID126061, slug t1, LoL, KR, separately from Academy, Challengers, old SKT and unrelated MT1.
- Upcoming, running and past list calls all returned HTTP200 with the implemented opponent filter; the 90-day past range returned15 normalized matches. Upcoming/running currently returned0.
- Header quota started at999 remaining after team lookup. Seven total one-time requests were used for team/contract checks and a local QA snapshot. No recurring poller was left running.
- No currently running fixture exists to validate in-progress score coverage or update latency. Capability remains false. Pagination beyond the first page and real429/failover remain synthetic-test coverage only.
- Local QA used existing PGlite in memory, the real normalized store and API route, and the actual React MatchPanel in a temporary harness. Chrome desktop and390px mobile rendered the15 matches correctly; default spoiler masking and checkbox reveal worked. This is component/pipeline QA, not complete game-modal/Colyseus end-to-end QA. Both temporary servers were stopped afterward.
- PostgreSQL binaries, PostgreSQL listener and Docker are unavailable locally; Redis binaries exist. PGlite verifies the pipeline without installing software, but does not replace production PostgreSQL leadership/failover. Enabling a continuous feed still needs an authorized PostgreSQL runtime.

## PostgreSQL installation and active local runtime (2026-11-10, 14:02 UTC+7)
After explicit user approval to install PostgreSQL from an official source, Homebrew installed PostgreSQL17.11 (postgresql@17) and required dependencies. Homebrew created its default cluster, but that cluster was not started.

A separate project cluster lives at `${HOME}/.local/share/t1-cave/postgres`; its private socket directory is `${HOME}/.local/share/t1-cave/run`, socket port55432. Local authentication uses the macOS account through peer, host authentication rejects connections, and `listen_addresses` is empty: no TCP or public database listener. The local test database has migrations 001 and 002 applied. No database password/token was generated.

The ignored `.env.pandascore` now contains the local DB URL, verified team126061, MATCH_FEED_ENABLED=true, API_HOST=127.0.0.1 and API_PORT=3300. The API and feed worker were started using `npm run start:api:local` and `npm run start:matches:local`. `/health/ready` and `/v1/matches/t1` returned200 with persistence enabled and15 past matches. Exactly one match-worker advisory lock was observed. Redis is optional; this local setup uses PostgreSQL fallback.

Real PostgreSQL acceptance: two workers shared one leader; starting standby caused zero additional upstream requests. Stopping leader A let B acquire leadership and write all three fresh bucket snapshots. The stricter run used six provider requests. Both probe workers were stopped afterward; the active local worker is separate. 82 automated tests and the production build pass.

This is local running infrastructure, not public deployment. No launch agent or login/reboot auto-start was configured. Sleep, shutdown or process termination stops updates; restart the local processes when needed. The PostgreSQL start command for this private cluster is:

    /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D ${HOME}/.local/share/t1-cave/postgres -l ${HOME}/.local/share/t1-cave/postgres.log -o "-k ${HOME}/.local/share/t1-cave/run -p 55432 -c listen_addresses=''" -w start

Then start the API and worker from the repo with the two local npm commands above. Do not use `brew services start postgresql@17`: it targets the unrelated default cluster, not this private socket configuration. In-progress score coverage/latency and Docker production deployment remain unverified.
