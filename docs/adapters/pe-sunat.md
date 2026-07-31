# Adaptador Perú — SUNAT

Implementación real en `packages/adapters/pe-sunat`, `packages/signing`, `packages/core-domain`.
Este documento registra lo que se verificó y cómo, siguiendo `docs/sdd/factuya-sdd.md` §16: nada
aquí se afirma sin una fuente citada o sin haberse ejecutado de verdad contra código real.

## Estado

MVP funcional: Factura (tipo 01), flujo síncrono (`sendBill`), firma XMLDSig con un `Signer`
inyectable (local para dev/test, KMS pendiente para producción — ver limitaciones abajo). Notas de
crédito/débito, guías de remisión, resúmenes/bajas (flujo asíncrono `sendSummary`/`getStatus`) y
SIRE quedan fuera de este build, tal como fija el alcance del MVP (SDD §2).

## Endpoint y credenciales de prueba (verificados, no de memoria)

- **Endpoint beta**: `https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService` — SUNAT
  publica que este servicio **no exige certificado registrado**, pensado exactamente para probar
  la estructura del XML antes de homologar.
- **Endpoint producción** (no usado en este MVP): `https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService`.
- **Credenciales públicas de prueba** (documentadas por SUNAT, no son un secreto): RUC
  `20000000001`, usuario SOL `MODDATOS`, contraseña `moddatos`. El `Username` de WS-Security se
  arma como `RUC + usuarioSOL` → `20000000001MODDATOS`.
- **Namespace del servicio**: `http://service.sunat.gob.pe` (prefijo convencional `ser`).
- **Operación usada**: `sendBill(fileName: string, contentFile: base64)` → `sendBillResponse.applicationResponse` (ZIP del CDR, base64).

Fuentes cruzadas (múltiples independientes, ya que no se pudo bajar el WSDL crudo — ver
limitación de entorno abajo): nota oficial de SUNAT sobre el servicio beta
(cpe.sunat.gob.pe/noticias/servicio-beta-para-realizar-pruebas-ubl-21), documentación de Greenter
(fe-primer.greenter.dev — referencia de facto del ecosistema peruano), y múltiples foros de
implementadores (delphiaccess, incared.net) que coinciden en el mismo namespace/formato de
credenciales.

## Estructura UBL 2.1 de la Factura

