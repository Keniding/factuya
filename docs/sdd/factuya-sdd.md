# Factuya — Spec-Driven Development (SDD)
**Sistema intermediario agnóstico de facturación electrónica**
Versión 0.9 · MVP: Perú (SUNAT) · Arquitectura lista para Colombia (Factus/DIAN) y otros países

> Historial: v0.1 fue la primera versión del spec. v0.2 incorpora políticas de desarrollo (§15),
> gestión de dependencias sin alucinación (§16), y dos correcciones técnicas verificadas contra
> fuentes actuales (ver ADR-0001 y ADR-0002) que v0.1 dejaba imprecisas. v0.3 agrega `apps/api`
> (servidor HTTP real, validado contra SUNAT beta) y su documentación interactiva (§7 ahora
> distingue el contrato aspiracional de este documento del contrato real implementado en
> `apps/api/openapi.yaml`). v0.4 implementa `KmsSigner` real (§9) sobre una CMK de KMS compartida
> por ambiente con aislamiento por tenant vía Grants, en vez de una CMK por tenant — decisión
> motivada por costo a escala, documentada en ADR-0003. v0.5 confirma `KmsSigner` con una corrida
> real contra AWS KMS (2026-08-02, no solo contra tipos/documentación) — ver
> `docs/aws/kms-live-verification.md` — y deja de ser la única pieza del MVP sin validar en vivo.
> v0.6 implementa multi-tenant real en `apps/api` (§7, ADR-0004): API Key (no JWT) resuelta vía
> `TenantRegistry`, con aislamiento real entre tenants. v0.7 corrige el diseño de KMS (ADR-0005
> reemplaza ADR-0003: una CMK **por tenant**, no compartida — la versión anterior implicaba que
> todos los tenants firmarían con la misma identidad criptográfica, contradiciendo el §13) e
> implementa `POST /v1/tenants/{id}/certificate` (ADR-0006: import real de la clave privada del
> tenant, AES-KWP/RFC 5649 implementado a mano y validado contra los vectores oficiales del RFC) —
> ver `docs/flows.md` para el detalle completo y el estado honesto de qué falta. v0.8 confirma ese
> import de clave con una corrida real contra AWS KMS (2026-08-03, no solo contra un `KMSClient`
> falso) — ver `docs/aws/kms-live-verification.md` Paso 4b. v0.9 arranca la infraestructura como
> código (ADR-0007: AWS CDK en TypeScript, no Terraform — `apps/infra`, todavía solo un scaffold
> sintetizado localmente, sin recursos reales ni despliegue contra AWS).

---

## 1. Visión

Factuya es una capa de abstracción (middleware) que recibe una factura/comprobante en un **JSON simple y agnóstico**, y se encarga de todo lo demás: generar el XML en el estándar del país correspondiente, firmarlo digitalmente, enviarlo al ente tributario o a su operador autorizado, esperar la validación, y devolver al sistema cliente un resultado normalizado (PDF, XML, CDR/estado, hash de verificación), **sin que ese sistema cliente necesite saber nada de SOAP, UBL, firma digital ni de las reglas internas de cada país**.

El objetivo no es competir por precio con un OSE — es ser la **interfaz de desarrollador** sobre uno o varios OSE/operadores, agnóstica al ERP/e-commerce/POS que la consuma y agnóstica al país detrás.

## 2. Alcance del MVP

- **Incluido:** Perú — SUNAT, vía un Operador de Servicios Electrónicos (SEE-OSE) o conexión directa (SEE del Contribuyente). Comprobantes: Factura, Boleta de Venta, Nota de Crédito, Nota de Débito. Flujo síncrono y asíncrono. CDR y consulta de estado.
- **Preparado, no implementado en MVP:** adaptador Factus/DIAN (Colombia), y estructura para SRI (Ecuador), SAT (México), Facturae (España) — todos siguen el mismo contrato de puerto (`CountryAdapter`).
- **Fuera de alcance del MVP:** Guías de remisión, retenciones/percepciones, SIRE (registro de ventas/compras), resumen diario de boletas — quedan como fase 2 dentro del propio adaptador Perú.

