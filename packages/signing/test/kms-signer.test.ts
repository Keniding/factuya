import { describe, expect, it } from "bun:test";
import { SignCommand, type KMSClient } from "@aws-sdk/client-kms";
import { KmsSigner } from "../src/kms-signer";

/**
 * Sin cuenta de AWS real disponible en este entorno (ver docs/dependencies/LEDGER.md y
 * .claude/skills/deps-aws-sdk-client-kms.md), estos tests verifican que KmsSigner arma el
 * SignCommand correcto y procesa la respuesta correctamente — NO que KMS real firme como se
 * espera. Un fake mínimo de KMSClient es suficiente para eso; no reemplaza una corrida real.
 */
function fakeKmsClient(handler: (command: unknown) => unknown): KMSClient {
  return { send: async (command: unknown) => handler(command) } as unknown as KMSClient;
}

describe("KmsSigner", () => {
  it("arma el SignCommand con RSASSA_PKCS1_V1_5_SHA_256, MessageType RAW, y el GrantToken del tenant", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const client = fakeKmsClient((command) => {
      expect(command).toBeInstanceOf(SignCommand);
      capturedInput = (command as SignCommand).input as Record<string, unknown>;
      return { Signature: new Uint8Array([9, 9, 9]) };
    });

    const signer = new KmsSigner({
      client,
      keyId: "arn:aws:kms:us-east-1:111122223333:key/test-key",
      publicCertPem: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
      grantToken: "test-grant-token",
    });

    const message = new TextEncoder().encode("<SignedInfo>test</SignedInfo>");
    const signature = await signer.sign(message);

    expect(signature).toEqual(new Uint8Array([9, 9, 9]));
    expect(capturedInput?.KeyId).toBe("arn:aws:kms:us-east-1:111122223333:key/test-key");
    expect(capturedInput?.Message).toEqual(message);
    expect(capturedInput?.MessageType).toBe("RAW");
    expect(capturedInput?.SigningAlgorithm).toBe("RSASSA_PKCS1_V1_5_SHA_256");
    expect(capturedInput?.GrantTokens).toEqual(["test-grant-token"]);
  });

  it("omite GrantTokens si no se provee un grantToken", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const client = fakeKmsClient((command) => {
      capturedInput = (command as SignCommand).input as Record<string, unknown>;
      return { Signature: new Uint8Array([1]) };
    });

    const signer = new KmsSigner({ client, keyId: "key-id", publicCertPem: "cert" });
    await signer.sign(new Uint8Array([0]));

    expect(capturedInput?.GrantTokens).toBeUndefined();
  });

  it("lanza un error claro si KMS no devuelve Signature", async () => {
    const client = fakeKmsClient(() => ({}));
    const signer = new KmsSigner({ client, keyId: "key-id", publicCertPem: "cert" });

    await expect(signer.sign(new Uint8Array([0]))).rejects.toThrow(/no devolvió Signature/);
  });

  it("devuelve el certificado público sin llamar a KMS", () => {
    const client = fakeKmsClient(() => {
      throw new Error("no debería llamarse");
    });
    const signer = new KmsSigner({ client, keyId: "key-id", publicCertPem: "el-cert-pem" });

    expect(signer.getPublicCertificatePem()).toBe("el-cert-pem");
  });
});
