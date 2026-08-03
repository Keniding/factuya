import { describe, expect, it } from "bun:test";
import type { TenantConfig } from "@factuya/shared-types";
import { authenticate, UnauthorizedError } from "../src/auth";
import { LocalTenantRegistry } from "../src/tenant-registry";

const tenant: TenantConfig = {
  tenantId: "tenant-a",
  country: "PE",
  submissionChannel: "SUNAT_DIRECT",
  issuer: { taxId: "20000000001", legalName: "EMPRESA A" },
  certificate: { publicCertificatePem: "dummy", signerRef: "dummy" },
};

function registryWithTenant(): LocalTenantRegistry {
  const registry = new LocalTenantRegistry();
  registry.register("valid-key", tenant);
  return registry;
}

describe("authenticate", () => {
  it("resuelve el tenant con un Authorization: Bearer válido", async () => {
    const req = new Request("http://localhost/v1/invoices", {
      headers: { Authorization: "Bearer valid-key" },
    });
    const resolved = await authenticate(req, registryWithTenant());
    expect(resolved.tenantId).toBe("tenant-a");
  });

  it("rechaza si falta el header Authorization", async () => {
    const req = new Request("http://localhost/v1/invoices");
    await expect(authenticate(req, registryWithTenant())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rechaza un header Authorization que no es Bearer", async () => {
    const req = new Request("http://localhost/v1/invoices", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    await expect(authenticate(req, registryWithTenant())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rechaza una API key que no está registrada", async () => {
    const req = new Request("http://localhost/v1/invoices", {
      headers: { Authorization: "Bearer key-que-no-existe" },
    });
    await expect(authenticate(req, registryWithTenant())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rechaza un Bearer vacío", async () => {
    const req = new Request("http://localhost/v1/invoices", {
      headers: { Authorization: "Bearer " },
    });
    await expect(authenticate(req, registryWithTenant())).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
