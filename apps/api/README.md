# @factuya/api

Servidor HTTP de desarrollo de Factuya. Expone, de verdad y sin mocks, el subconjunto del
contrato de `docs/sdd/factuya-sdd.md` §7 que este MVP soporta hoy: emitir una Factura contra
SUNAT (o el ambiente beta real, por defecto) y consultar el resultado. Ver `docs/flows.md` para
qué cambia respecto al contrato aspiracional completo del SDD y qué falta para producción.

## Por qué existe

Antes de este paquete, Factuya solo tenía el dominio (`packages/core-domain`), el adaptador
SUNAT (`packages/adapters/pe-sunat`) y la firma (`packages/signing`) — todo validado con tests,
pero sin una forma de invocarlo por HTTP. `apps/api` es esa capa: un servidor real en Bun
(`Bun.serve`, sin framework — la superficie de rutas es pequeña) que conecta esas piezas.

No es la arquitectura de despliegue de producción (`docs/sdd/factuya-sdd.md` §5: API Gateway +
Lambda + Step Functions + KMS + DynamoDB) — es el equivalente "todo en un proceso" para correrlo
y probarlo en una máquina de desarrollo o en CI.

## Cómo correrlo

```bash
bun install
bun run apps/api/src/index.ts
```

Por defecto arranca en `http://localhost:3000`, genera un certificado autofirmado efímero (solo
para desarrollo — ver `src/dev-certificate.ts`), y usa las credenciales públicas de prueba de
SUNAT beta (RUC `20000000001`, usuario SOL `MODDATOS`). Al arrancar, imprime en consola la **API
key del tenant de desarrollo** — necesaria para llamar cualquier endpoint bajo `/v1/` (ver
"Autenticación" abajo):

```
Tenant de desarrollo: dev-tenant (RUC 20000000001, canal SUNAT_DIRECT)
API key de desarrollo: fty_...
Usar con: Authorization: Bearer fty_...
```

Variables de entorno:

| Variable | Default |
|---|---|
| `PORT` | `3000` |
| `SUNAT_ENDPOINT_URL` | `https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService` |
| `SUNAT_RUC` | `20000000001` |
| `SUNAT_SOL_USER` | `MODDATOS` |
| `SUNAT_SOL_PASSWORD` | `moddatos` |
| `SUNAT_ISSUER_NAME` | `EMPRESA DEMO SAC` |
| `FACTUYA_DEV_API_KEY` | Generada aleatoriamente en cada arranque si no se define |
| `FACTUYA_ADMIN_API_KEY` | Generada aleatoriamente en cada arranque si no se define (ver "Alta de tenants" abajo) |
| `AWS_REGION` | `us-east-2` |
| `AWS_PROFILE` | Ninguno (usa la cadena de credenciales estándar de AWS — en producción, el rol de ejecución de Lambda) |

## Autenticación (ADR-0004)

Todo endpoint bajo `/v1/invoices*` exige `Authorization: Bearer <api_key>`. `/health`, `/docs`,
`/openapi.yaml`, `/vendor/*`, y `/v1/catalogs/*` son públicas a propósito. El tenant se resuelve
de la API key (hash SHA-256, comparación en tiempo constante — `src/api-key.ts`) contra un
`TenantRegistry` (`src/tenant-registry.ts`) — hoy `LocalTenantRegistry`, en memoria del proceso,
sembrado con un único tenant de desarrollo (ver limitaciones abajo). Un tenant nunca puede leer un
comprobante creado por otro (`GET /v1/invoices/{id}` de un id ajeno devuelve 404, no 403 — para no
revelar que el id existe).

Probarlo con `curl`:

```bash
curl -X POST http://localhost:3000/v1/invoices \
  -H "Authorization: Bearer <la key impresa al arrancar>" \
  -H "Content-Type: application/json" \
  -d '{ "documentType": "INVOICE", ... }'
```

O desde `GET /docs` (Scalar) — el botón de autenticación de la UI acepta pegar la key directamente
y prueba los endpoints protegidos desde el navegador sin configuración adicional.

## Alta de tenants reales (ADR-0005/ADR-0006)

`POST /v1/tenants/{id}/certificate` da de alta un tenant con su **propio certificado real** — no
comparte identidad criptográfica con ningún otro tenant (a diferencia del tenant de desarrollo
sembrado al arrancar, que usa el certificado efímero compartido). Es **admin-only**: requiere
`Authorization: Bearer <FACTUYA_ADMIN_API_KEY>` (impresa en consola al arrancar, igual que la key
de desarrollo), no una API key de tenant normal — mecanismo temporal, no un sistema de roles real.

