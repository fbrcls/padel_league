-- Padel League La Cure : préparation de la base depuis Neon SQL Editor.

-- Aucun secret, lien ou match de démonstration. Script répétable.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

DO $padel_migration_0$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='001_initial.sql') THEN
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

 INSERT INTO schema_migrations(name) VALUES('001_initial.sql');
 END IF;
END;
$padel_migration_0$;

DO $padel_migration_1$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='002_confirm_cycle_rules.sql') THEN
UPDATE cycles SET submission_deadline='2026-12-01T22:59:59.999Z', rules_confirmed=true WHERE id='2026-1';

 INSERT INTO schema_migrations(name) VALUES('002_confirm_cycle_rules.sql');
 END IF;
END;
$padel_migration_1$;

DO $padel_migration_2$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='003_session_credentials.sql') THEN
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS credential_version text;

 INSERT INTO schema_migrations(name) VALUES('003_session_credentials.sql');
 END IF;
END;
$padel_migration_2$;

DO $padel_migration_3$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='004_confirmed_player_aliases.sql') THEN
INSERT INTO players(id,name) SELECT 'frederic-romain','Frédéric Romain' FROM players WHERE id='fred-romain' ON CONFLICT(id) DO NOTHING;
INSERT INTO players(id,name) SELECT 'kevin-tulpinckx','Kevin Tulpinckx' FROM players WHERE id='kevin-tulpinck' ON CONFLICT(id) DO NOTHING;
UPDATE pairs SET player1='frederic-romain' WHERE player1='fred-romain';
UPDATE pairs SET player2='frederic-romain' WHERE player2='fred-romain';
UPDATE pairs SET player1='kevin-tulpinckx' WHERE player1='kevin-tulpinck';
UPDATE pairs SET player2='kevin-tulpinckx' WHERE player2='kevin-tulpinck';
UPDATE matches SET author='frederic-romain' WHERE author='fred-romain';
UPDATE matches SET submitted_by='frederic-romain' WHERE submitted_by='fred-romain';
UPDATE matches SET author='kevin-tulpinckx' WHERE author='kevin-tulpinck';
UPDATE matches SET submitted_by='kevin-tulpinckx' WHERE submitted_by='kevin-tulpinck';
DELETE FROM sessions WHERE player_id IN ('fred-romain','frederic-romain','kevin-tulpinck','kevin-tulpinckx');
DELETE FROM access_links WHERE player_id IN ('fred-romain','kevin-tulpinck');
DELETE FROM idempotency WHERE actor IN ('fred-romain','kevin-tulpinck');
DELETE FROM players WHERE id IN ('fred-romain','kevin-tulpinck');

 INSERT INTO schema_migrations(name) VALUES('004_confirmed_player_aliases.sql');
 END IF;
END;
$padel_migration_3$;

DO $padel_migration_4$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='005_result_shape.sql') THEN
ALTER TABLE matches ADD CONSTRAINT result_shape CHECK (
 (kind IS NULL AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IS NULL)
 OR (kind='played' AND games_a IS NOT NULL AND games_b IS NOT NULL AND forfeiting_entry IS NULL)
 OR (kind='forfeit' AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IS NOT NULL AND forfeiting_entry IN (entry_a,entry_b))
);
ALTER TABLE matches ADD CONSTRAINT submitted_state CHECK (status NOT IN ('pending','confirmed','disputed') OR (kind IS NOT NULL AND submitted_at IS NOT NULL AND deadline IS NOT NULL AND submitted_by IS NOT NULL AND submitted_entry IN (entry_a,entry_b)));

 INSERT INTO schema_migrations(name) VALUES('005_result_shape.sql');
 END IF;
END;
$padel_migration_4$;

DO $padel_migration_5$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='006_strict_result_nulls.sql') THEN
ALTER TABLE matches DROP CONSTRAINT result_shape;
ALTER TABLE matches DROP CONSTRAINT submitted_state;
ALTER TABLE matches ADD CONSTRAINT result_shape CHECK (
 (kind IS NULL AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IS NULL)
 OR (kind IS NOT NULL AND (
  (kind='played' AND games_a IS NOT NULL AND games_b IS NOT NULL AND forfeiting_entry IS NULL)
  OR (kind='forfeit' AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IS NOT NULL AND forfeiting_entry IN (entry_a,entry_b))
 ))
);
ALTER TABLE matches ADD CONSTRAINT submitted_state CHECK (status NOT IN ('pending','confirmed','disputed') OR (kind IS NOT NULL AND submitted_at IS NOT NULL AND deadline IS NOT NULL AND submitted_by IS NOT NULL AND submitted_entry IS NOT NULL AND submitted_entry IN (entry_a,entry_b)));

 INSERT INTO schema_migrations(name) VALUES('006_strict_result_nulls.sql');
 END IF;
END;
$padel_migration_5$;

DO $padel_migration_6$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='007_organizer_results.sql') THEN
ALTER TABLE matches ADD COLUMN IF NOT EXISTS submitted_role text NOT NULL DEFAULT 'player' CHECK (submitted_role IN ('player','admin'));
ALTER TABLE matches DROP CONSTRAINT IF EXISTS submitted_state;
ALTER TABLE matches ADD CONSTRAINT submitted_state CHECK (
 status NOT IN ('pending','confirmed','disputed') OR (
  kind IS NOT NULL AND submitted_at IS NOT NULL AND (
   (submitted_role='player' AND deadline IS NOT NULL AND submitted_by IS NOT NULL AND submitted_entry IS NOT NULL AND submitted_entry IN (entry_a,entry_b))
   OR (submitted_role='admin' AND status='confirmed' AND confirmed_at IS NOT NULL AND submitted_by IS NULL AND submitted_entry IS NULL)
  )
 )
);

 INSERT INTO schema_migrations(name) VALUES('007_organizer_results.sql');
 END IF;
END;
$padel_migration_6$;

COMMIT;
SELECT count(*) AS migrations_appliquees FROM schema_migrations;
-- FIN DU FICHIER 1
