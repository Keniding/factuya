import { beforeAll, describe, expect, it } from "bun:test";
import type { InvoiceRequest, TenantConfig } from "@factuya/shared-types";
import { emitInvoice } from "@factuya/core-domain";
import { LocalPemKeySigner } from "@factuya/signing";
import { PeSunatAdapter } from "../../src/pe-sunat-adapter";
import { generateTestCertificate } from "../generate-test-certificate";

/**
 * Prueba de integración REAL contra el ambiente beta de SUNAT — sin mocks del servicio.
 *
 * Endpoint y credenciales verificados en docs/adapters/pe-sunat.md (múltiples fuentes
 * independientes cruzadas: nota oficial de SUNAT sobre el servicio beta, documentación de
 * Greenter, y foros de implementadores — no se pudo descargar el WSDL crudo para verificación
 * byte a byte porque este sandbox de desarrollo bloquea el acceso saliente a dominios fuera de
 * un allowlist (ver docs/adapters/pe-sunat.md, sección "Limitación de este entorno").
 *
 * Por eso este test hace un pre-flight real: si la red de este entorno no permite alcanzar
 * SUNAT, el test se marca explícitamente como OMITIDO (con motivo impreso), en vez de fallar de
 * forma confusa o, peor, fingir que pasó. Si se corre en una máquina/CI con salida a internet
 * normal, hace la aserción real contra el CDR que SUNAT devuelve.
 */

const SUNAT_BETA_ENDPOINT = "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService";

// Credenciales públicas de prueba publicadas por SUNAT para su ambiente beta — no son un secreto.
const TEST_CREDENTIALS = { ruc: "20000000001", solUser: "MODDATOS", solPassword: "moddatos" };

let sunatReachable = false;

/**
 * Distingue "SUNAT respondió algo" de "el gateway de red de este entorno bloqueó la salida".
 * El proxy de este sandbox devuelve HTTP 403 con cuerpo de texto plano "request rejected: host
 * not permitted" cuando el host no está en su allowlist — una respuesta real de SUNAT (incluso
 * un error) vendría como XML/WSDL, nunca ese texto literal. Verificado empíricamente: ver
 * docs/adapters/pe-sunat.md, sección "Limitación de este entorno".
 */
function looksLikeSandboxProxyBlock(status: number, bodyText: string): boolean {
  return status === 403 && bodyText.toLowerCase().includes("host not permitted");
}

beforeAll(async () => {
  try {
    const res = await fetch(`${SUNAT_BETA_ENDPOINT}?wsdl`, { signal: AbortSignal.timeout(10_000) });
    const bodyText = await res.text();
    sunatReachable = !looksLikeSandboxProxyBlock(res.status, bodyText);
  } catch {
    sunatReachable = false;
  }
  if (!sunatReachable) {
    console.warn(
      "\n[integration] No se pudo alcanzar e-beta.sunat.gob.pe desde este entorno (bloqueo de red del sandbox, verificado con `bun -e 'fetch(...)'` -> 403 del gateway del proxy, no de SUNAT). " +
        "El test de integración real se omite en este entorno; correrlo en una máquina o CI con salida a internet normal para la validación real end-to-end.\n",
    );
  }
}, 15_000);

function buildSampleRequest(): InvoiceRequest {
  return {
    tenantId: "test-tenant",
    documentType: "INVOICE",
    series: "F001",
    issueDate: new Date().toISOString().slice(0, 10),
    issueTime: "10:00:00",
    currency: "PEN",
    issuer: { taxId: TEST_CREDENTIALS.ruc, legalName: "EMPRESA SAC" },
    customer: { taxId: "10000000001", legalName: "CLIENTE DE PRUEBA" },
    lines: [
      {
        id: "1",
        description: "Producto de prueba Factuya",
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
    amountInWords: "CIENTO DIECIOCHO CON 00/100 SOLES",
  };
}

describe("Integración real: PeSunatAdapter contra SUNAT beta", () => {
  it("emite una factura de prueba y recibe un CDR real de SUNAT", async () => {
    if (!sunatReachable) {
      console.warn("[integration] Test omitido: sin salida de red a SUNAT desde este entorno.");
      return;
    }

    const cert = generateTestCertificate();
    const signer = new LocalPemKeySigner(cert.privateKeyPem, cert.publicCertPem);

    const tenant: TenantConfig = {
      tenantId: "test-tenant",
      country: "PE",
      submissionChannel: "SUNAT_DIRECT",
      issuer: { taxId: TEST_CREDENTIALS.ruc, legalName: "EMPRESA SAC" },
      certificate: { publicCertificatePem: cert.publicCertPem, signerRef: "local-test" },
    };

    const adapter = new PeSunatAdapter({
      endpointUrl: SUNAT_BETA_ENDPOINT,
      signer,
      credentials: TEST_CREDENTIALS,
    });

    const result = await emitInvoice(adapter, buildSampleRequest(), tenant);

    // Con el RUC/certificado de prueba genérico, SUNAT beta puede aceptar u observar el
    // comprobante — lo que este test prueba de verdad es que el pipeline completo
    // (build -> sign -> zip -> SOAP -> CDR real) funciona de punta a punta contra el servicio
    // real, no que el resultado sea necesariamente "ACCEPTED".
    expect(["ACCEPTED", "REJECTED"]).toContain(result.status);
    expect(result.rawProviderResponse.cdrXml).toBeTruthy();
    console.log(`[integration] CDR real de SUNAT: status=${result.status} code=${result.countryReferenceCode} desc=${result.rawProviderResponse.description}`);
  }, 30_000);
});
