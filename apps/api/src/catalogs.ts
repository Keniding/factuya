import { catalogs } from "@factuya/adapter-pe-sunat";

export interface CatalogEntry {
  code: string;
  name: string;
}

/**
 * Solo los valores que el MVP realmente soporta (ver packages/adapters/pe-sunat/src/catalogs.ts).
 * NO es el catálogo oficial completo de SUNAT — esa fuente tiene muchas más entradas (ej. todos
 * los tipos de comprobante, todas las afectaciones de IGV) que este MVP no implementa todavía.
 * Documentado así a propósito en vez de inventar entradas no verificadas — ver
 * docs/policies/documentation.md §5.
 */
export const PE_CATALOGS: Record<string, CatalogEntry[]> = {
  "document-types": [{ code: catalogs.INVOICE_TYPE_CODE_FACTURA, name: "Factura" }],
  "identity-document-types": [
    { code: catalogs.PARTY_ID_SCHEME_RUC, name: "RUC" },
    { code: catalogs.PARTY_ID_SCHEME_DNI, name: "DNI" },
  ],
  "tax-affectation": [{ code: catalogs.TAX_EXEMPTION_REASON_CODE_GRAVADO, name: "Gravado - Operación Onerosa" }],
};
