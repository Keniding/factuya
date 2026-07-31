import { XMLParser } from "fast-xml-parser";
import type { InvoiceStatus } from "@factuya/shared-types";

/**
 * Parseo del CDR (ApplicationResponse UBL) que SUNAT devuelve tras sendBill.
 * Estructura verificada contra ejemplos documentados (ver docs/adapters/pe-sunat.md):
 * ApplicationResponse > cac:DocumentResponse > cac:Response > cbc:ResponseCode/cbc:Description.
 * Usa la skill .claude/skills/deps-fast-xml-parser.md (solo XMLParser, XMLBuilder está deprecado).
 */

export interface ParsedCdr {
  responseCode: string;
  description: string;
  status: InvoiceStatus;
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

export function parseCdr(cdrXml: string): ParsedCdr {
  const parsed = parser.parse(cdrXml);
  const response = parsed?.ApplicationResponse?.DocumentResponse?.Response;
  const responseCode = String(response?.ResponseCode ?? "");
  const description = String(response?.Description ?? "");

  // LIMITACIÓN CONOCIDA (no inventar el catálogo): SUNAT distingue "aceptado con observaciones"
  // (rangos de código específicos, catálogo 20) de "rechazado", pero no se pudo verificar el
  // rango exacto de códigos de observación contra la fuente oficial en este entorno (ver
  // docs/adapters/pe-sunat.md, sección de limitaciones). Por ahora solo se distingue
  // ACCEPTED (código "0") de REJECTED (cualquier otro código) — esto es una simplificación
  // deliberada y documentada, no una afirmación de que cubre todos los casos reales.
  const status: InvoiceStatus = responseCode === "0" ? "ACCEPTED" : "REJECTED";

  return { responseCode, description, status };
}
