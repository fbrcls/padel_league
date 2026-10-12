import { mkdir, writeFile } from "node:fs/promises";
import { localDb } from "./local-db";
import type { Db } from "../src/server/db";
async function exportData(db: Db) {
  const data = await db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const out: Record<string, unknown> = {
      exported_at: new Date().toISOString(),
    };
    for (const table of [
      "players",
      "pairs",
      "cycles",
      "boxes",
      "entries",
      "matches",
      "audit",
    ])
      out[table] = await tx.query(`SELECT * FROM ${table}`);
    return out;
  });
  await mkdir(".local/exports", { recursive: true });
  const path = ".local/exports/data-" + Date.now() + ".json";
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  console.log(
    "Export métier privé : " +
      path +
      " (ne contient pas les liens ni sessions ; ne remplace pas pg_dump).",
  );
}
if (process.env.DATABASE_URL) {
  const { productionDb } = await import("../src/server/neon");
  const { db, close } = productionDb(process.env.DATABASE_URL);
  try {
    await exportData(db);
  } finally {
    await close();
  }
} else {
  const { db, pg } = await localDb();
  try {
    await exportData(db);
  } finally {
    await pg.close();
  }
}
