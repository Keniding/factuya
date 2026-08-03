# @factuya/signing

Firma XMLDSig de comprobantes UBL 2.1 (`packages/adapters/pe-sunat`), con un `Signer` inyectable
— nunca una clave privada cargada directamente en el código del adaptador. Ver ADR-0002 (por qué
XMLDSig y no XAdES), y ADR-0005 (por qué cada tenant tiene su propia CMK de KMS, reemplaza
ADR-0003) + ADR-0006 (cómo llega su clave privada real a esa CMK).

## Implementaciones de `Signer`

- **`LocalPemKeySigner`** — clave PEM local. Solo para desarrollo/tests (certificado autofirmado,
  generado efímero — ver `test/generate-test-certificate.ts` y `apps/api/src/dev-certificate.ts`).
  Es la que ya validó de punta a punta el pipeline completo contra SUNAT beta real (ver
  `docs/adapters/pe-sunat.md`).
- **`KmsSigner`** — delega la operación de firma en AWS KMS (`Sign`, algoritmo
  `RSASSA_PKCS1_V1_5_SHA_256`, `MessageType: RAW`) contra la CMK **dedicada de un tenant** (ver
  ADR-0005 — cada tenant tiene su propia CMK, no una compartida). `kms-grants.ts`
  (`createTenantGrant`/`retireTenantGrant`) sigue existiendo pero ya no es el mecanismo primario de
  aislamiento — con una CMK por tenant, el aislamiento lo da la CMK misma.

Ambas implementan la misma interfaz `Signer`, así que `xml-dsig-signer.ts` (y todo lo que dependa
de él, como `packages/adapters/pe-sunat`) es agnóstico a cuál se use.

## Cómo llega la clave privada real de un tenant a su CMK (ADR-0006)

`kms-tenant-key-import.ts` (`createTenantSigningKey`) implementa el flujo real: crea una CMK
dedicada (`Origin: EXTERNAL`) e importa la clave privada real del tenant (`GetParametersForImport`
+ `ImportKeyMaterial`, wrapping `RSA_AES_KEY_WRAP_SHA_256`). Ese wrapping requiere **AES Key Wrap
con Padding (RFC 5649)** — implementado a mano en `aes-kwp.ts` porque ni `node:crypto` ni la
WebCrypto de Bun lo exponen, y no se encontró una dependencia npm activamente mantenida que lo
haga (ver ADR-0006 para el detalle completo de esa investigación).

`aes-kwp.ts` está validado contra los **vectores de prueba oficiales de RFC 5649 §6**
(`test/aes-kwp.test.ts` — coinciden byte a byte, no aproximados) y contra un round-trip con una
clave RSA-2048 real (153 bloques, mucho más grande que los ejemplos de 1-3 bloques del RFC).

## Estado de verificación

**`KmsSigner` verificado en vivo contra AWS KMS real** (2026-08-02) — no solo contra un
`KMSClient` falso. La corrida real: creó una CMK asimétrica (`RSA_2048`, `SIGN_VERIFY`), firmó un
mensaje, y verificó esa firma con `crypto.verify()` de Node contra la llave pública real obtenida
de KMS — confirmó que `RSASSA_PKCS1_V1_5_SHA_256`/`MessageType: RAW` produce exactamente la firma
esperada. Limpieza confirmada después (`ScheduleKeyDeletion`, `KeyState: PendingDeletion`).
Detalle completo en `docs/aws/kms-live-verification.md` y
`packages/signing/test/integration/kms-live.integration.test.ts`.

**`createTenantSigningKey` (import de clave, ADR-0006) verificado en vivo contra AWS KMS real**
(2026-08-03) — no solo contra un `KMSClient` falso ni contra vectores de prueba. La corrida real:
generó una clave RSA-2048 local (simulando la clave privada real de un tenant), creó una CMK
dedicada (`Origin: EXTERNAL`), la importó con el procedimiento completo de
`RSA_AES_KEY_WRAP_SHA_256` (AES-KWP + RSA-OAEP-SHA-256, `aes-kwp.ts`), firmó un mensaje con
`KmsSigner` usando esa CMK, y verificó la firma contra la llave pública **original** del tenant
(no una obtenida de KMS) — confirma que KMS importó y usa exactamente la clave privada enviada, no
una generada por error. Limpieza confirmada después (`ScheduleKeyDeletion`). Detalle completo en
`docs/aws/kms-live-verification.md` Paso 4b y
`packages/signing/test/integration/kms-tenant-key-import-live.integration.test.ts`. También sigue
probado contra un `KMSClient` falso con validación criptográfica completa
(`test/kms-tenant-key-import.test.ts`), que se mantiene como test rápido/reproducible en CI sin
tocar AWS real.

## Cómo correr los tests

```bash
bun test packages/signing                # unitarios, incluye vectores oficiales de RFC 5649 y KMSClient falso
bun run test:integration                 # incluye las verificaciones en vivo si están habilitadas (ver docs/aws/kms-live-verification.md)
```
