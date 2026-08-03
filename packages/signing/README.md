# @factuya/signing

Firma XMLDSig de comprobantes UBL 2.1 (`packages/adapters/pe-sunat`), con un `Signer` inyectable
— nunca una clave privada cargada directamente en el código del adaptador. Ver ADR-0002 (por qué
XMLDSig y no XAdES) y ADR-0003 (por qué una CMK de KMS compartida, no una por tenant).

## Implementaciones de `Signer`

- **`LocalPemKeySigner`** — clave PEM local. Solo para desarrollo/tests (certificado autofirmado,
  generado efímero — ver `test/generate-test-certificate.ts` y `apps/api/src/dev-certificate.ts`).
  Es la que ya validó de punta a punta el pipeline completo contra SUNAT beta real (ver
  `docs/adapters/pe-sunat.md`).
- **`KmsSigner`** — delega la operación de firma en AWS KMS (`Sign`, algoritmo
  `RSASSA_PKCS1_V1_5_SHA_256`, `MessageType: RAW`) contra una CMK asimétrica **compartida** por
  ambiente, no una por tenant (ver ADR-0003). El aislamiento por tenant se logra con un Grant
  `Sign`-only por tenant (`kms-grants.ts`: `createTenantGrant`/`retireTenantGrant`), no con una
  llave física separada — evita que el costo de KMS crezca linealmente con el número de tenants.

Ambas implementan la misma interfaz `Signer`, así que `xml-dsig-signer.ts` (y todo lo que dependa
de él, como `packages/adapters/pe-sunat`) es agnóstico a cuál se use.

## Estado de verificación de `KmsSigner`

**Verificado en vivo contra AWS KMS real** (2026-08-02, cuenta de desarrollo dedicada) — no solo
contra un `KMSClient` falso. La corrida real: creó una CMK asimétrica (`RSA_2048`,
`SIGN_VERIFY`), un Grant `Sign`-only, firmó un mensaje con `KmsSigner`, y verificó esa firma con
`crypto.verify()` de Node contra la llave pública real obtenida de KMS — confirmó que
`RSASSA_PKCS1_V1_5_SHA_256`/`MessageType: RAW` produce exactamente la firma esperada, no solo que
la llamada no lanzó error. Limpieza confirmada después (`RetireGrant` + `ScheduleKeyDeletion`,
`KeyState: PendingDeletion`). Detalle completo y reproducible en
`docs/aws/kms-live-verification.md` (guía pública) y
`packages/signing/test/integration/kms-live.integration.test.ts` (el test que lo hace).

También sigue probado contra un `KMSClient` falso para los unitarios normales
(`packages/signing/test/kms-signer.test.ts`, `kms-grants.test.ts`) — eso confirma que el código
arma los parámetros correctos sin necesidad de credenciales reales en cada corrida de `bun test`.

## Cómo correr los tests

```bash
bun test packages/signing                # unitarios, incluye KmsSigner contra un KMSClient falso
bun run test:integration                 # incluye la verificación en vivo si está habilitada (ver docs/aws/kms-live-verification.md)
```
