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
