import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { wrapPglite } from "../scripts/local-db";
import { makeApp } from "../src/server/app";
import {
  diagnostic,
  validateBindings,
  ConfigurationError,
} from "../src/server/diagnostics";
import { passwordHash } from "../src/server/security";
it("identifie une table absente sans exposer le message ou les credentials", () => {
  const secret = "must-not-appear-in-logs";
  const error = Object.assign(
    new Error(
      `relation "login_attempts" does not exist; postgresql://user:${secret}@example.invalid/db`,
    ),
    { code: "42P01", detail: secret },
  );
  const result = diagnostic(error);
  expect(result).toMatchObject({
    category: "database_schema",
    sqlstate: "42P01",
    table: "login_attempts",
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(
    JSON.stringify(
      diagnostic(
        Object.assign(new Error(`relation "${secret}" does not exist`), {
          code: "42P01",
        }),
      ),
    ),
  ).not.toContain(secret);
  expect(
    diagnostic(Object.assign(new Error(secret), { code: "28P01" })).category,
  ).toBe("database_authentication");
});
it("contrôle les bindings avec leurs noms uniquement, accepte les formats générés", async () => {
  expect(() => validateBindings({})).toThrow(ConfigurationError);
  const config = {
    DATABASE_URL:
      "postgresql://user:fake-password@example.invalid/neondb?sslmode=require",
    ADMIN_PASSWORD_HASH: await passwordHash("fixture-password-long"),
    LINK_ENCRYPTION_KEY: btoa("x".repeat(32)),
    APP_ORIGIN: "https://example.invalid",
  };
  expect(() => validateBindings(config)).not.toThrow();
  try {
    validateBindings({
      ...config,
      ADMIN_PASSWORD_HASH: "plaintext-must-not-leak",
    });
  } catch (e) {
    const result = diagnostic(e);
    expect(result).toMatchObject({
      category: "configuration",
      fields: ["ADMIN_PASSWORD_HASH"],
      reason: "invalid",
    });
    expect(JSON.stringify(result)).not.toContain("plaintext-must-not-leak");
  }
  expect(() =>
    validateBindings({ ...config, DATABASE_URL: "psql wrong" }),
  ).toThrow(ConfigurationError);
});
it("reproduit une base non initialisée : HTTP 500 et diagnostic SQLSTATE 42P01 corrélé", async () => {
  const pg = new PGlite();
  await pg.waitReady;
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const app = makeApp(wrapPglite(pg), {
      APP_ORIGIN: "https://example.invalid",
      ADMIN_PASSWORD_HASH: "fixture",
      LINK_ENCRYPTION_KEY: "fixture",
      local: true,
    });
    const response = await app.request("/api/auth/admin", {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "X-Requested-With": "PadelLeague",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "must-not-appear-in-logs" }),
    });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(spy).toHaveBeenCalledWith(
      "API error",
      expect.objectContaining({
        errorId: body.errorId,
        category: "database_schema",
        sqlstate: "42P01",
        table: "login_attempts",
        route: "/api/auth/admin",
      }),
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain(
      "must-not-appear-in-logs",
    );
  } finally {
    spy.mockRestore();
    await pg.close();
  }
}, 15000);
