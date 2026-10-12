import { mkdir, writeFile, access } from "node:fs/promises";
import { token, passwordHash } from "../src/server/security";
await mkdir(".local", { recursive: true });
const path = ".local/production-secrets.json";
try {
  await access(path);
  throw new Error(
    "Les secrets existent déjà. Ne pas les remplacer : cela invaliderait les accès.",
  );
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
const password = token();
await writeFile(
  path,
  JSON.stringify(
    {
      ADMIN_PASSWORD_HASH: await passwordHash(password),
      LINK_ENCRYPTION_KEY: btoa(
        String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
      ),
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
);
await writeFile(".local/production-admin-password.txt", password + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(
  "Secrets créés dans .local/production-secrets.json. Mot de passe privé dans .local/production-admin-password.txt. Conservez-les dans votre gestionnaire de mots de passe ; ne les publiez pas.",
);
