import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { InvoiceRequest, TenantConfig } from "@factuya/shared-types";
import { emitInvoice } from "@factuya/core-domain";
import { LocalPemKeySigner } from "@factuya/signing";
import { PeSunatAdapter } from "../../src/pe-sunat-adapter";
import { zipXmlFile } from "../../src/zip";
import { generateTestCertificate } from "../generate-test-certificate";

/**
 * Test de integración de componente: levanta un servidor SOAP local que habla el mismo
 * protocolo real que SUNAT (mismo envelope, mismo formato de CDR comprimido en ZIP dentro de
 * la respuesta SOAP) y corre el pipeline completo de PeSunatAdapter contra él por HTTP real
 * (socket real en localhost, no mocks de fetch ni de nuestro propio código).
 *
 * Esto NO reemplaza la prueba contra SUNAT real (sunat-beta.integration.test.ts) — la
 * complementa: aquí se prueba que TODO el código de Factuya (build UBL, firma XMLDSig, zip,
 * armado y parseo de SOAP, desempaquetado y parseo del CDR) funciona de punta a punta con bytes
 * reales, algo que sí se puede verificar en un entorno sin salida a internet como este sandbox
 * (ver docs/adapters/pe-sunat.md, "Limitación de este entorno").
 */

function extractTagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  if (!match) throw new Error(`No se encontró <${tag}> en el request SOAP recibido por el servidor de prueba`);
  return match[1] ?? "";
}

function buildMockCdrZip(fileName: string, responseCode: string, description: string): Uint8Array {
  const documentId = fileName.replace(/\.zip$/i, "");
  const cdrXml = `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ResponseDate>2026-07-31</cbc:ResponseDate>
  <cbc:ResponseTime>10:00:00</cbc:ResponseTime>
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>${responseCode}</cbc:ResponseCode>
      <cbc:Description>${description}</cbc:Description>
    </cac:Response>
    <cac:DocumentReference>
      <cbc:ID>${documentId}</cbc:ID>
    </cac:DocumentReference>
  </cac:DocumentResponse>
</ApplicationResponse>`;
  return zipXmlFile(cdrXml, `R-${documentId}.xml`);
}

describe("Integración de componente: PeSunatAdapter contra un servidor SOAP local con el protocolo real de SUNAT", () => {
  let server: ReturnType<typeof Bun.serve>;
  let nextResponseCode = "0";
  let nextDescription = "La Factura ha sido aceptada";

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        const fileName = extractTagValue(body, "fileName");
        const cdrZip = buildMockCdrZip(fileName, nextResponseCode, nextDescription);
        const applicationResponseBase64 = Buffer.from(cdrZip).toString("base64");

        const soapResponse = `<?xml version="1.0" encoding="UTF-8"?>
<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">
  <soap-env:Body>
    <sendBillResponse xmlns="http://service.sunat.gob.pe">
      <applicationResponse>${applicationResponseBase64}</applicationResponse>
    </sendBillResponse>
  </soap-env:Body>
</soap-env:Envelope>`;

        return new Response(soapResponse, { headers: { "Content-Type": "text/xml;charset=UTF-8" } });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  function buildRequestAndTenant(): { request: InvoiceRequest; tenant: TenantConfig; cert: ReturnType<typeof generateTestCertificate> } {
    const cert = generateTestCertificate();
    const request: InvoiceRequest = {
      tenantId: "test-tenant",
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
          quantity: 1,
          unitCode: "NIU",
          unitPrice: 100,
          lineExtensionAmount: 100,
          taxCategory: "GRAVADO",
          taxPercent: 18,
          taxAmount: 18,
        },
      ],
      taxes: [{ scheme: "IGV", taxableAmount: 100, taxAmount: 18, currency: "PEN" }],
    };
    const tenant: TenantConfig = {
      tenantId: "test-tenant",
      country: "PE",
      submissionChannel: "SUNAT_DIRECT",
      issuer: { taxId: "20000000001", legalName: "EMPRESA SAC" },
      certificate: { publicCertificatePem: cert.publicCertPem, signerRef: "local-test" },
    };
    return { request, tenant, cert };
  }

  it("procesa una factura de punta a punta y devuelve ACCEPTED con el CDR real desempaquetado", async () => {
    nextResponseCode = "0";
    nextDescription = "La Factura numero F001-1, ha sido aceptada";

    const { request, tenant, cert } = buildRequestAndTenant();
    const signer = new LocalPemKeySigner(cert.privateKeyPem, cert.publicCertPem);
    const adapter = new PeSunatAdapter({
      endpointUrl: server.url.toString(),
      signer,
      credentials: { ruc: "20000000001", solUser: "MODDATOS", solPassword: "moddatos" },
    });

    const result = await emitInvoice(adapter, request, tenant);

    expect(result.status).toBe("ACCEPTED");
    expect(result.countryReferenceCode).toBe("0");
    expect(result.rawProviderResponse.description).toBe("La Factura numero F001-1, ha sido aceptada");
    expect(String(result.rawProviderResponse.cdrXml)).toContain("<cbc:ResponseCode>0</cbc:ResponseCode>");
  });

  it("mapea un ResponseCode distinto de 0 a REJECTED", async () => {
    nextResponseCode = "2800";
    nextDescription = "El comprobante fue rechazado por datos inconsistentes";

    const { request, tenant, cert } = buildRequestAndTenant();
    const signer = new LocalPemKeySigner(cert.privateKeyPem, cert.publicCertPem);
    const adapter = new PeSunatAdapter({
      endpointUrl: server.url.toString(),
      signer,
      credentials: { ruc: "20000000001", solUser: "MODDATOS", solPassword: "moddatos" },
    });

    const result = await emitInvoice(adapter, request, tenant);

    expect(result.status).toBe("REJECTED");
    expect(result.countryReferenceCode).toBe("2800");
  });
});