## 3. Glosario mínimo (Perú)

| Término | Significado |
|---|---|
| **UBL 2.1** | Estándar XML (OASIS) en el que se estructura el comprobante. Formato exigido por SUNAT. |
| **XMLDSig** | Firma digital estándar W3C embebida en el XML (`ds:Signature`/`ds:SignedInfo`, SHA-256, certificado X.509 v3). Es el estándar que exige **SUNAT** — ver nota de precisión abajo. |
| **XAdES** | Extensión de XMLDSig con propiedades calificadas adicionales (firmante, política, timestamp). **No** es lo que exige SUNAT para el CPE; sí es lo que exige DIAN/Factus en Colombia (perfil XAdES-EPES). Ver ADR-0002. |
| **OSE** | Operador de Servicios Electrónicos — valida el comprobante antes de que llegue a SUNAT. |
| **PSE** | Proveedor de Servicios Electrónicos — facilita la emisión desde el sistema del contribuyente. OSE y PSE trabajan juntos, no son sustitutos. |
| **CDR** | Constancia de Recepción — la respuesta que da validez tributaria al comprobante. |
| **Ticket** | Identificador que devuelve SUNAT en el envío asíncrono (resúmenes, bajas), para luego consultar el resultado. |
| **SEE-SOL / SEE Contribuyente / SEE-OSE / Facturador SUNAT** | Las 4 modalidades de emisión electrónica. Factuya implementa el patrón SEE-OSE / SEE Contribuyente. |

> **Nota de precisión (v0.1 → v0.2):** la v0.1 de este documento usaba "XML-DSig/XAdES" de forma
> intercambiable para SUNAT. Es impreciso: SUNAT exige **XMLDSig estándar** (firma enveloped,
> `ds:Signature` embebido en el UBL, `RSA-SHA256`, canonicalización `exclusive-c14n`), consignada en
> dos contenedores UBL (`ext:UBLExtensions` y `cac:Signature`) según las Guías de Elaboración de
> Documentos XML oficiales de SUNAT (una por tipo de comprobante). **No** exige las propiedades
> calificadas de XAdES (`xades:QualifyingProperties`). Esto sí aplica para Colombia/DIAN (perfil
> XAdES-EPES), lo cual es relevante porque cambia qué librería usa cada adaptador — ver §9 y ADR-0002.

## 4. Principios de arquitectura

1. **Arquitectura hexagonal (puertos y adaptadores).** El *core* (dominio: validar factura, orquestar flujo, normalizar respuesta) no conoce SOAP, UBL ni SUNAT. Solo conoce un puerto `CountryAdapter` con métodos `build()`, `sign()`, `submit()`, `checkStatus()`.
2. **Un país = un adaptador.** `adapters/pe-sunat`, `adapters/co-factus`, etc. Cada adaptador encapsula: mapeo JSON→XML/UBL, reglas de negocio locales (series, catálogos, IGV/IVA), endpoint(s), y forma de autenticación.
3. **Multi-tenant desde el diseño, no como parche.** Cada tenant (empresa cliente de Factuya) tiene: su propio certificado digital, sus propias credenciales SOL/OSE, sus series/correlativos, y aislamiento total de datos y de operaciones de firma.
4. **Serverless orientado a evento, no a servidor siempre activo** — justo para el objetivo de evitar costos 24/7: todo el flujo (recepción → armado XML → firma → envío → espera CDR) se modela como una máquina de estados event-driven, no como un servicio corriendo en loop.
5. **Sin alucinación normativa ni de dependencias.** Todo comportamiento específico de SUNAT (series de 4 caracteres, campos obligatorios, catálogos de tipo de documento/moneda/afectación IGV) se implementa contra la "Guía de Elaboración de Documentos XML UBL 2.1" oficial de SUNAT y se versiona — no se improvisa. El mismo principio aplica a **toda dependencia de software**: ninguna versión ni API se asume desde el entrenamiento del modelo; se investiga y documenta antes de instalarse (ver §16). Se recomienda además validar el motor de generación XML contra un handler ya probado en producción (Greenter en PHP, `xhandler-java`/`xhandler-rust` de OpenUBL) en lugar de reescribir el mapeo UBL desde cero.

