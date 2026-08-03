# Flujos de facturación electrónica: sin Factuya, con Factuya, y qué sigue

Este documento responde tres preguntas de forma directa: cómo emite comprobantes electrónicos
un contribuyente peruano hoy sin Factuya, cómo cambia ese flujo con lo que ya está construido y
validado en este repo, y qué falta para que Factuya cubra el contrato completo descrito en
`docs/sdd/factuya-sdd.md`. Complementa, no reemplaza, ese SDD y `docs/adapters/pe-sunat.md`.

## Estado real del proyecto (no es 100%)

Antes de leer los flujos: el proyecto **no está completo al 100%** respecto al SDD. Lo que sí
está construido, probado, y validado contra el servicio real de SUNAT (no simulado, no mockeado):

- El dominio agnóstico (`packages/core-domain`) y el modelo de datos (`packages/shared-types`).
- El adaptador Perú completo para Factura (`packages/adapters/pe-sunat`): arma UBL 2.1, firma
  XMLDSig (`packages/signing`), envía por SOAP a SUNAT, parsea el CDR.
- Un servidor HTTP real (`apps/api`) que expone ese pipeline por API — ver más abajo, "Con
  Factuya".
- Documentación interactiva de esa API (`GET /docs`, Scalar).
- Cuatro corridas reales consecutivas contra `e-beta.sunat.gob.pe`, todas con CDR real de SUNAT
  y estado `ACCEPTED` (ver `docs/adapters/pe-sunat.md`).
- `KmsSigner` (`packages/signing`) verificado en vivo contra AWS KMS real (2026-08-02, cuenta de
  desarrollo dedicada `factuya-dev`, permisos mínimos): CMK real creada, Grant `Sign`-only real,
  firma real verificada con `crypto.verify()` contra la llave pública real de KMS, limpieza
  confirmada después (ver `docs/aws/kms-live-verification.md` y
  `packages/signing/README.md`).

Lo que el SDD describe y **todavía no existe**:

- Ninguna infraestructura de AWS real más allá de KMS: no hay Lambda, Step Functions, CloudHSM,
  DynamoDB, S3, SQS, ni EventBridge desplegados o siquiera como código IaC (CDK/Terraform).
  `apps/api` es un servidor Bun de un solo proceso, no la arquitectura serverless del SDD §5.
- Multi-tenancy real: un único tenant de desarrollo configurado por variables de entorno, sin
  autenticación de API, sin resolución de certificado/credenciales por tenant.
- Notas de crédito/débito, guías de remisión, resúmenes diarios/comunicación de baja (flujo
  asíncrono `sendSummary`/`getStatus`), y SIRE.
- El adaptador Colombia (`co-factus`) — solo existe como referencia en el SDD, ningún código.
- Persistencia real (DynamoDB/S3) — hoy es un `Map` en memoria que se vacía en cada reinicio.
- Webhooks de notificación al sistema cliente (`invoice.status.updated`).

Dicho eso, la parte que sí existe no es un prototipo desechable: es el mismo pipeline que
correría en producción (build → firma → envío → CDR), con la única sustitución pendiente siendo
el `Signer` (local hoy, KMS en producción — la interfaz ya está diseñada para ese cambio sin
tocar el resto del código) y la capa de infraestructura alrededor.

## Flujo sin Factuya (lo que hace hoy un contribuyente peruano por su cuenta)

Para que un negocio en Perú emita una factura electrónica válida ante SUNAT sin ningún
intermediario tecnológico como Factuya, tiene que resolver, por su cuenta, todo esto:

1. **Elegir una modalidad de emisión** entre las cuatro que reconoce SUNAT: el portal gratuito
   SEE-SOL (manual, comprobante por comprobante, no integrable con un sistema de ventas), el
   Facturador SUNAT descargable (similar, para bajo volumen), un sistema propio (SEE del
   Contribuyente), o contratar un Operador de Servicios Electrónicos (SEE-OSE).
