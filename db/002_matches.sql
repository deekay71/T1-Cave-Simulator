-- Feed isolated from game state. Public rows contain normalized display fields only.
CREATE TABLE match_feed_buckets (bucket text PRIMARY KEY, checked_at timestamptz NOT NULL, matches jsonb NOT NULL);
CREATE TABLE match_feed_history (id bigint PRIMARY KEY, bucket text NOT NULL, fetched_at timestamptz NOT NULL, data jsonb NOT NULL);
CREATE TABLE match_feed_requests (requested_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX match_feed_requests_time ON match_feed_requests(requested_at);
CREATE TABLE match_feed_control (id integer PRIMARY KEY CHECK(id=1), paused_until timestamptz NOT NULL DEFAULT '-infinity', auth_blocked boolean NOT NULL DEFAULT false);
INSERT INTO match_feed_control(id) VALUES (1);
