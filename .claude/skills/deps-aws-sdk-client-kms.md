---
name: deps-aws-sdk-client-kms
description: "Referencia investigada de @aws-sdk/client-kms, usado por packages/signing (KmsSigner) para firmar el XMLDSig de los comprobantes SUNAT delegando en AWS KMS, y por el módulo de Grants para el aislamiento por tenant sobre una CMK compartida (ver ADR-0003). Úsala cuando se escriba o revise código en packages/signing relacionado con KMS — incluye el nombre real y verificado del SigningAlgorithm, el flujo exacto de Sign con GrantTokens, y una limitación real encontrada: GrantConstraints (encryption context) NO aplica a operaciones Sign, solo a Encrypt/Decrypt/GenerateDataKey."
---

# @aws-sdk/client-kms — skill de dependencia (Factuya · packages/signing)

Instalado de verdad con `bun add @aws-sdk/client-kms@3.1100.0` en un entorno aislado y verificado
contra los tipos (`.d.ts`) reales del paquete instalado — 2026-07-31. **No probado contra un
servicio AWS real** (sin cuenta de AWS disponible en este entorno) — ver
`.claude/skills/deps-aws-sdk-client-kms/pending-live-verification.md` más abajo (resumen inline,
sin archivo separado dado el tamaño de esta skill).

## Procedencia

- Paquete: `@aws-sdk/client-kms`, versión resuelta **3.1100.0** (publicada 2026-07-31 — el SDK v3
  de AWS publica releases muy frecuentes/diarios, es el comportamiento normal de estos paquetes,
  no una señal de alerta).
- Repositorio: `aws/aws-sdk-js-v3` en GitHub (monorepo oficial del SDK de AWS para JS/TS).
- Mantenedores en npm: `amzn-oss`, `aws-sdk-bot` — cuentas oficiales de Amazon, sin ambigüedad de
  legitimidad.
- Licencia Apache-2.0.

## API real usada

### `Sign` — la operación central de `KmsSigner`

De `SignRequest`/`SignResponse` (leído de `dist-types/models/models_0.d.ts`):

```typescript
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";

const response = await client.send(new SignCommand({
  KeyId: keyId,                                  // ARN o key ID de la CMK compartida (ver ADR-0003)
  Message: signedInfoBytes,                      // Uint8Array — el <SignedInfo> canonicalizado de XMLDSig
  MessageType: "RAW",                            // KMS hashea internamente — NO pre-hashear nosotros
  SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",  // confirmado en el enum SigningAlgorithmSpec real
  GrantTokens: grantToken ? [grantToken] : undefined, // el Grant del tenant (ver ADR-0003)
}));
// response.Signature: Uint8Array — ya en el formato PKCS#1 (RFC 8017), lista para base64
```

**`RSASSA_PKCS1_V1_5_SHA_256` confirmado real**, no asumido del comentario anterior del stub —
existe tal cual en `SigningAlgorithmSpec` (`dist-types/models/enums.d.ts`). Compatible con lo que
ya usa `LocalPemKeySigner` (`createSign("RSA-SHA256")` de Node — mismo algoritmo, mismo formato de
salida), así que `KmsSigner` es un reemplazo directo sin cambiar `xml-dsig-signer.ts`.

**`MessageType: "RAW"`** es el valor correcto para Factuya: el `Signer.sign(data)` de este repo
recibe los bytes ya armados de `<SignedInfo>` **sin hashear** (igual que `LocalPemKeySigner`, que
deja que `createSign` haga el hash internamente) — usar `DIGEST` sería incorrecto salvo que se
pre-hashee la entrada, que no es lo que hace el resto del pipeline.

### `CreateGrant` / `RetireGrant` — aislamiento por tenant (ver ADR-0003)

De `CreateGrantRequest`/`CreateGrantResponse`:

```typescript
import { KMSClient, CreateGrantCommand, RetireGrantCommand } from "@aws-sdk/client-kms";

const grant = await client.send(new CreateGrantCommand({
  KeyId: sharedCmkKeyId,
  GranteePrincipal: backendServiceRoleArn,   // el rol IAM del backend de Factuya, NO uno por tenant
  Operations: ["Sign"],
  RetiringPrincipal: backendServiceRoleArn,  // permite que el propio backend retire el grant después
}));
// grant.GrantToken -> guardar en TenantConfig.certificate.kmsGrantToken
// grant.GrantId    -> guardar para poder hacer RetireGrant/RevokeGrant por GrantId más adelante

await client.send(new RetireGrantCommand({ GrantToken: grant.GrantToken }));
```

## Hallazgo real importante: `GrantConstraints` NO aplica a `Sign`

`GrantConstraints` (`EncryptionContextSubset`/`EncryptionContextEquals`/`SourceArn`) solo tiene
efecto en operaciones que usan **encryption context** — `Encrypt`, `Decrypt`, `GenerateDataKey` y
variantes. `SignRequest` (leído de los tipos reales) **no tiene ningún campo de encryption
context** — no existe forma de que KMS distinga criptográficamente "esta llamada a `Sign` es del
tenant A" de "es del tenant B" dentro de un mismo Grant `Sign`-only, más allá de qué `GrantToken`
se use.

**Consecuencia de diseño, documentada para no asumir más aislamiento del que realmente hay**: el
Grant de KMS da un límite real y útil de **revocación y auditoría** (revocar el Grant de un
tenant no afecta a los demás, y cada `GrantId` es rastreable a un tenant en los logs de
CloudTrail), pero **no** reemplaza la responsabilidad de la aplicación de usar el `GrantToken`
correcto para cada tenant al llamar `Sign` — esa corrección sigue siendo del código de Factuya
(resolver `TenantConfig` por `tenantId` y pasar su `kmsGrantToken`), igual que sería
responsabilidad de la aplicación leer la fila correcta de una base de datos. No es una limitación
de la implementación de Factuya, es cómo funciona `Sign` en KMS — está documentado aquí para que
nadie asuma que "usar Grants" implica aislamiento criptográfico automático por tenant a nivel de
la llamada misma.

## Known issues / gotchas

- `GranteePrincipal` debe ser un ARN de IAM (usuario, rol, cuenta) — no un string arbitrario de
  `tenantId`. En Factuya, todos los Grants de tenant comparten el mismo `GranteePrincipal` (el rol
  del backend), lo que refuerza el punto anterior: el Grant aísla por *revocación*, no por
  *identidad de quien llama*.
- `CreateGrant` sin el parámetro `Name` genera un `GrantId` nuevo en cada llamada aunque los
  parámetros sean idénticos — para reintentos idempotentes al dar de alta un tenant, pasar `Name`
  (ej. el `tenantId`) para no crear Grants duplicados por error de reintento.
- El `GrantToken` recién creado puede no tener aún "consistencia eventual" en todas las regiones —
  por eso `SignRequest.GrantTokens` existe como campo separado de la autorización IAM normal: se
  pasa explícitamente el token reciente en cada `Sign` hasta que el Grant se propague. Ver la nota
  oficial sobre "eventual consistency" en los tipos de `CreateGrantResponse`.
- **Pendiente de verificación en vivo**: todo lo anterior está confirmado contra los tipos y
  comentarios oficiales del SDK instalado, no contra una cuenta de AWS real (no disponible en este
  entorno). Antes de dar `KmsSigner` por validado con el mismo nivel de confianza que el adaptador
  SUNAT (que sí corrió contra el servicio real), correr una prueba real: crear una CMK asimétrica
  de prueba, un Grant `Sign`-only, y firmar un mensaje de prueba — confirmar que
  `RSASSA_PKCS1_V1_5_SHA_256` con `MessageType: RAW` produce una firma que `xml-crypto` puede
  verificar de vuelta (mismo patrón que ya se hizo para `LocalPemKeySigner` en
  `packages/signing/test/xml-dsig-signer.test.ts`).
