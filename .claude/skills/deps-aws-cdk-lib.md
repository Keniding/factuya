---
name: deps-aws-cdk-lib
description: "Referencia investigada de aws-cdk-lib/constructs/aws-cdk (AWS CDK v2, TypeScript), la herramienta de infraestructura como código elegida en ADR-0007 para apps/infra. Úsala SIEMPRE que se escriba o revise código en apps/infra que defina un Stack/Construct, toque cdk.json, o corra cdk synth/diff/deploy/bootstrap — incluye por qué se ejecuta con Bun en vez de Node, el conflicto real de versión de TypeScript con ADR-0001, y la tensión de permisos IAM del bootstrap. NO documenta todavía la API detallada de submódulos de servicio (aws-lambda, aws-dynamodb, aws-stepfunctions, etc.) — eso se investiga en el momento en que cada pieza real se modele, no antes, para no documentar contenido no usado."
---

# aws-cdk-lib / constructs / aws-cdk — skill de dependencia (Factuya · apps/infra)

Esta skill se generó siguiendo `.claude/agents/dependency-skill-agent.md`: los tres paquetes se
instalaron de verdad con Bun en `apps/infra`, se leyó su `package.json`/tipos reales instalados, y
se generó un proyecto CDK oficial descartable (`bunx aws-cdk@2.1134.0 init app --language
typescript` en un directorio fuera del repo) para verificar contra la fuente real — no contra lo
que el modelo "recuerda" de una versión anterior de CDK — la lista de feature flags de `cdk.json` y
la plantilla de `tsconfig.json` que CDK genera por defecto. Ver ADR-0007 para la decisión de fondo
(CDK sobre Terraform) y sus fuentes citadas.

## Resumen ejecutivo

- **`aws-cdk-lib` 2.263.0** — construct library principal. Publicador verificado: org
  `aws/aws-cdk` en GitHub (`repository.url` del `package.json` real instalado).
- **`constructs` 10.8.0** — modelo de programación base (`Construct`, `Node`). Mismos
  mantenedores (`amzn-oss`, `aws-cdk-team`).
- **`aws-cdk` (CLI) 2.1134.0** — `cdk synth`/`diff`/`deploy`/`bootstrap`. **Desde 2.1000.0 el CLI
  versiona independiente de `aws-cdk-lib`** — no es un error de pin tener 2.1134.0 (CLI) junto a
  2.263.0 (lib), es el esquema vigente. Regla de compatibilidad real: la fecha de release del CLI
  debe ser ≥ la de la librería usada.
- Los tres son `dependencies`/`devDependency` de `apps/infra` (`@factuya/infra`), **no** del root
  del monorepo — ningún otro paquete los necesita todavía.

## Índice de contenido detallado

1. [`01-installation-and-cdk-json.md`](deps-aws-cdk-lib/01-installation-and-cdk-json.md) — cómo se
   instaló, por qué `apps/infra` no usa el `tsconfig.json`/build que genera `cdk init` por
   defecto, y qué significa cada bloque de `cdk.json`.
2. [`02-bun-runtime-and-commands.md`](deps-aws-cdk-lib/02-bun-runtime-and-commands.md) — por qué
   `cdk.json` ejecuta `bun bin/app.ts` en vez del `npx tsc && npx tsx` que genera la plantilla
   oficial, y los comandos reales (`synth`/`diff`/`deploy`/`bootstrap`) con lo que cada uno toca o
   no toca de la cuenta de AWS real.
3. [`03-known-issues-and-gotchas.md`](deps-aws-cdk-lib/03-known-issues-and-gotchas.md) — el
   conflicto real de versión de TypeScript con ADR-0001, la tensión de permisos IAM del bootstrap,
   y el patrón de import por submódulo (`aws-cdk-lib/core`, no el barrel completo).

## Qué NO cubre esta skill todavía

Ningún submódulo de servicio (`aws-cdk-lib/aws-lambda`, `aws-cdk-lib/aws-dynamodb`,
`aws-cdk-lib/aws-stepfunctions`, `aws-cdk-lib/aws-apigatewayv2`, `aws-cdk-lib/aws-s3`,
`aws-cdk-lib/aws-sqs`, `aws-cdk-lib/aws-events`) está documentado en profundidad — `apps/infra` hoy
solo tiene un `Stack` vacío (ver ADR-0007). Cuando se decida modelar una pieza real (ej. la tabla
de DynamoDB para `TenantRegistry`), se extiende esta skill con un archivo nuevo
(`0N-<servicio>.md`) leyendo los tipos reales instalados en ese momento, no se documenta por
adelantado contenido que todavía no se usa.
