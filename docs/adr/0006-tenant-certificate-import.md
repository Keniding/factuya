# ADR-0006: `POST /v1/tenants/{id}/certificate` — import de la clave real del tenant a su propia CMK

- Estado: aceptado
- Fecha: 2026-08-03

## Contexto

ADR-0005 decidió que cada tenant tiene su propia CMK de KMS (no una compartida). Falta decidir
**cómo llega la clave privada de firma a esa CMK**. `docs/sdd/factuya-sdd.md` §7 describe el
endpoint como "sube certificado .pfx" — el tenant ya tiene, de su propio proceso de registro ante
SUNAT, un certificado X.509 y su clave privada correspondiente; Factuya no genera una identidad
nueva, custodia la que el tenant ya tiene.

AWS KMS soporta esto exactamente: crear una CMK con `Origin: EXTERNAL` e importar una clave
privada RSA existente vía `ImportKeyMaterial` (soportado para llaves de firma asimétricas desde
junio 2023). La clave privada nunca queda en texto plano en ningún almacenamiento de Factuya —
se cifra localmente antes de enviarla a KMS, y KMS la descifra internamente al importarla.

## Alcance de este incremento

- Se acepta **certificado (PEM) + clave privada (PEM)** por separado, no un `.pfx` (PKCS#12).
  Parsear PKCS#12 requiere una librería nueva (Node no lo hace nativamente) — queda fuera de
  alcance de este ADR; se documenta como limitación explícita, no como descuido. El tenant (o un
  script de conversión que Factuya podría ofrecer después) debe separar su `.pfx` en PEM antes de
  llamar a este endpoint.
- Autenticación del endpoint: **admin-only**, vía una API key de administrador separada
  (`FACTUYA_ADMIN_API_KEY`) — no hay un sistema de roles/RBAC real todavía. Documentado como
  limitación deliberada, igual que `LocalTenantRegistry`.

## Decisión: el flujo real de import

1. `CreateKey` con `KeySpec: RSA_2048`, `KeyUsage: SIGN_VERIFY`, `Origin: EXTERNAL` — la CMK queda
   en estado `PendingImport`, todavía no utilizable.
2. `GetParametersForImport` con `WrappingAlgorithm: RSA_AES_KEY_WRAP_SHA_256` y
   `WrappingKeySpec: RSA_2048` — KMS devuelve una llave pública de wrapping (DER/SPKI) y un
   `ImportToken`, ambos con vencimiento.
3. **Envolver la clave privada del tenant** (algoritmo `RSA_AES_KEY_WRAP_SHA_256`, dos pasos según
   la documentación oficial de AWS — verificado contra
   [Step 3: Encrypt the key material](https://docs.aws.amazon.com/kms/latest/developerguide/importing-keys-encrypt-key-material.html),
   no asumido):
   a. Generar una llave AES-256 aleatoria (KEK efímera, solo para este envoltorio, se descarta
      después de usarla).
   b. Envolver la clave privada del tenant (PKCS#8 DER) con esa KEK usando **AES Key Wrap con
      Padding, RFC 5649** — el algoritmo exacto que exige `RSA_AES_KEY_WRAP_SHA_256` para datos de
      longitud arbitraria (una clave RSA-2048 en DER no es múltiplo de 8 bytes).
   c. Envolver la KEK efímera (32 bytes) con la llave pública de wrapping de KMS usando
      RSA-OAEP-SHA-256.
   d. Concatenar: `EncryptedKeyMaterial = RSA-OAEP(KEK) || AES-KWP(clave privada)` — en ese orden,
      confirmado contra el ejemplo oficial de AWS (`cat aes-key-wrapped.bin key-material-wrapped.bin`).
4. `ImportKeyMaterial` con el `EncryptedKeyMaterial` del paso 3 y el `ImportToken` del paso 2 — la
   CMK pasa a estado `Enabled`, lista para `Sign`.
5. Se genera una API key nueva para el tenant (`generateApiKey`, ver ADR-0004), se registra en
   `TenantRegistry` con `certificate.signerRef` apuntando al `keyId` de su CMK recién creada, y se
   devuelve la API key **una sola vez** en la respuesta — el mismo patrón que cualquier sistema de
   API keys (Stripe, GitHub, etc.): si se pierde, se debe rotar, no se puede volver a consultar.

### Por qué se implementó AES Key Wrap con Padding (RFC 5649) a mano

Ni `node:crypto` ni la WebCrypto de Bun exponen el cifrador `AES-KWP` — `node:crypto` no reconoce
ningún nombre de cifrador de key-wrap (`getCiphers()` no lista ninguno), y la `AES-KW` de
WebCrypto implementa RFC 3394 (sin padding, exige múltiplos exactos de 8 bytes — una clave
RSA-2048 en DER no lo es). Se buscó una dependencia npm mantenida activamente que lo implementara
(criterio de `.claude/agents/dependency-skill-agent.md`): el único candidato encontrado
(`aes-kw`) no tiene actividad desde la era de Travis CI — no pasa el criterio de legitimidad/
mantenimiento del propio proceso de dependencias del repo.

Se implementó el algoritmo directamente sobre el primitivo `aes-256-ecb` de `node:crypto` (un
cifrador de bloque estándar, no algo hecho a mano), siguiendo la especificación exacta de
[RFC 5649](https://www.rfc-editor.org/rfc/rfc5649) — Alternative Initial Value (`0xA65959A6` +
longitud de 32 bits en network order), y el algoritmo de wrap de RFC 3394 §2.2.1 sobre esa AIV.
**Validado contra los vectores de prueba oficiales publicados en el propio RFC 5649 §6** (no
inventados, coinciden byte a byte) y contra un round-trip wrap/unwrap con una clave RSA-2048 real
(153 bloques, mucho más grande que los ejemplos de 1-3 bloques del RFC) antes de usarlo contra
KMS real.

## Fuentes verificadas (2026-08-03)

- [AWS KMS now supports importing asymmetric and HMAC keys](https://aws.amazon.com/about-aws/whats-new/2023/06/aws-kms-importing-asymmetric-hmac-keys) —
  confirma soporte de import de claves RSA de firma.
- [Importing key material for AWS KMS keys — Step 3: Encrypt the key material](https://docs.aws.amazon.com/kms/latest/developerguide/importing-keys-encrypt-key-material.html) —
  procedimiento exacto de `RSA_AES_KEY_WRAP_SHA_256`, orden de concatenación del blob final.
  citado textualmente, no parafraseado de memoria.
- [RFC 5649 — Advanced Encryption Standard (AES) Key Wrap with Padding Algorithm](https://www.rfc-editor.org/rfc/rfc5649) —
  especificación completa y vectores de prueba oficiales usados para validar la implementación.
- Tipos reales de `@aws-sdk/client-kms` instalados (`GetParametersForImportRequest/Response`,
  `ImportKeyMaterialRequest`, enums `WrappingKeySpec`/`AlgorithmSpec`) — ya investigado en
  `.claude/skills/deps-aws-sdk-client-kms.md`, no se agregó ninguna dependencia nueva.
- Verificación real de que `node:crypto`/WebCrypto de Bun no exponen `AES-KWP` directamente
  (`crypto.getCiphers()` no lista ningún cifrador de wrap; `crypto.subtle.wrapKey('AES-KW', ...)`
  sí existe pero implementa RFC 3394, no RFC 5649) y de que `aes-kw` (npm) no es una dependencia
  activamente mantenida.

## Consecuencias

- `packages/signing` gana un módulo de bajo nivel (`aes-kwp.ts`) con una responsabilidad muy
  acotada y una prueba directa contra vectores oficiales — si AWS alguna vez cambia el algoritmo
  de wrapping requerido, este es el único lugar que hay que tocar.
- El endpoint no soporta `.pfx` todavía — un tenant con un certificado en ese formato debe
  separarlo en PEM (certificado + clave privada) antes de llamar al endpoint. Documentado como
  limitación explícita en `apps/api/README.md`, no oculto.
- La API key de administrador (`FACTUYA_ADMIN_API_KEY`) es un mecanismo temporal — no reemplaza un
  sistema de roles/permisos real, que debe diseñarse antes de producción.
- Cada tenant importado tiene una CMK real, distinta, verificable — cumple el §13 del SDD sin
  ambigüedad, a diferencia del diseño original de ADR-0003.

## Addendum verificado con una corrida real (2026-08-03)

El flujo completo de este ADR se corrió contra AWS KMS real, no solo contra un `KMSClient` falso
ni contra vectores de prueba aislados de RFC 5649:

- Se generó una clave RSA-2048 local, simulando la clave privada real que un tenant ya tendría de
  su propio registro ante SUNAT.
- `createTenantSigningKey` creó una CMK dedicada (`Origin: EXTERNAL`, `KeySpec: RSA_2048`) e
  importó esa clave con el procedimiento real de `RSA_AES_KEY_WRAP_SHA_256`:
  `GetParametersForImport` → envolver con la implementación a mano de AES-KWP (`aes-kwp.ts`) +
  RSA-OAEP-SHA-256 → `ImportKeyMaterial`.
- `KmsSigner` firmó un mensaje usando esa CMK ya importada, y la firma se verificó con
  `crypto.verify()` de Node contra la llave pública **original** del tenant (no una obtenida de
  KMS) — confirma que KMS importó y usa exactamente la clave privada enviada, no una generada por
  error ni una mezcla con otra CMK.
- Limpieza confirmada: `ScheduleKeyDeletion` de la CMK de prueba (`KeyId:
  ce2915a7-5d77-4d22-a412-960c6c284958`).

Esto confirma, además del diseño y el código, que la implementación manual de AES-KWP (RFC 5649)
es compatible byte a byte con lo que KMS real espera recibir en `EncryptedKeyMaterial` — no solo
con los vectores oficiales del RFC ni con un desenvuelto simulado localmente. Detalle reproducible
en `docs/aws/kms-live-verification.md` Paso 4b y
`packages/signing/test/integration/kms-tenant-key-import-live.integration.test.ts`.
