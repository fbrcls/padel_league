import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { verifyPassword, encrypt, decrypt } from "../../src/server/security";
test("l’outil local produit des secrets compatibles sans requête réseau", async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url() !== "http://localhost:5173/__offline-secrets-test__")
      remoteRequests.push(r.url());
  });
  // The managed test browser blocks file:// URLs. Supply the exact standalone
  // document directly, without sending the initial request to a web server.
  const html = await readFile("tools/generate-secrets.html", "utf8");
  await page.route("**/*", async (route) => {
    if (
      route.request().url() === "http://localhost:5173/__offline-secrets-test__"
    )
      await route.fulfill({ contentType: "text/html", body: html });
    else await route.abort();
  });
  await page.goto("http://localhost:5173/__offline-secrets-test__");
  const password = "Password-fixture-for-offline-test";
  await page
    .getByLabel("Votre mot de passe organisateur", { exact: true })
    .fill(password);
  await page
    .getByLabel("Confirmer le mot de passe", { exact: true })
    .fill(password + "different");
  await page.getByRole("button", { name: "Générer les deux valeurs" }).click();
  await expect(page.getByRole("status")).toContainText("ne correspondent pas");
  await page
    .getByLabel("Confirmer le mot de passe", { exact: true })
    .fill(password);
  await page.getByRole("button", { name: "Générer les deux valeurs" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Valeurs générées localement",
  );
  const hash = await page
    .getByLabel("ADMIN_PASSWORD_HASH", { exact: true })
    .inputValue();
  const key = await page
    .getByLabel("LINK_ENCRYPTION_KEY", { exact: true })
    .inputValue();
  expect(await verifyPassword(password, hash)).toBe(true);
  expect(await verifyPassword("wrong", hash)).toBe(false);
  expect(Buffer.from(key, "base64")).toHaveLength(32);
  expect(await decrypt(await encrypt("player-token-fixture", key), key)).toBe(
    "player-token-fixture",
  );
  await expect(
    page.getByLabel("Votre mot de passe organisateur", { exact: true }),
  ).toHaveValue("");
  expect(remoteRequests).toEqual([]);
});
