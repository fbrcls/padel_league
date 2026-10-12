import { serve } from "@hono/node-server";
import { makeApp, runDue } from "../src/server/app";
import { localDb } from "./local-db";
import { migrate, seed, localConfig, createLinks } from "./setup";
const config = await localConfig(),
  { db, pg } = await localDb();
await migrate(db);
await seed(db);
await createLinks(db, config.LINK_ENCRYPTION_KEY);
await runDue(db);
const interval = setInterval(() => {
  runDue(db).catch(() => console.error("Échec de confirmation automatique"));
}, 5 * 60000);
const server = serve({
  fetch: makeApp(db, config).fetch,
  hostname: "127.0.0.1",
  port: 8787,
});
console.log(
  "API locale prête sur le port 8787. Mot de passe privé : .local/admin-password.txt",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(interval);
    server.close(() => {
      pg.close().then(() => process.exit(0));
    });
  });
