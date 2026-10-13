import { Hono } from "hono";
import { reportError, errorResponse } from "./diagnostics";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z, ZodError } from "zod";
import type { Db } from "./db";
import { audit } from "./db";
import { decrypt, encrypt, hash, token, verifyPassword } from "./security";
import {
  matchSchema,
  submissionSchema,
  versionSchema,
  disputeSchema,
  resolutionSchema,
  type Match,
  type Entry,
  type Result,
} from "../shared/contracts";
import { standings } from "./standings";
import { parsePasswordHash, verifyCredential } from "../shared/password";
export type Config = {
  APP_ORIGIN: string;
  ADMIN_PASSWORD_HASH: string;
  LINK_ENCRYPTION_KEY: string;
  local?: boolean;
  now?: () => Date;
  scheduleDeadline?: (date: Date) => Promise<void>;
};
type Actor = { role: "player" | "admin"; player_id: string | null };
type Env = { Variables: { actor: Actor } };
const fail = (
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
  message: string,
): never => {
  throw new HTTPException(status, { message });
};
const entriesSql =
  "SELECT e.*,p.player1,p.player2,a.name AS name_a,b.name AS name_b FROM entries e JOIN pairs p ON p.id=e.pair_id JOIN players a ON a.id=p.player1 JOIN players b ON b.id=p.player2";
