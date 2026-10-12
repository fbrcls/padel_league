import { describe, it, expect } from "vitest";
import {
  scheduleDeadline,
  dueKeys,
  dailySweep,
  type Queue,
} from "../src/server/queue";
describe("Repères d’échéance Cloudflare", () => {
  it("ne réveille pas la base avant l’échéance et arrondit au prochain passage", async () => {
    const keys = new Map<string, string>();
    const q: Queue = {
      put: async (k, v) => {
        keys.set(k, v);
      },
      list: async () => ({
        keys: [...keys.keys()].sort().map((name) => ({ name })),
      }),
      delete: async (k) => {
        keys.delete(k);
      },
    };
    const deadline = new Date("2026-10-14T12:02:00Z");
    await scheduleDeadline(q, deadline);
    expect(await dueKeys(q, new Date("2026-10-14T12:00:00Z"))).toHaveLength(0);
    expect(await dueKeys(q, new Date("2026-10-14T12:04:59Z"))).toHaveLength(0);
    expect(await dueKeys(q, new Date("2026-10-14T12:05:00Z"))).toHaveLength(1);
    for (const key of await dueKeys(q, new Date("2026-10-14T12:05:00Z")))
      await q.delete(key);
    expect(await dueKeys(q, new Date("2026-10-14T12:10:00Z"))).toHaveLength(0);
  });
  it("prévoit un rattrapage quotidien indépendant des repères", () => {
    expect(dailySweep(new Date("2026-10-14T00:00:00Z"))).toBe(true);
    expect(dailySweep(new Date("2026-10-14T00:05:00Z"))).toBe(false);
  });
});
