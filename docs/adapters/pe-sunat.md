# Adaptador Perú — SUNAT

Implementación real en `packages/adapters/pe-sunat`, `packages/signing`, `packages/core-domain`.
Este documento registra lo que se verificó y cómo, siguiendo `docs/sdd/factuya-sdd.md` §16: nada
aquí se afirma sin una fuente citada o sin haberse ejecutado de verdad contra código real.

## Estado

MVP funcional y **validado end-to-end contra el servicio real de SUNAT beta** (2026-07-31, 4
corridas reales consecutivas, todas `ACCEPTED` con CDR real: *"La Factura numero F001-N, ha sido
aceptada"*): Factura (tipo 01), flujo síncrono (`sendBill`), firma XMLDSig real con un `Signer`
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

### Hallazgo empírico confirmado: el pool de e-beta.sunat.gob.pe es inconsistente entre nodos (2026-07-31)

Una primera corrida real (sin salida de red bloqueada) devolvió `HTTP 401` con cuerpo HTML genérico
de nginx. El diagnóstico inicial (un gate `auth_basic` delante del servicio) resultó **incompleto**:
una investigación posterior con curl directo contra el endpoint, en la misma corrida, mostró que el
**mismo envelope idéntico** devuelve 200 o 401 de forma intercalada entre requests consecutivos:

```
8 intentos SIN header Authorization -> 200,401,200,200,401,200,200,401  (3/8 en 401)
8 intentos CON  header Authorization -> 200,200,200,200,200,200,200,200 (0/8 en 401)
```

Conclusión: no es un problema de credenciales ni de WS-Security — es un balanceador con nodos
inconsistentes en el pool de beta, donde solo un subconjunto exige `auth_basic`. Enviar
`Authorization: Basic base64(RUC+usuarioSOL:claveSOL)` (mismas credenciales del WS-Security) reduce
la tasa de 401 pero no la elimina de forma determinista. Por eso `sendBill()` en `soap-client.ts`
además reintenta (hasta 4 veces, backoff 250ms–2s) específicamente ante un 401 cuyo cuerpo es HTML
plano (no un SOAP Fault XML) — así no se reintenta nunca un rechazo real del WS-Security, que SUNAT
siempre devuelve como XML. Confirmado estable en 4 corridas reales consecutivas después del fix.

El WSDL real (`?wsdl` y el importado `?ns1.wsdl`) sí se pudo descargar en un entorno con red normal
— confirma namespace `http://service.sunat.gob.pe`, operación `sendBill` con `soapAction="urn:sendBill"`,
estilo `document`/literal envuelto, y coincide con lo ya documentado por fuentes cruzadas (nota
oficial de SUNAT sobre el servicio beta, Greenter, foros de implementadores).

### Otros dos hallazgos reales encontrados en la primera corrida completa end-to-end contra beta

1. **XSD: atributo `Id` inesperado en `<Invoice>` raíz** — SUNAT rechazó el XML con
   `cvc-complex-type: element Invoice ... had undefined attribute Id`. Causa real: `xml-crypto`
   agrega automáticamente un atributo `Id="_0"` al nodo referenciado por `addReference({ xpath: "/*" })`
   para poder generar `Reference URI="#_0"` — comportamiento correcto de XML-DSig en general, pero
   `InvoiceType` de UBL 2.1 no declara ese atributo, así que rompe la validación estricta de SUNAT.
   Corregido en `packages/signing/src/xml-dsig-signer.ts` pasando `isEmptyUri: true` a
   `addReference()`, que genera `Reference URI=""` (la referencia estándar "todo el documento" de
   XML-DSig) sin tocar el elemento raíz.
2. **Fault de negocio 3244: falta `cac:PaymentTerms`** — "Debe consignar la información del tipo de
   transacción del comprobante". El builder no emitía este bloque. Corregido agregando
   `<cac:PaymentTerms><cbc:ID>FormaPago</cbc:ID><cbc:PaymentMeansID>Contado|Credito</cbc:PaymentMeansID></cac:PaymentTerms>`,
   verificado contra `Factura-Gravada.xml` de Greenter (ver fuente abajo). Controlable vía el nuevo
   campo agnóstico `InvoiceRequest.paymentMeans` ("CASH" por defecto).
3. **Fault de negocio 3030: falta el código de establecimiento del emisor** — "no existe información
   del código de local anexo del emisor". El builder solo emitía `cac:RegistrationAddress` (que
   contiene `cbc:AddressTypeCode`, el código de establecimiento, "0000" por defecto) cuando el
   `PartyRef` del emisor traía una `address` completa. SUNAT exige este bloque para el emisor
   siempre, aunque no se provea dirección completa — corregido en `buildPartyBlock()`
   (`ubl-invoice-builder.ts`) para emitirlo siempre que `isSupplier`, con "PE" como país por defecto.

Los tres se descubrieron y corrigieron iterando contra el CDR real de SUNAT beta (no adivinados),
comparando además campo a campo contra `Factura-Gravada.xml`, el ejemplo real de Greenter
(https://gist.github.com/giansalex/53d3b6dadb5305ee95928a854ee3abc4) — misma fuente ya citada abajo
para la estructura general del UBL.

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

Parte de este monorepo se desarrolló en un sandbox cuya política de red **solo permite salida a un
allowlist** (registro de npm, GitHub, y poco más) — se verificó empíricamente:

```
$ bun -e 'fetch("https://e-beta.sunat.gob.pe/...")' → HTTP 403, cuerpo "request rejected: host not permitted"
$ bun -e 'fetch("https://example.com")'              → también HTTP 403 (no es algo específico de SUNAT)
$ bun -e 'fetch("https://api.github.com")'           → HTTP 200 (GitHub sí está permitido)
```

Por eso, en ese entorno, `sunat-beta.integration.test.ts` hace un pre-flight, detecta el bloqueo
(distinguiéndolo de una respuesta real de SUNAT por el texto literal del proxy, no por el código
HTTP solo) y **se omite explícitamente con un mensaje**, en vez de fallar de forma confusa o
fingir que pasó.

**Actualización 2026-07-31 — confirmado desde una máquina con red normal**: se corrió el adaptador
completo desde un entorno sin esa restricción (Windows, red normal). Esto permitió: descargar el
WSDL/XSD real de SUNAT beta byte a byte (antes no era posible, solo fuentes secundarias cruzadas),
diagnosticar con curl directo el comportamiento real del 401 intercalado (ver sección de arriba), y
validar el pipeline completo contra el CDR real de SUNAT — 4 corridas consecutivas, todas
`ACCEPTED`. El adaptador ya no depende de fuentes secundarias sin confirmar para su funcionamiento
básico; lo que queda "no confirmado contra fuente oficial" son casos fuera del MVP (notas de
crédito/débito, observado-vs-rechazado, ver abajo), no el flujo principal.

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
