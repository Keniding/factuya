/**
 * Catálogos mínimos de SUNAT usados por el MVP (solo Factura tipo 01, IGV gravado 18%, PEN).
 * Fuente: Guía de Elaboración de Documentos XML Factura Electrónica UBL 2.1 (cpe.sunat.gob.pe) y
 * el ejemplo real generado por Greenter (ver docs/adapters/pe-sunat.md para las referencias).
 * Deliberadamente incompletos: NO se listan aquí catálogos de boleta/notas/exoneraciones que el
 * MVP no implementa todavía (ver docs/sdd/factuya-sdd.md §2, "fuera de alcance del MVP") — no
 * inventar entradas de catálogo que no se han verificado contra la guía correspondiente.
 */

/** Catálogo 01: Tipo de Documento — Factuya MVP solo emite Factura. */
export const INVOICE_TYPE_CODE_FACTURA = "01";
export const INVOICE_TYPE_CODE_LIST_ID = "0101";

/** Catálogo 06: Tipo de Documento de Identidad. */
export const PARTY_ID_SCHEME_RUC = "6";
export const PARTY_ID_SCHEME_DNI = "1";

/** Catálogo 07: Tipo de Afectación del IGV — MVP solo soporta gravado con IGV 18%. */
export const TAX_EXEMPTION_REASON_CODE_GRAVADO = "10";

/** Esquema tributario IGV, fijo para el MVP. */
export const IGV_TAX_SCHEME_ID = "1000";
export const IGV_TAX_SCHEME_NAME = "IGV";
export const IGV_TAX_TYPE_CODE = "VAT";

/** Unidad de medida por defecto (catálogo UN/ECE rec 20) cuando la línea no especifica otra. */
export const DEFAULT_UNIT_CODE = "NIU";

export const UBL_VERSION_ID = "2.1";
export const CUSTOMIZATION_ID = "2.0";
