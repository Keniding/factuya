import type { TenantConfig } from "@factuya/shared-types";
import { hashApiKey, hashesEqual } from "./api-key";
import type { TenantRegistry } from "./tenant-registry";

/** Ver ADR-0004 — Bearer API key, no JWT. */
export class UnauthorizedError extends Error {}

const BEARER_PREFIX = "Bearer ";

function extractApiKey(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) return undefined;
  const key = header.slice(BEARER_PREFIX.length).trim();
  return key.length > 0 ? key : undefined;
}

/** Resuelve el tenant autenticado de la solicitud, o lanza UnauthorizedError. */
export async function authenticate(req: Request, registry: TenantRegistry): Promise<TenantConfig> {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    throw new UnauthorizedError("Falta el header Authorization: Bearer <api_key>");
  }
  const tenant = await registry.resolveByApiKeyHash(hashApiKey(apiKey));
  if (!tenant) {
    throw new UnauthorizedError("API key inválida");
  }
  return tenant;
}

/**
 * Autenticación admin-only para `POST /v1/tenants/{id}/certificate` (ADR-0006) — un mecanismo
 * temporal (una sola API key de administrador, no un sistema de roles real) documentado como
 * limitación deliberada en `apps/api/README.md`.
 */
export function authenticateAdmin(req: Request, adminApiKeyHash: string): void {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    throw new UnauthorizedError("Falta el header Authorization: Bearer <admin_api_key>");
  }
  if (!hashesEqual(hashApiKey(apiKey), adminApiKeyHash)) {
    throw new UnauthorizedError("Admin API key inválida");
  }
}