export async function runDue(db: Db, now = new Date()) {
  return db.transaction(async (tx) => {
    const rows = await tx.query<Match>(
      "UPDATE matches SET status='confirmed',confirmed_at=$1,version=version+1 WHERE id IN (SELECT id FROM matches WHERE status='pending' AND deadline <= $1 ORDER BY deadline LIMIT 100 FOR UPDATE SKIP LOCKED) AND status='pending' RETURNING *",
      [now],
    );
    for (const m of rows)
      await audit(tx, "system", "auto_confirm", m.id, { version: m.version });
    await tx.query(
      "INSERT INTO job_runs(id,last_success,confirmed_count) VALUES('confirmation',$1,$2) ON CONFLICT(id) DO UPDATE SET last_success=excluded.last_success,confirmed_count=excluded.confirmed_count",
      [now, rows.length],
    );
    await tx.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
    await tx.query("DELETE FROM login_attempts WHERE window_start < $1", [
      new Date(now.getTime() - 86400000),
    ]);
    return rows.length;
  });
}
export function makeApp(db: Db, config: Config) {
  const app = new Hono<Env>();
  const now = () => config.now?.() ?? new Date();
  const actorKey = (a: Actor) => (a.role === "admin" ? "admin" : a.player_id!);
  const isAdmin = (a: Actor) => {
    if (a.role !== "admin") fail(403, "Accès organisateur requis.");
  };
  const actor = (c: any): Actor => c.get("actor");
  const membership = (a: Actor, e: Entry) =>
    a.role === "player" &&
    (e.player1 === a.player_id || e.player2 === a.player_id);
  async function boxEntries(boxId: string) {
    return db.query<Entry>(entriesSql + " WHERE e.box_id=$1", [boxId]);
  }
  async function canRead(a: Actor, boxId: string) {
    const entries = await boxEntries(boxId);
    if (!entries.length) fail(404, "Box introuvable.");
    if (a.role !== "admin" && !entries.some((e) => membership(a, e)))
      fail(403, "Cette box ne fait pas partie de vos inscriptions.");
    return entries;
  }
  async function matchFor(
    tx: Db,
    id: string,
    a: Actor,
    version: number,
    mode: "participant" | "opponent" | "admin",
  ) {
    const [m] = await tx.query<Match>(
      "SELECT * FROM matches WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!m) fail(404, "Match introuvable.");
    if (mode === "admin") isAdmin(a);
    else {
      const es = await tx.query<Entry>(entriesSql + " WHERE e.id IN ($1,$2)", [
        m.entry_a,
        m.entry_b,
      ]);
      const own = es.find((e) => membership(a, e));
      if (!own) fail(403, "Vous ne participez pas à ce match.");
      if (mode === "opponent" && own!.id === m.submitted_entry)
        fail(403, "Seul un adversaire peut confirmer ou contester.");
    }
    if (m.version !== version)
      fail(409, "Ce match a changé. Actualisez avant de réessayer.");
    return m;
  }
  function checkResult(r: Result, m: Pick<Match, "entry_a" | "entry_b">) {
    if (
      r.kind === "forfeit" &&
      r.forfeiting_entry !== m.entry_a &&
      r.forfeiting_entry !== m.entry_b
    )
      fail(422, "Paire forfait invalide.");
  }
  async function cycleFor(tx: Db, boxId: string) {
    const [cycle] = await tx.query(
      "SELECT c.* FROM cycles c JOIN boxes b ON b.cycle_id=c.id WHERE b.id=$1",
      [boxId],
    );
    if (!cycle) fail(404, "Cycle introuvable.");
    return cycle;
  }
  async function checkSubmission(tx: Db, m: Match) {
    const cycle = await cycleFor(tx, m.box_id);
    if (cycle.closed) fail(422, "Ce cycle est clôturé.");
    if (
      cycle.submission_deadline &&
      now() > new Date(cycle.submission_deadline)
    )
      fail(422, "Le délai de saisie est terminé.");
    if (new Date(m.played_at) > now())
      fail(422, "Vous ne pouvez pas encoder le résultat d’un match futur.");
  }
  async function submit(tx: Db, m: Match, a: Actor, r: Result) {
    checkResult(r, m);
    await checkSubmission(tx, m);
    const es = await tx.query<Entry>(entriesSql + " WHERE e.id IN ($1,$2)", [
      m.entry_a,
      m.entry_b,
    ]);
    const own = es.find((e) => membership(a, e));
    if (!own) fail(403, "Vous ne participez pas à ce match.");
    const time = now(),
      deadline = new Date(time.getTime() + 48 * 3600000);
    // Register before commit: a failed registration rolls back the submission.
    // A stale marker after a rollback causes only a harmless extra check.
    await config.scheduleDeadline?.(deadline);
    const [updated] = await tx.query<Match>(
      "UPDATE matches SET status='pending',kind=$2,games_a=$3,games_b=$4,forfeiting_entry=$5,submitted_by=$6,submitted_entry=$7,submitted_at=$8,deadline=$9,version=version+1 WHERE id=$1 RETURNING *",
      [
        m.id,
        r.kind,
        r.kind === "played" ? r.games_a : null,
        r.kind === "played" ? r.games_b : null,
        r.kind === "forfeit" ? r.forfeiting_entry : null,
        a.player_id,
        own!.id,
        time,
        deadline,
      ],
    );
    await audit(tx, actorKey(a), "submit", m.id, { before: m, after: updated });
    return updated;
  }
  async function rateLimit(ip: string, endpoint: string) {
    const key = await hash(endpoint + "|" + ip);
    const count = await db.transaction(async (tx) => {
      const [row] = await tx.query(
        "INSERT INTO login_attempts(key,attempts,window_start) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start < $3 THEN 1 ELSE login_attempts.attempts+1 END,window_start=CASE WHEN login_attempts.window_start < $3 THEN $2 ELSE login_attempts.window_start END RETURNING attempts",
        [key, now(), new Date(now().getTime() - 15 * 60000)],
      );
      return row.attempts;
    });
    if (count > 10) fail(429, "Trop de tentatives. Réessayez dans 15 minutes.");
  }
  async function newSession(c: any, a: Actor) {
    const raw = token();
    await db.query(
      "INSERT INTO sessions(token_hash,role,player_id,expires_at,credential_version) VALUES($1,$2,$3,$4,$5)",
      [
        await hash(raw),
        a.role,
        a.player_id,
        new Date(
          now().getTime() + (a.role === "admin" ? 8 * 3600000 : 30 * 86400000),
        ),
        a.role === "admin" ? await hash(config.ADMIN_PASSWORD_HASH) : null,
      ],
    );
    setCookie(c, "padel_session", raw, {
      httpOnly: true,
      secure: !config.local,
      sameSite: "Lax",
      path: "/",
      maxAge: a.role === "admin" ? 8 * 3600 : 30 * 86400,
    });
  }
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 16000,
      onError: (c) => c.json({ error: "Requête trop volumineuse." }, 413),
    }),
  );
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (
        c.req.header("Origin") !== config.APP_ORIGIN ||
        c.req.header("X-Requested-With") !== "PadelLeague"
      )
        fail(403, "Origine de la requête non autorisée.");
      const length = Number(c.req.header("content-length") || 0);
      if (length > 16000) fail(422, "Requête trop volumineuse.");
      const raw = await c.req.text();
      if (raw.length > 16000) fail(422, "Requête trop volumineuse.");
    }
    if (
      c.req.path === "/api/health" ||
      c.req.path === "/api/auth/admin/parameters"
    )
      return next();
    if (["/api/auth/player", "/api/auth/admin"].includes(c.req.path)) {
      await rateLimit(
        config.local ? "local" : c.req.header("cf-connecting-ip") || "unknown",
        c.req.path,
      );
      return next();
    }
    const raw = getCookie(c, "padel_session");
    if (!raw) fail(401, "Ouvrez votre lien personnel pour vous connecter.");
    const [session] = await db.query<Actor & { credential_version: string }>(
      "SELECT role,player_id,credential_version FROM sessions WHERE token_hash=$1 AND expires_at>$2",
      [await hash(raw!), now()],
    );
    if (
      !session ||
      (session.role === "admin" &&
        session.credential_version !== (await hash(config.ADMIN_PASSWORD_HASH)))
    )
      fail(401, "Votre session a expiré. Ouvrez à nouveau votre lien.");
    c.set("actor", { role: session.role, player_id: session.player_id });
    await next();
  });
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.post("/api/auth/player", async (c) => {
    const { token: raw } = z
      .object({ token: z.string().min(30).max(100) })
      .parse(await c.req.json());
    const [link] = await db.query(
      "SELECT player_id FROM access_links WHERE token_hash=$1",
      [await hash(raw)],
    );
    if (!link)
      fail(401, "Lien invalide ou remplacé. Contactez l’organisateur.");
    await db.query("DELETE FROM login_attempts WHERE key=$1", [
      await hash(
        c.req.path +
          "|" +
          (config.local
            ? "local"
            : c.req.header("cf-connecting-ip") || "unknown"),
      ),
    ]);
    await newSession(c, { role: "player", player_id: link.player_id });
    return c.json({ ok: true });
  });
  app.get("/api/auth/admin/parameters", (c) => {
    const parsed = parsePasswordHash(config.ADMIN_PASSWORD_HASH);
    return c.json({
      salt: parsed.salt,
      iterations: parsed.iterations,
      upgradeRequired: parsed.format === "pbkdf2" && !config.local,
    });
  });
  app.post("/api/auth/admin", async (c) => {
    const input = z
      .object({
        proof: z.string().max(100).optional(),
        password: z.string().min(1).max(256).optional(),
      })
      .parse(await c.req.json());
    const parsed = parsePasswordHash(config.ADMIN_PASSWORD_HASH);
    if (parsed.format === "pbkdf2" && !config.local)
      throw new HTTPException(503, {
        message:
          "Le secret organisateur doit être mis à jour avec le nouvel outil de préparation.",
      });
    if (!config.local && input.password !== undefined)
      fail(422, "Actualisez la page avant de vous connecter.");
    let valid = false;
    if (input.proof)
      valid = await verifyCredential(
        input.proof,
        config.ADMIN_PASSWORD_HASH,
        !!config.local,
      );
    else if (config.local && input.password)
      valid = await verifyPassword(input.password, config.ADMIN_PASSWORD_HASH);
    else fail(422, "Actualisez la page avant de vous connecter.");
    if (!valid) fail(401, "Mot de passe incorrect.");
    await db.query("DELETE FROM login_attempts WHERE key=$1", [
      await hash(
        c.req.path +
          "|" +
          (config.local
            ? "local"
            : c.req.header("cf-connecting-ip") || "unknown"),
      ),
    ]);
    await newSession(c, { role: "admin", player_id: null });
    return c.json({ ok: true });
  });
  app.post("/api/auth/logout", async (c) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      await hash(getCookie(c, "padel_session")!),
    ]);
    deleteCookie(c, "padel_session", { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/me", async (c) => {
    const a = actor(c);
    const es = await db.query(
      entriesSql +
        " JOIN boxes x ON x.id=e.box_id JOIN cycles cy ON cy.id=x.cycle_id WHERE ($1::text IS NULL OR p.player1=$1 OR p.player2=$1) ORDER BY x.category,x.number",
      [a.role === "admin" ? null : a.player_id],
    );
    const boxes = await db.query(
      "SELECT DISTINCT b.*,cy.name AS cycle_name,cy.starts_at,cy.ends_at,cy.closed,cy.rules_confirmed FROM boxes b JOIN cycles cy ON cy.id=b.cycle_id JOIN entries e ON e.box_id=b.id JOIN pairs p ON p.id=e.pair_id WHERE ($1::text IS NULL OR p.player1=$1 OR p.player2=$1) ORDER BY b.category,b.number",
      [a.role === "admin" ? null : a.player_id],
    );
    const [player] = a.player_id
      ? await db.query("SELECT name FROM players WHERE id=$1", [a.player_id])
      : [];
    return c.json({
      ...a,
      name: player?.name ?? "Organisation",
      entries: es,
      boxes,
    });
  });
  app.get("/api/boxes/:id", async (c) =>
    c.json({ entries: await canRead(actor(c), c.req.param("id")) }),
  );
  app.get("/api/boxes/:id/matches", async (c) => {
    await canRead(actor(c), c.req.param("id"));
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query("page") || 1);
    const status = z
      .enum(["scheduled", "pending", "confirmed", "disputed", "cancelled"])
      .optional()
      .parse(c.req.query("status"));
    return c.json({
      matches: await db.query(
        "SELECT * FROM matches WHERE box_id=$1 AND ($3::text IS NULL OR status=$3) ORDER BY played_at DESC,id LIMIT 50 OFFSET $2",
        [c.req.param("id"), (page - 1) * 50, status ?? null],
      ),
      page,
    });
  });
  app.get("/api/boxes/:id/standings", async (c) => {
    const es = await canRead(actor(c), c.req.param("id"));
    const ms = await db.query<Match>(
      "SELECT * FROM matches WHERE box_id=$1 AND status='confirmed'",
      [c.req.param("id")],
    );
    const [cy] = await db.query(
      "SELECT c.rules_confirmed FROM cycles c JOIN boxes b ON b.cycle_id=c.id WHERE b.id=$1",
      [c.req.param("id")],
    );
    return c.json({
      standings: standings(es, ms),
      provisionalRules: !cy.rules_confirmed,
    });
  });
  app.post("/api/matches", async (c) => {
    const input = matchSchema.parse(await c.req.json()),
      a = actor(c),
      fingerprint = await hash(JSON.stringify(input));
    if (a.role !== "player")
      fail(403, "La création est réservée aux joueurs participants.");
    const out = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM players WHERE id=$1 FOR UPDATE", [
        a.player_id,
      ]);
      const [old] = await tx.query(
        "SELECT * FROM idempotency WHERE actor=$1 AND key=$2",
        [actorKey(a), input.key],
      );
      if (old) {
        if (old.fingerprint !== fingerprint)
          fail(409, "Cette clé a déjà été utilisée pour une autre saisie.");
        return (
          await tx.query<Match>("SELECT * FROM matches WHERE id=$1", [
            old.match_id,
          ])
        )[0];
      }
      const es = await tx.query<Entry>(entriesSql + " WHERE e.id IN ($1,$2)", [
        input.entry_a,
        input.entry_b,
      ]);
      if (es.length !== 2 || es[0].box_id !== es[1].box_id)
        fail(422, "Choisissez deux paires distinctes de la même box.");
      if (!es.some((e) => membership(a, e)))
        fail(403, "Vous devez participer au match.");
      if (
        [es[0].player1, es[0].player2].some(
          (p) => p === es[1].player1 || p === es[1].player2,
        )
      )
        fail(
          422,
          "Un joueur ne peut pas jouer dans les deux paires du même match.",
        );
      const boxId = es[0].box_id as string,
        cy = await cycleFor(tx, boxId),
        date = new Date(input.played_at);
      if (
        cy.closed ||
        date < new Date(cy.starts_at) ||
        date > new Date(cy.ends_at)
      )
        fail(422, "La date doit se situer dans le cycle ouvert.");
      const [created] = await tx.query<Match>(
        "INSERT INTO matches(id,box_id,entry_a,entry_b,played_at,status,author) VALUES($1,$2,$3,$4,$5,'scheduled',$6) RETURNING *",
        [
          crypto.randomUUID(),
          boxId,
          input.entry_a,
          input.entry_b,
          date,
          a.player_id,
        ],
      );
      await audit(tx, actorKey(a), "create", created.id, { after: created });
      const m = input.result
        ? await submit(tx, created, a, input.result)
        : created;
      await tx.query(
        "INSERT INTO idempotency(actor,key,fingerprint,match_id) VALUES($1,$2,$3,$4)",
        [actorKey(a), input.key, fingerprint, m.id],
      );
      return m;
    });
    return c.json(out, 201);
  });
  app.post("/api/matches/:id/result", async (c) => {
    const input = submissionSchema.parse(await c.req.json()),
      a = actor(c),
      fingerprint = await hash(JSON.stringify(input));
    const out = await db.transaction(async (tx) => {
      if (a.role !== "player") fail(403, "Action réservée aux joueurs.");
      await tx.query("SELECT id FROM players WHERE id=$1 FOR UPDATE", [
        a.player_id,
      ]);
      const [old] = await tx.query(
        "SELECT * FROM idempotency WHERE actor=$1 AND key=$2",
        [actorKey(a), input.key],
      );
      if (old) {
        if (
          old.fingerprint !== fingerprint ||
          old.match_id !== c.req.param("id")
        )
          fail(409, "Clé de saisie déjà utilisée.");
        return (
          await tx.query<Match>("SELECT * FROM matches WHERE id=$1", [
            old.match_id,
          ])
        )[0];
      }
      const m = await matchFor(
        tx,
        c.req.param("id"),
        a,
        input.version,
        "participant",
      );
      if (m.status !== "scheduled") fail(409, "Un résultat a déjà été encodé.");
      const updated = await submit(tx, m, a, input.result);
      await tx.query(
        "INSERT INTO idempotency(actor,key,fingerprint,match_id) VALUES($1,$2,$3,$4)",
        [actorKey(a), input.key, fingerprint, m.id],
      );
      return updated;
    });
    return c.json(out);
  });
  for (const action of ["confirm", "dispute"] as const)
    app.post(`/api/matches/:id/${action}`, async (c) => {
      const input = (
        action === "confirm" ? versionSchema : disputeSchema
      ).parse(await c.req.json());
      const out = await db.transaction(async (tx) => {
        const a = actor(c),
          m = await matchFor(
            tx,
            c.req.param("id"),
            a,
            input.version,
            "opponent",
          );
        if (m.status !== "pending")
          fail(409, "Ce résultat n’est plus en attente.");
        if (now() >= new Date(m.deadline!))
          fail(
            409,
            "Le délai de contestation est écoulé. Contactez l’organisateur pour une correction.",
          );
        if (action === "dispute")
          checkResult((input as z.infer<typeof disputeSchema>).result, m);
        const [updated] = await tx.query<Match>(
          "UPDATE matches SET status=$2,confirmed_at=$3,proposal=$4::jsonb,version=version+1 WHERE id=$1 RETURNING *",
          [
            m.id,
            action === "confirm" ? "confirmed" : "disputed",
            action === "confirm" ? now() : null,
            action === "dispute"
              ? JSON.stringify({ ...input, player: a.player_id })
              : null,
          ],
        );
        await audit(tx, actorKey(a), action, m.id, {
          before: m,
          after: updated,
        });
        return updated;
      });
      return c.json(out);
    });
  app.post("/api/admin/matches/:id/resolve", async (c) => {
    const input = resolutionSchema.parse(await c.req.json());
    const out = await db.transaction(async (tx) => {
      const a = actor(c),
        m = await matchFor(tx, c.req.param("id"), a, input.version, "admin");
      if (["cancelled", "scheduled"].includes(m.status))
        fail(409, "Ce match ne possède pas de résultat à corriger.");
      checkResult(input.result, m);
      const r = input.result;
      const [updated] = await tx.query<Match>(
        "UPDATE matches SET status='confirmed',kind=$2,games_a=$3,games_b=$4,forfeiting_entry=$5,confirmed_at=$6,proposal=NULL,version=version+1 WHERE id=$1 RETURNING *",
        [
          m.id,
          r.kind,
          r.kind === "played" ? r.games_a : null,
          r.kind === "played" ? r.games_b : null,
          r.kind === "forfeit" ? r.forfeiting_entry : null,
          now(),
        ],
      );
      await audit(tx, actorKey(a), "resolve", m.id, {
        reason: input.reason,
        before: m,
        after: updated,
      });
      return updated;
    });
    return c.json(out);
  });
  app.post("/api/admin/matches/:id/cancel", async (c) => {
    const input = versionSchema
      .extend({ reason: z.string().trim().min(1).max(1000) })
      .parse(await c.req.json());
    const out = await db.transaction(async (tx) => {
      const a = actor(c),
        m = await matchFor(tx, c.req.param("id"), a, input.version, "admin");
      if (m.status === "cancelled") fail(409, "Ce match est déjà annulé.");
      const [updated] = await tx.query<Match>(
        "UPDATE matches SET status='cancelled',proposal=NULL,version=version+1 WHERE id=$1 RETURNING *",
        [m.id],
      );
      await audit(tx, actorKey(a), "cancel", m.id, {
        reason: input.reason,
        before: m,
        after: updated,
      });
      return updated;
    });
    return c.json(out);
  });
  app.get("/api/admin/players", async (c) => {
    isAdmin(actor(c));
    return c.json({
      players: await db.query(
        "SELECT p.*,a.player_id IS NOT NULL AS has_link FROM players p LEFT JOIN access_links a ON a.player_id=p.id ORDER BY name",
      ),
    });
  });
  app.get("/api/admin/players/:id/access-link", async (c) => {
    isAdmin(actor(c));
    const [row] = await db.query(
      "SELECT ciphertext FROM access_links WHERE player_id=$1",
      [c.req.param("id")],
    );
    if (!row) fail(404, "Lien non généré.");
    return c.json({
      url:
        config.APP_ORIGIN +
        "/acces#jeton=" +
        (await decrypt(row.ciphertext, config.LINK_ENCRYPTION_KEY)),
    });
  });
  app.post("/api/admin/players/:id/access-link", async (c) => {
    isAdmin(actor(c));
    const raw = token(),
      id = c.req.param("id");
    await db.transaction(async (tx) => {
      if (
        !(await tx.query("SELECT id FROM players WHERE id=$1 FOR UPDATE", [id]))
          .length
      )
        fail(404, "Joueur introuvable.");
      await tx.query(
        "INSERT INTO access_links(player_id,token_hash,ciphertext) VALUES($1,$2,$3) ON CONFLICT(player_id) DO UPDATE SET token_hash=excluded.token_hash,ciphertext=excluded.ciphertext",
        [id, await hash(raw), await encrypt(raw, config.LINK_ENCRYPTION_KEY)],
      );
      await tx.query("DELETE FROM sessions WHERE player_id=$1", [id]);
      await audit(tx, "admin", "rotate_link", null, { player_id: id });
    });
    return c.json({ url: config.APP_ORIGIN + "/acces#jeton=" + raw });
  });
  app.get("/api/admin/matches/:id/audit", async (c) => {
    isAdmin(actor(c));
    return c.json({
      events: await db.query(
        "SELECT a.actor,a.action,a.details,a.created_at,p.name AS actor_name FROM audit a LEFT JOIN players p ON p.id=a.actor WHERE a.match_id=$1 ORDER BY a.created_at",
        [c.req.param("id")],
      ),
    });
  });
  app.get("/api/admin/jobs/status", async (c) => {
    isAdmin(actor(c));
    return c.json({
      job:
        (await db.query("SELECT * FROM job_runs WHERE id='confirmation'"))[0] ??
        null,
    });
  });
  app.post("/api/admin/jobs/run", async (c) => {
    isAdmin(actor(c));
    return c.json({ confirmed: await runDue(db, now()) });
  });
  app.onError((e, c) => {
    if (e instanceof HTTPException)
      return c.json({ error: e.message }, e.status);
    if (e instanceof ZodError || e instanceof SyntaxError)
      return c.json(
        { error: "Données invalides. Vérifiez les champs du formulaire." },
        422,
      );
    const errorId = reportError(e, c.req.path, c.req.method);
    return c.json(errorResponse(errorId), 500);
  });
  app.notFound((c) => c.json({ error: "Route introuvable." }, 404));
  return app;
}
