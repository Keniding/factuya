# Factuya — guía para agentes

Middleware agnóstico de facturación electrónica (MVP: SUNAT Perú). Ver
`docs/sdd/factuya-sdd.md` para el spec completo antes de tocar código o documentación.

## Reglas vinculantes en este repo

1. **Ramas y commits**: seguir `docs/policies/git-workflow.md` (Conventional Commits, naming
   `tipo/scope-descripcion`). Nunca commitear directo a `main`.
2. **Documentación**: seguir `docs/policies/documentation.md`. Todo paquete nuevo lleva su
   `README.md`; toda decisión de arquitectura no trivial lleva un ADR en `docs/adr/`; todo
   adaptador de país lleva `docs/adapters/<pais>.md`.
3. **Dependencias — regla más importante**: ninguna dependencia externa se agrega a un
   `package.json` sin antes correr el proceso de `.claude/agents/dependency-skill-agent.md`, que
   genera una skill investigada en `.claude/skills/deps-<paquete>/` y una fila en
   `docs/dependencies/LEDGER.md`. No asumir versiones ni APIs desde el entrenamiento del modelo —
   ver `docs/sdd/factuya-sdd.md` §16 y el caso real documentado en `docs/adr/0001-typescript-version-pin.md`.
4. **Package manager**: Bun (`bun add`, `bun run`, `bun test`) para todo el ecosistema
   TypeScript/JavaScript del monorepo. Bun es herramienta de desarrollo — el despliegue en AWS
   Lambda usa el runtime oficial `nodejs`, no un runtime Bun (ver SDD §11).
5. **Compilador TypeScript**: fijado en la serie 6.x (`@typescript/typescript6`), no 7.x, hasta que
   el ecosistema de tooling soporte la API estable de TS7 — ver ADR-0001. No "actualizar a la
   última versión" de TypeScript sin releer ese ADR primero.
6. **Firma digital**: el adaptador `pe-sunat` usa XMLDSig estándar (librería `xml-crypto`, ver
   `.claude/skills/deps-xml-crypto.md`), **no** XAdES — ver ADR-0002. No confundir con el adaptador
   `co-factus` (fase 2), que sí necesita XAdES-EPES y una librería distinta todavía sin investigar.
7. **Responsabilidad legal**: Factuya es un proxy tecnológico, no un OSE/PSE homologado — ver SDD
   §13. No diseñar ningún flujo que implique que Factuya asume la validación tributaria en nombre
   del tenant.
8. **Este entorno de desarrollo bloquea la red saliente salvo un allowlist** (npm, GitHub, poco
   más) — verificado empíricamente, ver `docs/adapters/pe-sunat.md` "Limitación de este entorno".
   Un test que falla por no alcanzar un host externo no es necesariamente un bug de código; revisar
   primero si es el mismo bloqueo antes de "arreglarlo" a ciegas.

## Dónde está cada cosa

```
docs/sdd/factuya-sdd.md        spec funcional + técnico (fuente de verdad del producto)
docs/adr/                      decisiones de arquitectura, numeradas
docs/policies/                 git-workflow.md, documentation.md
docs/dependencies/LEDGER.md    toda dependencia externa investigada, con fecha y skill asociada
docs/adapters/pe-sunat.md      cómo funciona el adaptador SUNAT, qué se verificó y limitaciones
.claude/agents/                agentes especializados de este repo
.claude/skills/deps-*/         skills de dependencias, generadas investigando el paquete real
packages/shared-types/         InvoiceRequest/InvoiceResult/TenantConfig — modelo agnóstico
packages/core-domain/          puerto CountryAdapter + orquestación emitInvoice
packages/signing/              firma XMLDSig con Signer inyectable (local dev/test, KMS pendiente)
packages/adapters/pe-sunat/    build UBL, SOAP client, parseo de CDR — implementación real
```

## Cómo correr y probar

```bash
bun install && bun run typecheck && bun test
```

`bun test` incluye tests unitarios y un test de integración de componente contra un servidor SOAP
local real (mismo protocolo que SUNAT). `bun run test:integration` agrega la prueba contra el
ambiente beta real de SUNAT — se omite automáticamente con un mensaje claro si el entorno no tiene
salida a internet (ver punto 8 arriba), no falla en falso ni finge pasar.
