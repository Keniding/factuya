import { describe, expect, it } from "bun:test";
import type { InvoiceRequest, InvoiceResult, TenantConfig } from "@factuya/shared-types";
import type { BuiltDocument, CountryAdapter, SignedDocument, SubmissionResult } from "../src/country-adapter";
import { emitInvoice } from "../src/emit-invoice";

const sampleRequest: InvoiceRequest = {
  tenantId: "tenant-1",
  documentType: "INVOICE",
  issueDate: "2026-07-31",
  currency: "PEN",
  issuer: { taxId: "20000000001", legalName: "EMPRESA SAC" },
  customer: { taxId: "10000000001", legalName: "CLIENTE" },
  lines: [],
  taxes: [],
};

const sampleTenant: TenantConfig = {
  tenantId: "tenant-1",
  country: "PE",
  submissionChannel: "SUNAT_DIRECT",
  issuer: { taxId: "20000000001", legalName: "EMPRESA SAC" },
  certificate: { publicCertificatePem: "dummy", signerRef: "dummy" },
};

class FakeSyncAdapter implements CountryAdapter {
  readonly countryCode = "PE";
  async build(): Promise<BuiltDocument> {
    return { content: "<xml/>", fileName: "test.xml" };
  }
  async sign(document: BuiltDocument): Promise<SignedDocument> {
    return document;
  }
  async submit(): Promise<SubmissionResult> {
    return {
      kind: "SYNC",
      result: { status: "ACCEPTED", countryDocumentId: "F001-1", rawProviderResponse: {} },
    };
  }
  async checkStatus(): Promise<InvoiceResult> {
    throw new Error("no debería llamarse en flujo síncrono");
  }
}

class FakeAsyncAdapter implements CountryAdapter {
  readonly countryCode = "PE";
  private pollCount = 0;
  constructor(private readonly acceptOnAttempt: number) {}

  async build(): Promise<BuiltDocument> {
    return { content: "<xml/>", fileName: "test.xml" };
  }
  async sign(document: BuiltDocument): Promise<SignedDocument> {
    return document;
  }
  async submit(): Promise<SubmissionResult> {
    return { kind: "ASYNC", ticket: "TICKET-123" };
  }
  async checkStatus(ticket: string): Promise<InvoiceResult> {
    expect(ticket).toBe("TICKET-123");
    const isReady = this.pollCount >= this.acceptOnAttempt;
    this.pollCount++;
    if (!isReady) {
      return { status: "PENDING", countryDocumentId: ticket, rawProviderResponse: {} };
    }
    return { status: "ACCEPTED", countryDocumentId: "RC001-1", rawProviderResponse: {} };
  }
}

const noWait = async () => {};

describe("emitInvoice", () => {
  it("devuelve el resultado inmediatamente en flujo síncrono", async () => {
    const result = await emitInvoice(new FakeSyncAdapter(), sampleRequest, sampleTenant);
    expect(result.status).toBe("ACCEPTED");
    expect(result.countryDocumentId).toBe("F001-1");
  });

  it("hace polling hasta obtener un resultado final en flujo asíncrono", async () => {
    const adapter = new FakeAsyncAdapter(2);
    const result = await emitInvoice(adapter, sampleRequest, sampleTenant, { wait: noWait });
    expect(result.status).toBe("ACCEPTED");
    expect(result.countryDocumentId).toBe("RC001-1");
  });

  it("devuelve PENDING si se agotan los intentos de polling", async () => {
    const adapter = new FakeAsyncAdapter(999);
    const result = await emitInvoice(adapter, sampleRequest, sampleTenant, {
      wait: noWait,
      maxPollAttempts: 3,
    });
    expect(result.status).toBe("PENDING");
    expect(result.rawProviderResponse.reason).toBe("max_poll_attempts_exceeded");
  });
});
