import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ver .claude/skills/deps-scalar-api-reference.md para la investigación completa. Resumen: el
 * paquete es un componente Vue que Factuya NO usa; solo se sirve su bundle standalone precompilado
 * (`dist/browser/standalone.js`, el mismo que resuelve la integración "CDN" del propio README
 * oficial) como archivo estático, sin bundler de frontend.
 *
 * `createRequire`/`node:module` (no `Bun.resolveSync`) para que esta resolución también funcione
 * si `apps/api` corre alguna vez sobre el runtime `nodejs` real (ver CLAUDE.md punto 4), no solo
 * sobre Bun en desarrollo.
 */
const require = createRequire(import.meta.url);

const scalarEntryFile = require.resolve("@scalar/api-reference");
export const SCALAR_STANDALONE_JS_PATH = join(dirname(scalarEntryFile), "browser", "standalone.js");

const currentDir = dirname(fileURLToPath(import.meta.url));
export const OPENAPI_YAML_PATH = join(currentDir, "..", "openapi.yaml");

export function renderDocsHtml(): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Factuya API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="/vendor/scalar-standalone.js"></script>
    <script>
      window.Scalar.createApiReference('#app', {
        url: '/openapi.yaml',
        title: 'Factuya API',
      });
    </script>
  </body>
</html>`;
}
