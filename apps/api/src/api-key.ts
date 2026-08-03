import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Ver ADR-0004: API key con prefijo reconocible, hasheada con SHA-256 (no bcrypt/scrypt/argon2 —
 * esos existen para mitigar fuerza bruta contra secretos de BAJA entropía como contraseñas
 * humanas; una API key aleatoria de alta entropía no lo necesita, y un hash lento agregaría
 * latencia innecesaria a cada request). Sin dependencia nueva: node:crypto alcanza.
 */
const API_KEY_PREFIX = "fty_";

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** Compara dos hashes (hex) en tiempo constante — evita filtrar información por timing. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
