import { createSign } from "node:crypto";
import type { Signer } from "./signer";

/**
 * Firma con una clave privada PEM local. SOLO para desarrollo/tests (ej. contra el ambiente
 * beta de SUNAT, que no exige certificado registrado — ver docs/adapters/pe-sunat.md).
 * En producción se usa un Signer respaldado por KMS/CloudHSM — ver docs/sdd/factuya-sdd.md §9.
 *
 * Usa `crypto.createSign("RSA-SHA256")`: es el mismo algoritmo que la implementación por defecto
 * de xml-crypto (RsaSha256, ver .claude/skills/deps-xml-crypto/04-kms-integration.md), verificado
 * contra su código fuente instalado, no asumido.
 */
export class LocalPemKeySigner implements Signer {
  constructor(
    private readonly privateKeyPem: string,
    private readonly publicCertPem: string,
  ) {}

  async sign(data: Uint8Array): Promise<Uint8Array> {
    const signer = createSign("RSA-SHA256");
    signer.update(data);
    signer.end();
    return new Uint8Array(signer.sign(this.privateKeyPem));
  }

  getPublicCertificatePem(): string {
    return this.publicCertPem;
  }
}
