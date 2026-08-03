import { constants, createPrivateKey, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import {
  CreateKeyCommand,
  GetParametersForImportCommand,
  ImportKeyMaterialCommand,
  type KMSClient,
} from "@aws-sdk/client-kms";
import { aesKeyWrapWithPadding } from "./aes-kwp";

/**
 * Ver ADR-0005 (una CMK por tenant) y ADR-0006 (cómo llega la clave privada real del tenant a
 * esa CMK). El tenant trae su propio certificado/clave (ya registrados ante SUNAT por su cuenta)
 * — Factuya no genera una identidad nueva, custodia la que el tenant ya tiene.
 *
 * PENDIENTE DE VERIFICACIÓN EN VIVO al momento de escribir este archivo — ver
 * docs/aws/kms-live-verification.md para el patrón de verificación real ya usado con KmsSigner/
 * kms-grants, que se debe repetir aquí antes de dar este flujo por validado en producción.
 */

export interface ImportedTenantKey {
  keyId: string;
}

/**
 * Crea una CMK asimétrica dedicada (`RSA_2048`, `SIGN_VERIFY`, `Origin: EXTERNAL`) e importa en
 * ella la clave privada real del tenant, siguiendo el procedimiento oficial de AWS para
 * `RSA_AES_KEY_WRAP_SHA_256` (ver ADR-0006 para las fuentes exactas):
 *
 *   1. `GetParametersForImport` — obtiene la llave pública de wrapping y el import token de KMS.
 *   2. Generar una KEK AES-256 efímera, envolver la clave privada del tenant con ella
 *      (`aesKeyWrapWithPadding`, RFC 5649).
 *   3. Envolver la KEK efímera con la llave pública de wrapping usando RSA-OAEP-SHA-256.
 *   4. Concatenar `RSA-OAEP(KEK) || AES-KWP(clave privada)` (ese orden exacto) e importar con
 *      `ImportKeyMaterial`.
 */
export async function createTenantSigningKey(
  client: KMSClient,
  tenantPrivateKeyPem: string,
  description: string,
): Promise<ImportedTenantKey> {
  const createKeyResponse = await client.send(
    new CreateKeyCommand({
      KeySpec: "RSA_2048",
      KeyUsage: "SIGN_VERIFY",
      Origin: "EXTERNAL",
      Description: description,
    }),
  );
  const keyId = createKeyResponse.KeyMetadata?.KeyId;
  if (!keyId) throw new Error("CreateKey (Origin EXTERNAL) no devolvió KeyId");

  const params = await client.send(
    new GetParametersForImportCommand({
      KeyId: keyId,
      WrappingAlgorithm: "RSA_AES_KEY_WRAP_SHA_256",
      WrappingKeySpec: "RSA_2048",
    }),
  );
  if (!params.ImportToken || !params.PublicKey) {
    throw new Error(`GetParametersForImport no devolvió ImportToken/PublicKey para ${keyId}`);
  }

  const tenantPrivateKeyDer = createPrivateKey(tenantPrivateKeyPem).export({
    type: "pkcs8",
    format: "der",
  }) as Buffer;

  const ephemeralAesKek = randomBytes(32);
  const wrappedPrivateKey = aesKeyWrapWithPadding(ephemeralAesKek, tenantPrivateKeyDer);

  const wrappingPublicKey = createPublicKey({
    key: Buffer.from(params.PublicKey),
    format: "der",
    type: "spki",
  });
  const wrappedKek = publicEncrypt(
    {
      key: wrappingPublicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    ephemeralAesKek,
  );

  const encryptedKeyMaterial = Buffer.concat([wrappedKek, wrappedPrivateKey]);

  await client.send(
    new ImportKeyMaterialCommand({
      KeyId: keyId,
      ImportToken: params.ImportToken,
      EncryptedKeyMaterial: encryptedKeyMaterial,
      ExpirationModel: "KEY_MATERIAL_DOES_NOT_EXPIRE",
    }),
  );

  return { keyId };
}