```bash
curl -X POST http://localhost:3000/v1/tenants/acme-corp/certificate \
  -H "Authorization: Bearer <la admin key impresa al arrancar>" \
  -H "Content-Type: application/json" \
  -d '{
    "ruc": "20123456789",
    "legalName": "ACME SAC",
    "certificatePem": "-----BEGIN CERTIFICATE-----...",
    "privateKeyPem": "-----BEGIN PRIVATE KEY-----..."
  }'
```

El flujo real detrás de este endpoint (`packages/signing/src/kms-tenant-key-import.ts`):

1. Crea una CMK asimétrica dedicada en KMS (`Origin: EXTERNAL`) — solo de este tenant.
2. Importa la clave privada real del tenant (`GetParametersForImport` + `ImportKeyMaterial`,
   wrapping `RSA_AES_KEY_WRAP_SHA_256` — AES Key Wrap con Padding, RFC 5649, implementado a mano
   porque no hay una dependencia npm mantenida que lo haga — ver ADR-0006 para el porqué).
3. Genera una API key nueva para el tenant y lo registra en `TenantRegistry`.
4. Devuelve `{ tenantId, apiKey, kmsKeyId }` — **la API key solo se muestra en esta respuesta**,
   no se puede volver a consultar (igual que Stripe/GitHub/cualquier sistema de API keys).

Solo acepta certificado + clave privada por separado en PEM — **no `.pfx`/PKCS#12 todavía**
(parsear ese formato requeriría una dependencia nueva, fuera de alcance de este incremento, ver
ADR-0006). Si tu certificado viene en `.pfx`, sepáralo primero:

```bash
openssl pkcs12 -in certificado.pfx -clcerts -nokeys -out certificado.pem
openssl pkcs12 -in certificado.pfx -nocerts -nodes -out clave-privada.pem
```

## Rutas implementadas

- `POST /v1/invoices` *(requiere auth de tenant)* — emite una Factura. Responde **201 síncrono**
  con el resultado final (no 202 + webhook, porque el adaptador SUNAT de este MVP solo implementa
  el flujo síncrono `sendBill` — ver `docs/adapters/pe-sunat.md`).
- `GET /v1/invoices/{id}` *(requiere auth de tenant)* — consulta un comprobante ya emitido por el
  mismo tenant (store en memoria del proceso, se pierde al reiniciar — producción necesita
  DynamoDB, no implementado aquí).
- `POST /v1/tenants/{id}/certificate` *(requiere auth de admin)* — da de alta un tenant con su
  propio certificado y su propia CMK dedicada en KMS (ver "Alta de tenants reales" arriba).
- `GET /v1/catalogs/{country}/{catalog}` *(pública)* — solo `PE`, y solo los catálogos mínimos que
  el MVP soporta (`document-types`, `identity-document-types`, `tax-affectation`) — no el catálogo
  oficial completo de SUNAT.
- `GET /health` *(pública)* — liveness.
- `GET /docs` *(pública)* — documentación interactiva (Scalar API Reference) generada desde
  `openapi.yaml`.
- `GET /openapi.yaml` *(pública)* — el spec OpenAPI 3.1 crudo, fiel a lo realmente implementado
  (no aspiracional), con los `securitySchemes` `bearerAuth`/`adminBearerAuth` documentados.

## Documentación interactiva (Scalar)

`GET /docs` sirve una página que carga el bundle standalone de `@scalar/api-reference`
(auto-hospedado desde `node_modules`, no desde un CDN externo — ver
`.claude/skills/deps-scalar-api-reference.md` para la investigación completa de por qué y cómo) y
lo apunta a `/openapi.yaml`, servido por este mismo proceso. Con el servidor corriendo:
`http://localhost:3000/docs`.

## Qué NO hace todavía (ver docs/flows.md para el detalle completo)

- La autenticación multi-tenant (ADR-0004) y el alta de tenants con custodia de clave real
  (ADR-0005/ADR-0006) ya son reales, pero `LocalTenantRegistry` es en memoria del proceso — se
  pierde al reiniciar. Producción necesita DynamoDB (ver `docs/aws/aws-infrastructure-sdd.md`).
- `POST /v1/tenants/{id}/certificate` no soporta `.pfx`/PKCS#12 — solo certificado y clave privada
  en PEM por separado (ver ADR-0006).
- La import de clave real (`createTenantSigningKey`) está **verificada en vivo contra AWS KMS
  real** (2026-08-03) — no solo contra un `KMSClient` falso — ver
  `docs/aws/kms-live-verification.md`, Paso 4b, y `packages/signing/README.md`.
- La API key de administrador es un mecanismo temporal — no reemplaza un sistema de roles/permisos
  real, que debe diseñarse antes de producción.
- No hay notas de crédito/débito, guías de remisión, ni flujo asíncrono (`sendSummary`).
- No hay persistencia real (DynamoDB/S3) — el store de comprobantes es un `Map` en memoria.
