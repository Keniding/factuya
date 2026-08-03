# Factuya — SDD de infraestructura AWS

Spec-Driven Development dedicado a la infraestructura AWS de Factuya — no reemplaza
`docs/sdd/factuya-sdd.md` (la fuente de verdad del producto, dominio y contrato), lo aterriza:
qué servicio de AWS existe hoy de verdad en la cuenta, cuál está solo diseñado en el SDD principal
sin construir, y en qué orden se van a ir levantando. Es un **documento vivo** — se actualiza cada
vez que se construye o verifica una pieza nueva, en vez de dejar cada avance como una nota suelta.

Versión 0.1 · Empezado 2026-08-02, después de la primera verificación en vivo (KMS).

## Relación con el resto de `docs/`

- `docs/sdd/factuya-sdd.md` §5, §10, §11 — la arquitectura *aspiracional* completa (de dónde sale
  la lista de servicios de la tabla de abajo). Este documento no la reinventa, la rastrea.
- `docs/flows.md` — el roadmap en lenguaje de negocio/orden de dependencia. Este documento es su
  contraparte técnica, a nivel de "qué recurso de AWS, con qué permisos, verificado cómo".
- `docs/adr/` — decisiones de arquitectura (ej. ADR-0003, KMS). Cuando una pieza nueva de esta
  tabla requiera una decisión no trivial, se documenta ahí, y esta tabla enlaza al ADR.
- `docs/aws/*.md` — una guía paso a paso por pieza de infraestructura, cuando exista (hoy:
  `kms-live-verification.md`). Este documento es el índice de estado; las guías son el detalle
  reproducible de cómo se verificó cada una.
- `docs/aws/*.private.md` — valores reales de la cuenta (gitignored). Este documento **nunca**
  lleva IDs de cuenta, ARNs, ni nombres de recursos reales — esos van en la copia privada
  correspondiente.

## Principios (heredados de `docs/sdd/factuya-sdd.md` §16 y ADR-0003)

1. **Nada se marca "verificado" sin una corrida real** contra la cuenta de AWS — igual que SUNAT
   beta y KMS. Diseñado-pero-no-probado y verificado-en-vivo son estados distintos, y esta tabla
   los distingue siempre.
2. **Un usuario IAM de desarrollo (`factuya-dev`), muchas policies acotadas** — una policy nueva y
   mínima por cada pieza de infraestructura que se agrega, nunca ampliar una policy existente para
   cubrir "de paso" un servicio nuevo, y nunca una policy de administrador. Ver
   `docs/aws/kms-live-verification.md` para el patrón ya usado con KMS.
3. **Serverless real, no simulado**: cada pieza que se construya debe respetar el objetivo
   original del proyecto — sin costo fijo 24/7. Si una pieza del diseño aspiracional no puede
   cumplir esto en la práctica, se documenta como una desviación con su razón, no se implementa
   en silencio.
4. **Ninguna dependencia nueva de AWS SDK sin pasar por `.claude/agents/dependency-skill-agent.md`**
   primero — mismo proceso que ya se siguió para `@aws-sdk/client-kms`.

## Estado por servicio

| Servicio AWS | Rol en la arquitectura (SDD §5) | Estado | Evidencia |
|---|---|---|---|
| IAM | Usuario de desarrollo con permisos mínimos por pieza | **Verificado en vivo** | Usuario `factuya-dev` creado, sin acceso a consola, policies acotadas por servicio (ver `docs/aws/kms-live-verification.md` Paso 1) |
| KMS | Firma de comprobantes (`KmsSigner`), custodia de clave privada por tenant vía Grants | **Verificado en vivo** (2026-08-02) | CMK real creada, Grant `Sign`-only real, firma verificada con `crypto.verify()`, limpieza confirmada — ver `docs/aws/kms-live-verification.md`, ADR-0003 (addendum) |
| Lambda | `IngestHandler`, `BuildDocument`, `SignDocument`, `SubmitToSunat`, `PollStatus`, `StoreResult`, `NotifyTenant` | No iniciado | — |
| Step Functions | Orquestación del flujo de emisión (`InvoiceEmissionWorkflow`, Standard) | No iniciado | — |
| API Gateway (HTTP API) | Reemplazo de `apps/api` (`Bun.serve`) por el ingreso real de producción, con auth por tenant | No iniciado — `apps/api` hoy es un proceso Bun de desarrollo, no Lambda detrás de API Gateway | — |
| DynamoDB | Estado de comprobantes, series/correlativos por tenant con locking optimista | No iniciado — hoy el correlativo es un contador en memoria de `apps/api` | — |
| S3 | XML firmado, CDR, PDF de representación impresa | No iniciado — hoy nada se persiste entre reinicios de `apps/api` | — |
| SQS | DLQ de reintentos/errores del envío a SUNAT | No iniciado | — |
| EventBridge | Eventos de dominio (`invoice.accepted`/`rejected`/`observed`) y verificación de expiración de certificados | No iniciado | — |
| Secrets Manager | Credenciales SOL/OSE por tenant | No iniciado — hoy son variables de entorno de un único tenant de desarrollo | — |
| CloudWatch / X-Ray | Trazabilidad y alarmas sobre tickets pendientes | No iniciado — depende de que exista el flujo asíncrono real primero | — |

## Registro de verificaciones en vivo

Cada fila es una corrida real contra la cuenta de AWS, no una prueba con mocks. Se agrega una fila
nueva cada vez que se verifica una pieza más de la tabla de arriba.

| Fecha | Servicio | Qué se verificó | Resultado |
|---|---|---|---|
| 2026-08-02 | KMS | `CreateKey` (RSA_2048, SIGN_VERIFY), `CreateGrant` (Sign-only), `Sign` vía `KmsSigner`, verificación de la firma con `crypto.verify()` contra `GetPublicKey`, `RetireGrant` + `ScheduleKeyDeletion` | PASS — ver `packages/signing/test/integration/kms-live.integration.test.ts` |

## Próxima pieza a construir

Según el orden de dependencia de `docs/flows.md`: **multi-tenant real en `apps/api`** (autenticación
por API key/JWT, resolución de `TenantConfig` por tenant) antes que cualquier pieza nueva de AWS —
sin eso, cualquier infraestructura nueva seguiría siendo de un solo tenant de desarrollo. Después:
**infraestructura como código** (CDK o Terraform, a decidir con su propio ADR si la elección no es
obvia) para empezar a mover `apps/api` de proceso Bun a Lambda + API Gateway real.
