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
    ).toBe(6);
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
