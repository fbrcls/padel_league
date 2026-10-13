import { deriveCredential, parsePasswordHash } from "../src/shared/password";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { wrapPglite } from "../scripts/local-db";
import { migrate, seed, createLinks } from "../scripts/setup";
import { makeApp, runDue } from "../src/server/app";
import { hash, passwordHash, decrypt } from "../src/server/security";
import { standings } from "../src/server/standings";
import { belgianInstant, localDateValue } from "../src/web/api";
import type { Entry, Match } from "../src/shared/contracts";
const pg = new PGlite(),
  db = wrapPglite(pg);
let clock = new Date("2026-10-12T18:00:00Z");
const config = {
  APP_ORIGIN: "http://localhost:5173",
  ADMIN_PASSWORD_HASH: "",
  LINK_ENCRYPTION_KEY: btoa("x".repeat(32)),
  local: true,
  now: () => clock,
};
let app: ReturnType<typeof makeApp>, a: Entry, b: Entry, outsider: Entry;
const author = "stephane-zone",
  opponent = "junior-decock";
async function session(player: string | null) {
  const raw = crypto.randomUUID();
  await db.query(
    "INSERT INTO sessions(token_hash,player_id,role,expires_at,credential_version) VALUES($1,$2,$3,$4,$5)",
    [
      await hash(raw),
      player,
      player ? "player" : "admin",
      new Date(clock.getTime() + 30 * 86400000),
      player ? null : await hash(config.ADMIN_PASSWORD_HASH),
    ],
  );
  return raw;
}
async function request(
  path: string,
  cookie: string | undefined,
  body?: any,
  origin = config.APP_ORIGIN,
) {
  const response = await app.request("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "X-Requested-With": "PadelLeague",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: "padel_session=" + cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie"),
  };
}
async function create(cookie: string, result?: any, key = crypto.randomUUID()) {
  return request("/matches", cookie, {
    entry_a: a.id,
    entry_b: b.id,
    played_at: "2026-10-12T12:00:00Z",
    key,
    ...(result ? { result } : {}),
  });
}
beforeAll(async () => {
  await pg.waitReady;
  await migrate(db);
  await seed(db);
  await createLinks(db, config.LINK_ENCRYPTION_KEY);
  config.ADMIN_PASSWORD_HASH = await passwordHash("test-password-very-long");
  app = makeApp(db, config);
  const es = await db.query<Entry>(
    "SELECT e.*,p.player1,p.player2,x.name AS name_a,y.name AS name_b FROM entries e JOIN pairs p ON e.pair_id=p.id JOIN players x ON x.id=p.player1 JOIN players y ON y.id=p.player2 ORDER BY e.id",
  );
  a = es.find((e) => e.player1 === author)!;
  b = es.find((e) => e.player1 === opponent && e.box_id === a.box_id)!;
  outsider = es.find((e) => e.box_id !== a.box_id)!;
}, 30000);
beforeEach(async () => {
  clock = new Date("2026-10-12T18:00:00Z");
  await db.query("DELETE FROM audit");
  await db.query("DELETE FROM idempotency");
  await db.query("DELETE FROM matches");
  await db.query("DELETE FROM sessions");
  await db.query("DELETE FROM login_attempts");
});
afterAll(async () => {
  await pg.close();
});
describe("Import et accès", () => {
  it("la connexion production vérifie la preuve sans PBKDF2 serveur ni exposition du vérificateur", async () => {
    const normal = app;
    const productionConfig = { ...config, local: false };
    app = makeApp(db, productionConfig);
    const parsed = parsePasswordHash(config.ADMIN_PASSWORD_HASH);
    const proof = await deriveCredential(
      "test-password-very-long",
      parsed.salt,
    );
    const spy = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockRejectedValue(
        new DOMException("Production PBKDF2 limit", "NotSupportedError"),
      );
    try {
      const parameters = await request("/auth/admin/parameters", undefined);
      expect(parameters.data).toEqual({
        salt: parsed.salt,
        iterations: 600000,
        upgradeRequired: false,
      });
      expect(JSON.stringify(parameters.data)).not.toContain(parsed.verifier);
      const login = await request("/auth/admin", undefined, { proof });
      expect(login.status).toBe(200);
      expect(login.cookie).toContain("Secure");
      expect(
        (await request("/auth/admin", undefined, { proof: parsed.verifier }))
          .status,
      ).toBe(401);
      expect(
        (
          await request("/auth/admin", undefined, {
            password: "test-password-very-long",
          })
        ).status,
      ).toBe(422);
      productionConfig.ADMIN_PASSWORD_HASH = `pbkdf2:600000:${parsed.salt}:${proof}`;
      expect(
        (await request("/auth/admin/parameters", undefined)).data
          .upgradeRequired,
      ).toBe(true);
      expect((await request("/auth/admin", undefined, { proof })).status).toBe(
        503,
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      app = normal;
    }
  });

  it("importe exactement 66 paires dans 11 box, sans doublons lors de la répétition", async () => {
    const before = await db.query("SELECT count(*)::int AS n FROM players");
    await seed(db);
    await migrate(db);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM entries"))[0].n,
    ).toBe(66);
    expect((await db.query("SELECT count(*)::int AS n FROM boxes"))[0].n).toBe(
      11,
    );
    expect(
      (await db.query("SELECT count(*)::int AS n FROM players"))[0].n,
    ).toBe(before[0].n);
  });
  it("connecte le lien personnel, partage un accès multipaire, bloque une box étrangère", async () => {
    const [link] = await db.query(
      "SELECT ciphertext FROM access_links WHERE player_id=$1",
      [opponent],
    );
    const raw = await decrypt(link.ciphertext, config.LINK_ENCRYPTION_KEY);
    const login = await request("/auth/player", undefined, { token: raw });
    expect(login.status).toBe(200);
    const cookie = login.cookie!.match(/padel_session=([^;]+)/)![1];
    const me = await request("/me", cookie);
    expect(me.data.entries).toHaveLength(2);
    expect((await request("/boxes/" + outsider.box_id, cookie)).status).toBe(
      403,
    );
  });
  it("protège l’organisateur, limite les tentatives et rejette une origine étrangère", async () => {
    expect(
      (
        await request("/auth/admin", undefined, {
          password: "test-password-very-long",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/auth/admin",
          undefined,
          { password: "wrong" },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    for (let i = 0; i < 10; i++)
      expect(
        (await request("/auth/player", undefined, { token: "z".repeat(43) }))
          .status,
      ).toBe(401);
    expect(
      (await request("/auth/player", undefined, { token: "z".repeat(43) }))
        .status,
    ).toBe(429);
  });
  it("fusionne les identités confirmées et invalide les sessions organisateur au changement de mot de passe", async () => {
    const fred = await session("frederic-romain"),
      kevin = await session("kevin-tulpinckx");
    expect((await request("/me", fred)).data.entries).toHaveLength(3);
    expect((await request("/me", kevin)).data.entries).toHaveLength(2);
    expect(
      await db.query(
        "SELECT id FROM players WHERE id IN ('fred-romain','kevin-tulpinck')",
      ),
    ).toHaveLength(0);
    const admin = await session(null),
      original = config.ADMIN_PASSWORD_HASH;
    config.ADMIN_PASSWORD_HASH = await passwordHash("another-long-password");
    expect((await request("/me", admin)).status).toBe(401);
    config.ADMIN_PASSWORD_HASH = original;
  });
  it("révoque l’ancien lien et toutes les sessions lors du remplacement", async () => {
    const admin = await session(null),
      player = await session(author);
    const old = (
      await request("/admin/players/" + author + "/access-link", admin)
    ).data.url.split("jeton=")[1];
    const rotated = await request(
      "/admin/players/" + author + "/access-link",
      admin,
      {},
    );
    expect(rotated.status).toBe(200);
    expect((await request("/me", player)).status).toBe(401);
    expect(
      (await request("/auth/player", undefined, { token: old })).status,
    ).toBe(401);
    expect(
      (
        await request("/auth/player", undefined, {
          token: rotated.data.url.split("jeton=")[1],
        })
      ).status,
    ).toBe(200);
  });
});
describe("Scores et intégrité", () => {
  it("18–9 ne compte qu’après confirmation adverse, le partenaire ne peut pas confirmer", async () => {
    const player = await session(author),
      other = await session(opponent),
      partner = await session(a.player2);
    const made = await create(player, {
      kind: "played",
      games_a: 18,
      games_b: 9,
    });
    expect(made.status).toBe(201);
    const m = made.data;
    expect(m.status).toBe("pending");
    let rank = (await request("/boxes/" + a.box_id + "/standings", player)).data
      .standings;
    expect(rank.find((r: any) => r.id === a.id).points).toBe(0);
    expect(
      (
        await request("/matches/" + m.id + "/confirm", partner, {
          version: m.version,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/matches/" + m.id + "/confirm", other, {
          version: m.version,
        })
      ).status,
    ).toBe(200);
    rank = (await request("/boxes/" + a.box_id + "/standings", player)).data
      .standings;
    expect(rank.find((r: any) => r.id === a.id)).toMatchObject({
      points: 4,
      gamesFor: 18,
      gamesAgainst: 9,
      wins: 1,
    });
    expect(rank.find((r: any) => r.id === b.id)).toMatchObject({
      points: 1,
      gamesFor: 9,
      gamesAgainst: 18,
      losses: 1,
    });
  });
  it("confirmation automatique après exactement 48h, répétable sans double validation", async () => {
    const player = await session(author);
    const m = (
      await create(player, { kind: "played", games_a: 12, games_b: 12 })
    ).data;
    expect(await runDue(db, new Date(clock.getTime() + 48 * 3600000 - 1))).toBe(
      0,
    );
    expect(await runDue(db, new Date(clock.getTime() + 48 * 3600000))).toBe(1);
    expect(await runDue(db, new Date(clock.getTime() + 49 * 3600000))).toBe(0);
    const rank = (await request("/boxes/" + a.box_id + "/standings", player))
      .data.standings;
    expect(rank.find((r: any) => r.id === a.id).points).toBe(2);
    expect(
      await db.query(
        "SELECT * FROM audit WHERE action='auto_confirm' AND match_id=$1",
        [m.id],
      ),
    ).toHaveLength(1);
  });
  it("la contestation suspend le délai, l’organisateur corrige puis annule avec historique", async () => {
    const player = await session(author),
      other = await session(opponent),
      admin = await session(null);
    const m = (
      await create(player, { kind: "played", games_a: 18, games_b: 9 })
    ).data;
    const disputed = await request("/matches/" + m.id + "/dispute", other, {
      version: m.version,
      result: { kind: "played", games_a: 9, games_b: 18 },
      reason: "Les scores sont inversés.",
    });
    expect(disputed.status).toBe(200);
    expect(await runDue(db, new Date(clock.getTime() + 49 * 3600000))).toBe(0);
    const fixed = await request("/admin/matches/" + m.id + "/resolve", admin, {
      version: disputed.data.version,
      result: { kind: "played", games_a: 9, games_b: 18 },
      reason: "Accord des équipes.",
    });
    expect(fixed.status).toBe(200);
    let rank = (await request("/boxes/" + a.box_id + "/standings", admin)).data
      .standings;
    expect(rank.find((r: any) => r.id === b.id).points).toBe(4);
    expect(
      (
        await request("/admin/matches/" + m.id + "/cancel", admin, {
          version: fixed.data.version,
          reason: "Doublon.",
        })
      ).status,
    ).toBe(200);
    rank = (await request("/boxes/" + a.box_id + "/standings", admin)).data
      .standings;
    expect(rank.every((r: any) => r.points === 0)).toBe(true);
    expect(
      (await request("/admin/matches/" + m.id + "/audit", admin)).data.events,
    ).toHaveLength(5);
  });
  it("autorise les matchs répétés mais déduplique une soumission réseau", async () => {
    const player = await session(author),
      key = crypto.randomUUID();
    const one = await create(player, undefined, key),
      retry = await create(player, undefined, key);
    expect(retry.data.id).toBe(one.data.id);
    expect((await create(player)).data.id).not.toBe(one.data.id);
    expect(await db.query("SELECT * FROM matches")).toHaveLength(2);
    expect(
      (await create(player, { kind: "played", games_a: 1, games_b: 2 }, key))
        .status,
    ).toBe(409);
  });
  it("rejette les conflits de version, scores invalides, dates hors cycle et actions étrangères", async () => {
    const player = await session(author),
      foreign = await session(outsider.player1);
    const m = (await create(player)).data;
    expect(
      (
        await request("/matches/" + m.id + "/result", foreign, {
          version: m.version,
          key: crypto.randomUUID(),
          result: { kind: "played", games_a: 1, games_b: 2 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/matches/" + m.id + "/result", player, {
          version: 99,
          key: crypto.randomUUID(),
          result: { kind: "played", games_a: 1, games_b: 2 },
        })
      ).status,
    ).toBe(409);
    expect(
      (await create(player, { kind: "played", games_a: -1, games_b: 2 }))
        .status,
    ).toBe(422);
    expect(
      (
        await request("/matches", player, {
          entry_a: a.id,
          entry_b: b.id,
          played_at: "2026-12-01T12:00:00Z",
          key: crypto.randomUUID(),
        })
      ).status,
    ).toBe(422);
    expect(
      (await create(player, { kind: "forfeit", forfeiting_entry: outsider.id }))
        .status,
    ).toBe(422);
  });
  it("accepte la saisie jusqu’au 1er décembre belge et la refuse ensuite sans interrompre les confirmations", async () => {
    clock = new Date("2026-12-01T22:59:59Z");
    const player = await session(author);
    const made = await create(player, {
      kind: "played",
      games_a: 18,
      games_b: 9,
    });
    expect(made.status).toBe(201);
    clock = new Date("2026-12-01T23:00:00Z");
    expect(
      (await create(player, { kind: "played", games_a: 18, games_b: 9 }))
        .status,
    ).toBe(422);
    expect(await runDue(db, new Date("2026-12-03T22:59:59Z"))).toBe(1);
  });
  it("un forfait attribue 0 et 3 sans jeux fictifs", async () => {
    const player = await session(author),
      other = await session(opponent);
    const m = (
      await create(player, { kind: "forfeit", forfeiting_entry: a.id })
    ).data;
    expect(m.games_a).toBeNull();
    await request("/matches/" + m.id + "/confirm", other, {
      version: m.version,
    });
    const rank = (await request("/boxes/" + a.box_id + "/standings", player))
      .data.standings;
    expect(rank.find((r: any) => r.id === a.id)).toMatchObject({
      points: 0,
      gamesFor: 0,
      played: 0,
      forfeits: 1,
    });
    expect(rank.find((r: any) => r.id === b.id)).toMatchObject({
      points: 3,
      gamesFor: 0,
    });
  });
  it("une course contestation / confirmation automatique ne produit pas deux états", async () => {
    const player = await session(author),
      other = await session(opponent);
    const m = (
      await create(player, { kind: "played", games_a: 18, games_b: 9 })
    ).data;
    const [response] = await Promise.all([
      request("/matches/" + m.id + "/dispute", other, {
        version: m.version,
        result: { kind: "played", games_a: 9, games_b: 18 },
        reason: "Correction",
      }),
      runDue(db, new Date(clock.getTime() + 48 * 3600000)),
    ]);
    const [final] = await db.query<Match>("SELECT * FROM matches WHERE id=$1", [
      m.id,
    ]);
    expect(["disputed", "confirmed"]).toContain(final.status);
    if (final.status === "confirmed") expect(final.proposal).toBeNull();
    else expect(response.status).toBe(200);
  });
});
describe("Classement et dates", () => {
  it("départage par confrontations directes avant les victoires et jeux gagnés, préserve les ex æquo", () => {
    const es = ["a", "b", "c", "d"].map((id) => ({
      id,
      name_a: id,
      name_b: id,
      player1: id,
      player2: id + "2",
      box_id: "x",
      pair_id: id,
    }));
    const match = (a: string, b: string, x: number, y: number) =>
      ({
        entry_a: a,
        entry_b: b,
        status: "confirmed",
        kind: "played",
        games_a: x,
        games_b: y,
      }) as Match;
    const rank = standings(es, [
      match("a", "b", 10, 2),
      match("b", "c", 20, 1),
      match("c", "a", 12, 1),
    ]);
    expect(rank[0].id).toBe("b");
    expect(rank[0].points).toBe(5);
    const equal = standings(es, []);
    expect(equal.map((e) => e.rank)).toEqual([1, 1, 1, 1]);
  });
  it("convertit les heures belges en respectant le changement d’heure", () => {
    expect(belgianInstant("2026-10-12T14:00")).toBe("2026-10-12T12:00:00.000Z");
    expect(belgianInstant("2026-11-01T14:00")).toBe("2026-11-01T13:00:00.000Z");
    expect(localDateValue(new Date("2026-11-29T22:59:00Z"))).toBe(
      "2026-11-29T23:59",
    );
    expect(() => belgianInstant("2026-03-29T02:30")).toThrow();
  });
});
