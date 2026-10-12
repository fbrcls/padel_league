export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}
export async function audit(
  db: Db,
  actor: string,
  action: string,
  matchId: string | null,
  details: unknown,
) {
  await db.query(
    "INSERT INTO audit(id,actor,action,match_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",
    [crypto.randomUUID(), actor, action, matchId, JSON.stringify(details)],
  );
}
