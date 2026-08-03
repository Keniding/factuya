# Known issues / gotchas reales

## Conflicto de versión de TypeScript con ADR-0001

`cdk init --language typescript` fija `"typescript": "~7.0.2"` como `devDependency` propia de su
plantilla. Este repo tiene **ADR-0001**, que fija la serie 6.x
(`@typescript/typescript6` 6.0.2) para todo el monorepo hasta que el ecosistema de tooling soporte
la API estable de TS7 (caso real: TS7 rompía `typescript-eslint`/`ts-jest`/`ts-morph` en ese
momento). `apps/infra` **no instala TypeScript propio** — no depende de `tsc` en absoluto para
ejecutar (`bun bin/app.ts` corre directo), y su type-checking pasa por el mismo `tsc6 --build` del
resto del monorepo vía las `references` del `tsconfig.json` raíz. Si en algún momento se agrega
`typescript` como dependencia directa de `apps/infra` por algún motivo, debe ser la misma versión
6.x pinneada en el resto del repo, nunca la que sugiere la plantilla de CDK.

## Tensión de permisos IAM: bootstrap de CDK vs. policy mínima por servicio

`docs/aws/aws-infrastructure-sdd.md` establece como principio "una policy nueva y mínima por cada
pieza de infraestructura, nunca una de administrador". El **bootstrap** de CDK (`cdk bootstrap`)
necesita permisos reales para: crear un bucket S3 (assets), crear roles IAM (los que CloudFormation
asume para desplegar, y los de ejecución de cada recurso que el stack defina — ej. el rol de
ejecución de una Lambda), y gestionar stacks de CloudFormation. Esto es intrínsecamente más amplio
que "una acción de KMS" — es un hecho documentado del propio proyecto CDK, no una elección de
diseño de Factuya. **No se debe resolver ampliando `FactuyaDevKmsSignerPolicy`** ni dando permisos
de administrador — la policy de bootstrap/deploy debe ser su propia policy nueva, acotada lo más
posible (idealmente restringida por prefijo de nombre de recurso/stack), decidida explícitamente
antes de la primera corrida real (ver ADR-0007).

## `bunx aws-cdk init` puede fallar su propio post-install en este entorno (no bloqueante)

Ver `01-installation-and-cdk-json.md` — al generar la plantilla de referencia en un directorio
descartable, el post-install de `cdk init` (que instala sus propias `devDependencies` con npm)
falló con `"node" no se reconoce...` y errores `EPERM` de limpieza en Windows. No afecta el uso
real de CDK en este repo porque `apps/infra` no usa `cdk init` — los archivos de la plantilla se
generan igual antes de que el post-install corra, y fueron suficientes para leerlos como
referencia antes de descartar el directorio.

## Nada de esto se verificó todavía contra una cuenta de AWS real

A diferencia de `KmsSigner`/`createTenantSigningKey` (`packages/signing`), que sí corrieron contra
AWS real (ver `docs/aws/kms-live-verification.md`), esta skill documenta únicamente lo verificado
**localmente** (`cdk synth` produciendo un template válido). `cdk bootstrap`/`cdk deploy` contra
una cuenta real quedan pendientes de una decisión explícita posterior — no se debe asumir que el
scaffold "ya despliega" solo porque sintetiza correctamente.
