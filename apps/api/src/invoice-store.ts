import type { InvoiceResult } from "@factuya/shared-types";

/**
 * Store en memoria del proceso — solo para que GET /v1/invoices/:id funcione en desarrollo local.
 * Se pierde en cada reinicio. Producción necesita DynamoDB (ver docs/sdd/factuya-sdd.md §11),
 * no implementado aquí (ver docs/flows.md, "qué falta").
 *
 * Ver ADR-0004: cada comprobante queda asociado al `tenantId` autenticado que lo creó —
 * `getInvoice` exige ese mismo `tenantId` para devolverlo, así un tenant nunca puede leer un
 * comprobante de otro solo por adivinar/enumerar el id.
 */
export interface StoredInvoice {
  id: string;
  tenantId: string;
  createdAt: string;
  result: InvoiceResult;
}

const store = new Map<string, StoredInvoice>();

export function saveInvoice(id: string, tenantId: string, result: InvoiceResult): StoredInvoice {
  const stored: StoredInvoice = { id, tenantId, createdAt: new Date().toISOString(), result };
  store.set(id, stored);
  return stored;
}

export function getInvoice(id: string, tenantId: string): StoredInvoice | undefined {
  const stored = store.get(id);
  return stored && stored.tenantId === tenantId ? stored : undefined;
}