2. **Obtener y mantener vigente un certificado digital** (X.509 v3) y un usuario secundario de
   Clave SOL — y renovarlo antes de que expire, porque un certificado vencido corta la emisión.
3. Si elige sistema propio: **construir el motor de generación UBL 2.1** — namespaces exactos,
   catálogos de SUNAT (tipo de documento, tipo de moneda, afectación de IGV, unidad de medida),
   series y correlativos sin duplicados bajo concurrencia.
4. **Implementar la firma XMLDSig** (canonicalización `exclusive-c14n`, `RSA-SHA256`) sobre ese
   XML, y custodiar la clave privada del certificado de forma segura.
5. **Comprimir el XML firmado a ZIP** con la convención de nombre exacta de SUNAT
   (`RUC-TIPO-SERIE-CORRELATIVO.zip`) y **hablar el protocolo SOAP** de `billService` — incluyendo
   WS-Security con usuario/clave, y manejar el hecho documentado de que el servicio de SUNAT no
   siempre responde de forma consistente (ver el hallazgo de este mismo repo en
   `docs/adapters/pe-sunat.md` sobre el pool de beta).
6. **Interpretar el CDR** que devuelve SUNAT (o el OSE contratado): aceptado, aceptado con
   observaciones, o rechazado — y sobre eso, decidir si el comprobante es válido tributariamente.
7. **Conservar** el XML enviado y el CDR recibido por el plazo legal correspondiente.
8. Si además necesita facturar en otro país (ej. una empresa peruana que expande a Colombia),
   **repetir todo lo anterior desde cero** contra un estándar completamente distinto (DIAN/Factus:
   REST + JSON en vez de SOAP + XML, XAdES-EPES en vez de XMLDSig, OAuth2 en vez de WS-Security).

Cada punto de esta lista es, hoy, trabajo real de ingeniería que un equipo de producto tiene que
mantener — o un costo recurrente pagado a un OSE que solo resuelve parte de la lista (típicamente
del punto 5 en adelante, no el 3 ni el 4 si el negocio quiere seguir siendo dueño de su propio
sistema de facturación en vez de depender por completo del portal de un tercero).

## Flujo con Factuya (lo que ya funciona hoy en este repo)

Con lo que ya está construido y validado, el mismo negocio hace una sola llamada HTTP con un
JSON simple, y todo lo anterior queda resuelto por Factuya:

1. El sistema cliente (ERP, e-commerce, POS) hace `POST /v1/invoices` a `apps/api` con un
   `InvoiceRequest` agnóstico — sin XML, sin SOAP, sin campos específicos de SUNAT más allá de
   los pocos catálogos mínimos que expone `GET /v1/catalogs/PE/...`.
2. `apps/api` resuelve el tenant (hoy: configuración fija de desarrollo; en producción: por
   `tenantId`) y llama a `emitInvoice()` (`packages/core-domain`).
3. `PeSunatAdapter.build()` arma el XML UBL 2.1 completo — namespaces, catálogos,
   `cac:PaymentTerms`, `cac:RegistrationAddress` con el código de establecimiento — sin que el
   llamador tenga que conocer ninguno de esos detalles.
4. `packages/signing` firma el XML con XMLDSig (`exclusive-c14n`, `RSA-SHA256`) a través de un
   `Signer` inyectable — hoy una clave local, en producción una llamada a KMS sin exponer la
   clave privada.
5. `PeSunatAdapter.submit()` comprime a ZIP, arma el envelope SOAP con WS-Security, y llama al
   servicio real de SUNAT — con reintento automático ante la inconsistencia conocida del pool de
   beta (ver `docs/adapters/pe-sunat.md`).
6. SUNAT devuelve el CDR real; Factuya lo desempaqueta, lo interpreta, y responde al cliente con
   un `InvoiceResult` normalizado: `status` (`ACCEPTED`/`REJECTED`/...), el identificador del
   documento, el código de referencia, y la respuesta cruda para depuración si hace falta.
