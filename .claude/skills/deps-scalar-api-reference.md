---
name: deps-scalar-api-reference
description: "Referencia investigada del paquete @scalar/api-reference, usado por Factuya para servir documentación interactiva (estilo Swagger UI) del contrato público de apps/api a partir de un archivo openapi.yaml. Úsala cuando se escriba o revise código en apps/api relacionado con la ruta /docs o con cómo se sirve el bundle standalone de Scalar. No requiere Vue ni un bundler: Factuya solo sirve el bundle standalone precompilado como archivo estático, sin importar el componente Vue del paquete."
---

# @scalar/api-reference — skill de dependencia (Factuya · apps/api)

Instalado de verdad con `bun add @scalar/api-reference@1.64.0` en un entorno aislado y verificado
contra `package.json`, los tipos instalados, y el bundle real en `node_modules` — 2026-07-31.
Nada de lo que sigue viene de memoria del modelo ni de un blog de integración desactualizado.

## Procedencia

- Paquete: `@scalar/api-reference`, versión resuelta **1.64.0** (publicada 2026-07-31).
- Repositorio: `scalar/scalar` en GitHub (org oficial, coincide con `scalar.com`) — mismo producto
  que la página de descarga del Scalar API Client que referenció el usuario
  (`scalar.com/products/api-client`); `api-reference` es el paquete específico para *servir*
  documentación de una API, no el cliente de escritorio.
- Mantenedores publicados en npm: todos con email `@scalar.com` (`cameronrohani`, `marclave`,
  `scalar_geoff`, `hanspagel`, etc.) — sin señales de typosquat.
- Licencia MIT. ~20M instalaciones npm/mes según su propio README, 15.500+ estrellas en GitHub.
- **Importante para el pin de versión**: el propio `package.json` declara `"engines": { "node":
  ">=22" }`. Compatible con Bun (herramienta de desarrollo de este repo) y con Node.js 22 LTS+
  (runtime real de despliegue, ver CLAUDE.md punto 4) — no se detectó ninguna API usada aquí que
  dependa de una función exclusiva de Bun.

## Por qué esta forma de integrarlo (standalone, sin Vue)

El paquete es, en el fondo, un componente Vue 3 (`"main": "./dist/index.js"`, pensado para
`createApp(ApiReference).mount(...)` dentro de una app Vue con bundler) — pero Factuya **no usa
Vue** en ningún lado y `apps/api` es un servidor Bun sin bundler de frontend. Por eso Factuya no
importa el paquete como módulo de código: solo sirve como archivo estático el bundle ya compilado
que el propio paquete expone para este caso exacto de uso.

Confirmado leyendo `package.json` real del paquete instalado:

```json
"browser": "./dist/browser/standalone.js"
```

Ese es el mismo archivo que resuelve `https://cdn.jsdelivr.net/npm/@scalar/api-reference` en el
método de integración "CDN" que documenta el propio README oficial del paquete. Factuya sirve ese
archivo desde su propio servidor (`GET /vendor/scalar-standalone.js`) en vez de depender de
jsdelivr en tiempo de ejecución — mismo bundle, sin dependencia de red externa para ver la
documentación.

## API real usada

Confirmado en `dist/standalone/lib/html-api.d.ts` y `dist/standalone/lib/register-globals.d.ts`
(leídos del paquete instalado, no asumidos): el bundle standalone registra un global
`window.Scalar` con un único método:

```typescript
declare global {
  interface Window {
    Scalar: { createApiReference: CreateApiReference };
  }
}
```

Firma real (de `html-api.d.ts`):

```typescript
/**
 * @example createApiReference({ url: '/scalar.json' }).mount('#app')
 * @example createApiReference('#app', { url: '/scalar.json' })
 */
export declare const createApiReference: CreateApiReference;
```

Uso en Factuya (HTML servido por `apps/api` en `GET /docs`):

```html
<div id="app"></div>
<script src="/vendor/scalar-standalone.js"></script>
<script>
  Scalar.createApiReference('#app', {
    url: '/openapi.yaml',
    title: 'Factuya API',
  });
</script>
```

Opciones de configuración verificadas contra `node_modules/@scalar/types/dist/api-reference/api-reference-configuration.d.ts`
(paquete transitivo, mismo árbol de instalación): `url`, `title`, `theme`, `favicon`, `proxyUrl`
existen como campos reales de `ApiReferenceConfiguration`. Factuya no necesita `proxyUrl` porque
sirve la documentación y la API desde el mismo origen (sin problema de CORS que evitar).

## Cómo se resuelve la ruta del bundle sin pelear con el mapa de `exports`

El `package.json` del paquete **no** expone `./dist/browser/standalone.js` como subpath en su mapa
`exports` (solo expone `.`, `./components`, `./blocks`, `./hooks`, `./plugins`, `./features`,
`./helpers`, y un par de `.css`). Intentar `import "@scalar/api-reference/dist/browser/standalone.js"`
directamente falla por eso. La forma correcta usada en `apps/api`: resolver primero el paquete raíz
(sí permitido, `"."` está en el mapa de `exports`) y navegar el filesystem desde ahí — el acceso a
archivos del propio paquete por `fs` no está sujeto al mapa de `exports` (eso solo restringe
resolución de *module specifiers*):

```typescript
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const entryFile = require.resolve("@scalar/api-reference"); // .../dist/index.js
const standaloneJsPath = join(dirname(entryFile), "browser", "standalone.js");
```

Se usa `node:module`/`createRequire` (no una API exclusiva de Bun como `Bun.resolveSync`) para que
esta ruta de resolución también funcione si `apps/api` se ejecuta alguna vez sobre el runtime
`nodejs` real (ver CLAUDE.md punto 4) y no solo sobre Bun en desarrollo.

## Known issues / gotchas

- El bundle standalone pesa **~3.6 MB** (`dist/browser/standalone.js`, sin comprimir) — irrelevante
  para verlo una vez en un navegador de desarrollo, pero si `apps/api` migra a Lambda real, servir
  este archivo desde la propia función no es ideal (cold start/tamaño de paquete); lo razonable a
  futuro sería servirlo como asset estático desde S3/CloudFront, no desde la Lambda de negocio —
  no implementado todavía, ver `docs/flows.md` para el roadmap.
- El paquete completo trae Vue 3 y ~25 dependencias porque el subpath `.` (el componente Vue) sigue
  ahí aunque Factuya no lo use — no se puede instalar "solo la parte standalone" como paquete
  separado; es el mismo tarball. Aceptado conscientemente por ser la opción oficial y mantenida.
- No se necesitó `proxyUrl` (mismo origen). Si en el futuro `/docs` se sirve desde un dominio
  distinto al de la API, revisar esa opción antes de asumir que seguirá funcionando sin CORS.
