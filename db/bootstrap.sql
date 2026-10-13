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

INSERT INTO cycles(id,name,starts_at,ends_at,submission_deadline,rules_confirmed) VALUES('2026-1','Cycle 1 · 2026','2026-10-11T22:00:00Z','2026-11-29T22:59:59.999Z','2026-12-01T22:59:59.999Z',true) ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-OPEN-1','2026-1','OPEN',1) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('stephane-zone','Stephane Zone') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gauvain-callens','Gauvain Callens') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('gauvain-callens__stephane-zone','stephane-zone','gauvain-callens') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-1__gauvain-callens__stephane-zone','gauvain-callens__stephane-zone','2026-1-OPEN-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('junior-decock','Junior Decock') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('fabrice-claes','Fabrice Claes') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('fabrice-claes__junior-decock','junior-decock','fabrice-claes') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-1__fabrice-claes__junior-decock','fabrice-claes__junior-decock','2026-1-OPEN-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('timothe-desmoudt','Timothé Desmoudt') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('laurent-oyhenard','Laurent Oyhenard') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('laurent-oyhenard__timothe-desmoudt','timothe-desmoudt','laurent-oyhenard') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-1__laurent-oyhenard__timothe-desmoudt','laurent-oyhenard__timothe-desmoudt','2026-1-OPEN-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('brian-smet','Brian Smet') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('herve-vandy','Hervé Vandy') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('brian-smet__herve-vandy','brian-smet','herve-vandy') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-1__brian-smet__herve-vandy','brian-smet__herve-vandy','2026-1-OPEN-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('max-zone','Max Zone') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('vincent-denis-piou','Vincent Denis (Piou)') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('max-zone__vincent-denis-piou','max-zone','vincent-denis-piou') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-1__max-zone__vincent-denis-piou','max-zone__vincent-denis-piou','2026-1-OPEN-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('malcolm-gossart','Malcolm Gossart') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('maxence-gysemberg','Maxence Gysemberg') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('malcolm-gossart__maxence-gysemberg','malcolm-gossart','maxence-gysemberg') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-1__malcolm-gossart__maxence-gysemberg','malcolm-gossart__maxence-gysemberg','2026-1-OPEN-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('michael-bertrand','Michael Bertrand') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('charley','Charley') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('charley__michael-bertrand','michael-bertrand','charley') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-1__charley__michael-bertrand','charley__michael-bertrand','2026-1-OPEN-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-OPEN-2','2026-1','OPEN',2) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('loic-houart','Loic Houart') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('thomas-vandenkerkhoven','Thomas Vandenkerkhoven') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('loic-houart__thomas-vandenkerkhoven','loic-houart','thomas-vandenkerkhoven') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-2__loic-houart__thomas-vandenkerkhoven','loic-houart__thomas-vandenkerkhoven','2026-1-OPEN-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('kevin-de-troyer','Kevin de Troyer') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('massimo-morchio','Massimo Morchio') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('kevin-de-troyer__massimo-morchio','kevin-de-troyer','massimo-morchio') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-2__kevin-de-troyer__massimo-morchio','kevin-de-troyer__massimo-morchio','2026-1-OPEN-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('kevin-tulpinckx','Kevin Tulpinckx') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('tom-groeseneken','Tom Groeseneken') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('kevin-tulpinckx__tom-groeseneken','kevin-tulpinckx','tom-groeseneken') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-2__kevin-tulpinckx__tom-groeseneken','kevin-tulpinckx__tom-groeseneken','2026-1-OPEN-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jean-francois-smal','Jean-François Smal') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('brice-jeanmotte','Brice Jeanmotte') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('brice-jeanmotte__jean-francois-smal','jean-francois-smal','brice-jeanmotte') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-2__brice-jeanmotte__jean-francois-smal','brice-jeanmotte__jean-francois-smal','2026-1-OPEN-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('reda-abayahia','Reda Abayahia') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('mike-liroux','Mike Liroux') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('mike-liroux__reda-abayahia','reda-abayahia','mike-liroux') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-2__mike-liroux__reda-abayahia','mike-liroux__reda-abayahia','2026-1-OPEN-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gijs-klarenbeek','Gijs Klarenbeek') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('luc-copin','Luc Copin') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('gijs-klarenbeek__luc-copin','gijs-klarenbeek','luc-copin') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-2__gijs-klarenbeek__luc-copin','gijs-klarenbeek__luc-copin','2026-1-OPEN-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('pierre-van-cleuvenbergen','Pierre Van Cleuvenbergen') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('axel-van-cleuvenbergen','Axel Van Cleuvenbergen') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('axel-van-cleuvenbergen__pierre-van-cleuvenbergen','pierre-van-cleuvenbergen','axel-van-cleuvenbergen') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-2__axel-van-cleuvenbergen__pierre-van-cleuvenbergen','axel-van-cleuvenbergen__pierre-van-cleuvenbergen','2026-1-OPEN-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-OPEN-3','2026-1','OPEN',3) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('maxime-romain','Maxime Romain') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('frederic-romain','Frédéric Romain') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('fred-romain__maxime-romain','maxime-romain','frederic-romain') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-3__fred-romain__maxime-romain','fred-romain__maxime-romain','2026-1-OPEN-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('anthony-guenne','Anthony Guenne') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gaetan-moens','Gaetan Moens') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('anthony-guenne__gaetan-moens','anthony-guenne','gaetan-moens') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-3__anthony-guenne__gaetan-moens','anthony-guenne__gaetan-moens','2026-1-OPEN-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('bertrand-govoerts','Bertrand Govoerts') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('noel-parate','Noel Parate') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('bertrand-govoerts__noel-parate','bertrand-govoerts','noel-parate') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-3__bertrand-govoerts__noel-parate','bertrand-govoerts__noel-parate','2026-1-OPEN-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('daniel-laduron','Daniel Laduron') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('alain-laduron','Alain Laduron') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('alain-laduron__daniel-laduron','daniel-laduron','alain-laduron') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-3__alain-laduron__daniel-laduron','alain-laduron__daniel-laduron','2026-1-OPEN-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('olivier-engels','Olivier Engels') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('serge-kreusch','Serge Kreusch') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('olivier-engels__serge-kreusch','olivier-engels','serge-kreusch') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-3__olivier-engels__serge-kreusch','olivier-engels__serge-kreusch','2026-1-OPEN-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('romain-deschutter','Romain Deschutter') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('guillaume-dessy','Guillaume Dessy') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('guillaume-dessy__romain-deschutter','romain-deschutter','guillaume-dessy') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-3__guillaume-dessy__romain-deschutter','guillaume-dessy__romain-deschutter','2026-1-OPEN-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-OPEN-4','2026-1','OPEN',4) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('lucas-pistone','Lucas Pistone') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gaetan-celestri','Gaëtan Celestri') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('gaetan-celestri__lucas-pistone','lucas-pistone','gaetan-celestri') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-4__gaetan-celestri__lucas-pistone','gaetan-celestri__lucas-pistone','2026-1-OPEN-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('christian-pierre','Christian Pierre') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('alain-piens','Alain Piens') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('alain-piens__christian-pierre','christian-pierre','alain-piens') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-4__alain-piens__christian-pierre','alain-piens__christian-pierre','2026-1-OPEN-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('devashish-basnet','Devashish Basnet') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jean-louis-dufour','Jean-Louis Dufour') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('devashish-basnet__jean-louis-dufour','devashish-basnet','jean-louis-dufour') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-4__devashish-basnet__jean-louis-dufour','devashish-basnet__jean-louis-dufour','2026-1-OPEN-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('christian-vanschoonwinkel','Christian Vanschoonwinkel') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('laurent-deschutter','Laurent Deschutter') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('christian-vanschoonwinkel__laurent-deschutter','christian-vanschoonwinkel','laurent-deschutter') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-4__christian-vanschoonwinkel__laurent-deschutter','christian-vanschoonwinkel__laurent-deschutter','2026-1-OPEN-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('greg-cachoir','Greg Cachoir') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('cedric-ronsmans','Cedric Ronsmans') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('cedric-ronsmans__greg-cachoir','greg-cachoir','cedric-ronsmans') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-4__cedric-ronsmans__greg-cachoir','cedric-ronsmans__greg-cachoir','2026-1-OPEN-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('serge-locquet','Serge Locquet') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('didier-vanherck','Didier Vanherck') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('didier-vanherck__serge-locquet','serge-locquet','didier-vanherck') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-4__didier-vanherck__serge-locquet','didier-vanherck__serge-locquet','2026-1-OPEN-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-OPEN-5','2026-1','OPEN',5) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('john-falzone','John Falzone') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('yannick-van-thienen','Yannick Van thienen') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('john-falzone__yannick-van-thienen','john-falzone','yannick-van-thienen') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-5__john-falzone__yannick-van-thienen','john-falzone__yannick-van-thienen','2026-1-OPEN-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jean-michel-hanquin','Jean-Michel Hanquin') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('cedric-quintin','Cedric Quintin') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('cedric-quintin__jean-michel-hanquin','jean-michel-hanquin','cedric-quintin') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-5__cedric-quintin__jean-michel-hanquin','cedric-quintin__jean-michel-hanquin','2026-1-OPEN-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('claude-paulus','Claude Paulus') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gerard-delatte','Gerard Delatte') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('claude-paulus__gerard-delatte','claude-paulus','gerard-delatte') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-5__claude-paulus__gerard-delatte','claude-paulus__gerard-delatte','2026-1-OPEN-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('fabrice-degreef','Fabrice Degreef') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('milo-degreef','Milo Degreef') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('fabrice-degreef__milo-degreef','fabrice-degreef','milo-degreef') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-5__fabrice-degreef__milo-degreef','fabrice-degreef__milo-degreef','2026-1-OPEN-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jonathan-waerzeggers','Jonathan Waerzeggers') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('lionel-waerzeggers','Lionel Waerzeggers') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('jonathan-waerzeggers__lionel-waerzeggers','jonathan-waerzeggers','lionel-waerzeggers') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-5__jonathan-waerzeggers__lionel-waerzeggers','jonathan-waerzeggers__lionel-waerzeggers','2026-1-OPEN-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('baudouin-van-ruymbeke','Baudouin Van Ruymbeke') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jean-michel-jerome','Jean-Michel Jérome') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('baudouin-van-ruymbeke__jean-michel-jerome','baudouin-van-ruymbeke','jean-michel-jerome') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-OPEN-5__baudouin-van-ruymbeke__jean-michel-jerome','baudouin-van-ruymbeke__jean-michel-jerome','2026-1-OPEN-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-WOMEN_MIXED-1','2026-1','WOMEN_MIXED',1) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('manon','Manon') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('charley','Charley') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('charley__manon','manon','charley') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-1__charley__manon','charley__manon','2026-1-WOMEN_MIXED-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('michael-bertrand','Michael Bertrand') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('camille-dierickx','Camille Dierickx') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('camille-dierickx__michael-bertrand','michael-bertrand','camille-dierickx') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-1__camille-dierickx__michael-bertrand','camille-dierickx__michael-bertrand','2026-1-WOMEN_MIXED-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('heloise-fontaine','Heloise Fontaine') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('malcolm-gossart','Malcolm Gossart') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('heloise-fontaine__malcolm-gossart','heloise-fontaine','malcolm-gossart') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-1__heloise-fontaine__malcolm-gossart','heloise-fontaine__malcolm-gossart','2026-1-WOMEN_MIXED-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('aurelie-gardette','Aurélie Gardette') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('frederic-romain','Frédéric Romain') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('aurelie-gardette__frederic-romain','aurelie-gardette','frederic-romain') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-1__aurelie-gardette__frederic-romain','aurelie-gardette__frederic-romain','2026-1-WOMEN_MIXED-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('loic-houart','Loic Houart') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('lola-leysen','Lola Leysen') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('loic-houart__lola-leysen','loic-houart','lola-leysen') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-1__loic-houart__lola-leysen','loic-houart__lola-leysen','2026-1-WOMEN_MIXED-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('julie-paix','Julie Paix') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('junior-decock','Junior Decock') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('julie-paix__junior-decock','julie-paix','junior-decock') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-1__julie-paix__junior-decock','julie-paix__junior-decock','2026-1-WOMEN_MIXED-1') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-WOMEN_MIXED-2','2026-1','WOMEN_MIXED',2) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('laura-bertrand','Laura Bertrand') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('kevin-tulpinckx','Kevin Tulpinckx') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('kevin-tulpinck__laura-bertrand','laura-bertrand','kevin-tulpinckx') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-2__kevin-tulpinck__laura-bertrand','kevin-tulpinck__laura-bertrand','2026-1-WOMEN_MIXED-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('lola-leysen','Lola Leysen') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('manon','Manon') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('lola-leysen__manon','lola-leysen','manon') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-2__lola-leysen__manon','lola-leysen__manon','2026-1-WOMEN_MIXED-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('stephanie-vanderhofstadt','Stephanie Vanderhofstadt') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('aurelie-gardette','Aurélie Gardette') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('aurelie-gardette__stephanie-vanderhofstadt','stephanie-vanderhofstadt','aurelie-gardette') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-2__aurelie-gardette__stephanie-vanderhofstadt','aurelie-gardette__stephanie-vanderhofstadt','2026-1-WOMEN_MIXED-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gil-de-poerck','Gil De Poerck') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('leila-de-poerck','Leila De Poerck') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('gil-de-poerck__leila-de-poerck','gil-de-poerck','leila-de-poerck') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-2__gil-de-poerck__leila-de-poerck','gil-de-poerck__leila-de-poerck','2026-1-WOMEN_MIXED-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gisele-bertholet','Gisèle Bertholet') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('david-dierickx','David Dierickx') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('david-dierickx__gisele-bertholet','gisele-bertholet','david-dierickx') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-2__david-dierickx__gisele-bertholet','david-dierickx__gisele-bertholet','2026-1-WOMEN_MIXED-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('nathalie-naome','Nathalie Naomé') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('alain-laduron','Alain Laduron') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('alain-laduron__nathalie-naome','nathalie-naome','alain-laduron') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-2__alain-laduron__nathalie-naome','alain-laduron__nathalie-naome','2026-1-WOMEN_MIXED-2') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-WOMEN_MIXED-3','2026-1','WOMEN_MIXED',3) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('els-lips','Els Lips') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('kim-bardiau','Kim Bardiau') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('els-lips__kim-bardiau','els-lips','kim-bardiau') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-3__els-lips__kim-bardiau','els-lips__kim-bardiau','2026-1-WOMEN_MIXED-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('julie-paix','Julie Paix') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gisele-bertholet','Gisèle Bertholet') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('gisele-bertholet__julie-paix','julie-paix','gisele-bertholet') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-3__gisele-bertholet__julie-paix','gisele-bertholet__julie-paix','2026-1-WOMEN_MIXED-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('an-dodion','An Dodion') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('daniel-laduron','Daniel Laduron') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('an-dodion__daniel-laduron','an-dodion','daniel-laduron') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-3__an-dodion__daniel-laduron','an-dodion__daniel-laduron','2026-1-WOMEN_MIXED-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jessica-vanderhaegen','Jessica Vanderhaegen') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('pierre-van-cleuvenbergen','Pierre Van Cleuvenbergen') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('jessica-vanderhaegen__pierre-van-cleuvenbergen','jessica-vanderhaegen','pierre-van-cleuvenbergen') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-3__jessica-vanderhaegen__pierre-van-cleuvenbergen','jessica-vanderhaegen__pierre-van-cleuvenbergen','2026-1-WOMEN_MIXED-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('christine-evrard','Christine Evrard') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('charlotte-krugg','Charlotte Krugg') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('charlotte-krugg__christine-evrard','christine-evrard','charlotte-krugg') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-3__charlotte-krugg__christine-evrard','charlotte-krugg__christine-evrard','2026-1-WOMEN_MIXED-3') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-WOMEN_MIXED-4','2026-1','WOMEN_MIXED',4) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('frederic-romain','Frédéric Romain') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('adele-dengis','Adèle Dengis') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('adele-dengis__frederic-romain','frederic-romain','adele-dengis') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-4__adele-dengis__frederic-romain','adele-dengis__frederic-romain','2026-1-WOMEN_MIXED-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('devashish-basnet','Devashish Basnet') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('chantal','Chantal') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('chantal__devashish-basnet','devashish-basnet','chantal') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-4__chantal__devashish-basnet','chantal__devashish-basnet','2026-1-WOMEN_MIXED-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('gael-smets','Gael Smets') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('meghann-vander-wee','Meghann Vander wee') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('gael-smets__meghann-vander-wee','gael-smets','meghann-vander-wee') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-4__gael-smets__meghann-vander-wee','gael-smets__meghann-vander-wee','2026-1-WOMEN_MIXED-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('laurent-van-innes','Laurent Van Innes') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('brigitte-somville','Brigitte Somville') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('brigitte-somville__laurent-van-innes','laurent-van-innes','brigitte-somville') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-4__brigitte-somville__laurent-van-innes','brigitte-somville__laurent-van-innes','2026-1-WOMEN_MIXED-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('elodie-cuvelie','Elodie Cuvelie') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('pierre-antoine-briol','Pierre-Antoine Briol') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('elodie-cuvelie__pierre-antoine-briol','elodie-cuvelie','pierre-antoine-briol') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-4__elodie-cuvelie__pierre-antoine-briol','elodie-cuvelie__pierre-antoine-briol','2026-1-WOMEN_MIXED-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('romain-deschutter','Romain Deschutter') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('celine-jammart','Céline Jammart') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('celine-jammart__romain-deschutter','romain-deschutter','celine-jammart') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-4__celine-jammart__romain-deschutter','celine-jammart__romain-deschutter','2026-1-WOMEN_MIXED-4') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-WOMEN_MIXED-5','2026-1','WOMEN_MIXED',5) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('sandrine-delimont','Sandrine Delimont') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('frederic-mahy','Frédéric Mahy') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('frederic-mahy__sandrine-delimont','sandrine-delimont','frederic-mahy') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-5__frederic-mahy__sandrine-delimont','frederic-mahy__sandrine-delimont','2026-1-WOMEN_MIXED-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jessica-vanderhaegen','Jessica Vanderhaegen') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('sandrine-nockreman','Sandrine Nockreman') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('jessica-vanderhaegen__sandrine-nockreman','jessica-vanderhaegen','sandrine-nockreman') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-5__jessica-vanderhaegen__sandrine-nockreman','jessica-vanderhaegen__sandrine-nockreman','2026-1-WOMEN_MIXED-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('juliette-bertin','Juliette Bertin') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('sandrine-van-ysendyck','Sandrine Van Ysendyck') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('juliette-bertin__sandrine-van-ysendyck','juliette-bertin','sandrine-van-ysendyck') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-5__juliette-bertin__sandrine-van-ysendyck','juliette-bertin__sandrine-van-ysendyck','2026-1-WOMEN_MIXED-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('frederique-callebaut','Frédérique Callebaut') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jennifer-chaparro','Jennifer Chaparro') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('frederique-callebaut__jennifer-chaparro','frederique-callebaut','jennifer-chaparro') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-5__frederique-callebaut__jennifer-chaparro','frederique-callebaut__jennifer-chaparro','2026-1-WOMEN_MIXED-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('maxime-romain','Maxime Romain') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('madeline-hayot','Madeline Hayot') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('madeline-hayot__maxime-romain','maxime-romain','madeline-hayot') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-5__madeline-hayot__maxime-romain','madeline-hayot__maxime-romain','2026-1-WOMEN_MIXED-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('an-dodion','An Dodion') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('julie-collin','Julie Collin') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('an-dodion__julie-collin','an-dodion','julie-collin') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-5__an-dodion__julie-collin','an-dodion__julie-collin','2026-1-WOMEN_MIXED-5') ON CONFLICT(id) DO NOTHING;