7. El cliente puede volver a consultar ese mismo resultado con `GET /v1/invoices/{id}` sin
   volver a hablar con SUNAT.
8. Todo el contrato queda documentado y navegable en `GET /docs` (Scalar, generado desde
   `openapi.yaml`), sin que el equipo integrador necesite leer el SDD interno de Factuya.

Verificado de punta a punta contra SUNAT beta real, con una llamada HTTP real a `apps/api`
(no una prueba unitaria): respuesta `201`, `status: "ACCEPTED"`,
`"La Factura numero F001-1, ha sido aceptada"` — el mismo texto que devuelve SUNAT, sin que
Factuya lo reformule ni lo invente.

El punto 8 del flujo "sin Factuya" (repetir todo para un segundo país) es exactamente lo que la
arquitectura de puertos y adaptadores está diseñada para evitar — cuando exista `co-factus`, el
mismo `POST /v1/invoices` con el mismo contrato agnóstico funcionará contra Colombia, cambiando
solo el adaptador que resuelve el `tenantId`, no el contrato que ve el integrador.

## El flujo que sigue (roadmap, en orden de dependencia)

No es una lista de deseos sin orden — cada paso depende del anterior o desbloquea el siguiente.
Para la parte de infraestructura AWS específicamente, `docs/aws/aws-infrastructure-sdd.md` es el
documento vivo que trackea, servicio por servicio, qué ya está verificado en una cuenta real vs.
qué sigue siendo diseño — se actualiza en cada pieza nueva que se construye.

1. **Multi-tenant real**: autenticación por API key/JWT en `apps/api`, resolución de
   `TenantConfig` por tenant (hoy es una constante), y el endpoint
   `POST /v1/tenants/{id}/certificate` del SDD §7 (todavía no implementado). Sin esto, todo lo
   demás sigue siendo de un solo tenant de desarrollo.
2. **Infraestructura como código** (CDK o Terraform, ver SDD §11): Lambda + Step Functions + SQS
   DLQ + DynamoDB + S3, replicando el mismo pipeline que hoy corre como proceso único en
   `apps/api`. El código de dominio no debería necesitar cambios grandes — ya está separado por
   puertos — pero el *empaquetado* y la *orquestación* si son trabajo nuevo completo. El usuario
   IAM `factuya-dev` (permisos mínimos, ver `docs/aws/`) ya está creado y puede irse ampliando con
   una policy acotada por cada pieza nueva, en vez de una policy amplia de una sola vez.
3. **Persistencia real**: DynamoDB para estado/correlativos por tenant (con locking optimista
   para evitar duplicados bajo concurrencia — hoy el contador es un entero en memoria, solo
   válido para un proceso), S3 para XML/CDR/PDF.
4. **Flujo asíncrono SUNAT** (`sendSummary`/`getStatus`, resúmenes y bajas) y notas de
   crédito/débito — extienden `PeSunatAdapter`, que ya tiene el puerto (`checkStatus`) preparado
   pero sin implementación real todavía.
5. **Webhooks** (`invoice.status.updated`) — una vez que exista el flujo asíncrono, tiene sentido
   notificar en vez de solo permitir polling por `GET /v1/invoices/{id}`.
6. **Adaptador `co-factus` (Colombia)**: el primer adaptador de un segundo país, siguiendo el
   mismo proceso de investigación de dependencias (`.claude/agents/dependency-skill-agent.md`)
   para la librería de XAdES-EPES que documenta el SDD §12 como pendiente.
7. **Observabilidad de producción**: CloudWatch/X-Ray o equivalente, alarmas sobre tickets
   pendientes — solo tiene sentido una vez que exista el flujo asíncrono real desplegado (punto 4
   y 2 combinados).

Los pasos 1 a 3 son los que bloquean que Factuya deje de ser "un pipeline validado que corre en
un proceso de desarrollo" y pase a ser "un servicio multi-tenant en producción" — son el trabajo
inmediato siguiente, no una elección arbitraria de prioridad.
