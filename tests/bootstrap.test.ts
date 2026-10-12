import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { bootstrapSql } from "../scripts/bootstrap-sql";
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
