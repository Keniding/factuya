import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Empaquetado ZIP exigido por SUNAT antes de sendBill — ver docs/sdd/factuya-sdd.md §8.4 y la
 * skill .claude/skills/deps-fflate.md.
 */
export function zipXmlFile(xmlContent: string, xmlFileName: string): Uint8Array {
  return zipSync({ [xmlFileName]: strToU8(xmlContent) }, { level: 6 });
}

/** Extrae el primer archivo .xml de un ZIP de CDR recibido de SUNAT. */
export function extractXmlFromZip(zipBytes: Uint8Array): string {
  const files = unzipSync(zipBytes);
  const entryName = Object.keys(files).find((name) => name.toUpperCase().endsWith(".XML"));
  if (!entryName) {
    throw new Error("El ZIP no contiene ningún archivo .xml");
  }
  const entry = files[entryName];
  if (!entry) {
    throw new Error(`No se pudo leer la entrada ${entryName} del ZIP`);
  }
  return strFromU8(entry);
}
