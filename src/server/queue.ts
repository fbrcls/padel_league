export interface Queue {
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
  list(options: {
    prefix: string;
    limit: number;
  }): Promise<{ keys: { name: string }[] }>;
  delete(key: string): Promise<void>;
}
export async function scheduleDeadline(queue: Queue, deadline: Date) {
  const bucket = Math.ceil(deadline.getTime() / 300000) * 300000;
  await queue.put("due:" + String(bucket).padStart(16, "0"), "1", {
    expirationTtl: 7 * 86400,
  });
}
export async function dueKeys(queue: Queue, now: Date) {
  const result = await queue.list({ prefix: "due:", limit: 1000 });
  return result.keys
    .map((k) => k.name)
    .filter((name) => Number(name.slice(4)) <= now.getTime());
}
export function dailySweep(now: Date) {
  return now.getUTCHours() === 0 && now.getUTCMinutes() < 5;
}
