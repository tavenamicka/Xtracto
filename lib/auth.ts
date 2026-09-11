export const SESSION_COOKIE = "xtracto_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET manquant dans l'environnement.");
  return secret;
}

// verifySessionToken() tourne dans proxy.ts, donc sur CHAQUE requête vers une
// route protégée. Sans ce cache, on réimporterait la clé HMAC (coût crypto
// réel) à chaque appel alors qu'AUTH_SECRET ne change jamais en cours de vie
// du process.
let cachedKey: Promise<CryptoKey> | null = null;

function getHmacKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(getSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
  return cachedKey;
}

async function hmac(data: string): Promise<string> {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return toHex(sig);
}

export async function createSessionToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const signature = await hmac(String(exp));
  return `${exp}.${signature}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expStr, signature] = token.split(".");
  if (!expStr || !signature) return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const expected = await hmac(expStr);
  return expected === signature;
}

function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.XTRACTO_PASSWORD;
  if (!expected) throw new Error("XTRACTO_PASSWORD manquant dans l'environnement.");
  return timingSafeEqual(candidate, expected);
}
