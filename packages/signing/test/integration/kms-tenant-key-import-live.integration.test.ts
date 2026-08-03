import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "bun:test";
import { KMSClient, ScheduleKeyDeletionCommand } from "@aws-sdk/client-kms";
import { createTenantSigningKey } from "../../src/kms-tenant-key-import";
import { KmsSigner } from "../../src/kms-signer";

/**
 * Verificación en vivo de ADR-0006 (import de la clave privada real de un tenant a su propia
 * CMK) contra AWS KMS real — no un `KMSClient` falso. Requiere que la policy `factuya-dev` tenga
 * además `kms:GetParametersForImport` y `kms:ImportKeyMaterial` (ver docs/aws/kms-live-verification.md).
 *
 * Mismo triple gate de seguridad que kms-live.integration.test.ts — nunca corre por accidente ni
 * usa el perfil `default` implícito.
 */

const LIVE_TEST_ENABLED = process.env.FACTUYA_KMS_LIVE_TEST === "1";
const AWS_PROFILE = process.env.AWS_PROFILE;
const AWS_REGION = process.env.AWS_REGION ?? "us-east-2";

let canRun = false;
let skipReason = "";

beforeAll(() => {
  if (!LIVE_TEST_ENABLED) {
    skipReason = "FACTUYA_KMS_LIVE_TEST no está en '1' — este test crea recursos reales en una cuenta de AWS real. Se omite por defecto.";
    return;
  }
  if (!AWS_PROFILE) {
    skipReason = "AWS_PROFILE no está seteado explícitamente — por seguridad este test nunca usa un perfil implícito.";
    return;
  }
  canRun = true;
});

describe("Integración real: import de la clave privada de un tenant a su propia CMK (ADR-0006)", () => {
  it("importa una clave RSA-2048 real, firma con ella vía KmsSigner, y la firma verifica contra la llave pública original del tenant", async () => {
    if (!canRun) {
      console.warn(`[kms-tenant-import-live] Test omitido: ${skipReason}`);
      return;
    }

    const client = new KMSClient({ region: AWS_REGION, profile: AWS_PROFILE as string });

    // Simula "la clave privada real que el tenant ya tiene de su propio registro ante SUNAT" —
    // generada localmente, nunca enviada a KMS en texto plano (aesKeyWrapWithPadding + RSA-OAEP
    // la envuelven antes, ver kms-tenant-key-import.ts).
    const tenantKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const tenantPrivateKeyPem = tenantKeyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const tenantPublicKeyPem = tenantKeyPair.publicKey.export({ type: "spki", format: "pem" }) as string;

    let keyId: string | undefined;
    try {
      const imported = await createTenantSigningKey(
        client,
        tenantPrivateKeyPem,
        "factuya-dev — import de prueba ADR-0006, ver docs/aws/kms-live-verification.md",
      );
      keyId = imported.keyId;
      console.log(`[kms-tenant-import-live] CMK creada e importada: ${keyId}`);

      const signer = new KmsSigner({ client, keyId, publicCertPem: "" });
      const message = new TextEncoder().encode("factuya tenant key import live verification");
      const signature = await signer.sign(message);
      expect(signature.byteLength).toBeGreaterThan(0);

      // Verificar con la llave pública ORIGINAL del tenant (no una obtenida de KMS) — confirma
      // que KMS realmente importó y está usando la clave privada exacta que se le envió, no una
      // generada internamente por error.
      const verifier = createVerify("RSA-SHA256");
      verifier.update(Buffer.from(message));
      verifier.end();
      const isValid = verifier.verify(tenantPublicKeyPem, Buffer.from(signature));

      expect(isValid).toBe(true);
      console.log("[kms-tenant-import-live] Firma verificada contra la llave pública original del tenant — el import fue correcto");
    } finally {
      if (keyId) {
        await client
          .send(new ScheduleKeyDeletionCommand({ KeyId: keyId, PendingWindowInDays: 7 }))
          .catch((err) => console.warn(`[kms-tenant-import-live] No se pudo programar el borrado de la CMK de prueba: ${err}`));
        console.log(`[kms-tenant-import-live] Borrado de ${keyId} programado (ventana de 7 días, sin costo durante la espera)`);
      }
    }
  }, 60_000);
});
