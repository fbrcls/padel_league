import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const origin = "http://localhost:5173",
  headers = { Origin: origin, "X-Requested-With": "PadelLeague" };
test("l’organisateur encode un match programmé et un résultat direct depuis le navigateur", async ({
  page,
  request,
}) => {
  const password = (await readFile(".local/admin-password.txt", "utf8")).trim();
  await page.goto("/organisateur");
  await page.getByLabel("Mot de passe organisateur").fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Encoder un score" }),
  ).toBeEnabled();
  const ids: string[] = [];
  try {
    await page
      .getByRole("button", { name: "+ Programmer", exact: true })
      .click();
    await page
      .getByLabel("Première paire", { exact: true })
      .selectOption({ label: "Stephane Zone / Gauvain Callens" });
    await page
      .getByLabel("Adversaires", { exact: true })
      .selectOption({ label: "Junior Decock / Fabrice Claes" });
    await page.getByLabel("Date et heure (Belgique)").fill("2026-10-12T14:00");
    await page.getByRole("button", { name: "Enregistrer la date" }).click();
    await expect(page.getByRole("status")).toContainText("Match programmé");
    const planned = (
      await (await page.request.get("/api/boxes/2026-1-OPEN-1/matches")).json()
    ).matches.find(
      (m: any) =>
        m.status === "scheduled" && m.played_at === "2026-10-12T12:00:00.000Z",
    );
    ids.push(planned.id);
    await page
      .getByRole("button", { name: "Encoder", exact: true })
      .first()
      .click();
    await page.getByLabel("Jeux de Stephane Zone / Gauvain Callens").fill("18");
    await page.getByLabel("Jeux de Junior Decock / Fabrice Claes").fill("9");
    await page.getByRole("button", { name: "Soumettre le résultat" }).click();
    await expect(page.getByRole("status")).toContainText(
      "validé par l’organisation",
    );
    let list = (
      await (await page.request.get("/api/boxes/2026-1-OPEN-1/matches")).json()
    ).matches;
    expect(list.find((m: any) => m.id === planned.id)).toMatchObject({
      status: "confirmed",
      submitted_role: "admin",
      games_a: 18,
      games_b: 9,
    });
    await page.getByRole("button", { name: "Encoder un score" }).click();
    await page
      .getByLabel("Première paire", { exact: true })
      .selectOption({ label: "Stephane Zone / Gauvain Callens" });
    await page
      .getByLabel("Adversaires", { exact: true })
      .selectOption({ label: "Junior Decock / Fabrice Claes" });
    await page.getByLabel("Date et heure (Belgique)").fill("2026-10-12T16:00");
    await page.getByLabel("Jeux de Stephane Zone / Gauvain Callens").fill("10");
    await page.getByLabel("Jeux de Junior Decock / Fabrice Claes").fill("10");
    await page.getByRole("button", { name: "Soumettre le résultat" }).click();
    await expect(page.getByRole("status")).toContainText(
      "validé par l’organisation",
    );
    list = (
      await (await page.request.get("/api/boxes/2026-1-OPEN-1/matches")).json()
    ).matches;
    const direct = list.find(
      (m: any) =>
        m.played_at === "2026-10-12T14:00:00.000Z" && m.status === "confirmed",
    );
    ids.push(direct.id);
    expect(direct).toMatchObject({
      submitted_role: "admin",
      games_a: 10,
      games_b: 10,
    });
  } finally {
    for (const id of ids) {
      const list = (
        await (
          await page.request.get("/api/boxes/2026-1-OPEN-1/matches")
        ).json()
      ).matches;
      const m = list.find((m: any) => m.id === id);
      if (m && m.status !== "cancelled")
        await page.request.post("/api/admin/matches/" + id + "/cancel", {
          headers,
          data: {
            version: m.version,
            reason: "Nettoyage du test organisateur",
          },
        });
    }
  }
});
