import type { InvoiceRequest, InvoiceResult, TenantConfig } from "@factuya/shared-types";

/**
 * Documento construido por un adaptador de país, antes de firmar.
 * `content` es el XML (u otro formato del país) como string UTF-8.
 */
export interface BuiltDocument {
  content: string;
  fileName: string;
}

/** Documento ya firmado, listo para enviar al canal del tenant. */
export interface SignedDocument {
  content: string;
  fileName: string;
}

export type SubmissionResult =
  | { kind: "SYNC"; result: InvoiceResult }
  | { kind: "ASYNC"; ticket: string };

/**
 * Puerto que todo adaptador de país debe implementar — ver docs/sdd/factuya-sdd.md §4.
 * El core-domain solo conoce esta interfaz; nunca SOAP, UBL, ni reglas de un país específico.
 */
export interface CountryAdapter {
  readonly countryCode: string;

  build(request: InvoiceRequest, tenant: TenantConfig): Promise<BuiltDocument>;

  sign(document: BuiltDocument, tenant: TenantConfig): Promise<SignedDocument>;

  submit(document: SignedDocument, tenant: TenantConfig): Promise<SubmissionResult>;

  /** Solo relevante para el flujo asíncrono (SubmissionResult.kind === "ASYNC"). */
  checkStatus(ticket: string, tenant: TenantConfig): Promise<InvoiceResult>;
}
