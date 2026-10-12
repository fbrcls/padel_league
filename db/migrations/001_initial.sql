CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS pairs (id text PRIMARY KEY, player1 text NOT NULL REFERENCES players(id), player2 text NOT NULL REFERENCES players(id), CHECK(player1 <> player2));
CREATE TABLE IF NOT EXISTS cycles (id text PRIMARY KEY, name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, submission_deadline timestamptz, closed boolean NOT NULL DEFAULT false, rules_confirmed boolean NOT NULL DEFAULT false, CHECK(ends_at > starts_at));
CREATE TABLE IF NOT EXISTS boxes (id text PRIMARY KEY, cycle_id text NOT NULL REFERENCES cycles(id), category text NOT NULL CHECK(category IN ('OPEN','WOMEN_MIXED')), number integer NOT NULL CHECK(number > 0), UNIQUE(cycle_id,category,number));
CREATE TABLE IF NOT EXISTS entries (id text PRIMARY KEY, pair_id text NOT NULL REFERENCES pairs(id), box_id text NOT NULL REFERENCES boxes(id), UNIQUE(pair_id,box_id));
CREATE TABLE IF NOT EXISTS matches (
 id text PRIMARY KEY, box_id text NOT NULL REFERENCES boxes(id), entry_a text NOT NULL REFERENCES entries(id), entry_b text NOT NULL REFERENCES entries(id), played_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('scheduled','pending','confirmed','disputed','cancelled')), version integer NOT NULL DEFAULT 1,
 author text REFERENCES players(id), submitted_by text REFERENCES players(id), submitted_entry text REFERENCES entries(id),
 kind text CHECK(kind IN ('played','forfeit')), games_a integer CHECK(games_a BETWEEN 0 AND 999), games_b integer CHECK(games_b BETWEEN 0 AND 999), forfeiting_entry text REFERENCES entries(id),
 submitted_at timestamptz, deadline timestamptz, confirmed_at timestamptz, proposal jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(entry_a <> entry_b),
 CHECK((kind IS NULL AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IS NULL) OR (kind='played' AND games_a IS NOT NULL AND games_b IS NOT NULL AND forfeiting_entry IS NULL) OR (kind='forfeit' AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IN (entry_a,entry_b)))
);
CREATE INDEX IF NOT EXISTS matches_box ON matches(box_id,played_at);
CREATE INDEX IF NOT EXISTS matches_due ON matches(deadline) WHERE status='pending';
CREATE TABLE IF NOT EXISTS access_links (player_id text PRIMARY KEY REFERENCES players(id), token_hash text NOT NULL UNIQUE, ciphertext text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, player_id text REFERENCES players(id), role text NOT NULL CHECK(role IN ('player','admin')), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit (id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL, match_id text REFERENCES matches(id), details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (actor text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, match_id text NOT NULL REFERENCES matches(id), PRIMARY KEY(actor,key));
CREATE TABLE IF NOT EXISTS job_runs (id text PRIMARY KEY, last_success timestamptz NOT NULL, confirmed_count integer NOT NULL);
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
