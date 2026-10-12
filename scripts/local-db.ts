import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/server/db";
export function wrapPglite(pg: PGlite): Db {
  const wrap = (source: any): Db => ({
    query: async (sql, params = []) => (await source.query(sql, params)).rows,
    transaction: async (fn) => source.transaction((tx: any) => fn(wrap(tx))),
  });
  return wrap(pg);
}
export async function localDb(path = ".local/postgres") {
  const pg = new PGlite(path);
  await pg.waitReady;
  return { db: wrapPglite(pg), pg };
}
