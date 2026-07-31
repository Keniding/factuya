import type { InvoiceLine, InvoiceRequest, Party, PartyAddress, PartyRef, TaxSummary } from "@factuya/shared-types";

/**
 * Validación mínima en el límite del sistema (la API pública) — ver instrucciones generales del
 * repo: "solo validar en las fronteras del sistema". No usa una librería de schema (ver
 * docs/dependencies/LEDGER.md: no se investigó ninguna para este MVP) — el contrato es pequeño y
 * estable, y cada chequeo es rastreable a un campo real de shared-types.
 */
export class BadRequestError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new BadRequestError(`Cuerpo de la solicitud inválido`, [`${field} es requerido y debe ser un objeto`]);
  }
  return value as Record<string, unknown>;
}

/**
 * tsconfig.base.json fija `exactOptionalPropertyTypes: true` — un campo opcional no puede recibir
 * `undefined` explícito, la clave debe omitirse por completo. Esta función limpia esas claves
 * antes de devolver el objeto tipado. `T` se pasa explícito en cada llamada (no se infiere del
 * argumento) para que el chequeo estructural de `exactOptionalPropertyTypes` no se aplique sobre
 * el objeto "sucio" de entrada, que sí puede tener claves en `undefined` antes de limpiarlas.
 */
function stripUndefined<T>(obj: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

function parseAddress(value: unknown): PartyAddress | undefined {
  if (value === undefined) return undefined;
  const v = asRecord(value, "address");
  if (!isNonEmptyString(v.countryCode)) {
    throw new BadRequestError("address inválida", ["address.countryCode es requerido si se provee address"]);
  }
  return stripUndefined<PartyAddress>({
    countryCode: v.countryCode,
    line: typeof v.line === "string" ? v.line : undefined,
    district: typeof v.district === "string" ? v.district : undefined,
    province: typeof v.province === "string" ? v.province : undefined,
    department: typeof v.department === "string" ? v.department : undefined,
    ubigeo: typeof v.ubigeo === "string" ? v.ubigeo : undefined,
  });
}

function parsePartyRef(value: unknown, field: string): PartyRef {
  const v = asRecord(value, field);
  if (!isNonEmptyString(v.taxId)) throw new BadRequestError("issuer inválido", [`${field}.taxId es requerido`]);
  if (!isNonEmptyString(v.legalName)) throw new BadRequestError("issuer inválido", [`${field}.legalName es requerido`]);
  return stripUndefined<PartyRef>({
    taxId: v.taxId,
    legalName: v.legalName,
    tradeName: typeof v.tradeName === "string" ? v.tradeName : undefined,
    address: parseAddress(v.address),
  });
}

function parseParty(value: unknown, field: string): Party {
  const v = asRecord(value, field);
  if (!isNonEmptyString(v.taxId)) throw new BadRequestError("customer inválido", [`${field}.taxId es requerido`]);
  if (!isNonEmptyString(v.legalName)) throw new BadRequestError("customer inválido", [`${field}.legalName es requerido`]);
  return stripUndefined<Party>({
    taxId: v.taxId,
    legalName: v.legalName,
    taxIdType: typeof v.taxIdType === "string" ? v.taxIdType : undefined,
    address: parseAddress(v.address),
  });
}

const VALID_TAX_CATEGORIES = new Set(["GRAVADO", "EXONERADO", "INAFECTO", "GRATUITO"]);

function parseLine(value: unknown, index: number): InvoiceLine {
  const v = asRecord(value, `lines[${index}]`);
  const errors: string[] = [];
  if (!isNonEmptyString(v.id)) errors.push(`lines[${index}].id es requerido`);
  if (!isNonEmptyString(v.description)) errors.push(`lines[${index}].description es requerido`);
  if (!isFiniteNumber(v.quantity)) errors.push(`lines[${index}].quantity debe ser un número`);
  if (!isFiniteNumber(v.unitPrice)) errors.push(`lines[${index}].unitPrice debe ser un número`);
  if (!isFiniteNumber(v.lineExtensionAmount)) errors.push(`lines[${index}].lineExtensionAmount debe ser un número`);
  if (typeof v.taxCategory !== "string" || !VALID_TAX_CATEGORIES.has(v.taxCategory)) {
    errors.push(`lines[${index}].taxCategory debe ser uno de: ${[...VALID_TAX_CATEGORIES].join(", ")}`);
  }
  if (!isFiniteNumber(v.taxPercent)) errors.push(`lines[${index}].taxPercent debe ser un número`);
  if (!isFiniteNumber(v.taxAmount)) errors.push(`lines[${index}].taxAmount debe ser un número`);
  if (errors.length > 0) throw new BadRequestError("línea de factura inválida", errors);

  return stripUndefined<InvoiceLine>({
    id: v.id as string,
    description: v.description as string,
    quantity: v.quantity as number,
    unitCode: isNonEmptyString(v.unitCode) ? v.unitCode : "NIU",
    unitPrice: v.unitPrice as number,
    lineExtensionAmount: v.lineExtensionAmount as number,
    taxCategory: v.taxCategory as InvoiceLine["taxCategory"],
    taxPercent: v.taxPercent as number,
    taxAmount: v.taxAmount as number,
    sellerItemId: typeof v.sellerItemId === "string" ? v.sellerItemId : undefined,
  });
}

const VALID_TAX_SCHEMES = new Set(["IGV", "IVA", "ICBPER", "OTHER"]);

function parseTax(value: unknown, index: number): TaxSummary {
  const v = asRecord(value, `taxes[${index}]`);
  const errors: string[] = [];
  if (typeof v.scheme !== "string" || !VALID_TAX_SCHEMES.has(v.scheme)) {
    errors.push(`taxes[${index}].scheme debe ser uno de: ${[...VALID_TAX_SCHEMES].join(", ")}`);
  }
  if (!isFiniteNumber(v.taxableAmount)) errors.push(`taxes[${index}].taxableAmount debe ser un número`);
  if (!isFiniteNumber(v.taxAmount)) errors.push(`taxes[${index}].taxAmount debe ser un número`);
  if (!isNonEmptyString(v.currency)) errors.push(`taxes[${index}].currency es requerido`);
  if (errors.length > 0) throw new BadRequestError("resumen de impuesto inválido", errors);

  return {
    scheme: v.scheme as TaxSummary["scheme"],
    taxableAmount: v.taxableAmount as number,
    taxAmount: v.taxAmount as number,
    currency: v.currency as string,
  };
}

/**
 * Parsea y valida el body de POST /v1/invoices contra InvoiceRequest. Solo INVOICE está
 * soportado en este MVP (ver PeSunatAdapter.build) — se valida aquí para devolver un 400 claro
 * en vez de dejar que el error aparezca más adentro del pipeline como un 502.
 */
export function parseInvoiceRequest(body: unknown): InvoiceRequest {
  const v = asRecord(body, "body");

  if (v.documentType !== "INVOICE") {
    throw new BadRequestError("documentType no soportado", [
      `documentType debe ser "INVOICE" — este MVP no soporta CREDIT_NOTE/DEBIT_NOTE todavía (ver docs/adapters/pe-sunat.md)`,
    ]);
  }
  if (!isNonEmptyString(v.issueDate)) {
    throw new BadRequestError("issueDate es requerido", ["issueDate debe ser una fecha YYYY-MM-DD"]);
  }
  if (!isNonEmptyString(v.currency)) {
    throw new BadRequestError("currency es requerido", ["currency debe ser un código ISO 4217, ej. PEN"]);
  }
  if (!Array.isArray(v.lines) || v.lines.length === 0) {
    throw new BadRequestError("lines es requerido", ["lines debe ser un array con al menos un elemento"]);
  }
  if (!Array.isArray(v.taxes) || v.taxes.length === 0) {
    throw new BadRequestError("taxes es requerido", ["taxes debe ser un array con al menos un elemento"]);
  }
  if (v.paymentMeans !== undefined && v.paymentMeans !== "CASH" && v.paymentMeans !== "CREDIT") {
    throw new BadRequestError("paymentMeans inválido", [`paymentMeans debe ser "CASH" o "CREDIT" si se provee`]);
  }

  return stripUndefined<InvoiceRequest>({
    tenantId: isNonEmptyString(v.tenantId) ? v.tenantId : "dev-tenant",
    documentType: "INVOICE",
    series: typeof v.series === "string" ? v.series : undefined,
    issueDate: v.issueDate,
    issueTime: typeof v.issueTime === "string" ? v.issueTime : undefined,
    currency: v.currency,
    issuer: parsePartyRef(v.issuer, "issuer"),
    customer: parseParty(v.customer, "customer"),
    lines: v.lines.map((line, index) => parseLine(line, index)),
    taxes: v.taxes.map((tax, index) => parseTax(tax, index)),
    legalNotes: Array.isArray(v.legalNotes) ? v.legalNotes.filter((n): n is string => typeof n === "string") : undefined,
    amountInWords: typeof v.amountInWords === "string" ? v.amountInWords : undefined,
    paymentMeans: v.paymentMeans as "CASH" | "CREDIT" | undefined,
  });
}
