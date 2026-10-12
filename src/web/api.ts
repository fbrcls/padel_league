export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Requested-With": "PadelLeague",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Une erreur est survenue.");
  return result;
}
export const names = (e: { name_a: string; name_b: string }) =>
  e.name_a + " / " + e.name_b;
export function localDateValue(date = new Date()) {
  const p = new Intl.DateTimeFormat("fr-BE", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (key: string) => p.find((x) => x.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function belgianInstant(value: string) {
  const wall = new Date(value + "Z");
  let result = wall;
  for (let i = 0; i < 3; i++) {
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Brussels",
      timeZoneName: "longOffset",
    })
      .formatToParts(result)
      .find((x) => x.type === "timeZoneName")!.value;
    const [, sign, hours, minutes] = offset.match(/GMT([+-])(\d{2}):(\d{2})/)!;
    result = new Date(
      wall.getTime() -
        (sign === "+" ? 1 : -1) *
          (Number(hours) * 60 + Number(minutes)) *
          60000,
    );
  }
  if (localDateValue(result) !== value)
    throw new Error(
      "Cette heure n’existe pas en Belgique (changement d’heure).",
    );
  return result.toISOString();
}
export const formatDate = (date: string) =>
  new Intl.DateTimeFormat("fr-BE", {
    timeZone: "Europe/Brussels",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
