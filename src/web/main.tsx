import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, names, formatDate, localDateValue, belgianInstant } from "./api";
import type { Entry, Match, Result } from "../shared/contracts";
import "./style.css";
import { deriveCredential, PASSWORD_ITERATIONS } from "../shared/password";
type Me = {
  role: "player" | "admin";
  player_id: string | null;
  name: string;
  entries: Entry[];
  boxes: any[];
};
const labels: Record<string, string> = {
  scheduled: "Programmé",
  pending: "À confirmer",
  confirmed: "Confirmé",
  disputed: "Contesté",
  cancelled: "Annulé",
};
const auditLabels: Record<string, string> = {
  create: "Match enregistré",
  submit: "Résultat encodé",
  confirm: "Confirmation adverse",
  dispute: "Résultat contesté",
  resolve: "Correction organisateur",
  cancel: "Match annulé",
  auto_confirm: "Confirmation automatique",
};
const category = (value: string) =>
  value === "OPEN" ? "Open / Messieurs" : "Dames / Mixtes";
function ResultFields({
  entries,
  onChange,
  value,
}: {
  entries: Entry[];
  onChange: (value: Result) => void;
  value: Result;
}) {
  return (
    <>
      <label>
        Type de résultat
        <select
          value={value.kind}
          onChange={(e) =>
            onChange(
              e.target.value === "played"
                ? { kind: "played", games_a: NaN, games_b: NaN }
                : { kind: "forfeit", forfeiting_entry: entries[0].id },
            )
          }
        >
          <option value="played">Match joué</option>
          <option value="forfeit">Forfait</option>
        </select>
      </label>
      {value.kind === "played" ? (
        <div className="score-fields">
          {entries.map((entry, i) => (
            <label key={entry.id}>
              {names(entry)}
              <input
                aria-label={"Jeux de " + names(entry)}
                type="number"
                inputMode="numeric"
                min="0"
                max="999"
                required
                value={
                  Number.isNaN(i === 0 ? value.games_a : value.games_b)
                    ? ""
                    : i === 0
                      ? value.games_a
                      : value.games_b
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    [i === 0 ? "games_a" : "games_b"]:
                      e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
      ) : (
        <label>
          Paire déclarée forfait
          <select
            value={value.forfeiting_entry}
            onChange={(e) =>
              onChange({ ...value, forfeiting_entry: e.target.value })
            }
          >
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {names(e)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [boxId, setBoxId] = useState(""),
    [entries, setEntries] = useState<Entry[]>([]),
    [matches, setMatches] = useState<Match[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [rulesPending, setRulesPending] = useState(false);
  const [tab, setTab] = useState("matches"),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [boxLoading, setBoxLoading] = useState(false);
  const [form, setForm] = useState<"schedule" | "result" | null>(null),
    [selected, setSelected] = useState<Match | null>(null),
    [action, setAction] = useState<"submit" | "dispute" | "resolve" | null>(
      null,
    );
  const [aId, setAId] = useState(""),
    [bId, setBId] = useState(""),
    [date, setDate] = useState(localDateValue()),
    [result, setResult] = useState<Result>({
      kind: "played",
      games_a: NaN,
      games_b: NaN,
    }),
    [reason, setReason] = useState(""),
    [key, setKey] = useState(crypto.randomUUID());
  const [password, setPassword] = useState(""),
    [loginAdmin, setLoginAdmin] = useState(
      location.pathname === "/organisateur",
    );
  const [players, setPlayers] = useState<any[]>([]),
    [search, setSearch] = useState(""),
    [link, setLink] = useState<{ name: string; url: string } | null>(null),
    [job, setJob] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]);
  async function identity() {
    const data = await api<Me>("/me");
    setMe(data);
    setBoxId((old) => old || data.boxes[0]?.id || "");
    return data;
  }
  useEffect(() => {
    (async () => {
      try {
        const raw = new URLSearchParams(location.hash.slice(1)).get("jeton");
        if (raw) {
          history.replaceState(null, "", "/");
          await api("/auth/player", { token: raw });
        }
        await identity();
      } catch (e: any) {
        if (location.hash || !e.message.includes("Ouvrez votre lien"))
          setError(e.message);
      } finally {
        setBoot(false);
      }
    })();
  }, []);
  async function loadBox(id = boxId, currentPage = page) {
    if (!id) return;
    const [box, list, ranking] = await Promise.all([
      api("/boxes/" + id),
      api(
        "/boxes/" +
          id +
          "/matches?page=" +
          currentPage +
          (filter === "all" ? "" : "&status=" + filter),
      ),
      api("/boxes/" + id + "/standings"),
    ]);
    setEntries(box.entries);
    setMatches(list.matches);
    setRows(ranking.standings);
    setRulesPending(ranking.provisionalRules);
  }
  useEffect(() => {
    if (!me || !boxId) return;
    let cancelled = false;
    setBoxLoading(true);
    setEntries([]);
    setMatches([]);
    setRows([]);
    setForm(null);
    setSelected(null);
    setAction(null);
    (async () => {
      try {
        const [box, list, ranking] = await Promise.all([
          api("/boxes/" + boxId),
          api(
            "/boxes/" +
              boxId +
              "/matches?page=" +
              page +
              (filter === "all" ? "" : "&status=" + filter),
          ),
          api("/boxes/" + boxId + "/standings"),
        ]);
        if (!cancelled) {
          setEntries(box.entries);
          setMatches(list.matches);
          setRows(ranking.standings);
          setRulesPending(ranking.provisionalRules);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setBoxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boxId, page, filter, me?.player_id, me?.role]);
  useEffect(() => {
    if (me?.role !== "admin") return;
    Promise.all([api("/admin/players"), api("/admin/jobs/status")])
      .then(([p, j]) => {
        setPlayers(p.players);
        setJob(j.job);
      })
      .catch((e) => setError(e.message));
  }, [me?.role]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const owns = (e: Entry) =>
    e.player1 === me?.player_id || e.player2 === me?.player_id;
  const ownEntries = entries.filter(owns);
  const selectableEntries = me?.role === "admin" ? entries : ownEntries;
  const entry = (id: string) => entries.find((e) => e.id === id)!;
  const title = (id: string) => {
    const e = entry(id);
    return e ? names(e) : "Paire";
  };
  const canPlay = (m: Match) =>
    ownEntries.some((e) => e.id === m.entry_a || e.id === m.entry_b);
  const canRespond = (m: Match) =>
    canPlay(m) &&
    !ownEntries.some((e) => e.id === m.submitted_entry) &&
    m.status === "pending" &&
    Date.now() < new Date(m.deadline!).getTime();
  function openCreate(mode: "schedule" | "result") {
    setForm(mode);
    setSelected(null);
    setAction(null);
    setKey(crypto.randomUUID());
    const own = selectableEntries[0];
    setAId(own?.id ?? "");
    setBId(entries.find((e) => e.id !== own?.id && !owns(e))?.id ?? "");
    setDate(localDateValue());
    setResult({ kind: "played", games_a: NaN, games_b: NaN });
  }
  function openAction(m: Match, kind: "submit" | "dispute" | "resolve") {
    setSelected(m);
    setAction(kind);
    setForm(null);
    setKey(crypto.randomUUID());
    setReason("");
    setEvents([]);
    setResult(
      m.proposal?.result ??
        (m.kind === "forfeit"
          ? { kind: "forfeit", forfeiting_entry: m.forfeiting_entry! }
          : {
              kind: "played",
              games_a: m.games_a ?? 0,
              games_b: m.games_b ?? 0,
            }),
    );
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    await perform(async () => {
      await api("/matches", {
        entry_a: aId,
        entry_b: bId,
        played_at: belgianInstant(date),
        key,
        ...(form === "result" ? { result } : {}),
      });
      setForm(null);
      setNotice(
        form === "result"
          ? me?.role === "admin"
            ? "Résultat encodé et validé par l’organisation."
            : "Résultat encodé. Vos adversaires peuvent le confirmer."
          : "Match programmé. Pensez à réserver sur SportFinder.",
      );
      setPage(1);
      await loadBox(boxId, 1);
    });
  }
  async function saveAction(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !action) return;
    await perform(async () => {
      const path =
        action === "resolve"
          ? "/admin/matches/" + selected.id + "/resolve"
          : "/matches/" +
            selected.id +
            "/" +
            (action === "submit" ? "result" : "dispute");
      await api(path, {
        version: selected.version,
        result,
        key,
        ...(action === "submit" ? {} : { reason }),
      });
      setSelected(null);
      setAction(null);
      setNotice(
        me?.role === "admin" && action === "submit"
          ? "Résultat encodé et validé par l’organisation."
          : "Résultat enregistré.",
      );
      await loadBox();
    });
  }
  if (boot) return <div className="splash">Chargement de la League…</div>;
  return (
    <>
      <header>
        <a className="brand" href="/">
          LA CURE<span>PADEL LEAGUE</span>
        </a>
        <div className="header-right">
          {me ? (
            <>
              <span>{me.name}</span>
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    await api("/auth/logout", {});
                    setMe(null);
                    setLoginAdmin(false);
                    setLink(null);
                    setPlayers([]);
                    setMatches([]);
                    setEntries([]);
                    setRows([]);
                  })
                }
              >
                Déconnexion
              </button>
            </>
          ) : (
            <button
              className="ghost"
              onClick={() => setLoginAdmin(!loginAdmin)}
            >
              Organisation
            </button>
          )}
        </div>
      </header>
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">COMPÉTITION AMICALE · CYCLE 1</p>
            <h1>
              Jouez.
              <br />
              <span>Marquez des points.</span>
            </h1>
            <p>
              Du 12 octobre au 29 novembre 2026
              <br />
              Votre box, vos matchs, votre progression.
            </p>
          </div>
          <div className="hero-ball" aria-hidden="true">
            <span>
              LA
              <br />
              CURE
            </span>
          </div>
        </section>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button aria-label="Fermer l’erreur" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}
        {!me ? (
          <section className="panel access">
            <p className="eyebrow">BIENVENUE À LA LEAGUE</p>
            <h2>
              {loginAdmin
                ? "Accès organisateur"
                : "Votre terrain de jeu commence ici"}
            </h2>
            {loginAdmin ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  perform(async () => {
                    const parameters = await api("/auth/admin/parameters");
                    if (parameters.upgradeRequired)
                      throw new Error(
                        "Mettez à jour ADMIN_PASSWORD_HASH avec le nouvel outil de préparation, en conservant votre mot de passe et la clé des liens.",
                      );
                    if (parameters.iterations !== PASSWORD_ITERATIONS)
                      throw new Error("Paramètres de connexion invalides.");
                    const proof = await deriveCredential(
                      password,
                      parameters.salt,
                    );
                    await api("/auth/admin", { proof });
                    setPassword("");
                    await identity();
                  });
                }}
              >
                <label>
                  Mot de passe organisateur
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button disabled={busy}>
                  {busy ? "Connexion…" : "Se connecter"}
                </button>
              </form>
            ) : (
              <>
                <p>
                  Ouvrez le lien personnel transmis par l’organisation pour
                  retrouver vos paires et encoder vos résultats.
                </p>
                <p className="muted">
                  Vous avez perdu votre lien ? Contactez l’organisateur.
                </p>
              </>
            )}
          </section>
        ) : (
          <>
            <div className="toolbar">
              <label className="box-picker">
                Votre box
                <select
                  aria-label="Choisir une box"
                  value={boxId}
                  onChange={(e) => {
                    setBoxId(e.target.value);
                    setPage(1);
                  }}
                >
                  {me.boxes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {category(b.category)} · Box {b.number}
                    </option>
                  ))}
                </select>
              </label>
              {(me.role === "player" || me.role === "admin") && (
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={boxLoading || busy || !selectableEntries.length}
                    onClick={() => openCreate("schedule")}
                  >
                    + Programmer
                  </button>
                  <button
                    disabled={boxLoading || busy || !selectableEntries.length}
                    onClick={() => openCreate("result")}
                  >
                    Encoder un score
                  </button>
                </div>
              )}
            </div>
            <nav className="tabs" aria-label="Vues de la compétition">
              <button
                className={tab === "matches" ? "active" : ""}
                onClick={() => setTab("matches")}
              >
                Les matchs
              </button>
              <button
                className={tab === "ranking" ? "active" : ""}
                onClick={() => setTab("ranking")}
              >
                Classement
              </button>
              {me.role === "admin" && (
                <button
                  className={tab === "admin" ? "active" : ""}
                  onClick={() => setTab("admin")}
                >
                  Organisation
                </button>
              )}
            </nav>
            {form && (
              <section className="panel">
                <div className="section-head">
                  <h2>
                    {form === "schedule"
                      ? "Programmer un match"
                      : "Encoder un résultat"}
                  </h2>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setForm(null)}
                  >
                    Fermer
                  </button>
                </div>
                <form onSubmit={create}>
                  <div className="form-grid">
                    <label>
                      {me.role === "admin" ? "Première paire" : "Votre paire"}
                      <select
                        aria-label={
                          me.role === "admin" ? "Première paire" : "Votre paire"
                        }
                        required
                        value={aId}
                        onChange={(e) => {
                          setAId(e.target.value);
                          if (bId === e.target.value) setBId("");
                        }}
                      >
                        {selectableEntries.map((e) => (
                          <option key={e.id} value={e.id}>
                            {names(e)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Adversaires
                      <select
                        aria-label="Adversaires"
                        required
                        value={bId}
                        onChange={(e) => setBId(e.target.value)}
                      >
                        <option value="">Choisir une paire</option>
                        {entries
                          .filter((e) => e.id !== aId)
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {names(e)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Date et heure (Belgique)
                      <input
                        required
                        type="datetime-local"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                  </div>
                  {form === "result" && aId && bId && (
                    <ResultFields
                      entries={[entry(aId), entry(bId)]}
                      value={result}
                      onChange={setResult}
                    />
                  )}
                  <p className="muted">
                    {form === "schedule"
                      ? "La réservation se fait séparément sur SportFinder."
                      : me.role === "admin"
                        ? "Le résultat sera validé immédiatement et comptera au classement."
                        : "Jeux cumulés après 1 h 30. Vérifiez les paires et le score avant envoi. Confirmation adverse ou automatique après 48 h."}
                  </p>
                  <button disabled={busy || !bId}>
                    {busy
                      ? "Enregistrement…"
                      : form === "schedule"
                        ? "Enregistrer la date"
                        : "Soumettre le résultat"}
                  </button>
                </form>
              </section>
            )}
            {selected && action && (
              <section className="panel">
                <div className="section-head">
                  <h2>
                    {action === "submit"
                      ? "Encoder le score"
                      : action === "dispute"
                        ? "Contester le résultat"
                        : "Résoudre ou corriger"}
                  </h2>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setAction(null);
                      setSelected(null);
                    }}
                  >
                    Fermer
                  </button>
                </div>
                <p>{formatDate(selected.played_at)}</p>
                {selected.proposal && (
                  <div className="alert">
                    Contestation : {selected.proposal.reason}
                  </div>
                )}
                <form onSubmit={saveAction}>
                  <ResultFields
                    entries={[entry(selected.entry_a), entry(selected.entry_b)]}
                    value={result}
                    onChange={setResult}
                  />
                  {action === "submit" && me.role === "admin" && (
                    <p className="muted">
                      Le résultat sera validé immédiatement et comptera au
                      classement.
                    </p>
                  )}
                  {action !== "submit" && (
                    <label>
                      {action === "dispute"
                        ? "Motif de contestation"
                        : "Motif de la correction"}
                      <textarea
                        required
                        maxLength={1000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                  )}
                  <button disabled={busy}>
                    {busy
                      ? "Enregistrement…"
                      : action === "dispute"
                        ? "Envoyer la contestation"
                        : action === "resolve"
                          ? "Valider ce résultat"
                          : "Soumettre le résultat"}
                  </button>
                </form>
                {me.role === "admin" && (
                  <>
                    <button
                      className="text-button"
                      onClick={() =>
                        perform(async () => {
                          setEvents(
                            (
                              await api(
                                "/admin/matches/" + selected.id + "/audit",
                              )
                            ).events,
                          );
                        })
                      }
                    >
                      Voir l’historique
                    </button>
                    {events.map((e, i) => (
                      <div className="audit" key={i}>
                        <strong>
                          {auditLabels[e.action] ?? "Mise à jour"}
                        </strong>{" "}
                        ·{" "}
                        {e.actor === "admin"
                          ? "Organisation"
                          : e.actor === "system"
                            ? "Automatique"
                            : (e.actor_name ?? "Participant")}{" "}
                        · {formatDate(e.created_at)}
                        {e.details.reason && <p>{e.details.reason}</p>}
                      </div>
                    ))}
                  </>
                )}
              </section>
            )}
            {tab === "matches" && (
              <section>
                <div className="section-head">
                  <div>
                    <p className="eyebrow">SUR LE TERRAIN</p>
                    <h2>Les rencontres de votre box</h2>
                  </div>
                  <button
                    className="text-button"
                    disabled={busy || boxLoading}
                    onClick={() => perform(() => loadBox())}
                  >
                    Actualiser
                  </button>
                </div>
                <div className="filters">
                  {[
                    ["all", "Tous"],
                    ["scheduled", "À jouer"],
                    ["pending", "À confirmer"],
                    ["confirmed", "Joués"],
                    ["disputed", "Contestés"],
                  ].map(([value, label]) => (
                    <button
                      className={filter === value ? "selected" : ""}
                      key={value}
                      onClick={() => {
                        setFilter(value);
                        setPage(1);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {boxLoading ? (
                  <p>Chargement des matchs…</p>
                ) : matches.filter(
                    (m) => filter === "all" || m.status === filter,
                  ).length === 0 ? (
                  <div className="empty">
                    <span aria-hidden="true">◉</span>
                    <h3>Aucun match ici pour le moment</h3>
                    <p>
                      Programmez une rencontre ou encodez votre premier score.
                    </p>
                  </div>
                ) : (
                  <div className="match-grid">
                    {matches
                      .filter((m) => filter === "all" || m.status === filter)
                      .map((m) => (
                        <article className="match-card" key={m.id}>
                          <div className="match-meta">
                            <span>{formatDate(m.played_at)}</span>
                            <span className={"badge " + m.status}>
                              {labels[m.status]}
                            </span>
                          </div>
                          <div className="pair-line">
                            <strong>{title(m.entry_a)}</strong>
                            <span className="score">
                              {m.kind === "played"
                                ? m.games_a
                                : m.kind === "forfeit"
                                  ? m.forfeiting_entry === m.entry_a
                                    ? "F"
                                    : "V"
                                  : "—"}
                            </span>
                          </div>
                          <div className="pair-line">
                            <strong>{title(m.entry_b)}</strong>
                            <span className="score">
                              {m.kind === "played"
                                ? m.games_b
                                : m.kind === "forfeit"
                                  ? m.forfeiting_entry === m.entry_b
                                    ? "F"
                                    : "V"
                                  : "—"}
                            </span>
                          </div>
                          {m.status === "pending" && (
                            <p className="muted small">
                              Confirmation automatique à partir du{" "}
                              {formatDate(m.deadline!)}.
                            </p>
                          )}
                          {m.status === "disputed" && (
                            <p className="small">
                              En attente de résolution par l’organisation.
                            </p>
                          )}
                          {m.submitted_role === "admin" && (
                            <p className="muted small">
                              Encodé et validé par l’organisation.
                            </p>
                          )}
                          <div className="card-actions">
                            {m.status === "scheduled" &&
                              (me.role === "admin" || canPlay(m)) && (
                                <button
                                  disabled={busy}
                                  onClick={() => openAction(m, "submit")}
                                >
                                  Encoder
                                </button>
                              )}
                            {canRespond(m) && (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    perform(async () => {
                                      await api(
                                        "/matches/" + m.id + "/confirm",
                                        { version: m.version },
                                      );
                                      setNotice("Résultat confirmé.");
                                      await loadBox();
                                    })
                                  }
                                >
                                  Confirmer
                                </button>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => openAction(m, "dispute")}
                                >
                                  Contester
                                </button>
                              </>
                            )}
                            {me.role === "admin" &&
                              m.status !== "cancelled" && (
                                <>
                                  {m.status !== "scheduled" && (
                                    <button
                                      disabled={busy}
                                      onClick={() => openAction(m, "resolve")}
                                    >
                                      {m.status === "disputed"
                                        ? "Résoudre"
                                        : "Corriger"}
                                    </button>
                                  )}
                                  <button
                                    className="text-button danger"
                                    disabled={busy}
                                    onClick={() => {
                                      const reason = prompt(
                                        "Motif de l’annulation (le résultat sera retiré du classement)",
                                      );
                                      if (reason?.trim())
                                        perform(async () => {
                                          await api(
                                            "/admin/matches/" +
                                              m.id +
                                              "/cancel",
                                            { version: m.version, reason },
                                          );
                                          await loadBox();
                                          setNotice("Match annulé.");
                                        });
                                    }}
                                  >
                                    Annuler
                                  </button>
                                </>
                              )}
                          </div>
                        </article>
                      ))}
                  </div>
                )}
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={page === 1 || boxLoading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Précédent
                  </button>
                  <span>Page {page} · 50 matchs maximum</span>
                  <button
                    className="secondary"
                    disabled={matches.length < 50 || boxLoading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Suivant
                  </button>
                </div>
              </section>
            )}
            {tab === "ranking" && (
              <section className="panel">
                <p className="eyebrow">ACCUMULEZ LES POINTS</p>
                <div className="section-head">
                  <h2>Classement de la box</h2>
                  <button
                    className="text-button"
                    disabled={busy || boxLoading}
                    onClick={() => perform(() => loadBox())}
                  >
                    Actualiser
                  </button>
                </div>
                {rulesPending && (
                  <p className="alert">
                    Départage provisoire : les égalités multiples et les
                    victoires par forfait restent à confirmer par
                    l’organisation.
                  </p>
                )}
                <p className="table-hint">
                  Faites défiler le tableau horizontalement pour voir toutes les
                  statistiques.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Rang</th>
                        <th>Paire</th>
                        <th>Points</th>
                        <th>Joués</th>
                        <th>V</th>
                        <th>N</th>
                        <th>D</th>
                        <th>Forfaits*</th>
                        <th>Jeux +</th>
                        <th>Jeux −</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr className={owns(r) ? "own-row" : ""} key={r.id}>
                          <td>{r.rank}</td>
                          <td>{names(r)}</td>
                          <td>
                            <strong>{r.points}</strong>
                          </td>
                          <td>{r.played}</td>
                          <td>{r.wins}</td>
                          <td>{r.draws}</td>
                          <td>{r.losses}</td>
                          <td>{r.forfeits}</td>
                          <td>{r.gamesFor}</td>
                          <td>{r.gamesAgainst}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small">
                  Résultats confirmés uniquement. Victoire : 4 pts · Nul : 2 pts
                  · Défaite jouée : 1 pt.
                  <br />* Rencontres décidées par forfait. V et D incluent les
                  forfaits.
                  <br />
                  Départage : points, confrontations directes, victoires, jeux
                  gagnés.
                </p>
              </section>
            )}
            {tab === "admin" && me.role === "admin" && (
              <section className="panel">
                <h2>Organisation</h2>
                <div className="job">
                  <p>
                    Dernière vérification des échéances :{" "}
                    {job
                      ? formatDate(job.last_success)
                      : "aucune exécution enregistrée"}
                    {(!job ||
                      Date.now() - new Date(job.last_success).getTime() >
                        15 * 60000) && (
                      <strong className="danger">
                        {" "}
                        · Ancienne vérification (peut être normal sans résultat
                        à échéance)
                      </strong>
                    )}
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        const r = await api("/admin/jobs/run", {});
                        setNotice(r.confirmed + " résultat(s) confirmé(s).");
                        setJob((await api("/admin/jobs/status")).job);
                        await loadBox();
                      })
                    }
                  >
                    Rattraper les confirmations
                  </button>
                </div>
                <h3>Liens personnels</h3>
                <p className="muted">
                  Chaque lien donne accès au compte du joueur. Transmettez-le
                  uniquement à la personne concernée.
                </p>
                <label>
                  Rechercher un joueur
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nom du joueur"
                  />
                </label>
                {link && (
                  <div className="private-link">
                    <strong>{link.name}</strong>
                    <input
                      aria-label="Lien personnel à transmettre"
                      readOnly
                      value={link.url}
                    />
                    <button
                      disabled={busy}
                      onClick={() =>
                        perform(async () => {
                          await navigator.clipboard.writeText(link.url);
                          setNotice("Lien copié.");
                        })
                      }
                    >
                      Copier le lien
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setLink(null)}
                    >
                      Masquer
                    </button>
                  </div>
                )}
                <div className="players">
                  {players
                    .filter((p) =>
                      p.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p) => (
                      <div key={p.id}>
                        <span>{p.name}</span>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            perform(async () => {
                              const r = await api(
                                "/admin/players/" + p.id + "/access-link",
                                p.has_link ? undefined : {},
                              );
                              setLink({ name: p.name, url: r.url });
                              if (!p.has_link)
                                setPlayers(
                                  (await api("/admin/players")).players,
                                );
                            })
                          }
                        >
                          {p.has_link ? "Voir le lien" : "Créer le lien"}
                        </button>
                        {p.has_link && (
                          <button
                            className="text-button danger"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Remplacer le lien de " +
                                    p.name +
                                    " ? Son ancien lien et ses sessions seront invalidés.",
                                )
                              )
                                perform(async () => {
                                  const r = await api(
                                    "/admin/players/" + p.id + "/access-link",
                                    {},
                                  );
                                  setLink({ name: p.name, url: r.url });
                                  setNotice(
                                    "Ancien lien révoqué. Transmettez le nouveau lien au joueur.",
                                  );
                                });
                            }}
                          >
                            Remplacer
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </section>
            )}
          </>
        )}
        <footer>
          <strong>PADEL LEAGUE LA CURE</strong>
          <span>Convivialité · Fair-play · Progression</span>
          <p>
            Horaires affichés en heure belge. Réservation des terrains via
            SportFinder.
          </p>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
