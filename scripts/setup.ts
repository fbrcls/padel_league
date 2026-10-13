import { readFile, readdir } from "node:fs/promises";
import type { Db } from "../src/server/db";
import { token, hash, encrypt, passwordHash } from "../src/server/security";
export async function migrate(db: Db) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await db.query("SELECT name FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).length
    )
      continue;
    const sql = await readFile("db/migrations/" + name, "utf8");
    await db.transaction(async (tx) => {
      for (const statement of sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
  }
}
export const playerId = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export async function seed(db: Db) {
  const roster = JSON.parse(
    await readFile("db/seed/roster.json", "utf8"),
  ) as Record<string, string[][][]>;
  const aliases = JSON.parse(
    await readFile("db/seed/aliases.json", "utf8"),
  ) as Record<string, string>;
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO cycles(id,name,starts_at,ends_at,submission_deadline,rules_confirmed) VALUES('2026-1','Cycle 1 · 2026','2026-10-11T22:00:00Z','2026-11-29T22:59:59.999Z','2026-12-01T22:59:59.999Z',true) ON CONFLICT(id) DO NOTHING",
    );
    for (const [category, boxes] of Object.entries(roster))
      for (let bi = 0; bi < boxes.length; bi++) {
        const boxId = `2026-1-${category}-${bi + 1}`;
        await tx.query(
          "INSERT INTO boxes(id,cycle_id,category,number) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
          [boxId, "2026-1", category, bi + 1],
        );
        for (const [n1, n2] of boxes[bi]) {
          const canonical1 = aliases[n1] ?? n1,
            canonical2 = aliases[n2] ?? n2;
          const p1 = playerId(canonical1),
            p2 = playerId(canonical2),
            pairId = [playerId(n1), playerId(n2)].sort().join("__");
          for (const [id, name] of [
            [p1, canonical1],
            [p2, canonical2],
          ])
            await tx.query(
              "INSERT INTO players(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
              [id, name],
            );
          await tx.query(
            "INSERT INTO pairs(id,player1,player2) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
            [pairId, p1, p2],
          );
          await tx.query(
            "INSERT INTO entries(id,pair_id,box_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
            [boxId + "__" + pairId, pairId, boxId],
          );
        }
      }
    // Identifiant historique conservé : les accès et inscriptions restent valides.
    await tx.query(
      "UPDATE players SET name='Charley Severin' WHERE id='charley'",
    );
  });
}
export async function localConfig() {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  await mkdir(".local", { recursive: true });
  try {
    return JSON.parse(await readFile(".local/config.json", "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const password = token(),
    secret = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    );
  const config = {
    APP_ORIGIN: "http://localhost:5173",
    ADMIN_PASSWORD_HASH: await passwordHash(password),
    LINK_ENCRYPTION_KEY: secret,
    local: true,
  };
  await writeFile(".local/config.json", JSON.stringify(config), {
    mode: 0o600,
  });
  await writeFile(".local/admin-password.txt", password + "\n", {
    mode: 0o600,
  });
  return config;
}
export async function createLinks(db: Db, secret: string) {
  for (const p of await db.query("SELECT id FROM players")) {
    if (
      (
        await db.query(
          "SELECT player_id FROM access_links WHERE player_id=$1",
          [p.id],
        )
      ).length
    )
      continue;
    const raw = token();
    await db.query(
      "INSERT INTO access_links(player_id,token_hash,ciphertext) VALUES($1,$2,$3)",
      [p.id, await hash(raw), await encrypt(raw, secret)],
    );
  }
}
