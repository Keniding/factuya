# ADR-0007: AWS CDK (TypeScript) para infraestructura como código, no Terraform

- Estado: aceptado
- Fecha: 2026-08-03

## Contexto

`docs/flows.md` (roadmap, paso 2) y `docs/aws/aws-infrastructure-sdd.md` marcan la infraestructura
como código como el siguiente paso de dependencia: reemplazar el proceso único de `apps/api`
(`Bun.serve`) por Lambda + API Gateway + Step Functions + DynamoDB + S3 + SQS, según
`docs/sdd/factuya-sdd.md` §5/§11. `docs/flows.md` deja la elección de herramienta abierta "a
decidir con su propio ADR si la elección no es obvia" — este documento resuelve esa elección.

Dos candidatos evidentes para IaC en AWS: **AWS CDK** (define infraestructura como código en un
lenguaje de programación general, que en este monorepo sería TypeScript, y sintetiza CloudFormation)
y **Terraform** (HCL declarativo, multi-cloud, estado gestionado por su propio backend).

## Decisión

**AWS CDK, en TypeScript, sobre Terraform**, por una razón concreta de este repo (no una
preferencia genérica): **todo el monorepo ya es TypeScript/Bun** — dominio, adaptador SUNAT, firma,
y `apps/api` comparten el mismo lenguaje, el mismo gestor de paquetes (Bun), y el mismo proceso de
investigación de dependencias (`.claude/agents/dependency-skill-agent.md`). Con CDK, la
infraestructura se define en el mismo lenguaje y puede, cuando tenga sentido, compartir tipos
directamente con el código de dominio (ej. el nombre de una tabla de DynamoDB, el `Duration` de un
timeout de Lambda) sin una capa de traducción manual. Terraform exigiría mantener dos ecosistemas
de tooling paralelos (HCL + su propio linter/registry) para un equipo que hoy solo necesita uno.

Esto no es una afirmación de que CDK sea objetivamente superior a Terraform — es la elección
correcta **para este proyecto específico**, 100% AWS (sin necesidad multi-cloud) y 100%
TypeScript ya.

### Paquetes y versiones

- `aws-cdk-lib` **2.263.0** — construct library principal (`npmjs.com/package/aws-cdk-lib`,
  publicada por la org `aws/aws-cdk` en GitHub).
- `constructs` **10.8.0** — modelo de programación base sobre el que se construye `aws-cdk-lib`
  (mismos mantenedores: `amzn-oss`, `aws-cdk-team`).
- `aws-cdk` (CLI) **2.1134.0** — herramienta de línea de comandos (`cdk synth`/`diff`/`deploy`/
  `bootstrap`), mismos mantenedores. **Desde la versión 2.1000.0, el CLI y `aws-cdk-lib` versionan
  de forma independiente** (el CLI ya no sigue la misma numeración que la librería) — la regla de
  compatibilidad oficial es "la fecha de release del CLI debe ser posterior a la de la librería
  usada", que se cumple aquí (ambos son las versiones vigentes al momento de esta decisión).

Las tres son dependencias nuevas del monorepo — instaladas en `apps/infra` siguiendo el proceso de
`.claude/agents/dependency-skill-agent.md`, con su skill en `.claude/skills/deps-aws-cdk-lib.md` y
su fila en `docs/dependencies/LEDGER.md`.

### CDK ejecutado con Bun, no Node

`cdk.json` define `"app": "bun bin/app.ts"` — Bun ejecuta el entry point de TypeScript
directamente (igual que `apps/api`), sin un paso de compilación separado (`tsc`) ni `tsx` como
runner intermedio, que sí usa la plantilla oficial por defecto de `cdk init` (pensada para Node).
Se verificó, antes de adoptar este patrón, que un problema de compatibilidad real reportado entre
Bun y el CLI de CDK (`bunx cdk synth` fallando con `SIGHUP`) es específico de versiones de Bun
anteriores a la 1.0.8 — muy anterior a la 1.3.13 que usa este repo — y que existen ejemplos
funcionando de CDK ejecutado directamente con Bun como runtime (no solo como instalador). Ver
fuentes abajo.

### Divergencia deliberada del `tsconfig.json` generado por `cdk init`

La plantilla oficial (`cdk init app --language typescript`, inspeccionada en un directorio
descartable antes de decidir esto — no asumida de memoria) fija **TypeScript `~7.0.2`** como
`devDependency` propia. Este repo ya tiene **ADR-0001**, que fija la serie 6.x
(`@typescript/typescript6`) para todo el monorepo hasta que el ecosistema de tooling soporte la
API estable de TS7. `apps/infra` **no** instala su propio TypeScript — extiende
`tsconfig.base.json` como cualquier otro paquete del monorepo y usa el mismo `tsc6 --build` para
type-checking (agregado a las `references` del `tsconfig.json` raíz), consistente con ADR-0001.

## Alcance de este incremento

- Se agrega el paquete `apps/infra` (`@factuya/infra`) con un **stack vacío**
  (`FactuyaInfraStack`) — el scaffold synth-verificado localmente (`cdk synth` produce un
  `cdk.out/` válido sin errores), sin ningún recurso real todavía.
