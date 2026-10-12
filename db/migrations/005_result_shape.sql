ALTER TABLE matches ADD CONSTRAINT result_shape CHECK (
 (kind IS NULL AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IS NULL)
 OR (kind='played' AND games_a IS NOT NULL AND games_b IS NOT NULL AND forfeiting_entry IS NULL)
 OR (kind='forfeit' AND games_a IS NULL AND games_b IS NULL AND forfeiting_entry IS NOT NULL AND forfeiting_entry IN (entry_a,entry_b))
);
ALTER TABLE matches ADD CONSTRAINT submitted_state CHECK (status NOT IN ('pending','confirmed','disputed') OR (kind IS NOT NULL AND submitted_at IS NOT NULL AND deadline IS NOT NULL AND submitted_by IS NOT NULL AND submitted_entry IN (entry_a,entry_b)));
