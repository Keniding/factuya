/**
 * Modelo de dominio agnóstico de Factuya — ver docs/sdd/factuya-sdd.md §6 y §13.
 * Ningún tipo aquí conoce SOAP, UBL, ni reglas específicas de un país.
 */

export type DocumentType = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";

export type SubmissionChannel = "SUNAT_DIRECT" | "OSE_PROVIDER";

export interface PartyRef {
  /** Identificador tributario del emisor (RUC en Perú, NIT en Colombia, etc.) */
  taxId: string;
  legalName: string;
  tradeName?: string;
  address?: PartyAddress;
}

export interface PartyAddress {
  line?: string;
  district?: string;
  province?: string;
  department?: string;
  countryCode: string; // ISO 3166-1 alpha-2, ej. "PE"
  ubigeo?: string; // código de ubicación geográfica (Perú, opcional)
}

export interface Party {
  taxIdType?: string; // ej. "6" = RUC en el catálogo SUNAT 6, "1" = DNI
  taxId: string;
  legalName: string;
  address?: PartyAddress;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitCode: string; // catálogo de unidad de medida (ej. "NIU" = unidad)
  unitPrice: number; // precio unitario sin impuesto
  lineExtensionAmount: number; // quantity * unitPrice, sin impuesto
  taxCategory: "GRAVADO" | "EXONERADO" | "INAFECTO" | "GRATUITO";
  taxPercent: number; // ej. 18 para IGV 18%
  taxAmount: number;
  sellerItemId?: string;
}

export interface TaxSummary {
  /** Código de esquema tributario agnóstico; el adaptador lo traduce a IGV/IVA/etc. */
  scheme: "IGV" | "IVA" | "ICBPER" | "OTHER";
  taxableAmount: number;
  taxAmount: number;
  currency: string; // ISO 4217
}

export interface InvoiceRequest {
  tenantId: string;
  documentType: DocumentType;
  series?: string;
  issueDate: string; // YYYY-MM-DD
  issueTime?: string; // HH:mm:ss
  currency: string; // ISO 4217
  issuer: PartyRef;
  customer: Party;
  lines: InvoiceLine[];
  taxes: TaxSummary[];
  legalNotes?: string[];
  /** Monto total en letras — algunos países (Perú) lo exigen literal en el XML. */
  amountInWords?: string;
}

export type InvoiceStatus = "ACCEPTED" | "REJECTED" | "OBSERVED" | "PENDING";

export interface InvoiceResult {
  status: InvoiceStatus;
  countryDocumentId: string;
  countryReferenceCode?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  cdrUrl?: string;
  rawProviderResponse: Record<string, unknown>;
}

export interface TenantCertificate {
  /** Referencia al material de firma — nunca la clave privada en texto plano. Ver docs/sdd/factuya-sdd.md §9. */
  publicCertificatePem: string;
  /** Identificador de la clave en KMS/CloudHSM (producción) o ruta local (solo dev/test). */
  signerRef: string;
}

export interface TenantConfig {
  tenantId: string;
  country: "PE" | "CO";
  submissionChannel: SubmissionChannel;
  issuer: PartyRef;
  certificate: TenantCertificate;
  /** Solo si submissionChannel === "OSE_PROVIDER" */
  oseProvider?: {
    name: string;
    endpointUrl: string;
  };
  /** Credenciales del usuario secundario de Clave SOL — nunca la clave SOL maestra (ver SDD §8). */
  solCredentials?: {
    ruc: string;
    solUser: string;
    /** Referencia al secreto en Secrets Manager, no el valor en texto plano. */
    solPasswordRef: string;
  };
}
