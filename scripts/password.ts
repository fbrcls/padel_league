import { passwordHash } from "../src/server/security";
if (!process.stdin.isTTY) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString().trimEnd();
  if (password.length < 16)
    throw new Error("Utiliser un mot de passe d’au moins 16 caractères.");
  console.log(await passwordHash(password));
} else {
  console.error(
    "Fournir le mot de passe sur l’entrée standard depuis un gestionnaire de mots de passe ou une saisie masquée. Voir README.",
  );
  process.exit(1);
}
