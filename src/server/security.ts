const encoder = new TextEncoder();
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)));
export const token = () =>
  b64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function hash(s: string) {
  return b64(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
}
export async function encrypt(s: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return (
    b64(iv) +
    "." +
    b64(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(s),
      ),
    )
  );
}
export async function decrypt(s: string, secret: string) {
  const [iv, cipher] = s.split(".");
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(iv) },
      key,
      bytes(cipher),
    ),
  );
}
export async function passwordHash(
  password: string,
  salt = b64(crypto.getRandomValues(new Uint8Array(16))),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bytes(salt), iterations: 600000 },
    key,
    256,
  );
  return `pbkdf2:600000:${salt}:${b64(derived)}`;
}
export async function verifyPassword(password: string, expected: string) {
  const [algorithm, iterations, salt] = expected.split(":");
  if (algorithm !== "pbkdf2" || iterations !== "600000" || !salt) return false;
  const actual = await passwordHash(password, salt);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
  return diff === 0;
}
