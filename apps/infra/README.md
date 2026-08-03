# @factuya/infra

Infraestructura como código de Factuya en AWS, con **AWS CDK (TypeScript)** — ver
[ADR-0007](../../docs/adr/0007-cdk-for-infrastructure-as-code.md) para por qué CDK y no Terraform.
Reemplazará, pieza por pieza, el proceso único de `apps/api` (`Bun.serve`) por la arquitectura
serverless real descrita en `docs/sdd/factuya-sdd.md` §5/§11 (Lambda, API Gateway, Step Functions,
DynamoDB, S3, SQS) — ver `docs/aws/aws-infrastructure-sdd.md` para el estado servicio por servicio.

## Estado actual

**Solo scaffold** — `FactuyaInfraStack` (`lib/factuya-infra-stack.ts`) está vacío, sin ningún
recurso todavía. Verificado únicamente que `cdk synth` sintetiza un template de CloudFormation
válido **localmente**, sin tocar ninguna cuenta de AWS real. `cdk bootstrap`/`cdk deploy` **no se
han corrido nunca** contra la cuenta real de este proyecto — requieren una policy IAM nueva y
acotada para `factuya-dev` (o un usuario/rol dedicado a despliegue), pendiente de decidir
explícitamente con el usuario, mismo patrón ya seguido para KMS (ver
`docs/aws/kms-live-verification.md`).

Qué recurso real modelar primero (ej. la tabla de DynamoDB para `TenantRegistry`, la primera Lambda
envolviendo `emitInvoice`) es una decisión de secuencia todavía pendiente — ver `docs/flows.md`.

## Cómo correrlo

```bash
bun install                 # desde la raíz del monorepo
cd apps/infra
bun run synth                # cdk synth — genera cdk.out/ localmente, no toca AWS
```

`cdk.out/` está en `.gitignore` — se regenera con `synth`, nunca se edita a mano.

`bun run diff`/`bun run deploy`/`bun run bootstrap` están definidos en `package.json` pero **no se
deben correr todavía** contra la cuenta real — ver la limitación de permisos arriba.

## Por qué CDK se ejecuta con Bun, no con Node

`cdk.json` define `"app": "bun bin/app.ts"` — Bun transpila y ejecuta el TypeScript directamente,
igual que `apps/api` (`bun run src/index.ts`), sin el paso `tsc`/`tsx` que genera la plantilla
oficial de `cdk init` (pensada para Node). Ver
`.claude/skills/deps-aws-cdk-lib/02-bun-runtime-and-commands.md` para la verificación de
compatibilidad Bun/CDK que se hizo antes de adoptar este patrón.

## TypeScript: no instala su propio compilador

A diferencia de la plantilla oficial de CDK (que fija TypeScript `~7.0.2` como dependencia propia),
`apps/infra` extiende `tsconfig.base.json` de la raíz y se type-checkea con el mismo `tsc6 --build`
pinneado en [ADR-0001](../../docs/adr/0001-typescript-version-pin.md) — sin instalar TypeScript
directamente. Ver `.claude/skills/deps-aws-cdk-lib/03-known-issues-and-gotchas.md`.

## Dependencias

`aws-cdk-lib` 2.263.0, `constructs` 10.8.0, `aws-cdk` (CLI) 2.1134.0 — investigadas siguiendo
`.claude/agents/dependency-skill-agent.md`, documentadas en
[`.claude/skills/deps-aws-cdk-lib.md`](../../.claude/skills/deps-aws-cdk-lib.md) y registradas en
`docs/dependencies/LEDGER.md`.
