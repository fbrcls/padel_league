import { readFile, readdir } from "node:fs/promises";
import { wrapPglite } from "../scripts/local-db";
import { seed } from "../scripts/setup";
import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { bootstrapSql, bootstrapParts } from "../scripts/bootstrap-sql";
it("le script Neon initialise la compétition et préserve les données lors d’une répétition", async () => {
  const pg = new PGlite();
  try {
    const sql = await bootstrapSql();
    await pg.exec(sql);
    expect(
      (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM entries"))
        .rows[0].n,
    ).toBe(66);
    expect(
      (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM boxes"))
        .rows[0].n,
    ).toBe(11);
    expect(
      (
        await pg.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM access_links",
        )
      ).rows[0].n,
    ).toBe(0);
    await pg.query(
      "INSERT INTO players(id,name) VALUES('test-preservation','Participant ajouté après import')",
    );
    await pg.exec(sql);
    expect(
      (await pg.query("SELECT id FROM players WHERE id='test-preservation'"))
        .rows,
    ).toHaveLength(1);
    expect(
      (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM entries"))
        .rows[0].n,
    ).toBe(66);
    expect(
      (
        await pg.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM schema_migrations",
        )
      ).rows[0].n,
    ).toBe(7);
  } finally {
    await pg.close();
  }
}, 15000);

it("les trois scripts courts sont complets, compatibles et répétables", async () => {
  const pg = new PGlite(),
    reference = new PGlite();
  try {
    const parts = await bootstrapParts();
    expect(Object.keys(parts)).toEqual([
      "01-schema.sql",
      "02-joueurs.sql",
      "03-paires.sql",
    ]);
    for (const sql of Object.values(parts)) {
      expect(Buffer.byteLength(sql)).toBeLessThan(10000);
      await pg.exec(sql);
    }
    await reference.exec(await bootstrapSql());
    for (const table of ["players", "pairs", "boxes", "entries", "cycles"]) {
      expect(
        (await pg.query(`SELECT * FROM ${table} ORDER BY id`)).rows,
      ).toEqual(
        (await reference.query(`SELECT * FROM ${table} ORDER BY id`)).rows,
      );
    }
    await pg.query(
      "INSERT INTO players(id,name) VALUES('preserved-player','Joueur conservé')",
    );
    for (const sql of Object.values(parts)) await pg.exec(sql);
    expect(
      (await pg.query("SELECT id FROM players WHERE id='preserved-player'"))
        .rows,
    ).toHaveLength(1);
    expect(
      (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM entries"))
        .rows[0].n,
    ).toBe(66);
  } finally {
    await pg.close();
    await reference.close();
  }
}, 20000);

it("la migration organisateur conserve les résultats joueurs existants et se rejoue sans effet", async () => {
  const pg = new PGlite();
  try {
    for (const name of (await readdir("db/migrations"))
      .filter((n) => n.endsWith(".sql") && !n.startsWith("007_"))
      .sort()) {
      await pg.exec(await readFile("db/migrations/" + name, "utf8"));
      await pg.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
    await seed(wrapPglite(pg));
    const es = (
      await pg.query<{ id: string; box_id: string; player1: string }>(
        "SELECT e.id,e.box_id,p.player1 FROM entries e JOIN pairs p ON p.id=e.pair_id WHERE e.box_id='2026-1-OPEN-1' ORDER BY e.id LIMIT 2",
      )
    ).rows;
    await pg.query(
      "INSERT INTO matches(id,box_id,entry_a,entry_b,played_at,status,author,kind,games_a,games_b,submitted_by,submitted_entry,submitted_at,deadline) VALUES('preserved-match',$1,$2,$3,now(),'pending',$4,'played',18,9,$4,$2,now(),now()+interval '48 hours')",
      [es[0].box_id, es[0].id, es[1].id, es[0].player1],
    );
    const migration = await readFile(
      "db/neon/04-organizer-results.sql",
      "utf8",
    );
    await pg.exec(migration);
    await pg.exec(migration);
    expect(
      (
        await pg.query(
          "SELECT status,games_a,games_b,submitted_role,version FROM matches WHERE id='preserved-match'",
        )
      ).rows,
    ).toEqual([
      {
        status: "pending",
        games_a: 18,
        games_b: 9,
        submitted_role: "player",
        version: 1,
      },
    ]);
  } finally {
    await pg.close();
  }
}, 15000);
