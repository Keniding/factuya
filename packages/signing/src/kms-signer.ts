import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import type { Signer } from "./signer";

/**
 * Firma delegando en AWS KMS — la clave privada del tenant nunca sale de KMS (docs/sdd/factuya-sdd.md
 * §9). Es el Signer de producción.
 *
 * Diseño verificado contra ADR-0003 y `.claude/skills/deps-aws-sdk-client-kms.md`: una única CMK
 * asimétrica **compartida** por ambiente (no una CMK por tenant — ver ADR-0003 para el porqué de
 * costo), con el aislamiento por tenant resuelto vía un Grant `Sign`-only (`kms-grants.ts`). El
 * `grantToken` de ese Grant, si existe, se adjunta a cada llamada `Sign` — sin él, la autorización
 * depende de la política de la propia CMK/IAM del rol que ejecuta el proceso.
 *
 * `RSASSA_PKCS1_V1_5_SHA_256` + `MessageType: "RAW"` están confirmados contra los tipos reales
 * instalados de `@aws-sdk/client-kms` (no asumidos) — mismo algoritmo y formato de salida que
 * `LocalPemKeySigner` (`createSign("RSA-SHA256")` de Node), por lo que `KmsSigner` es intercambiable
 * con `LocalPemKeySigner` sin tocar `xml-dsig-signer.ts`.
 *
 * PENDIENTE DE VERIFICACIÓN EN VIVO: implementado contra la documentación/tipos oficiales de KMS,
 * no contra una cuenta de AWS real (no disponible en este entorno de desarrollo) — ver el ledger
 * de dependencias y la sección correspondiente del skill antes de darlo por validado como el
 * adaptador SUNAT (que sí corrió contra el servicio real).
 */

export interface KmsSignerOptions {
  client: KMSClient;
  /** ARN o key ID de la CMK asimétrica compartida (ver ADR-0003) — nunca una CMK por tenant. */
  keyId: string;
  /** Certificado público del tenant en PEM — provisto por el tenant, no generado por KMS (KMS solo custodia la clave privada). */
  publicCertPem: string;
  /**
   * Grant token del tenant (ver `kms-grants.ts::createTenantGrant`). Opcional solo para permitir
   * probar contra una CMK sin Grants todavía (ej. autorizada solo por política/IAM del rol) —
   * en producción multi-tenant siempre debe proveerse.
   */
  grantToken?: string;
}

export class KmsSigner implements Signer {
  private readonly client: KMSClient;
  private readonly keyId: string;
  private readonly publicCertPem: string;
  private readonly grantToken: string | undefined;

  constructor(options: KmsSignerOptions) {
    this.client = options.client;
    this.keyId = options.keyId;
    this.publicCertPem = options.publicCertPem;
    this.grantToken = options.grantToken;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    const response = await this.client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: data,
        MessageType: "RAW",
        SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
        GrantTokens: this.grantToken ? [this.grantToken] : undefined,
      }),
    );

    if (!response.Signature) {
      throw new Error(`KMS Sign no devolvió Signature para KeyId ${this.keyId} (respuesta vacía)`);
    }
    return response.Signature;
  }

  getPublicCertificatePem(): string {
    return this.publicCertPem;
  }
}
