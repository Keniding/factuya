import { describe, expect, it } from "bun:test";
import { DOMParser } from "@xmldom/xmldom";
import type { InvoiceRequest, TenantConfig } from "@factuya/shared-types";
import { buildFacturaUbl } from "../src/ubl-invoice-builder";

const request: InvoiceRequest = {
  tenantId: "tenant-1",
  documentType: "INVOICE",
  series: "F001",
  issueDate: "2026-07-31",
  issueTime: "10:00:00",
  currency: "PEN",
  issuer: { taxId: "20000000001", legalName: "EMPRESA SAC" },
  customer: { taxId: "10000000001", legalName: "CLIENTE DE PRUEBA" },
  lines: [
    {
      id: "1",
      description: "Producto de prueba",
      quantity: 2,
      unitCode: "NIU",
      unitPrice: 100,
      lineExtensionAmount: 200,
      taxCategory: "GRAVADO",
      taxPercent: 18,
      taxAmount: 36,
    },
  ],
  taxes: [{ scheme: "IGV", taxableAmount: 200, taxAmount: 36, currency: "PEN" }],
};

const tenant: TenantConfig = {
  tenantId: "tenant-1",
  country: "PE",
  submissionChannel: "SUNAT_DIRECT",
  issuer: { taxId: "20000000001", legalName: "EMPRESA SAC" },
  certificate: { publicCertificatePem: "dummy", signerRef: "dummy" },
};

describe("buildFacturaUbl", () => {
  const xml = buildFacturaUbl(request, tenant, "F001-1");

  it("produce XML bien formado (parseable por xmldom)", () => {
    const doc = new DOMParser().parseFromString(xml);
    expect(doc.documentElement?.tagName).toBe("Invoice");
  });

  it("incluye el ID de documento, moneda, y montos correctos", () => {
    expect(xml).toContain("<cbc:ID>F001-1</cbc:ID>");
    expect(xml).toContain("<cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>");
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="PEN">200.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="PEN">236.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="PEN">236.00</cbc:PayableAmount>');
  });

  it("deja el ExtensionContent vacío listo para la firma", () => {
    expect(xml).toContain("<ext:ExtensionContent></ext:ExtensionContent>");
  });

  it("incluye los datos del emisor y del cliente", () => {
    expect(xml).toContain("20000000001");
    expect(xml).toContain("10000000001");
    expect(xml).toContain("CLIENTE DE PRUEBA");
  });

  it("rechaza tipos de documento distintos de INVOICE (fuera de alcance del MVP)", async () => {
    const creditNoteRequest: InvoiceRequest = { ...request, documentType: "CREDIT_NOTE" };
    const { PeSunatAdapter } = await import("../src/pe-sunat-adapter");
    const adapter = new PeSunatAdapter({
      endpointUrl: "https://example.invalid",
      signer: { sign: async () => new Uint8Array(), getPublicCertificatePem: () => "" },
      credentials: { ruc: "1", solUser: "1", solPassword: "1" },
    });
    await expect(adapter.build(creditNoteRequest, tenant)).rejects.toThrow(/solo soporta/);
  });
});
