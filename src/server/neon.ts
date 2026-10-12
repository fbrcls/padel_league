import { Pool, neonConfig } from "@neondatabase/serverless";
import type { Db } from "./db";
neonConfig.webSocketConstructor = WebSocket;
export function productionDb(connectionString: string): {
  db: Db;
  close: () => Promise<void>;
} {
  const pool = new Pool({ connectionString, max: 2 });
  const db: Db = {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    transaction: async (fn) => {
      const client = await pool.connect();
      const tx: Db = {
        query: async (sql, params = []) =>
          (await client.query(sql, params)).rows,
        transaction: async (nested) => nested(tx),
      };
      try {
        await client.query("BEGIN");
        const value = await fn(tx);
        await client.query("COMMIT");
        return value;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
  return { db, close: () => pool.end() };
}