## 5. Arquitectura de alto nivel (AWS)

```
Cliente (ERP/E-commerce/POS)
        │  POST /v1/invoices  (JSON agnóstico + tenant_id)
        ▼
 API Gateway (HTTP API) ── Auth (API Key / JWT por tenant)
        │
        ▼
 Lambda: IngestHandler
   - valida payload (schema JSON del dominio, no de SUNAT)
   - persiste "intención de emisión" (DynamoDB, estado=RECEIVED)
   - dispara Step Functions
        │
        ▼
 Step Functions: InvoiceEmissionWorkflow
   1. BuildDocument (Lambda)   → arma UBL 2.1 desde JSON usando el adaptador del país del tenant
   2. SignDocument (Lambda)    → firma vía AWS KMS/CloudHSM (la clave privada NUNCA sale del HSM)
   3. SubmitToSunat (Lambda)   → SOAP sendBill (síncrono) o sendSummary (asíncrono, guarda ticket)
   4. [si asíncrono] Wait + PollStatus (Lambda, con backoff) → consulta ticket hasta CDR
   5. StoreResult (Lambda)     → guarda XML, CDR, PDF representación impresa en S3; actualiza DynamoDB
   6. NotifyTenant (Lambda)    → webhook/SQS de vuelta al sistema cliente con resultado normalizado
        │
        ▼
 S3 (XML, CDR, PDF)  +  DynamoDB (estado, metadatos, series/correlativos)  +  SQS DLQ (reintentos/errores)
```

Componentes de soporte:
- **AWS KMS + CloudHSM (o Secrets Manager con envelope encryption)**: custodia de certificados `.pfx` / claves privadas por tenant. La operación de firma se ejecuta como llamada a KMS, no cargando la clave en memoria de la Lambda.
- **EventBridge**: eventos de dominio (`invoice.accepted`, `invoice.rejected`, `invoice.observed`) para que otros módulos (facturación recurrente, dashboards) reaccionen sin acoplarse.
- **CloudWatch + X-Ray**: trazabilidad de cada envío (crítico porque SUNAT puede tardar en resolver tickets asíncronos).
- **Step Functions Standard** (no Express) para el workflow, porque las esperas del flujo asíncrono de SUNAT pueden extenderse más allá del límite de Express.

## 6. Modelo de dominio (agnóstico)

```typescript
interface InvoiceRequest {
  tenantId: string;
  documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE"; // agnóstico
  series?: string;          // si no se envía, Factuya la resuelve según reglas del país
  issueDate: string;
  currency: string;         // ISO 4217
  issuer: PartyRef;         // resuelto contra el perfil del tenant, no se repite en cada llamada
  customer: Party;
  lines: InvoiceLine[];
  taxes: TaxSummary[];      // normalizado; el adaptador traduce a IGV/IVA/etc.
  legalNotes?: string[];
  amountInWords?: string;   // algunos países (Perú) lo exigen literal en el XML
  paymentMeans?: "CASH" | "CREDIT"; // default "CASH" — SUNAT exige informar esto (cac:PaymentTerms)
}

interface InvoiceResult {
  status: "ACCEPTED" | "REJECTED" | "OBSERVED" | "PENDING";
  countryDocumentId: string;   // p.ej. "F001-00000123"
  countryReferenceCode?: string; // CDR id, CUFE (Colombia), etc.
  xmlUrl: string;
  pdfUrl: string;
  cdrUrl?: string;
  rawProviderResponse: Record<string, unknown>; // para debugging, nunca expuesto al mapeo agnóstico
}
```

