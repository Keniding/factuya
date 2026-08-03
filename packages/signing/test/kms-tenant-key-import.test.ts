import { privateDecrypt, generateKeyPairSync, constants as cryptoConstants } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  CreateKeyCommand,
  GetParametersForImportCommand,
  ImportKeyMaterialCommand,
  type KMSClient,
} from "@aws-sdk/client-kms";
import { createTenantSigningKey } from "../src/kms-tenant-key-import";
import { aesKeyUnwrapWithPadding } from "../src/aes-kwp";

/** Ver docs/dependencies/LEDGER.md — fake de KMSClient, no una corrida real contra AWS. */
function fakeKmsClient(handler: (command: unknown) => unknown): KMSClient {
  return { send: async (command: unknown) => handler(command) } as unknown as KMSClient;
}

describe("createTenantSigningKey", () => {
  it("crea la CMK con Origin EXTERNAL, pide los parámetros de import correctos, y el material importado desenvuelve exactamente a la clave privada original", async () => {
    // Llave de wrapping "de KMS" real (generada localmente solo para este test — simula lo que
    // GetParametersForImport devolvería).
    const wrappingKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const wrappingPublicKeyDer = wrappingKeyPair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const importToken = Buffer.from("fake-import-token");

    const tenantKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const tenantPrivateKeyPem = tenantKeyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const tenantPrivateKeyDer = tenantKeyPair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;

    const calls: unknown[] = [];
    let capturedEncryptedKeyMaterial: Buffer | undefined;

    const client = fakeKmsClient((command) => {
      calls.push(command);
      if (command instanceof CreateKeyCommand) {
        expect(command.input.KeySpec).toBe("RSA_2048");
        expect(command.input.KeyUsage).toBe("SIGN_VERIFY");
        expect(command.input.Origin).toBe("EXTERNAL");
        return { KeyMetadata: { KeyId: "fake-key-id" } };
      }
      if (command instanceof GetParametersForImportCommand) {
        expect(command.input.KeyId).toBe("fake-key-id");
        expect(command.input.WrappingAlgorithm).toBe("RSA_AES_KEY_WRAP_SHA_256");
        expect(command.input.WrappingKeySpec).toBe("RSA_2048");
        return { ImportToken: importToken, PublicKey: wrappingPublicKeyDer };
      }
      if (command instanceof ImportKeyMaterialCommand) {
        expect(command.input.KeyId).toBe("fake-key-id");
        expect(Buffer.from(command.input.ImportToken as Uint8Array).equals(importToken)).toBe(true);
        capturedEncryptedKeyMaterial = Buffer.from(command.input.EncryptedKeyMaterial as Uint8Array);
        return {};
      }
      throw new Error(`comando inesperado: ${String(command)}`);
    });

    const result = await createTenantSigningKey(client, tenantPrivateKeyPem, "tenant de prueba");
    expect(result.keyId).toBe("fake-key-id");
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBeInstanceOf(CreateKeyCommand);
    expect(calls[1]).toBeInstanceOf(GetParametersForImportCommand);
    expect(calls[2]).toBeInstanceOf(ImportKeyMaterialCommand);

    // Verificar que lo que se mandó a ImportKeyMaterial realmente desenvuelve a la clave privada
    // original — el mismo proceso que haría KMS del otro lado, hecho aquí con la llave privada de
    // wrapping local (que en la vida real solo KMS tiene).
    if (!capturedEncryptedKeyMaterial) throw new Error("no se capturó EncryptedKeyMaterial");
    const rsaWrappedKekSize = 2048 / 8; // RSA-2048 OAEP produce un bloque del tamaño del módulo
    const wrappedKek = capturedEncryptedKeyMaterial.subarray(0, rsaWrappedKekSize);
    const wrappedPrivateKey = capturedEncryptedKeyMaterial.subarray(rsaWrappedKekSize);

    const kek = privateDecrypt(
      { key: wrappingKeyPair.privateKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      wrappedKek,
    );
    const unwrappedPrivateKeyDer = aesKeyUnwrapWithPadding(kek, wrappedPrivateKey);

    expect(Buffer.compare(unwrappedPrivateKeyDer, tenantPrivateKeyDer)).toBe(0);
  });

  it("lanza un error claro si CreateKey no devuelve KeyId", async () => {
    const client = fakeKmsClient(() => ({}));
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

    await expect(createTenantSigningKey(client, pem, "test")).rejects.toThrow(/no devolvió KeyId/);
  });
});
