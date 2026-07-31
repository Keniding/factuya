import type { Signer } from "./signer";

/**
 * Firma delegando en AWS KMS — la clave privada del tenant nunca sale de KMS/CloudHSM
 * (docs/sdd/factuya-sdd.md §9). Es el Signer de producción.
 *
 * NO IMPLEMENTADO TODAVÍA: este monorepo se desarrolló en un sandbox sin credenciales ni acceso
 * de red a AWS, por lo que el algoritmo exacto de KMS (`SigningAlgorithm`, `MessageType`) no pudo
 * verificarse contra el servicio real — solo contra documentación de terceros (ver
 * .claude/skills/deps-xml-crypto/04-kms-integration.md, sección "Pendiente explícito"). Implementar
 * esta clase requiere:
 *   1. Correr dependency-skill-agent sobre @aws-sdk/client-kms (instalar de verdad, leer tipos).
 *   2. Confirmar el nombre de `SigningAlgorithm` (candidato: "RSASSA_PKCS1_V1_5_SHA_256") contra
 *      la documentación vigente de la API de KMS al momento de implementar, no reusar el nombre
 *      de este comentario sin verificar.
 *   3. Probar contra una clave KMS real (no simulable sin cuenta de AWS).
 */
export class KmsSigner implements Signer {
  constructor(
    private readonly kmsKeyId: string,
    private readonly publicCertPem: string,
  ) {}

  async sign(_data: Uint8Array): Promise<Uint8Array> {
    throw new Error(
      `KmsSigner.sign() no implementado — ver comentario de clase. keyId solicitado: ${this.kmsKeyId}`,
    );
  }

  getPublicCertificatePem(): string {
    return this.publicCertPem;
  }
}
