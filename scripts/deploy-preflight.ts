import { parse } from "jsonc-parser";
import { readFile } from "node:fs/promises";
const config = parse(await readFile("wrangler.jsonc", "utf8"));
const origin = config.vars?.APP_ORIGIN;
if (
  !origin ||
  origin.includes("REPLACE") ||
  !origin.startsWith("https://") ||
  new URL(origin).origin !== origin
) {
  console.error(
    "Configurer APP_ORIGIN avec l’origine HTTPS exacte du Worker dans wrangler.jsonc avant le déploiement.",
  );
  process.exit(1);
}
console.log(
  "Origine publique configurée. Vérifier les trois secrets et les quotas gratuits dans Cloudflare avant publication.",
);

if (
  !config.kv_namespaces?.some(
    (n: { binding: string; id: string }) =>
      n.binding === "CONFIRMATION_QUEUE" &&
      /^[a-f0-9]{32}$/.test(n.id) &&
      n.id !== "0".repeat(32),
  )
) {
  console.error(
    "Créer le namespace KV CONFIRMATION_QUEUE puis renseigner son identifiant dans wrangler.jsonc.",
  );
  process.exit(1);
}