El adaptador `pe-sunat` traduce este modelo a UBL 2.1 real (con sus namespaces `cac`/`cbc`, catálogos SUNAT de tipo de documento, tipo de moneda, tipo de afectación IGV, unidad de medida, etc.).

## 7. Contrato API público (lo que ve el desarrollador integrador)

Este es el contrato **aspiracional completo** de producción. El contrato **real, ya implementado
y validado contra SUNAT beta**, es un subconjunto — ver `apps/api/openapi.yaml` (fuente de verdad
del contrato real, servido interactivamente en `GET /docs` vía Scalar) y `docs/flows.md` para el
detalle exacto de qué difiere y por qué. Diferencias principales hoy: `POST /v1/invoices` responde
**201 síncrono** (no 202 + webhook, el adaptador SUNAT del MVP solo implementa `sendBill`
síncrono), no existe todavía `POST /v1/invoices/{id}/void` ni el webhook, y `GET /v1/catalogs`
expone solo el subconjunto mínimo que el MVP soporta. **La autenticación "API Key / JWT por
tenant" ya está decidida y real**: API Key, no JWT (ADR-0004) — `Authorization: Bearer <api_key>`
en todo endpoint bajo `/v1/invoices*`. **`POST /v1/tenants/{id}/certificate` ya está
implementado** (ADR-0005/ADR-0006): cada tenant se da de alta con su propio certificado real y su
propia CMK dedicada en KMS — admin-only (una API key de administrador separada, sin RBAC real
todavía), y solo acepta certificado/clave en PEM por separado, no `.pfx`/PKCS#12.

```
POST   /v1/invoices                → emite un comprobante (asíncrono; responde 202 + invoiceId)
GET    /v1/invoices/{id}            → estado normalizado + URLs de XML/PDF/CDR
POST   /v1/invoices/{id}/void       → comunicación de baja (cuando aplica)
GET    /v1/catalogs/{country}/{catalog} → catálogos vigentes (tipo doc, moneda, unidad medida...)
POST   /v1/tenants/{id}/certificate → sube certificado .pfx (se cifra y va directo a KMS/Secrets Manager)
Webhook: invoice.status.updated     → notificación push al sistema cliente
```

Todo en JSON. El cliente jamás ve XML, SOAP, ni WSDL — eso vive exclusivamente dentro del adaptador `pe-sunat`.

## 8. Flujo detallado del adaptador SUNAT (Perú)

1. **Resolución de credenciales del tenant**: usuario secundario de Clave SOL (nunca la clave SOL maestra), y certificado digital vigente.
2. **Armado UBL 2.1**: namespaces obligatorios, `ID` = serie (4 caracteres, ej. `F001`) + correlativo, `ProfileID` según tipo de operación, catálogos SUNAT (moneda, IGV, unidad de medida, tipo de documento).
3. **Firma XMLDSig**: `CanonicalizationMethod` exclusive-c14n, `SignatureMethod` RSA-SHA256, firma enveloped en `ext:UBLExtensions`/`cac:Signature` según la Guía XML UBL 2.1 del tipo de comprobante — operación delegada a KMS (ver §9 y ADR-0002; no es XAdES).
4. **Compresión**: el XML firmado se comprime a ZIP con nombre de archivo según convención SUNAT (`RUC-TIPO-SERIE-CORRELATIVO.zip`).
5. **Envío SOAP**: `sendBill` (síncrono, factura/boleta/notas) contra el endpoint vigente del servicio de facturación (billService), o `sendSummary` (asíncrono, resúmenes/bajas) que retorna un **ticket**.
6. **Si es asíncrono**: Step Functions hace polling con backoff exponencial contra el servicio de consulta de ticket hasta obtener el CDR.
7. **CDR**: se descomprime, se interpreta el código de respuesta (aceptado / aceptado con observaciones / rechazado) y se normaliza a `InvoiceResult.status`.
8. **Persistencia**: XML enviado + CDR recibido se guardan en S3 con retención (obligación legal de conservación).

