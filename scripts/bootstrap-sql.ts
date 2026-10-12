import { readFile, readdir, writeFile } from "node:fs/promises";
import type { Db } from "../src/server/db";
import { seed } from "./setup";
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
if (process.argv[1]?.endsWith("bootstrap-sql.ts")) {
  await writeFile("db/bootstrap.sql", await bootstrapSql());
  console.log("db/bootstrap.sql généré (sans secrets).");
}
