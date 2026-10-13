// Expensive password derivation runs in the browser (or in setup scripts).
// The Worker stores only SHA-256 of the derived credential, never the credential.
const encoder = new TextEncoder();
const base64 = (data: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(data)));
export const PASSWORD_ITERATIONS = 600000;
export const PASSWORD_FORMAT = "pbkdf2-client";
export function parsePasswordHash(value: string) {
  const [format, iterations, salt, verifier, ...extra] = value.split(":");
  if (
    extra.length ||
    !["pbkdf2", PASSWORD_FORMAT].includes(format) ||
    Number(iterations) !== PASSWORD_ITERATIONS ||
    !salt ||
    !verifier
  )
    throw new Error("Invalid password verifier format");
  if (atob(salt).length !== 16 || atob(verifier).length !== 32)
    throw new Error("Invalid password verifier length");
  return { format, salt, verifier, iterations: PASSWORD_ITERATIONS };
}
export async function deriveCredential(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)),
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    256,
  );
  return base64(bits);
}
export async function credentialHash(proof: string) {
  return base64(await crypto.subtle.digest("SHA-256", encoder.encode(proof)));
}
function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function verifyCredential(
  proof: string,
  stored: string,
  allowLegacyLocal = false,
) {
  const parsed = parsePasswordHash(stored);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(proof)) return false;
  if (parsed.format === "pbkdf2") {
    // Compatibility for existing local development only, never for production.
    return allowLegacyLocal && constantTimeEqual(proof, parsed.verifier);
  }
  return constantTimeEqual(await credentialHash(proof), parsed.verifier);
}
