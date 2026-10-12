import type { Match, Entry } from "../shared/contracts";
export function points(m: Match, id: string) {
  if (m.kind === "forfeit") return m.forfeiting_entry === id ? 0 : 3;
  const own = id === m.entry_a ? m.games_a! : m.games_b!;
  const other = id === m.entry_a ? m.games_b! : m.games_a!;
  return own > other ? 4 : own === other ? 2 : 1;
}
export function standings(entries: Entry[], matches: Match[]) {
  const valid = matches.filter((m) => m.status === "confirmed");
  const rows = entries.map((e) => {
    const played = valid.filter(
      (m) => m.entry_a === e.id || m.entry_b === e.id,
    );
    const games = played.filter((m) => m.kind === "played");
    const wins = played.filter((m) => points(m, e.id) >= 3).length;
    const draws = games.filter((m) => points(m, e.id) === 2).length;
    const gamesFor = games.reduce(
      (n, m) => n + (m.entry_a === e.id ? m.games_a! : m.games_b!),
      0,
    );
    const gamesAgainst = games.reduce(
      (n, m) => n + (m.entry_a === e.id ? m.games_b! : m.games_a!),
      0,
    );
    return {
      ...e,
      points: played.reduce((n, m) => n + points(m, e.id), 0),
      played: games.length,
      forfeits: played.length - games.length,
      wins,
      draws,
      losses: played.length - wins - draws,
      gamesFor,
      gamesAgainst,
      difference: gamesFor - gamesAgainst,
      direct: 0,
      rank: 0,
    };
  });
  for (const row of rows) {
    const tied = new Set(
      rows.filter((r) => r.points === row.points).map((r) => r.id),
    );
    row.direct = valid
      .filter(
        (m) =>
          tied.has(m.entry_a) &&
          tied.has(m.entry_b) &&
          (m.entry_a === row.id || m.entry_b === row.id),
      )
      .reduce((n, m) => n + points(m, row.id), 0);
  }
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.points - a.points ||
    b.direct - a.direct ||
    b.wins - a.wins ||
    b.gamesFor - a.gamesFor;
  rows.sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  rows.forEach(
    (r, i) =>
      (r.rank =
        i > 0 && compare(r, rows[i - 1]) === 0 ? rows[i - 1].rank : i + 1),
  );
  return rows;
}
