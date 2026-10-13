-- Ajout demandé : Michael Bertrand / Charley Severin, cycle 2026-1.
-- Répétable. Conserve leurs identifiants, liens, matchs et paires en mixte.
-- Neon SQL Editor : copier tout, puis Run (pas Explain).
BEGIN;

UPDATE players SET name='Charley Severin' WHERE id='charley';

INSERT INTO pairs(id,player1,player2)
VALUES ('charley__michael-bertrand','michael-bertrand','charley')
ON CONFLICT(id) DO NOTHING;

INSERT INTO entries(id,pair_id,box_id)
VALUES ('2026-1-OPEN-1__charley__michael-bertrand',
        'charley__michael-bertrand','2026-1-OPEN-1')
ON CONFLICT(id) DO NOTHING;

COMMIT;

SELECT p1.name AS joueur_1, p2.name AS joueur_2, b.category, b.number AS box
FROM entries e
JOIN pairs p ON p.id=e.pair_id
JOIN players p1 ON p1.id=p.player1
JOIN players p2 ON p2.id=p.player2
JOIN boxes b ON b.id=e.box_id
WHERE e.id='2026-1-OPEN-1__charley__michael-bertrand';