**Nota de diseño importante**: no reescribir el mapeo UBL y el cliente SOAP desde cero sin referencia — validar cada campo contra la Guía XML UBL 2.1 oficial de SUNAT (una guía por tipo de comprobante: factura, boleta, nota de crédito, nota de débito) y usar como referencia cruzada implementaciones probadas en producción (Greenter en PHP, `xhandler-java`/`xhandler-rust` de OpenUBL) para evitar errores sutiles de namespace o de catálogo que SUNAT rechaza silenciosamente.

## 9. Seguridad y gestión de certificados (crítico, multi-tenant)

- Cada tenant sube su certificado + clave privada real vía `POST /v1/tenants/{id}/certificate`
  (implementado — ver ADR-0006; hoy PEM por separado, `.pfx`/PKCS#12 queda pendiente). La clave se
  envuelve localmente (AES Key Wrap con Padding RFC 5649 + RSA-OAEP-SHA-256) e importa a **su
  propia CMK asimétrica dedicada en AWS KMS** — nunca queda en texto plano en S3, DynamoDB, ni
  variables de entorno de Lambda.
- La operación `Sign()` es una llamada a KMS (`Sign` API, algoritmo `RSASSA_PKCS1_V1_5_SHA_256`, `MessageType: RAW` sobre el `ds:SignedInfo` ya canonicalizado) — la Lambda nunca tiene la clave privada en memoria. Implementado en `packages/signing/src/kms-signer.ts` y **verificado en vivo contra AWS KMS real** (2026-08-02): CMK real creada, firma verificada con `crypto.verify()` contra la llave pública real de KMS — ver `packages/signing/README.md` y `docs/aws/kms-live-verification.md`.
- Librería de firma XMLDSig para el adaptador `pe-sunat`: ver skill `.claude/skills/deps-xml-crypto.md` (investigada y documentada siguiendo el proceso de §16). Para el adaptador `co-factus` (fase 2) se requiere una librería XAdES-EPES distinta — no reutilizar `xml-crypto` sin extensión, ver ADR-0002.
- **Aislamiento por tenant: una CMK por tenant** (ADR-0005, reemplaza ADR-0003 — una versión
  anterior de este documento decidió una CMK compartida entre tenants con Grants; se corrigió
  porque eso implicaba que todos los tenants firmarían con la misma identidad criptográfica,
  contradiciendo el modelo de responsabilidad de §13). El costo de KMS crece linealmente con el
  número de tenants (~$1-3/mes cada uno) — evaluado como aceptable incluso a cientos de tenants,
  ver ADR-0005 para la comparación contra alternativas (CloudHSM, AWS Payment Cryptography, ambas
  descartadas por no ser más baratas a esta escala).
- Rotación y expiración de certificados: job programado (EventBridge Scheduler) que alerta 30/15/7 días antes del vencimiento del certificado de cada tenant.
- Credenciales SOL/OSE por tenant en Secrets Manager, con rotación soportada.

## 10. Estructura del monorepo

```
factuya/
├── apps/
│   └── api/                    # API Gateway + Lambdas de ingreso/consulta (TypeScript, Node.js)
├── packages/
│   ├── core-domain/            # modelo agnóstico, puertos, orquestación (sin dependencias de país)
│   ├── adapters/
│   │   ├── pe-sunat/           # UBL 2.1, XMLDSig, SOAP client, catálogos SUNAT
│   │   └── co-factus/          # (fase 2) REST client Factus/DIAN, firma XAdES-EPES
│   ├── signing/                # wrapper sobre KMS/CloudHSM
│   └── shared-types/           # tipos compartidos (InvoiceRequest, InvoiceResult...)
├── infra/                      # apps/infra en el código real — IaC con AWS CDK (ADR-0007), no Terraform
├── .claude/
│   ├── agents/                 # agentes especializados del repo (ver §16)
│   └── skills/                 # skills de dependencias + skills de dominio, generadas sin alucinar
└── docs/
    ├── sdd/                    # este documento y sus revisiones
    ├── adr/                    # Architecture Decision Records
    ├── policies/               # políticas de git, commits, documentación
    └── dependencies/           # ledger de dependencias investigadas
```

Justificación de monorepo para el MVP: un solo país activo, equipo pequeño, y necesitas iterar rápido en el contrato entre `core-domain` y `adapters/pe-sunat` sin fricción de versionado entre repos. La migración a polyrepo (cuando existan 3+ adaptadores de país con ciclos de release independientes) es mecánica gracias a que ya están separados por paquete.

## 11. Infraestructura como código y stack recomendado

> Ver `docs/aws/aws-infrastructure-sdd.md` para el estado real y vivo de esta sección — qué de lo
> descrito abajo ya existe verificado en una cuenta de AWS real (hoy: solo KMS) y qué sigue siendo
> el diseño aspiracional.

- **Lenguaje**: TypeScript — mejor madurez de librerías de firma XML y mejor cold-start en Lambda que JVM.
- **Compilador/type-check**: `typescript@6.0.2` (paquete `@typescript/typescript6`) como fuente de verdad para build y CI — **no** `typescript@7.0.2` todavía, porque el ecosistema de tooling (`typescript-eslint`, `ts-jest`/equivalentes, `ts-morph`) aún no soporta la API programática de TS7 (estable recién en TS 7.1, ~oct. 2026). Ver ADR-0001. Se puede correr `tsgo` (TS7 nativo) en paralelo como chequeo rápido no bloqueante en CI, pero no como *source of truth*.
- **Package manager / runtime de desarrollo**: **Bun** (`bun install`, `bun run`, `bun test`, `bun build`) para todo el monorepo TypeScript — equivalente a lo que `uv` es para Python. **Importante**: Bun **no** es un runtime gestionado oficialmente por AWS Lambda (no existe `provided.bun` como managed runtime). El flujo correcto es: desarrollar/testear/bundlear con Bun, pero **desplegar el artefacto compilado sobre el runtime oficial `nodejs` de Lambda** (Bun solo como custom runtime/layer quedaría descartado para el MVP por complejidad operativa extra en un sistema donde la disponibilidad es crítica). Revisar en cada release de Bun si esto cambia antes de asumir lo contrario.
- **IaC**: AWS CDK (TypeScript, coherente con el resto del stack) — decidido sobre Terraform en
  ADR-0007. `apps/infra` ya tiene el scaffold, sintetizado localmente; sin recursos reales ni
  despliegue todavía.
- **Orquestación**: Step Functions Standard.
- **Cola/DLQ**: SQS para reintentos de envíos fallidos a SUNAT (caídas del servicio son frecuentes y documentadas).
- **Datos**: DynamoDB (estado de comprobantes, series/correlativos con locking optimista para evitar duplicados) + S3 (XML/CDR/PDF).
- **Observabilidad**: CloudWatch Logs + X-Ray, alarmas sobre tickets pendientes más de X minutos.

## 12. Roadmap fase 2 (Colombia — Factus/DIAN)

- Nuevo paquete `adapters/co-factus`: cliente REST (OAuth2, access token 1h + refresh token), sin necesidad de manejar SOAP.
- Reutiliza `core-domain`, `apps/api`; **no** reutiliza `signing` tal cual, porque Factus/DIAN exige perfil **XAdES-EPES** (propiedades calificadas), distinto del XMLDSig plano de SUNAT — requiere su propia librería/skill investigada (ver ADR-0002).
- Añade catálogo UNSPSC y eventos RADIAN (acuse, aceptación) al modelo de `InvoiceResult` como extensión opcional por país.

## 13. Modelo de responsabilidad legal (DECIDIDO)

**Factuya = proxy/agente intermediario tecnológico, no OSE/PSE homologado.**

- Factuya **no se homologa ante SUNAT como Operador de Servicios Electrónicos**. No asume la responsabilidad tributaria/legal de validar comprobantes en nombre de terceros.
- Cada **tenant** mantiene su propia identidad tributaria frente a SUNAT: su RUC, su certificado digital, su usuario secundario de Clave SOL, y — si decide operar bajo SEE-OSE — su propio contrato con un OSE ya homologado (o el propio Facturador SUNAT / SEE-SOL si es un contribuyente que no requiere OSE).
- El rol de Factuya se limita a: recibir el JSON agnóstico → armar el UBL 2.1 → firmar (con el certificado *del tenant*, custodiado en KMS pero de titularidad del tenant) → enviarlo al canal que el tenant ya tiene habilitado (SUNAT directo o su OSE contratado) → devolver el resultado normalizado. Es decir: Factuya nunca es la entidad que SUNAT reconoce como responsable de la validación — esa responsabilidad la conserva siempre el tenant (contribuyente) y, si aplica, su OSE.
- Consecuencia práctica en el modelo de datos: `TenantConfig` debe incluir explícitamente `submissionChannel: "SUNAT_DIRECT" | "OSE_PROVIDER"` y, si es `OSE_PROVIDER`, los endpoints/credenciales del OSE que el tenant ya tiene contratado — Factuya no reemplaza a ese OSE, lo orquesta.
- Términos de servicio: Factuya debe dejar explícito en su contrato con cada tenant que actúa como **proveedor de tecnología/intermediación**, no como responsable tributario ni como entidad validadora — recomendable validarlo con asesoría legal antes de lanzar a producción (esto excede el alcance técnico de este documento).

## 14. Riesgos y consideraciones regulatorias abiertas (Perú, 2026)

- **SIRE** obligatorio para principales contribuyentes desde junio 2026 — no está en el MVP pero el modelo de datos debe dejar espacio para exportar registro de ventas/compras.
- Cambios normativos activos (ej. nueva declaración de boletos aéreos desde agosto 2026) confirman que los catálogos y reglas de SUNAT deben vivir **versionados y externalizados** (no hardcodeados en el adaptador), para poder actualizarlos sin redeploy de todo el sistema.
- Si en el futuro el volumen justifica homologarse como OSE propio, ese es un cambio de modelo de negocio y de arquitectura de responsabilidad, no una simple iteración técnica — debe tratarse como una decisión separada, no asumirse por defecto.

## 15. Políticas de desarrollo (ramas, commits, documentación)

Ver `docs/policies/git-workflow.md` y `docs/policies/documentation.md` para el detalle completo. Resumen vinculante para todo el repo:

- **Ramas**: `<tipo>/<scope>-<descripción-corta>` (ej. `feat/pe-sunat-build-ubl-invoice`). Nunca commitear directo a `main`.
- **Commits**: Conventional Commits (`tipo(scope): resumen`). El *body* explica el porqué, no el qué.
- **Documentación obligatoria por cambio**: todo paquete nuevo en `packages/*` requiere `README.md` propio; toda decisión de arquitectura no trivial requiere un ADR en `docs/adr/`; toda dependencia externa nueva requiere una skill investigada en `.claude/skills/deps-<paquete>/` **antes** de entrar a `package.json` (ver §16).
- **PR**: no se aprueba un PR que introduce una dependencia sin su skill correspondiente, ni una decisión arquitectónica relevante sin su ADR.

## 16. Gestión de dependencias sin alucinación

Factuya es un sistema con responsabilidad fiscal/legal indirecta (firma documentos tributarios de terceros). Un error de versión o de API mal asumida en la librería de firma, en el cliente SOAP o en el SDK de KMS no es un bug cosmético — puede invalidar comprobantes o exponer una clave privada. Por eso:

- Ninguna versión de dependencia se fija de memoria. Se resuelve la versión real vigente (registro de npm/Bun, changelog oficial, releases de GitHub) en el momento de instalarla.
- Ninguna API de una librería o servicio (KMS, SOAP client, parser XML) se documenta o usa a partir de lo que "se recuerda" de ella — se lee el código/tipos instalados y la documentación oficial vigente.
- El agente `.claude/agents/dependency-skill-agent.md` es el mecanismo formal para esto: investiga la dependencia, valida la legitimidad del publicador (evitar typosquats/forks no oficiales), y genera una **skill estructurada** en `.claude/skills/deps-<paquete>/` (ver ejemplo real: `deps-xml-crypto`) antes de que la dependencia se use en código.
- Cada skill de dependencia registra una fecha de "revisar de nuevo antes de" en `docs/dependencies/LEDGER.md`, porque el ecosistema (como se vio con TypeScript 7.0 — ADR-0001) puede cambiar de forma disruptiva entre que se investiga y que se usa.

## 17. Estado de implementación (v0.9)

El modelo de dominio (§6), el puerto `CountryAdapter` (§4), el adaptador `pe-sunat` (Factura,
flujo síncrono), `apps/api` (servidor HTTP real con documentación interactiva, multi-tenant real
por API Key —ADR-0004— y alta de tenants con custodia de clave real —ADR-0005/ADR-0006—), y
`KmsSigner` (§9) están implementados. **Verificado con corridas reales** (no mockeadas): SUNAT
beta, `apps/api` contra ese mismo pipeline (incluyendo el aislamiento real entre tenants), la
firma vía KMS real (CMK creada, firma verificada con `crypto.verify()` contra la llave pública
real), y el import de la clave privada real de un tenant a su propia CMK (ADR-0006: CMK creada con
`Origin: EXTERNAL`, clave importada con `RSA_AES_KEY_WRAP_SHA_256`, firma verificada contra la
llave pública original del tenant, 2026-08-03). Ver `docs/adapters/pe-sunat.md`,
`docs/aws/kms-live-verification.md`, `apps/api/README.md`, y `docs/flows.md` para el detalle
completo, qué se verificó, y las limitaciones documentadas explícitamente (contador de correlativo
en memoria en vez de DynamoDB, `TenantRegistry` en memoria del proceso en vez de DynamoDB, sin
soporte de `.pfx`/PKCS#12, distinción aceptado-con-observaciones pendiente de verificar contra el
catálogo oficial de SUNAT).

`apps/infra` (`@factuya/infra`, ADR-0007) existe como scaffold de AWS CDK — un `Stack` vacío,
`cdk synth` verificado localmente sin tocar AWS real. Ningún recurso de infraestructura real (§5,
§11) está desplegado todavía.

Pendiente: modelar recursos reales dentro de `apps/infra` y correr `cdk bootstrap`/`cdk deploy`
contra AWS (orquestación Step Functions/Lambda §5, hoy `emitInvoice` es una función en proceso que
sigue la misma secuencia lógica), persistencia DynamoDB/S3, soporte de `.pfx`/PKCS#12, notas de
crédito/débito, flujo asíncrono (`sendSummary`/`getStatus`), y el adaptador `co-factus` (§12).

---
*Próximo paso sugerido: dentro de `apps/infra` (ADR-0007, ya scaffoldeado), decidir y modelar el
primer recurso real — candidato natural: DynamoDB para `TenantRegistry` — y resolver la policy IAM
de `cdk bootstrap`/`cdk deploy` antes de la primera corrida contra AWS real. Ver `docs/flows.md`
para el orden de dependencia completo del roadmap.*
