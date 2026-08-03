import type { TenantConfig } from "@factuya/shared-types";
import { hashApiKey, hashesEqual } from "./api-key";

/**
 * Ver ADR-0004. `apps/api` depende solo de esta interfaz, nunca de una implementación concreta —
 * así el día que exista DynamoDB (docs/aws/aws-infrastructure-sdd.md) se agrega una
 * `DynamoDbTenantRegistry` sin tocar el resto del servidor.
 */
export interface TenantRegistry {
  resolveByApiKeyHash(apiKeyHash: string): Promise<TenantConfig | undefined>;
  /**
   * Da de alta un tenant con su API key en texto plano — la implementación debe guardar solo el
   * hash (ver ADR-0006, `POST /v1/tenants/{id}/certificate`). Parte del contrato, no un detalle
   * de `LocalTenantRegistry`: cualquier implementación real (ej. DynamoDB) también necesita
   * soportar el alta de un tenant nuevo, no solo la resolución.
   */
  register(apiKey: string, tenant: TenantConfig): Promise<void>;
}

interface RegisteredTenant {
  apiKeyHash: string;
  tenant: TenantConfig;
}

/**
 * Registro de tenants en memoria del proceso — solo para desarrollo (mismo espíritu que
 * `LocalPemKeySigner`: real y funcional, nunca para producción). Se pierde en cada reinicio.
 */
export class LocalTenantRegistry implements TenantRegistry {
  private readonly tenants: RegisteredTenant[] = [];

  async register(apiKey: string, tenant: TenantConfig): Promise<void> {
    this.tenants.push({ apiKeyHash: hashApiKey(apiKey), tenant });
  }

  async resolveByApiKeyHash(apiKeyHash: string): Promise<TenantConfig | undefined> {
    return this.tenants.find((entry) => hashesEqual(entry.apiKeyHash, apiKeyHash))?.tenant;
  }
}
