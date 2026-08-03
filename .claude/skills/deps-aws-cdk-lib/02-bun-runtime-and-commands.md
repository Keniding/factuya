# CDK ejecutado con Bun + comandos reales

## Por qué `"app": "bun bin/app.ts"`

La plantilla oficial de `cdk init --language typescript` genera
`"app": "npx tsc && npx tsx bin/<nombre>.ts"` — pensada para Node, con un paso de compilación
(`tsc`) seguido de ejecución con `tsx`. Este repo es Bun-first en todo lo demás (`apps/api` corre
`bun run src/index.ts` directo, sin paso de compilación separado) — `apps/infra` sigue el mismo
patrón: Bun transpila y ejecuta el TypeScript de `bin/app.ts` directamente, sin `tsc` ni `tsx`
intermedios.

**Verificado antes de adoptar esto** (no asumido): existe un reporte real de incompatibilidad
entre Bun y el CLI de CDK (`bunx cdk synth` fallando con `SIGHUP`/"Subprocess exited with error
null") — pero está circunscrito explícitamente a versiones de Bun **anteriores a la 1.0.8**
(2023). Este repo fija `engines.bun: ">=1.3.0"` en el `package.json` raíz y tiene Bun 1.3.13
instalado — muy posterior. Se confirmó además un ejemplo real funcionando
([mrgrain/bun-cdk-app](https://github.com/mrgrain/bun-cdk-app)) con exactamente el mismo patrón
(`"app": "bun app.ts"`), y se corrió `cdk synth` real en este propio repo con éxito (`cdk.out/`
generado con `FactuyaInfraStack.template.json` válido) antes de dar esto por confirmado.

## Import por submódulo, no el barrel completo

```typescript
// Correcto — el que usa apps/infra/bin/app.ts y lib/factuya-infra-stack.ts
import { App, Stack, type StackProps } from "aws-cdk-lib/core";

// También válido pero no lo que usa este repo (barrel completo, peor para tree-shaking)
import { App, Stack } from "aws-cdk-lib";
```

La plantilla oficial ya genera `import * as cdk from 'aws-cdk-lib/core'` en 2.263.0 — confirma que
el patrón recomendado actual es importar por submódulo (`aws-cdk-lib/core`,
`aws-cdk-lib/aws-lambda`, etc.), no el paquete raíz completo.

## Comandos reales y qué tocan (o no) de AWS

Ejecutar siempre desde `apps/infra/` (`bun run <script>` definido en su `package.json`, o
`bunx cdk <comando>` directo):

- **`cdk synth`** (`bun run synth`) — sintetiza CloudFormation a `cdk.out/` **localmente, sin
  tocar la cuenta de AWS** salvo que el stack tenga "context lookups" (ej. buscar una VPC
  existente por nombre) o un `env` de cuenta/región fijado explícitamente que dispare validaciones
  contra la cuenta real. El stack actual (`FactuyaInfraStack`, vacío, sin `env` fijado) no hace
  ninguna de las dos — `cdk synth` corrido en este repo confirmó esto (no pidió credenciales).
- **`cdk diff`** — compara el stack sintetizado contra lo ya desplegado en una cuenta real; **sí
  necesita credenciales de AWS** (llama a `DescribeStacks`/`GetTemplate` de CloudFormation). No
  corrido todavía — no hay nada desplegado con qué comparar.
- **`cdk bootstrap`** — crea infraestructura real de soporte en la cuenta/región de destino
  (bucket S3 de assets, roles IAM de CloudFormation, opcionalmente un repositorio ECR). **Nunca
  corrido contra la cuenta real de este proyecto** — requiere permisos que `factuya-dev` (solo
  KMS hoy) no tiene, y es una decisión explícita pendiente (ver ADR-0007, sección de tensión de
  permisos IAM).
- **`cdk deploy`** — despliega el stack sintetizado como un stack real de CloudFormation. Depende
  de que `cdk bootstrap` ya se haya corrido en esa cuenta/región. Tampoco corrido todavía.

`cdk.out/` está en `.gitignore` (se regenera con `cdk synth`, nunca se edita a mano ni se
commitea).
