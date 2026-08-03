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

## Estado de verificación de `KmsSigner` — léase antes de asumir que está "100% probado"

Implementado y probado contra un `KMSClient` **falso** (`packages/signing/test/kms-signer.test.ts`,
`kms-grants.test.ts`) — confirma que el código arma los parámetros correctos y procesa la
respuesta correctamente, pero **no** que AWS KMS real firme y acepte esos parámetros como se
espera. A diferencia de `LocalPemKeySigner` (validado con criptografía real y, a través del
adaptador SUNAT, contra el servicio real de SUNAT beta), `KmsSigner` no se ha corrido todavía
contra una cuenta de AWS real. Ver `docs/dependencies/LEDGER.md` y
`.claude/skills/deps-aws-sdk-client-kms.md` para el detalle exacto de qué falta confirmar antes de
usarlo en producción, y **`docs/aws/kms-live-verification.md` para el checklist paso a paso** de cómo
correr esa verificación en vivo (`packages/signing/test/integration/kms-live.integration.test.ts`)
contra una cuenta de AWS real.

## Cómo correr los tests

```bash
bun test packages/signing                # unitarios, incluye KmsSigner contra un KMSClient falso
bun run test:integration                 # incluye la verificación en vivo si está habilitada (ver docs/aws/kms-live-verification.md)
```
