import { describe, expect, it } from "bun:test";
import type { InvoiceResult, TenantConfig } from "@factuya/shared-types";
import type { BuiltDocument, CountryAdapter, SignedDocument, SubmissionResult } from "@factuya/core-domain";
import { createApp } from "../src/app";
import { LocalTenantRegistry } from "../src/tenant-registry";

/** Fake CountryAdapter — mismo patrón que packages/core-domain/test/emit-invoice.test.ts. */
class FakeAdapter implements CountryAdapter {
  readonly countryCode = "PE";
  async build(): Promise<BuiltDocument> {
    return { content: "<xml/>", fileName: "test.xml" };
  }
  async sign(document: BuiltDocument): Promise<SignedDocument> {
    return document;
  }
  async submit(): Promise<SubmissionResult> {
    const result: InvoiceResult = { status: "ACCEPTED", countryDocumentId: "F001-1", rawProviderResponse: {} };
    return { kind: "SYNC", result };
  }
  async checkStatus(): Promise<InvoiceResult> {
    throw new Error("no debería llamarse en este test");
  }
}

function buildTenant(tenantId: string): TenantConfig {
  return {
    tenantId,
    country: "PE",
    submissionChannel: "SUNAT_DIRECT",
    issuer: { taxId: "20000000001", legalName: `EMPRESA ${tenantId}` },
    certificate: { publicCertificatePem: "dummy", signerRef: "dummy" },
  };
}

function buildInvoicePayload(): unknown {
  return {
    documentType: "INVOICE",
    issueDate: "2026-08-02",
    currency: "PEN",
    issuer: { taxId: "20000000001", legalName: "EMPRESA DEMO" },
    customer: { taxId: "10000000001", legalName: "CLIENTE" },
    lines: [
      {
        id: "1",
        description: "Producto",
        quantity: 1,
        unitPrice: 100,
        lineExtensionAmount: 100,
        taxCategory: "GRAVADO",
        taxPercent: 18,
        taxAmount: 18,
      },
    ],
    taxes: [{ scheme: "IGV", taxableAmount: 100, taxAmount: 18, currency: "PEN" }],
  };
}

function buildTestApp() {
  const registry = new LocalTenantRegistry();
  registry.register("key-tenant-a", buildTenant("tenant-a"));
  registry.register("key-tenant-b", buildTenant("tenant-b"));
  const fetch = createApp({ tenantRegistry: registry, countryAdapter: new FakeAdapter() });
  return fetch;
}

describe("createApp — rutas públicas", () => {
  it("GET /health no requiere autenticación", async () => {
    const fetch = buildTestApp();
    const res = await fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /v1/catalogs/PE/document-types no requiere autenticación", async () => {
    const fetch = buildTestApp();
    const res = await fetch(new Request("http://localhost/v1/catalogs/PE/document-types"));
    expect(res.status).toBe(200);
  });

  it("una ruta desconocida devuelve 404", async () => {
    const fetch = buildTestApp();
    const res = await fetch(new Request("http://localhost/no-existe"));
    expect(res.status).toBe(404);
  });
});

describe("createApp — autenticación de /v1/invoices", () => {
  it("POST /v1/invoices sin Authorization devuelve 401", async () => {
    const fetch = buildTestApp();
    const res = await fetch(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildInvoicePayload()),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("POST /v1/invoices con una API key inválida devuelve 401", async () => {
    const fetch = buildTestApp();
    const res = await fetch(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer key-que-no-existe" },
        body: JSON.stringify(buildInvoicePayload()),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /v1/invoices con una API key válida crea el comprobante para ese tenant", async () => {
    const fetch = buildTestApp();
    const res = await fetch(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer key-tenant-a" },
        body: JSON.stringify(buildInvoicePayload()),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe("ACCEPTED");
    expect(typeof body.id).toBe("string");
  });
});

describe("createApp — aislamiento real entre tenants (ADR-0004)", () => {
  it("el tenant B nunca puede leer un comprobante creado por el tenant A", async () => {
    const fetch = buildTestApp();

    const createRes = await fetch(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer key-tenant-a" },
        body: JSON.stringify(buildInvoicePayload()),
      }),
    );
    const { id } = (await createRes.json()) as { id: string };

    const readAsOwner = await fetch(
      new Request(`http://localhost/v1/invoices/${id}`, { headers: { Authorization: "Bearer key-tenant-a" } }),
    );
    expect(readAsOwner.status).toBe(200);

    const readAsOtherTenant = await fetch(
      new Request(`http://localhost/v1/invoices/${id}`, { headers: { Authorization: "Bearer key-tenant-b" } }),
    );
    expect(readAsOtherTenant.status).toBe(404);
  });

  it("GET /v1/invoices/:id sin Authorization devuelve 401 antes de siquiera buscar el comprobante", async () => {
    const fetch = buildTestApp();
    const res = await fetch(new Request("http://localhost/v1/invoices/cualquier-id"));
    expect(res.status).toBe(401);
  });
});