- **No se corrió `cdk bootstrap` ni `cdk deploy` contra ninguna cuenta de AWS real** como parte de
  esta decisión. Bootstrap crea recursos reales (bucket S3 de assets, roles IAM, repositorio ECR)
  y el usuario `factuya-dev` (permisos mínimos, solo KMS hoy — ver
  `docs/aws/kms-live-verification.md`) no tiene permisos para eso. Antes de la primera corrida real
  de `cdk bootstrap`, hace falta una policy nueva y acotada (no de administrador), siguiendo el
  mismo patrón ya usado para KMS — pendiente de una decisión explícita posterior sobre qué
  contiene esa policy.
- Qué recurso real modelar primero dentro de este stack (DynamoDB para `TenantRegistry`, la
  primera Lambda envolviendo `emitInvoice`, etc.) queda **fuera de alcance de este ADR** — es una
  decisión de secuencia, no de arquitectura, y se toma con el usuario paso a paso (mismo patrón ya
  usado para multi-tenant vs. certificado de tenant).

## Tensión conocida: policy mínima por servicio vs. permisos de CDK

`docs/aws/aws-infrastructure-sdd.md` (principio 2) establece "una policy nueva y mínima por cada
pieza de infraestructura, nunca una policy de administrador". CDK, por diseño, necesita permisos
más amplios de lo habitual para hacer su trabajo — no porque cada stack los use en runtime, sino
porque el propio **proceso de despliegue** (`cdk bootstrap`/`cdk deploy`) crea y actualiza
CloudFormation, roles IAM de ejecución para los recursos que el stack define, un bucket S3 de
assets, y (si se usan Lambdas en contenedor) un repositorio ECR. Esto es una tensión real, no un
descuido: se documentará explícitamente, con su propia policy acotada (ni admin, ni ampliar
`FactuyaDevKmsSignerPolicy`), cuando se decida la primera corrida real de bootstrap — no antes.

## Fuentes verificadas (2026-08-03)

- [aws-cdk-lib — npm](https://www.npmjs.com/package/aws-cdk-lib) y `bun info aws-cdk-lib` — versión
  2.263.0 vigente, publicador `aws/aws-cdk` confirmado contra el `package.json` real instalado
  (`repository.url: github.com/aws/aws-cdk.git`).
- `bun info constructs` / `bun info aws-cdk` — versiones 10.8.0 / 2.1134.0, mismos mantenedores
  (`amzn-oss`, `aws-cdk-team`).
- [AWS CDK versioning](https://docs.aws.amazon.com/cdk/v2/guide/versioning.html) y
  [aws-cdk-cli/COMPATIBILITY.md](https://github.com/aws/aws-cdk-cli/blob/main/COMPATIBILITY.md) —
  confirman la divergencia de versionado CLI/librería desde CLI 2.1000.0 y la regla de
  compatibilidad "fecha de release del CLI ≥ fecha de release de la librería".
- [mrgrain/bun-cdk-app](https://github.com/mrgrain/bun-cdk-app) — ejemplo real de CDK ejecutado
  directamente con Bun (`"app": "bun app.ts"` en `cdk.json`), patrón adoptado aquí.
- Reporte real de incompatibilidad Bun/CDK
  ([codetalkio/bun-issue-cdk-repro](https://github.com/codetalkio/bun-issue-cdk-repro)) — específico
  de Bun ≤1.0.8, no aplica a la versión instalada en este repo (1.3.13, ver `package.json` raíz,
  `engines.bun: ">=1.3.0"`).
- Plantilla real generada con `bunx aws-cdk@2.1134.0 init app --language typescript` en un
  directorio descartable, inspeccionada antes de decidir la estructura de `apps/infra` (no
  copiada de memoria de una versión anterior de CDK) — de ahí se confirmó la lista real de
  feature flags de `context` vigente para esta versión y el conflicto de versión de TypeScript
  con ADR-0001 (la plantilla pide `~7.0.2`, este repo se queda en 6.x).

## Consecuencias

- `apps/infra` (`@factuya/infra`) se suma a `apps/*` en el monorepo, con su propio `README.md`
  (regla de `docs/policies/documentation.md`).
- El código de dominio no necesita cambios para esto — el stack today está vacío. El trabajo real
  de modelar Lambda/Step Functions/DynamoDB/S3/SQS es incremental, pieza por pieza, no un cambio
  de una sola vez.
- La primera corrida real de `cdk bootstrap`/`cdk deploy` contra AWS requiere una policy IAM nueva
  para `factuya-dev` (o un usuario/rol dedicado a despliegue, a decidir) — no debe asumirse ni
  ejecutarse sin que el usuario la apruebe explícitamente, mismo patrón ya seguido para KMS.
- Si en el futuro Factuya necesitara desplegar en un proveedor distinto de AWS (poco probable dado
  el alcance actual del SDD), esta decisión debería revisarse — CDK está fuertemente acoplado a
  CloudFormation/AWS.
