import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const origin = "http://localhost:5173";
const headers = { Origin: origin, "X-Requested-With": "PadelLeague" };
test("parcours mobile : score, confirmation adverse, classement et organisateur", async ({
  browser,
}) => {
  const password = (await readFile(".local/admin-password.txt", "utf8")).trim();
  const admin = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    baseURL: origin,
  });
  const adminPage = await admin.newPage();
  await adminPage.goto("/organisateur");
  await adminPage.getByLabel("Mot de passe organisateur").fill(password);
  await adminPage
    .getByRole("button", { name: "Se connecter", exact: true })
    .click();
  await expect(
    adminPage.getByRole("button", { name: "Déconnexion" }),
  ).toBeVisible();
  const fetchLink = async (id: string) =>
    (
      await (
        await admin.request.get("/api/admin/players/" + id + "/access-link")
      ).json()
    ).url;
  const linkA = await fetchLink("stephane-zone"),
    linkB = await fetchLink("junior-decock");
  const contextA = await browser.newContext({
      viewport: { width: 390, height: 844 },
      baseURL: origin,
    }),
    contextB = await browser.newContext({
      viewport: { width: 390, height: 844 },
      baseURL: origin,
    });
  const playerA = await contextA.newPage(),
    playerB = await contextB.newPage();
  const errors: string[] = [];
  playerA.on("pageerror", (e) => errors.push(e.message));
  await playerA.goto(linkA);
  await expect(
    playerA.getByRole("button", { name: "Encoder un score" }),
  ).toBeEnabled();
  await playerA.getByRole("button", { name: "Encoder un score" }).click();
  await playerA
    .getByLabel("Adversaires", { exact: true })
    .selectOption({ label: "Junior Decock / Fabrice Claes" });
  await playerA.getByLabel("Date et heure (Belgique)").fill("2026-10-12T12:00");
  await playerA
    .getByLabel("Jeux de Stephane Zone / Gauvain Callens")
    .fill("18");
  await playerA.getByLabel("Jeux de Junior Decock / Fabrice Claes").fill("9");
  await playerA.getByRole("button", { name: "Soumettre le résultat" }).click();
  await expect(playerA.getByRole("status")).toContainText("Résultat encodé");
  const list = await (
    await contextA.request.get("/api/boxes/2026-1-OPEN-1/matches")
  ).json();
  const m = list.matches.find(
    (m: any) => m.status === "pending" && m.games_a === 18 && m.games_b === 9,
  );
  expect(m).toBeTruthy();
  await playerB.goto(linkB);
  await expect(
    playerB.getByRole("button", { name: "Confirmer", exact: true }).first(),
  ).toBeVisible();
  await playerB
    .getByRole("button", { name: "Confirmer", exact: true })
    .first()
    .click();
  await expect(playerB.getByRole("status")).toContainText("Résultat confirmé");
  await playerA.reload();
  await playerA
    .getByRole("button", { name: "Classement", exact: true })
    .click();
  await expect(
    playerA
      .getByRole("row")
      .filter({ hasText: "Stephane Zone / Gauvain Callens" }),
  ).toContainText("4");
  expect(
    await playerA.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await playerA.screenshot({
    path: ".local/screenshots/mobile-ranking.png",
    fullPage: true,
  });
  await adminPage
    .getByRole("button", { name: "Organisation", exact: true })
    .click();
  await adminPage.getByLabel("Rechercher un joueur").fill("Stephane");
  await adminPage
    .getByRole("button", { name: "Voir le lien", exact: true })
    .click();
  await expect(
    adminPage.getByLabel("Lien personnel à transmettre"),
  ).toHaveValue(linkA);
  await adminPage.screenshot({
    path: ".local/screenshots/admin.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  const cancelled = await admin.request.post(
    "/api/admin/matches/" + m.id + "/cancel",
    {
      headers,
      data: { version: m.version + 1, reason: "Nettoyage du test navigateur" },
    },
  );
  expect(cancelled.ok()).toBe(true);
  await contextA.close();
  await contextB.close();
  await admin.close();
});
