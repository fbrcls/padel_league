import { migrate, seed, localConfig, createLinks } from "./setup";
import { localDb } from "./local-db";
if (process.env.DATABASE_URL) {
  const { productionDb } = await import("../src/server/neon");
  // Node 24 supplies WebSocket; the production adapter uses its standard constructor.
  const { db, close } = productionDb(process.env.DATABASE_URL);
  try {
    await migrate(db);
    await seed(db);
  } finally {
    await close();
  }
  console.log(
    "Migrations et participants préparés. Générer les liens via l’espace organisateur.",
  );
} else {
  const config = await localConfig();
  const { db, pg } = await localDb();
  try {
    await migrate(db);
    await seed(db);
    await createLinks(db, config.LINK_ENCRYPTION_KEY);
  } finally {
    await pg.close();
  }
  console.log(
    "Base locale prête. Mot de passe organisateur dans .local/admin-password.txt (privé).",
  );
}
