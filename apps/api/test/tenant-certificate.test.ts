import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { InvoiceResult } from "@factuya/shared-types";
import type { BuiltDocument, CountryAdapter, SignedDocument, SubmissionResult } from "@factuya/core-domain";
import { CreateKeyCommand, GetParametersForImportCommand, ImportKeyMaterialCommand, type KMSClient } from "@aws-sdk/client-kms";
import { createApp } from "../src/app";
import { LocalTenantRegistry } from "../src/tenant-registry";
import { hashApiKey } from "../src/api-key";

/**
 * Ver ADR-0006. Usa un `KMSClient` falso que responde a `CreateKey`/`GetParametersForImport`/
 * `ImportKeyMaterial` sin tocar AWS real — `createTenantSigningKey` ya está probado
 * criptográficamente de punta a punta en `packages/signing/test/kms-tenant-key-import.test.ts`;
 * aquí se prueba el endpoint (auth admin, validación, registro del tenant, respuesta), no el
 * wrapping otra vez.
 */
function fakeKmsClient(): KMSClient {
  const wrappingKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrappingPublicKeyDer = wrappingKeyPair.publicKey.export({ type: "spki", format: "der" }) as Buffer;

  return {
    send: async (command: unknown) => {
      if (command instanceof CreateKeyCommand) {
        return { KeyMetadata: { KeyId: "fake-tenant-key-id" } };
      }
      if (command instanceof GetParametersForImportCommand) {
        return { ImportToken: Buffer.from("fake-token"), PublicKey: wrappingPublicKeyDer };
      }
      if (command instanceof ImportKeyMaterialCommand) {
        return {};
      }
      throw new Error(`comando inesperado: ${String(command)}`);
    },
  } as unknown as KMSClient;
}

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

/** Mismo patrón que apps/api/src/dev-certificate.ts — config mínima, no depende del openssl.cnf del sistema. */
function generateTestCertAndKey(): { certificatePem: string; privateKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), "factuya-tenant-cert-test-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const configPath = join(dir, "openssl.cnf");
  try {
    writeFileSync(
      configPath,
      "[req]\ndistinguished_name=req_dn\nx509_extensions=v3\nprompt=no\n[req_dn]\nCN=Tenant Test\n[v3]\nbasicConstraints=critical,CA:true\nsubjectKeyIdentifier=hash\n",
    );
    const result = spawnSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
      "-days", "1", "-nodes", "-config", configPath,
    ], { stdio: "pipe" });
    if (result.status !== 0) {
      throw new Error(`openssl falló generando el certificado de prueba: ${result.stderr?.toString()}`);
    }
    return { certificatePem: readFileSync(certPath, "utf8"), privateKeyPem: readFileSync(keyPath, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ADMIN_API_KEY = "admin-key-de-prueba";

function buildTestApp() {
  const registry = new LocalTenantRegistry();
  const fetch = createApp({
    tenantRegistry: registry,
    countryAdapter: new FakeAdapter(),
    kmsClient: fakeKmsClient(),
    adminApiKeyHash: hashApiKey(ADMIN_API_KEY),
  });
  return { fetch, registry };
}

describe("POST /v1/tenants/{id}/certificate — autenticación admin", () => {
  it("sin Authorization devuelve 401", async () => {
    const { fetch } = buildTestApp();
    const res = await fetch(
      new Request("http://localhost/v1/tenants/acme/certificate", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
  });

  it("con una API key que no es la de admin devuelve 401", async () => {
    const { fetch } = buildTestApp();
    const res = await fetch(
      new Request("http://localhost/v1/tenants/acme/certificate", {
        method: "POST",
        headers: { Authorization: "Bearer no-soy-admin" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/tenants/{id}/certificate — validación del cuerpo", () => {
  it("rechaza un certificado/clave que no corresponden al mismo par", async () => {
    const { fetch } = buildTestApp();
    const certA = generateTestCertAndKey();
    const certB = generateTestCertAndKey();
    const res = await fetch(
      new Request("http://localhost/v1/tenants/acme/certificate", {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ruc: "20000000001",
          legalName: "ACME SAC",
          certificatePem: certA.certificatePem,
          privateKeyPem: certB.privateKeyPem,
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no corresponden al mismo par/);
  });
});

describe("POST /v1/tenants/{id}/certificate — alta real de un tenant", () => {
  it("crea el tenant, importa la clave a KMS, y la API key devuelta funciona para emitir facturas", async () => {
    const { fetch, registry } = buildTestApp();
    const { certificatePem, privateKeyPem } = generateTestCertAndKey();

    const createRes = await fetch(
      new Request("http://localhost/v1/tenants/acme/certificate", {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ruc: "20000000001", legalName: "ACME SAC", certificatePem, privateKeyPem }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { tenantId: string; apiKey: string; kmsKeyId: string };
    expect(created.tenantId).toBe("acme");
    expect(created.kmsKeyId).toBe("fake-tenant-key-id");
    expect(typeof created.apiKey).toBe("string");

    const resolved = await registry.resolveByApiKeyHash(hashApiKey(created.apiKey));
    expect(resolved?.tenantId).toBe("acme");
    expect(resolved?.certificate.signerRef).toBe("fake-tenant-key-id");
    expect(resolved?.issuer.taxId).toBe("20000000001");

    // La API key recién creada debe poder usarse de inmediato en el flujo normal de facturas.
    const invoiceRes = await fetch(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: { Authorization: `Bearer ${created.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "INVOICE",
          issueDate: "2026-08-03",
          currency: "PEN",
          issuer: { taxId: "20000000001", legalName: "ACME SAC" },
          customer: { taxId: "10000000001", legalName: "CLIENTE" },
          lines: [
            { id: "1", description: "Producto", quantity: 1, unitPrice: 100, lineExtensionAmount: 100, taxCategory: "GRAVADO", taxPercent: 18, taxAmount: 18 },
          ],
          taxes: [{ scheme: "IGV", taxableAmount: 100, taxAmount: 18, currency: "PEN" }],
        }),
      }),
    );
    expect(invoiceRes.status).toBe(201);
  });
});
