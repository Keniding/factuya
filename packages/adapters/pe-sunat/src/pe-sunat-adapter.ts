import type { CountryAdapter, BuiltDocument, SignedDocument, SubmissionResult } from "@factuya/core-domain";
import type { InvoiceRequest, InvoiceResult, TenantConfig } from "@factuya/shared-types";
import type { Signer } from "@factuya/signing";
import { signUblXml } from "@factuya/signing";
import { buildFacturaUbl } from "./ubl-invoice-builder";
import { zipXmlFile, extractXmlFromZip } from "./zip";
import { sendBill, type SunatSoapCredentials } from "./soap-client";
import { parseCdr } from "./cdr-parser";

const SIGNATURE_INSERTION_XPATH = "//*[local-name(.)='ExtensionContent']";

export interface PeSunatAdapterOptions {
  endpointUrl: string;
  signer: Signer;
  credentials: SunatSoapCredentials;
  /**
   * Resuelve serie+correlativo del comprobante. LIMITACIÓN CONOCIDA: en producción esto debe
   * ser un contador atómico por tenant en DynamoDB (ver docs/sdd/factuya-sdd.md §11) — no
   * implementado en este sandbox por no tener infraestructura AWS disponible. Por defecto usa
   * un contador en memoria del proceso, válido SOLO para desarrollo/tests, nunca para producción
   * (se reinicia en cada arranque y no es seguro ante concurrencia real).
   */
  resolveDocumentNumber?: (request: InvoiceRequest, tenant: TenantConfig) => { series: string; correlative: number };
}

let inMemoryCorrelative = 0;
function defaultResolveDocumentNumber(request: InvoiceRequest): { series: string; correlative: number } {
  inMemoryCorrelative += 1;
  return { series: request.series ?? "F001", correlative: inMemoryCorrelative };
}

export class PeSunatAdapter implements CountryAdapter {
  readonly countryCode = "PE";

  constructor(private readonly options: PeSunatAdapterOptions) {}

  async build(request: InvoiceRequest, tenant: TenantConfig): Promise<BuiltDocument> {
    if (request.documentType !== "INVOICE") {
      throw new Error(
        `PeSunatAdapter MVP solo soporta documentType "INVOICE" (Factura) — recibido "${request.documentType}". Notas de crédito/débito quedan fuera de este build (ver docs/sdd/factuya-sdd.md §2).`,
      );
    }

    const resolve = this.options.resolveDocumentNumber ?? defaultResolveDocumentNumber;
    const { series, correlative } = resolve(request, tenant);
    const documentId = `${series}-${correlative}`;
    const xmlFileName = `${tenant.issuer.taxId}-01-${series}-${correlative}.xml`;

    const content = buildFacturaUbl(request, tenant, documentId);
    return { content, fileName: xmlFileName };
  }

  async sign(document: BuiltDocument): Promise<SignedDocument> {
    const signedContent = await signUblXml(document.content, this.options.signer, {
      insertionXPath: SIGNATURE_INSERTION_XPATH,
    });
    return { content: signedContent, fileName: document.fileName };
  }

  async submit(document: SignedDocument): Promise<SubmissionResult> {
    const zipFileName = document.fileName.replace(/\.xml$/i, ".zip");
    const zipBytes = zipXmlFile(document.content, document.fileName);

    const { applicationResponseZip } = await sendBill(
      this.options.endpointUrl,
      zipFileName,
      zipBytes,
      this.options.credentials,
    );

    const cdrXml = extractXmlFromZip(applicationResponseZip);
    const cdr = parseCdr(cdrXml);

    const result: InvoiceResult = {
      status: cdr.status,
      countryDocumentId: document.fileName.replace(/\.xml$/i, ""),
      countryReferenceCode: cdr.responseCode,
      rawProviderResponse: { responseCode: cdr.responseCode, description: cdr.description, cdrXml },
    };
    return { kind: "SYNC", result };
  }

  async checkStatus(): Promise<InvoiceResult> {
    // MVP: PeSunatAdapter.submit() siempre es síncrono (sendBill) — checkStatus (getStatus con
    // ticket) es necesario para sendSummary/resúmenes, fuera de alcance del MVP (SDD §2).
    throw new Error("checkStatus no implementado — PeSunatAdapter MVP solo usa el flujo síncrono sendBill");
  }
}