`packages/adapters/pe-sunat/src/ubl-invoice-builder.ts` arma el XML mediante plantillas de string
(no un XML builder genérico — ver `.claude/skills/deps-fast-xml-parser.md`, que documenta por qué
`XMLBuilder` de esa librería está deprecado y no se usa). El orden y estructura de elementos se
verificó contra un XML real generado por Greenter, publicado por su propio autor
(https://gist.github.com/giansalex/53d3b6dadb5305ee95928a854ee3abc4), no inventado ni reconstruido
solo de memoria de la especificación UBL.

Catálogos usados (ver `src/catalogs.ts`, deliberadamente mínimos): tipo de documento 01 (Factura),
tipo de documento de identidad 6 (RUC), afectación IGV 10 (gravado), esquema IGV 1000/VAT, unidad
de medida NIU por defecto.

## Firma digital

XMLDSig estándar (no XAdES, ver ADR-0002), vía `packages/signing`, usando `xml-crypto` (ver
`.claude/skills/deps-xml-crypto/`). El `ds:Signature` se inserta dentro de
`ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent`, que el builder deja vacío a propósito.

## Empaquetado y envío

`zipXmlFile`/`extractXmlFromZip` (`fflate`, ver `.claude/skills/deps-fflate.md`) comprimen el XML
firmado antes de `sendBill` y descomprimen el CDR recibido. `soap-client.ts` arma el envelope SOAP
con WS-Security `UsernameToken` a mano (no se usó una librería de cliente SOAP genérica: la
superficie necesaria es una sola operación).

## Pruebas

- **Unitarias**: `bun test` (excluyendo `test/integration`) — cubren `emitInvoice`
  (`packages/core-domain`), firma+verificación real con certificado autofirmado
  (`packages/signing`), y el builder UBL (`packages/adapters/pe-sunat`).
- **Integración real contra SUNAT beta**: `packages/adapters/pe-sunat/test/integration/sunat-beta.integration.test.ts`.
  Arma una factura de prueba real, la firma con un certificado autofirmado (válido para beta, que
  no exige certificado registrado), y la envía al endpoint beta real, verificando el CDR que SUNAT
  devuelve.
- **Integración de componente (servidor SOAP local con el protocolo real)**:
  `packages/adapters/pe-sunat/test/integration/local-soap-server.integration.test.ts`. Levanta un
  servidor HTTP real en `localhost` que habla exactamente el mismo protocolo SOAP/ZIP/CDR que
  SUNAT, y corre el pipeline completo de Factuya contra él por un socket real. No sustituye a la
  prueba contra SUNAT real, pero prueba de punta a punta que el código de Factuya (build, firma,
  zip, SOAP, parseo de CDR) es correcto, sin depender de la red externa.

Correr todo:

```bash
bun install
bun run typecheck        # tsc6 --build (TypeScript 6.x, ver ADR-0001)
bun test                 # unitarias + integración de componente local
bun run test:integration # incluye la prueba contra SUNAT beta real
```

## Limitación de este entorno (léase antes de asumir que "no corrió")

Este monorepo se desarrolló en un sandbox cuya política de red **solo permite salida a un
allowlist** (registro de npm, GitHub, y poco más) — se verificó empíricamente:

```
$ bun -e 'fetch("https://e-beta.sunat.gob.pe/...")' → HTTP 403, cuerpo "request rejected: host not permitted"
$ bun -e 'fetch("https://example.com")'              → también HTTP 403 (no es algo específico de SUNAT)
$ bun -e 'fetch("https://api.github.com")'           → HTTP 200 (GitHub sí está permitido)
```

Por eso, en este entorno, `sunat-beta.integration.test.ts` hace un pre-flight, detecta el bloqueo
(distinguiéndolo de una respuesta real de SUNAT por el texto literal del proxy, no por el código
HTTP solo) y **se omite explícitamente con un mensaje**, en vez de fallar de forma confusa o
fingir que pasó. **El código y el test son reales y correctos** — correrlos en una máquina de
desarrollo normal o en GitHub Actions (que sí tiene salida a internet) ejecutará la aserción real
contra el CDR que SUNAT devuelve. No se pudo, por esta misma razón, descargar el WSDL crudo para
verificación byte a byte — el endpoint/operaciones se verificaron por múltiples fuentes
secundarias cruzadas (ver arriba), pero se recomienda una primera corrida real contra beta desde
un entorno con red normal antes de dar el adaptador por completamente validado.

## Otras limitaciones conocidas, documentadas a propósito (no se inventó una solución)

- **Serie/correlativo**: `PeSunatAdapter` usa un contador en memoria del proceso por defecto
  (`resolveDocumentNumber`), válido solo para desarrollo/tests. Producción necesita un contador
  atómico por tenant en DynamoDB (SDD §11) — no implementado aquí por no haber infraestructura AWS
  disponible en este entorno. La opción es inyectable para no bloquear la implementación futura.
- **`KmsSigner` no implementado**: sin cuenta de AWS ni red hacia AWS en este entorno, no se pudo
  verificar el nombre exacto del `SigningAlgorithm` de KMS contra el servicio real. Ver
  `packages/signing/src/kms-signer.ts` y `.claude/skills/deps-xml-crypto/04-kms-integration.md`
  para el patrón ya investigado y qué falta confirmar.
- **Aceptado-con-observaciones vs rechazado**: `parseCdr` solo distingue `ACCEPTED` (código "0")
  de `REJECTED` (cualquier otro código). SUNAT tiene un catálogo de códigos de observación
  (catálogo 20) que en principio siguen siendo válidos tributariamente, pero no se pudo verificar
  el rango exacto de códigos contra la fuente oficial en este entorno (ver
  `packages/adapters/pe-sunat/src/cdr-parser.ts` para el comentario in situ) — se documenta como
  simplificación deliberada, no como cobertura completa.
- **Monto en letras** (`amountInWords`): SUNAT recomienda incluir el total en letras; Factuya no
  lo genera automáticamente (requeriría un conversor número→letras en español, no implementado) —
  el llamador puede proveerlo opcionalmente en `InvoiceRequest.amountInWords`.
- **Un solo tenant de certificado por adaptador**: `PeSunatAdapter` recibe un `Signer` ya resuelto
  por invocación — el enrutamiento multi-tenant real (resolver certificado/credenciales por
  `tenantId` desde Secrets Manager/KMS) vive en la capa de orquestación (Step Functions/Lambda,
  SDD §5), no implementada en este build de solo-dominio.
