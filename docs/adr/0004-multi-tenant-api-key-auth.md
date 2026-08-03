# ADR-0004: Multi-tenant real en `apps/api` — API Key por tenant, no JWT

- Estado: aceptado
- Fecha: 2026-08-02

## Contexto

`apps/api` hoy resuelve un único `TenantConfig` fijo por variables de entorno
(`apps/api/src/config.ts`) — toda llamada a `POST /v1/invoices` usa el mismo tenant de
desarrollo, sin autenticación. `docs/sdd/factuya-sdd.md` §5/§7 ya menciona "Auth (API Key / JWT
por tenant)" en el diseño aspiracional, pero nunca decidió cuál de los dos ni cómo se verifica —
justo el tipo de ambigüedad que este repo no deja sin resolver antes de escribir código (SDD §16).

Restricción real a tener en cuenta: DynamoDB (donde en producción viviría el registro de
tenants) todavía no existe — ver `docs/aws/aws-infrastructure-sdd.md`, estado "No iniciado". La
resolución de tenant real no puede depender de esa pieza sin bloquearse en infraestructura que
todavía no se construyó.

## Decisión

**API Key, no JWT.** Factuya es una API server-to-server — quien llama es un ERP, un e-commerce,
un POS, no un usuario final en un navegador. Los problemas que JWT resuelve (sesiones de corta
vida, refresh tokens, claims firmados verificables sin ida y vuelta a una base de datos) no
aplican a este caso; una API key simple, de larga vida y revocable es el patrón estándar en APIs
B2B de este tipo (Stripe, Twilio, SendGrid, etc.) y el más simple de operar sin introducir bugs de
verificación de firma/expiración. Si en el futuro aparece un caso de uso que sí necesite JWT (ej.
un dashboard web de un tenant con sesiones de usuario humano), se evalúa aparte — no se adelanta
ahora sin un caso de uso real.

Detalle de la implementación:

- **Header**: `Authorization: Bearer <api_key>` — convención estándar, y la que la documentación
  interactiva (`GET /docs`, Scalar) soporta probar directamente sin configuración adicional.
- **Formato de la key**: prefijo `fty_` + secreto aleatorio de alta entropía (ej.
  `crypto.randomBytes(32).toString("base64url")`) — el prefijo no es decorativo: permite que
  herramientas de detección de secretos filtrados (y cualquier humano revisando logs) identifiquen
  de inmediato que es una credencial de Factuya, sin exponer nada sobre el tenant o el ambiente en
  el string mismo.
- **Almacenamiento: nunca en texto plano.** Se guarda `sha256(api_key)` (`node:crypto`,
  `createHash("sha256")`), y la verificación compara con `crypto.timingSafeEqual` para no filtrar
  información por tiempo de respuesta. **No** se usa bcrypt/scrypt/argon2: esos algoritmos existen
  para mitigar fuerza bruta contra secretos de **baja entropía** (contraseñas elegidas por
  humanos) — una API key generada aleatoriamente con suficiente entropía no lo necesita, y un hash
  deliberadamente lento agregaría latencia innecesaria a cada request sin beneficio real. Sin
  dependencia nueva: `node:crypto` ya cubre todo esto, no hace falta pasar por
  `dependency-skill-agent`.
- **Resolución de tenant**: una interfaz `TenantRegistry` con
  `resolveByApiKeyHash(hash): Promise<TenantConfig | undefined>`. `apps/api` usa una
  implementación **`LocalTenantRegistry`** (nombrada consistente con `LocalPemKeySigner` —
  mismo patrón: real y funcional, pero explícitamente de desarrollo, nunca para producción)
  respaldada en memoria/configuración de proceso. Intercambiable por una implementación respaldada
  en DynamoDB el día que esa pieza de infraestructura exista (`docs/aws/aws-infrastructure-sdd.md`).

## Fuera de alcance de este ADR

- `POST /v1/tenants/{id}/certificate` (subida de certificado por tenant, SDD §7) — necesita su
  propio diseño de flujo de emisión/rotación de API keys y almacenamiento seguro de certificados.
  Se aborda en un ADR/implementación aparte, no se resuelve de paso acá.
- Rate limiting / cuotas por tenant — no es parte del problema que este ADR resuelve (aislamiento
  de acceso), aunque podría apoyarse en la misma resolución de tenant más adelante.

## Fuentes verificadas

- `docs/sdd/factuya-sdd.md` §5/§7 (el punto de partida ambiguo que este ADR resuelve).
- Patrón de autenticación Bearer API key para APIs B2B server-to-server: práctica estándar y
  estable de la industria (Stripe, Twilio), no depende de una versión de librería ni de
  documentación que cambie con frecuencia — no requiere el proceso de investigación de §16 (eso
  aplica a dependencias externas de código, no a un patrón arquitectónico general).
- `node:crypto` (`createHash`, `timingSafeEqual`): API estable de Node.js, documentación oficial —
  se usa sin agregar ninguna dependencia npm nueva.

## Consecuencias

- `apps/api` necesita un middleware de auth antes de cada ruta protegida (todo excepto `/health`,
  `/docs`, `/openapi.yaml`, `/vendor/*`, que son públicas por diseño).
- `apps/api/openapi.yaml` se actualiza con un `securityScheme` tipo `http`/`bearer` en el contrato.
- `LocalTenantRegistry` es una limitación deliberada, documentada junto a las demás limitaciones
  conocidas del proyecto (`packages/signing/README.md`, `docs/flows.md`) — no un descuido.
- El tenant de desarrollo deja de ser un valor fijo cableado en `config.ts`: pasa a ser un tenant
  sembrado en `LocalTenantRegistry` con una API key conocida, impresa en consola al arrancar el
  servidor (mismo espíritu que el certificado efímero de `dev-certificate.ts`) — el mecanismo de
  autenticación es real desde el primer request, no un bypass que solo se activa "en dev".
