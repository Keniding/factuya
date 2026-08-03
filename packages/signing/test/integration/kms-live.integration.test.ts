import { createVerify } from "node:crypto";
import { beforeAll, describe, expect, it } from "bun:test";
import {
  CreateKeyCommand,
  GetPublicKeyCommand,
  KMSClient,
  ScheduleKeyDeletionCommand,
  type CreateKeyCommandOutput,
} from "@aws-sdk/client-kms";
import { KmsSigner } from "../../src/kms-signer";
import { createTenantGrant, retireTenantGrant } from "../../src/kms-grants";

/**
 * Prueba de integración REAL contra AWS KMS — sin mocks del SDK. Ver
 * docs/aws/kms-live-verification.md para el paso a paso completo (crear el usuario IAM, configurar el
 * perfil local) y ADR-0003 para el diseño que esto verifica: una CMK compartida por ambiente +
 * un Grant `Sign`-only por tenant.
 *
 * TRIPLE GATE DE SEGURIDAD, a propósito: esta máquina puede tener perfiles de AWS de OTRAS
 * cuentas configurados (de otros clientes/proyectos) — este test JAMÁS debe correr por accidente
 * ni usar el perfil "default" implícito. Requiere:
 *   1. FACTUYA_KMS_LIVE_TEST=1 — opt-in explícito, porque este test crea recursos reales (con
 *      costo, aunque de centavos — ver docs/aws/kms-live-verification.md).
 *   2. AWS_PROFILE seteado explícitamente — nunca se asume ningún perfil por default.
 *   3. FACTUYA_KMS_LIVE_TEST_PRINCIPAL_ARN — el ARN del propio usuario IAM (obtenido en el Paso 3
 *      de la guía con `aws sts get-caller-identity`), usado como GranteePrincipal/RetiringPrincipal
 *      del Grant de prueba. Se pide como variable en vez de resolverlo con una llamada a STS desde
 *      este test para no agregar `@aws-sdk/client-sts` como dependencia nueva solo para esto — ya
 *      es un valor que el Paso 3 de la guía deja anotado.
 * Sin los tres, el test se omite explícitamente con un mensaje, mismo patrón honesto que
 * sunat-beta.integration.test.ts (no falla confuso, no finge pasar).
 */

const LIVE_TEST_ENABLED = process.env.FACTUYA_KMS_LIVE_TEST === "1";
const AWS_PROFILE = process.env.AWS_PROFILE;
const PRINCIPAL_ARN = process.env.FACTUYA_KMS_LIVE_TEST_PRINCIPAL_ARN;
const AWS_REGION = process.env.AWS_REGION ?? "us-east-2";

let canRun = false;
let skipReason = "";

beforeAll(() => {
  if (!LIVE_TEST_ENABLED) {
    skipReason =
      "FACTUYA_KMS_LIVE_TEST no está en '1' — este test crea recursos reales en una cuenta de AWS real (ver docs/aws/kms-live-verification.md). Se omite por defecto.";
    return;
  }
  if (!AWS_PROFILE) {
    skipReason =
      "AWS_PROFILE no está seteado explícitamente — por seguridad este test nunca usa un perfil implícito (ver docs/aws/kms-live-verification.md, esta máquina puede tener perfiles de otras cuentas).";
    return;
  }
  if (!PRINCIPAL_ARN) {
    skipReason =
      "FACTUYA_KMS_LIVE_TEST_PRINCIPAL_ARN no está seteado — necesario como GranteePrincipal del Grant de prueba (ver docs/aws/kms-live-verification.md, Paso 3).";
    return;
  }
  canRun = true;
});

describe("Integración real: KmsSigner contra AWS KMS", () => {
  it("crea una CMK real, un Grant de tenant real, firma, y verifica la firma contra la llave pública real de KMS", async () => {
    if (!canRun) {
      console.warn(`[kms-live] Test omitido: ${skipReason}`);
      return;
    }

    const client = new KMSClient({ region: AWS_REGION, profile: AWS_PROFILE });
    let keyId: string | undefined;
    let grantToken: string | undefined;

    try {
      const createKeyResponse: CreateKeyCommandOutput = await client.send(
        new CreateKeyCommand({
          KeySpec: "RSA_2048",
          KeyUsage: "SIGN_VERIFY",
          Description: "factuya-dev — CMK efímera de verificación en vivo de KmsSigner, ver docs/aws/kms-live-verification.md",
          Tags: [{ TagKey: "factuya:purpose", TagValue: "kms-signer-live-verification" }],
        }),
      );
      keyId = createKeyResponse.KeyMetadata?.KeyId;
      if (!keyId) throw new Error("CreateKey no devolvió KeyId");
      console.log(`[kms-live] CMK creada: ${keyId}`);

      const grant = await createTenantGrant({
        client,
        keyId,
        granteePrincipalArn: PRINCIPAL_ARN as string,
        tenantId: "factuya-dev-live-verification",
      });
      grantToken = grant.grantToken;
      console.log(`[kms-live] Grant creado: ${grant.grantId}`);

      const signer = new KmsSigner({ client, keyId, publicCertPem: "", grantToken });
      const message = new TextEncoder().encode("factuya kms-live-verification test message");
      const signature = await signer.sign(message);
      expect(signature.byteLength).toBeGreaterThan(0);

      const publicKeyResponse = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
      if (!publicKeyResponse.PublicKey) throw new Error("GetPublicKey no devolvió PublicKey");
      const publicKeyDer = Buffer.from(publicKeyResponse.PublicKey);
      const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyDer.toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----\n`;

      const verifier = createVerify("RSA-SHA256");
      verifier.update(Buffer.from(message));
      verifier.end();
      const isValid = verifier.verify(publicKeyPem, Buffer.from(signature));

      expect(isValid).toBe(true);
      console.log("[kms-live] Firma real de KMS verificada correctamente con crypto.verify()");
    } finally {
      if (grantToken) {
        await retireTenantGrant(client, grantToken).catch((err) =>
          console.warn(`[kms-live] No se pudo retirar el Grant de prueba: ${err}`),
        );
      }
      if (keyId) {
        await client
          .send(new ScheduleKeyDeletionCommand({ KeyId: keyId, PendingWindowInDays: 7 }))
          .catch((err) => console.warn(`[kms-live] No se pudo programar el borrado de la CMK de prueba: ${err}`));
        console.log(`[kms-live] Borrado de ${keyId} programado (ventana de 7 días, sin costo durante la espera)`);
      }
    }
  }, 60_000);
});
