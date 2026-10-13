// Logs contain only fixed categories, SQLSTATE codes and known application names.
// Never log the original message, stack, connection URL, parameters or bindings.
const tables = new Set([
  "players",
  "pairs",
  "cycles",
  "boxes",
  "entries",
  "matches",
  "access_links",
  "sessions",
  "audit",
  "login_attempts",
  "idempotency",
  "job_runs",
  "schema_migrations",
]);
const errorNames = new Set([
  "Error",
  "error",
  "TypeError",
  "RangeError",
  "AggregateError",
  "OperationError",
  "NotSupportedError",
  "InvalidAccessError",
]);
const bindingNames = [
  "DATABASE_URL",
  "ADMIN_PASSWORD_HASH",
  "LINK_ENCRYPTION_KEY",
  "APP_ORIGIN",
] as const;
export class ConfigurationError extends Error {
  constructor(
    public readonly fields: string[],
    public readonly reason: "missing" | "invalid",
  ) {
    super("Application configuration error");
    this.name = "ConfigurationError";
  }
}
export function validateBindings(env: Record<string, unknown>) {
  const missing = bindingNames.filter(
    (name) => typeof env[name] !== "string" || !(env[name] as string).trim(),
  );
  if (missing.length) throw new ConfigurationError(missing, "missing");
  try {
    const url = new URL((env.DATABASE_URL as string).trim());
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password
    )
      throw Error();
  } catch {
    throw new ConfigurationError(["DATABASE_URL"], "invalid");
  }
  const hash = (env.ADMIN_PASSWORD_HASH as string).split(":");
  try {
    if (
      hash.length !== 4 ||
      hash[0] !== "pbkdf2" ||
      hash[1] !== "600000" ||
      atob(hash[2]).length !== 16 ||
      atob(hash[3]).length !== 32
    )
      throw Error();
  } catch {
    throw new ConfigurationError(["ADMIN_PASSWORD_HASH"], "invalid");
  }
  try {
    if (atob(env.LINK_ENCRYPTION_KEY as string).length !== 32) throw Error();
  } catch {
    throw new ConfigurationError(["LINK_ENCRYPTION_KEY"], "invalid");
  }
}
export function diagnostic(error: unknown) {
  if (error instanceof ConfigurationError)
    return {
      category: "configuration",
      fields: error.fields.filter((f) =>
        bindingNames.includes(f as (typeof bindingNames)[number]),
      ),
      reason: error.reason,
      hint: "Vérifier les secrets dans Settings → Variables and Secrets du Worker.",
    };
  let current = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth++
  ) {
    const e = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const code = typeof e.code === "string" ? e.code : "";
    const message = typeof e.message === "string" ? e.message : "";
    if (/^[0-9A-Z]{5}$/.test(code)) {
      let category = "database_error",
        hint = "Vérifier la base Neon et les migrations de l’application.";
      if (["42P01", "42703", "42883", "3F000"].includes(code)) {
        category = "database_schema";
        hint =
          "Exécuter db/bootstrap.sql sur la même base et branche Neon que DATABASE_URL.";
      } else if (["28P01", "28000"].includes(code)) {
        category = "database_authentication";
        hint =
          "Vérifier le secret DATABASE_URL avec Neon → Connect, sans communiquer sa valeur.";
      } else if (code === "42501") {
        category = "database_permissions";
        hint =
          "Vérifier les droits du rôle PostgreSQL sur les tables de l’application.";
      } else if (code === "3D000") {
        category = "database_selection";
        hint = "Vérifier le nom de base sélectionné dans Neon → Connect.";
      } else if (code.startsWith("08") || ["53300", "57P03"].includes(code)) {
        category = "database_connection";
        hint =
          "Vérifier la disponibilité de Neon et les connexions autorisées.";
      }
      const match =
        code === "42P01"
          ? message.match(/relation "([^"]+)" does not exist/i)
          : null;
      const name = match?.[1].split(".").pop();
      return {
        category,
        sqlstate: code,
        ...(name && tables.has(name) ? { table: name } : {}),
        hint,
      };
    }
    if (
      [
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
      ].includes(code)
    )
      return {
        category: "database_connection",
        code,
        hint: "Vérifier la connexion Neon et la disponibilité du service.",
      };
    if (
      ["OperationError", "NotSupportedError", "InvalidAccessError"].includes(
        String(e.name),
      )
    )
      return {
        category: "cryptography",
        name: String(e.name),
        hint: "Vérifier le format des secrets et la compatibilité cryptographique du runtime.",
      };
    if (e.cause && e.cause !== current) {
      current = e.cause;
      continue;
    }
    return {
      category: "unexpected",
      name: errorNames.has(String(e.name)) ? String(e.name) : "unknown",
      hint: "Consulter la référence de cette erreur pour poursuivre le diagnostic.",
    };
  }
  return {
    category: "unexpected",
    name: "unknown",
    hint: "Consulter la référence de cette erreur pour poursuivre le diagnostic.",
  };
}
export function reportError(error: unknown, path: string, method: string) {
  const errorId = crypto.randomUUID();
  const route = [
    "/api/auth/admin",
    "/api/auth/player",
    "/api/me",
    "/api/health",
  ].includes(path)
    ? path
    : "/api/*";
  console.error("API error", {
    errorId,
    route,
    method: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ].includes(method)
      ? method
      : "OTHER",
    ...diagnostic(error),
  });
  return errorId;
}
export function errorResponse(errorId: string) {
  return {
    error:
      "Une erreur technique est survenue. Réessayez ou contactez l’organisateur.",
    errorId,
  };
}
