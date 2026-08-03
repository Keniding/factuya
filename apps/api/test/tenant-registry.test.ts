import { describe, expect, it } from "bun:test";
import type { TenantConfig } from "@factuya/shared-types";
import { LocalTenantRegistry } from "../src/tenant-registry";
import { hashApiKey } from "../src/api-key";

function buildTenant(tenantId: string): TenantConfig {
  return {
    tenantId,
    country: "PE",
    submissionChannel: "SUNAT_DIRECT",
    issuer: { taxId: "20000000001", legalName: `EMPRESA ${tenantId}` },
    certificate: { publicCertificatePem: "dummy", signerRef: "dummy" },
  };
}

describe("LocalTenantRegistry", () => {
  it("resuelve el tenant correcto por el hash de su propia API key", async () => {
    const registry = new LocalTenantRegistry();
    const tenantA = buildTenant("tenant-a");
    const tenantB = buildTenant("tenant-b");
    registry.register("key-a", tenantA);
    registry.register("key-b", tenantB);

    expect(await registry.resolveByApiKeyHash(hashApiKey("key-a"))).toEqual(tenantA);
    expect(await registry.resolveByApiKeyHash(hashApiKey("key-b"))).toEqual(tenantB);
  });

  it("no resuelve ningún tenant con una key que no fue registrada", async () => {
    const registry = new LocalTenantRegistry();
    registry.register("key-a", buildTenant("tenant-a"));

    expect(await registry.resolveByApiKeyHash(hashApiKey("key-desconocida"))).toBeUndefined();
  });

  it("una key nunca resuelve al tenant de otra key, aunque ambas existan", async () => {
    const registry = new LocalTenantRegistry();
    registry.register("key-a", buildTenant("tenant-a"));
    registry.register("key-b", buildTenant("tenant-b"));

    const resolved = await registry.resolveByApiKeyHash(hashApiKey("key-a"));
    expect(resolved?.tenantId).toBe("tenant-a");
    expect(resolved?.tenantId).not.toBe("tenant-b");
  });
});
