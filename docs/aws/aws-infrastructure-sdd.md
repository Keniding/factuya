# Factuya — SDD de infraestructura AWS

Spec-Driven Development dedicado a la infraestructura AWS de Factuya — no reemplaza
`docs/sdd/factuya-sdd.md` (la fuente de verdad del producto, dominio y contrato), lo aterriza:
qué servicio de AWS existe hoy de verdad en la cuenta, cuál está solo diseñado en el SDD principal
sin construir, y en qué orden se van a ir levantando. Es un **documento vivo** — se actualiza cada
vez que se construye o verifica una pieza nueva, en vez de dejar cada avance como una nota suelta.

Versión 0.5 · Empezado 2026-08-02 tras la primera verificación en vivo (KMS); actualizado el mismo
día con multi-tenant real en `apps/api` (ADR-0004). 2026-08-03: corregido el diseño de KMS (ADR-0005
reemplaza ADR-0003 — una CMK por tenant, no compartida), agregado el import de clave real por
tenant (ADR-0006), confirmada la corrida en vivo de ese import contra AWS KMS real, y arrancada la
infraestructura como código con AWS CDK (ADR-0007, `apps/infra`).

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

## Principios (heredados de `docs/sdd/factuya-sdd.md` §16 y ADR-0005)

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
| KMS | Firma de comprobantes (`KmsSigner`); una CMK dedicada por tenant, con import de su clave privada real (ADR-0005/ADR-0006) | **Verificado en vivo** — tanto la firma (`Sign`, 2026-08-02) como el import de clave real de un tenant (`GetParametersForImport`/`ImportKeyMaterial`, 2026-08-03) corrieron contra AWS real | `docs/aws/kms-live-verification.md` Paso 4 (firma, PASS) y Paso 4b (import, PASS) |
| CDK (herramienta de IaC, no un servicio en sí) | Define y sintetiza toda la infraestructura de las filas de abajo (ADR-0007) | **Scaffold sintetizado localmente** — `apps/infra` (`FactuyaInfraStack`, vacío), `cdk synth` verificado sin tocar AWS real; `cdk bootstrap`/`cdk deploy` nunca corridos | `apps/infra/README.md`, ADR-0007, `.claude/skills/deps-aws-cdk-lib.md` |
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
| 2026-08-03 | KMS | `CreateKey` (`Origin: EXTERNAL`), `GetParametersForImport`, wrapping AES-KWP (RFC 5649) + RSA-OAEP-SHA-256 hecho a mano, `ImportKeyMaterial`, `Sign` vía `KmsSigner` con la clave importada, verificación de la firma contra la llave pública **original** del tenant, `ScheduleKeyDeletion` | PASS — ver `packages/signing/test/integration/kms-tenant-key-import-live.integration.test.ts` |

## Próxima pieza a construir

**Multi-tenant real en `apps/api` ya está hecho y verificado en vivo** (ADR-0004/0005/0006):
autenticación por API Key, resolución de `TenantConfig` vía `TenantRegistry`, aislamiento real
entre tenants, y cada tenant con su propia CMK dedicada + import de su clave privada real — ver
`apps/api/README.md`. `LocalTenantRegistry` sigue en memoria del proceso, no respaldado en
DynamoDB — eso depende de la fila de DynamoDB de la tabla de arriba, todavía "No iniciado".

**Infraestructura como código arrancada** (ADR-0007): `apps/infra` sintetiza CloudFormation
localmente con AWS CDK, sin recursos reales todavía. Dos decisiones explícitas pendientes antes de
seguir: (1) qué pieza modelar primero dentro del stack — la tabla de DynamoDB para
`TenantRegistry` es la candidata natural, porque además resuelve la limitación ya documentada de
`LocalTenantRegistry` en memoria; (2) la policy IAM nueva y acotada para `cdk bootstrap`/`cdk
deploy` contra la cuenta real — el bootstrap de CDK necesita permisos más amplios que una sola
pieza de servicio (crea un bucket S3 de assets y roles IAM), documentado como tensión real en
ADR-0007, no se debe resolver ampliando `FactuyaDevKmsSignerPolicy` ni con una policy de
administrador.

Después de eso, según el orden de dependencia de `docs/flows.md`, sigue **infraestructura como
código** (CDK o Terraform, a decidir con su propio ADR si la elección no es obvia) para empezar a
mover `apps/api` de proceso Bun a Lambda + API Gateway real — el usuario IAM `factuya-dev`
(permisos mínimos) ya existe y se amplía con una policy acotada por cada servicio nuevo, sin
ampliar `FactuyaDevKmsSignerPolicy`.
