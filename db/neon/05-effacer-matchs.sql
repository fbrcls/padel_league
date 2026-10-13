-- Suppression définitive de TOUS les matchs, dans TOUS les cycles,
-- y compris les matchs programmés, confirmés, contestés et annulés.
-- Supprime aussi leur historique et les clés d'idempotence associées.
-- Conserve joueurs, paires, boxes, inscriptions, cycles et accès personnels.
-- À exécuter dans Neon SQL Editor avec Run (pas Explain).

BEGIN;

-- Empêche une saisie concurrente pendant le nettoyage.
LOCK TABLE matches, audit, idempotency IN ACCESS EXCLUSIVE MODE;

DELETE FROM audit WHERE match_id IS NOT NULL;
DELETE FROM idempotency;
DELETE FROM matches;

COMMIT;

-- Doit afficher 0. Les classements sont recalculés à partir des matchs.
SELECT count(*) AS matchs_restants FROM matches;
