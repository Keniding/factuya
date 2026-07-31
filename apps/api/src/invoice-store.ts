import type { InvoiceResult } from "@factuya/shared-types";

/**
 * Store en memoria del proceso — solo para que GET /v1/invoices/:id funcione en desarrollo local.
 * Se pierde en cada reinicio. Producción necesita DynamoDB (ver docs/sdd/factuya-sdd.md §11),
 * no implementado aquí (ver docs/flows.md, "qué falta").
 */
export interface StoredInvoice {
  id: string;
  createdAt: string;
  result: InvoiceResult;
}

const store = new Map<string, StoredInvoice>();

export function saveInvoice(id: string, result: InvoiceResult): StoredInvoice {
  const stored: StoredInvoice = { id, createdAt: new Date().toISOString(), result };
  store.set(id, stored);
  return stored;
}

export function getInvoice(id: string): StoredInvoice | undefined {
  return store.get(id);
}
