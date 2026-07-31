/**
 * Contrato de firma que packages/signing expone al resto del monorepo.
 * Nunca expone la clave privada — solo la operación de firmar bytes ya calculados.
 * Ver docs/sdd/factuya-sdd.md §9.
 */
export interface Signer {
  /** Firma RSA-SHA256 (PKCS#1 v1.5) sobre los bytes dados. Devuelve la firma cruda. */
  sign(data: Uint8Array): Promise<Uint8Array>;
  getPublicCertificatePem(): string;
}
