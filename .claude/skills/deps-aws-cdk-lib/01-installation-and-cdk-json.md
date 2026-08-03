# Instalación y `cdk.json` real

## Instalación

Instalado con Bun dentro del workspace `apps/infra` (no en la raíz del monorepo — ningún otro
paquete depende de CDK):

```bash
cd apps/infra
bun add aws-cdk-lib@2.263.0 constructs@10.8.0
bun add -D aws-cdk@2.1134.0
```

`package.json` de `apps/infra` fija las tres versiones exactas (no rangos `^`/`~`), siguiendo la
misma convención que `@aws-sdk/client-kms` en `apps/api` — decisión explícita del proceso de
`.claude/agents/dependency-skill-agent.md`, no un descuido.

## `tsconfig.json`: por qué NO es el que genera `cdk init`

`bunx aws-cdk@2.1134.0 init app --language typescript`, corrido en un directorio descartable fuera
del repo para inspeccionar la plantilla real (no asumida de memoria), genera:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["jest", "node"],
    "noEmit": true
    // ...
  }
}
```

y un `package.json` con `"typescript": "~7.0.2"` como `devDependency` propia.

`apps/infra` **no adopta ese `tsconfig.json`**. En su lugar, extiende
`tsconfig.base.json` de la raíz — igual que todos los demás paquetes del monorepo
(`"moduleResolution": "Bundler"`, `"module": "ESNext"`) — y se agrega a las `references` del
`tsconfig.json` raíz para que `tsc6 --build` (el compilador pinneado en ADR-0001) lo type-check
junto con el resto. Ver `03-known-issues-and-gotchas.md` para el porqué exacto (conflicto de
versión de TypeScript).

## `cdk.json`: qué significa cada bloque

```json
{
  "app": "bun bin/app.ts",
  "watch": { "include": [...], "exclude": [...] },
  "context": { /* ~85 feature flags */ }
}
```

- **`app`**: comando que el CLI de CDK ejecuta para obtener el árbol de constructs y sintetizar
  CloudFormation. Ver `02-bun-runtime-and-commands.md` para por qué es `bun bin/app.ts` y no lo
  que genera la plantilla oficial por defecto.
- **`watch`**: solo relevante para `cdk watch` (redeploy automático en cambios) — no usado todavía
  en este proyecto, se deja igual que la plantilla oficial por conveniencia futura.
- **`context`**: la lista completa de "feature flags" de CDK v2 vigentes en la versión 2.263.0/
  2.1134.0 al momento de esta investigación (2026-08-03) — copiada **exactamente** de la salida
  real de `cdk init` (no de una lista recordada de una versión anterior, que sería más corta y
  podría tener nombres de flags ya renombrados/removidos). Cada flag habilita el comportamiento
  "nuevo"/corregido de una versión de CDK para un recurso específico, mantenido así por
  retrocompatibilidad con stacks ya desplegados con el comportamiento viejo — como este proyecto
  no tiene stacks desplegados todavía, tenerlos todos en `true`/el valor de la plantilla oficial es
  lo correcto (evita heredar comportamiento legacy innecesariamente).

## Gotcha de entorno real durante la instalación

`bunx aws-cdk@2.1134.0 init app --language typescript` intentó, como parte de su propio
post-install, invocar `npm`/`node` para instalar sus propias `devDependencies` (jest, swc, tsx) —
en el entorno de desarrollo de este proyecto eso falló (`"node" no se reconoce...`, más errores
`EPERM` de limpieza de `node_modules` en Windows). **Esto no bloqueó lo que se necesitaba**: los
archivos de la plantilla (`cdk.json`, `bin/*.ts`, `lib/*.ts`, `tsconfig.json`) se generaron
igual antes del post-install — se usaron solo para lectura/referencia, el directorio se descartó
después. No representa un problema para el uso real de CDK en este repo, porque `apps/infra` nunca
ejecuta `cdk init` — el scaffold se escribió a mano siguiendo el patrón real observado.
