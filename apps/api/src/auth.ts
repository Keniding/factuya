import type { TenantConfig } from "@factuya/shared-types";
import { hashApiKey } from "./api-key";
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
