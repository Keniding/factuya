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
SUNAT beta (RUC `20000000001`, usuario SOL `MODDATOS`). Se puede sobreescribir con variables de
entorno:

| Variable | Default |
|---|---|
| `PORT` | `3000` |
| `SUNAT_ENDPOINT_URL` | `https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService` |
| `SUNAT_RUC` | `20000000001` |
| `SUNAT_SOL_USER` | `MODDATOS` |
| `SUNAT_SOL_PASSWORD` | `moddatos` |
| `SUNAT_ISSUER_NAME` | `EMPRESA DEMO SAC` |

## Rutas implementadas

- `POST /v1/invoices` — emite una Factura. Responde **201 síncrono** con el resultado final (no
  202 + webhook, porque el adaptador SUNAT de este MVP solo implementa el flujo síncrono
  `sendBill` — ver `docs/adapters/pe-sunat.md`).
- `GET /v1/invoices/{id}` — consulta un comprobante ya emitido (store en memoria del proceso, se
  pierde al reiniciar — producción necesita DynamoDB, no implementado aquí).
- `GET /v1/catalogs/{country}/{catalog}` — solo `PE`, y solo los catálogos mínimos que el MVP
  soporta (`document-types`, `identity-document-types`, `tax-affectation`) — no el catálogo
  oficial completo de SUNAT.
- `GET /health` — liveness.
- `GET /docs` — documentación interactiva (Scalar API Reference) generada desde `openapi.yaml`.
- `GET /openapi.yaml` — el spec OpenAPI 3.1 crudo, fiel a lo realmente implementado (no
  aspiracional).

## Documentación interactiva (Scalar)

`GET /docs` sirve una página que carga el bundle standalone de `@scalar/api-reference`
(auto-hospedado desde `node_modules`, no desde un CDN externo — ver
`.claude/skills/deps-scalar-api-reference.md` para la investigación completa de por qué y cómo) y
lo apunta a `/openapi.yaml`, servido por este mismo proceso. Con el servidor corriendo:
`http://localhost:3000/docs`.

## Qué NO hace todavía (ver docs/flows.md para el detalle completo)

- No hay multi-tenant real: un único tenant de desarrollo resuelto por variables de entorno, no
  por API key/autenticación.
- No hay `KmsSigner` real (certificado efímero autofirmado en cada arranque — solo válido porque
  SUNAT beta no exige certificado registrado).
- No hay notas de crédito/débito, guías de remisión, ni flujo asíncrono (`sendSummary`).
- No hay persistencia real (DynamoDB/S3) — el store de comprobantes es un `Map` en memoria.
