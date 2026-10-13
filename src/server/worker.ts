import { makeApp, runDue, type Config } from "./app";
import { productionDb } from "./neon";
import { validateBindings, reportError, errorResponse } from "./diagnostics";
import { scheduleDeadline, dueKeys, dailySweep, type Queue } from "./queue";
type Bindings = Config & {
  DATABASE_URL: string;
  CONFIRMATION_QUEUE: Queue;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
};
export default {
  async fetch(request: Request, env: Bindings) {
    if (!new URL(request.url).pathname.startsWith("/api/")) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      return new Response(response.body, { status: response.status, headers });
    }
    let close: (() => Promise<void>) | undefined;
    try {
      validateBindings(env);
      const connection = productionDb(env.DATABASE_URL.trim());
      close = connection.close;
      return await makeApp(connection.db, {
        ...env,
        local: false,
        scheduleDeadline: (date) =>
          scheduleDeadline(env.CONFIRMATION_QUEUE, date),
      }).fetch(request);
    } catch (error) {
      const errorId = reportError(
        error,
        new URL(request.url).pathname,
        request.method,
      );
      return Response.json(errorResponse(errorId), {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    } finally {
      if (close)
        try {
          await close();
        } catch (error) {
          reportError(error, "/api/*", "OTHER");
        }
    }
  },
  async scheduled(_event: unknown, env: Bindings) {
    const now = new Date();
    let keys: string[] = [];
    try {
      keys = await dueKeys(env.CONFIRMATION_QUEUE, now);
    } catch (error) {
      if (!dailySweep(now)) throw error;
    }
    if (keys.length === 0 && !dailySweep(now)) return;
    const { db, close } = productionDb(env.DATABASE_URL);
    try {
      const count = await runDue(db, now);
      // Keep markers when the SQL batch is full; another batch may remain.
      if (count < 100)
        for (const key of keys) await env.CONFIRMATION_QUEUE.delete(key);
    } finally {
      await close();
    }
  },
};