INSERT INTO boxes(id,cycle_id,category,number) VALUES('2026-1-WOMEN_MIXED-6','2026-1','WOMEN_MIXED',6) ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('virginie-dalcq','Virginie Dalcq') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('lucrezia-olivo','Lucrezia Olivo') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('lucrezia-olivo__virginie-dalcq','virginie-dalcq','lucrezia-olivo') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-6__lucrezia-olivo__virginie-dalcq','lucrezia-olivo__virginie-dalcq','2026-1-WOMEN_MIXED-6') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('veronique-genot','Veronique Genot') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('patricia-gebala','Patricia Gebala') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('patricia-gebala__veronique-genot','veronique-genot','patricia-gebala') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-6__patricia-gebala__veronique-genot','patricia-gebala__veronique-genot','2026-1-WOMEN_MIXED-6') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('nancy-van-deynse','Nancy Van Deynse') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('greta-antoons','Greta Antoons') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('greta-antoons__nancy-van-deynse','nancy-van-deynse','greta-antoons') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-6__greta-antoons__nancy-van-deynse','greta-antoons__nancy-van-deynse','2026-1-WOMEN_MIXED-6') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('jennifer-chaparro','Jennifer Chaparro') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('yannick-van-thienen','Yannick Van thienen') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('jennifer-chaparro__yannick-van-thienen','jennifer-chaparro','yannick-van-thienen') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-6__jennifer-chaparro__yannick-van-thienen','jennifer-chaparro__yannick-van-thienen','2026-1-WOMEN_MIXED-6') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('laurence-walravens','Laurence Walravens') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('katherline-lamine','Katherline Lamine') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('katherline-lamine__laurence-walravens','laurence-walravens','katherline-lamine') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-6__katherline-lamine__laurence-walravens','katherline-lamine__laurence-walravens','2026-1-WOMEN_MIXED-6') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('celine-jammart','Céline Jammart') ON CONFLICT(id) DO NOTHING;

INSERT INTO players(id,name) VALUES('adele-dengis','Adèle Dengis') ON CONFLICT(id) DO NOTHING;

INSERT INTO pairs(id,player1,player2) VALUES('adele-dengis__celine-jammart','celine-jammart','adele-dengis') ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id) VALUES('2026-1-WOMEN_MIXED-6__adele-dengis__celine-jammart','adele-dengis__celine-jammart','2026-1-WOMEN_MIXED-6') ON CONFLICT(id) DO NOTHING;

UPDATE players SET name='Charley Severin' WHERE id='charley';

COMMIT;

SELECT (SELECT count(*) FROM players) AS joueurs, (SELECT count(*) FROM pairs) AS paires, (SELECT count(*) FROM boxes) AS box, (SELECT count(*) FROM entries) AS inscriptions;
