import { createApp } from "./app";
import { logDevTenantInfo, peSunatAdapter, tenantRegistry } from "./config";

/**
 * Punto de entrada real de `apps/api` — arma las dependencias reales (certificado efímero,
 * `PeSunatAdapter` apuntando a SUNAT beta, `LocalTenantRegistry` con el tenant de desarrollo
 * sembrado — ver `config.ts`) y las inyecta en `createApp` (`app.ts`, el ruteo/autenticación
 * real, probado por separado con dependencias falsas). Usa `Bun.serve` (herramienta de
 * desarrollo, ver CLAUDE.md punto 4) en vez de la arquitectura de producción (API Gateway +
 * Lambda + Step Functions) — este servidor es el equivalente "todo en un proceso" para desarrollo
 * local, no el despliegue final.
 */

const PORT = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port: PORT,
  fetch: createApp({ tenantRegistry, countryAdapter: peSunatAdapter }),
});

console.log(`Factuya API escuchando en http://localhost:${server.port}`);
console.log(`Documentación interactiva (Scalar): http://localhost:${server.port}/docs`);
logDevTenantInfo();
