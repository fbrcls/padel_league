import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import type { Db } from "../src/server/db";
import { seed, playerId } from "./setup";
const quote = (value: unknown): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nombre invalide");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return "'" + value.replaceAll("'", "''") + "'";
  throw new Error("Type SQL non pris en charge");
};
export async function bootstrapSql() {
  const chunks = [
    "-- Padel League La Cure : préparation de la base depuis Neon SQL Editor.",
    "-- Aucun secret, lien ou match de démonstration. Script répétable.",
    "BEGIN;",
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());",
  ];
  for (const [index, name] of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .entries()) {
    const sql = await readFile("db/migrations/" + name, "utf8");
    const tag = `$padel_migration_${index}$`;
    if (sql.includes(tag)) throw new Error("Délimiteur de migration ambigu");
    chunks.push(
      `DO ${tag}\nBEGIN\n IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name=${quote(name)}) THEN\n${sql}\n INSERT INTO schema_migrations(name) VALUES(${quote(name)});\n END IF;\nEND;\n${tag};`,
    );
  }
  const capture: Db = {
    query: async (sql, params = []) => {
      chunks.push(
        sql.replace(/\$(\d+)/g, (_, n) => quote(params[Number(n) - 1])) + ";",
      );
      return [];
    },
    transaction: (fn) => fn(capture),
  };
  await seed(capture);
  chunks.push(
    "COMMIT;",
    "SELECT (SELECT count(*) FROM players) AS joueurs, (SELECT count(*) FROM pairs) AS paires, (SELECT count(*) FROM boxes) AS box, (SELECT count(*) FROM entries) AS inscriptions;",
  );
  return chunks.join("\n\n") + "\n";
}
export async function bootstrapParts() {
  const full = await bootstrapSql();
  const firstSeed = full.indexOf("INSERT INTO cycles(");
  if (firstSeed < 0) throw new Error("Début de l’import introuvable");
  const schema =
    full.slice(0, firstSeed) +
    "COMMIT;\nSELECT count(*) AS migrations_appliquees FROM schema_migrations;\n-- FIN DU FICHIER 1\n";
  const roster = JSON.parse(
    await readFile("db/seed/roster.json", "utf8"),
  ) as Record<string, string[][][]>;
  const aliases = JSON.parse(
    await readFile("db/seed/aliases.json", "utf8"),
  ) as Record<string, string>;
  const players = new Map<string, string>();
  const pairs: [string, number, string, string][] = [];
  for (const [category, boxes] of Object.entries(roster))
    for (const [index, box] of boxes.entries())
      for (const [a, b] of box) {
        for (const name of [a, b]) {
          const canonical = aliases[name] ?? name;
          players.set(playerId(canonical), canonical);
        }
        pairs.push([category, index + 1, playerId(a), playerId(b)]);
      }
  const cycle = full.slice(firstSeed, full.indexOf(";", firstSeed) + 1);
  const playerSql = `-- Fichier 2/3 : cycle et joueurs. Répétable, sans secrets.
BEGIN;
${cycle}
INSERT INTO players(id,name) SELECT r->>0,r->>1 FROM jsonb_array_elements(${quote(JSON.stringify([...players]))}::jsonb) AS r ON CONFLICT(id) DO NOTHING;
COMMIT;
SELECT count(*) AS joueurs FROM players;
-- FIN DU FICHIER 2
`;
  const aliasIds = Object.fromEntries(
    Object.entries(aliases).map(([from, to]) => [playerId(from), playerId(to)]),
  );
  const pairSql = `-- Fichier 3/3 : box, paires et inscriptions. Répétable, sans secrets.
BEGIN;
DO $padel_pairs$
DECLARE
 v_row jsonb; v_category text; v_number integer; v_source_a text; v_source_b text; v_player_a text; v_player_b text; v_pair text; v_box text;
 v_aliases jsonb := ${quote(JSON.stringify(aliasIds))}::jsonb;
BEGIN
 FOR v_row IN SELECT value FROM jsonb_array_elements(${quote(JSON.stringify(pairs))}::jsonb) LOOP
  v_category := v_row->>0; v_number := (v_row->>1)::integer; v_source_a := v_row->>2; v_source_b := v_row->>3;
  v_player_a := COALESCE(v_aliases->>v_source_a,v_source_a); v_player_b := COALESCE(v_aliases->>v_source_b,v_source_b);
  v_pair := CASE WHEN v_source_a COLLATE "C" < v_source_b COLLATE "C" THEN v_source_a||'__'||v_source_b ELSE v_source_b||'__'||v_source_a END;
  v_box := '2026-1-'||v_category||'-'||v_number;
  INSERT INTO boxes(id,cycle_id,category,number) VALUES(v_box,'2026-1',v_category,v_number) ON CONFLICT(id) DO NOTHING;
  INSERT INTO pairs(id,player1,player2) VALUES(v_pair,v_player_a,v_player_b) ON CONFLICT(id) DO NOTHING;
  INSERT INTO entries(id,pair_id,box_id) VALUES(v_box||'__'||v_pair,v_pair,v_box) ON CONFLICT(id) DO NOTHING;
 END LOOP;
END;
$padel_pairs$;
COMMIT;
SELECT (SELECT count(*) FROM players) AS joueurs, (SELECT count(*) FROM pairs) AS paires, (SELECT count(*) FROM boxes) AS box, (SELECT count(*) FROM entries) AS inscriptions;
-- FIN DU FICHIER 3
`;
  const parts = {
    "01-schema.sql": schema,
    "02-joueurs.sql": playerSql,
    "03-paires.sql": pairSql,
  };
  for (const [name, sql] of Object.entries(parts))
    if (Buffer.byteLength(sql, "utf8") >= 10000)
      throw new Error("Script trop long : " + name);
  return parts;
}
if (process.argv[1]?.endsWith("bootstrap-sql.ts")) {
  await writeFile("db/bootstrap.sql", await bootstrapSql());
  await mkdir("db/neon", { recursive: true });
  for (const [name, sql] of Object.entries(await bootstrapParts()))
    await writeFile("db/neon/" + name, sql);
  const name = "007_organizer_results.sql";
  const sql = await readFile("db/migrations/" + name, "utf8");
  await writeFile(
    "db/neon/04-organizer-results.sql",
    `-- Évolution : encodage organisateur. Répétable, préserve les matchs existants.
BEGIN;
DO $organizer_migration$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='${name}') THEN
${sql}
 INSERT INTO schema_migrations(name) VALUES('${name}');
 END IF;
END;
$organizer_migration$;
COMMIT;
SELECT column_name FROM information_schema.columns WHERE table_name='matches' AND column_name='submitted_role';
-- FIN DU FICHIER
`,
  );
  console.log(
    "Scripts de préparation et migration Neon générés (sans secrets).",
  );
}
