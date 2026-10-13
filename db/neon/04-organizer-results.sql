-- Évolution : encodage organisateur. Répétable, préserve les matchs existants.
BEGIN;
DO $organizer_migration$
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
$organizer_migration$;
COMMIT;
SELECT column_name FROM information_schema.columns WHERE table_name='matches' AND column_name='submitted_role';
-- FIN DU FICHIER
