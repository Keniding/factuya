# Política de documentación — Factuya

Vinculante para todo el monorepo. Referenciada desde `docs/sdd/factuya-sdd.md` §15.

## 1. Estructura de `docs/`

```
docs/
├── sdd/                  # el spec vivo — se versiona (v0.1, v0.2, ...) en el propio archivo
│   └── factuya-sdd.md
├── adr/                  # decisiones de arquitectura, una por archivo, numeradas
│   ├── README.md         # índice + plantilla
│   └── NNNN-titulo.md
├── policies/             # este archivo, git-workflow.md, y las que se agreguen
├── dependencies/
│   └── LEDGER.md         # registro de toda dependencia externa investigada
└── adapters/             # un doc funcional por país, cuando exista el adaptador
    └── pe-sunat.md
```

## 2. Cuándo se requiere cada tipo de documento

| Cambio | Documento requerido |
|---|---|
| Nuevo paquete en `packages/*` o `apps/*` | `README.md` propio del paquete (setup, propósito, cómo correr sus tests) |
| Decisión de arquitectura no trivial (librería core, flujo de firma, canal SUNAT, runtime) | ADR en `docs/adr/` |
| Corrección a una afirmación técnica previa del SDD | ADR + actualizar el SDD citando el ADR (ver ejemplo: ADR-0001, ADR-0002) |
| Nueva dependencia externa (npm) | Skill en `.claude/skills/deps-<paquete>/` **antes** de usarse en código — ver §16 del SDD |
| Nuevo adaptador de país o cambio de comportamiento en uno existente | `docs/adapters/<pais>.md` actualizado |
| Cambio en el contrato público (`InvoiceRequest`, `InvoiceResult`, rutas API) | Actualizar §6/§7 del SDD en el mismo PR |

## 3. `docs/adapters/<pais>.md` — formato mínimo

Cada adaptador de país documenta, con enlaces a fuente oficial (no memoria):

- Endpoint(s) vigentes y cómo se verificaron (fecha de verificación).
- Catálogos usados (tipo de documento, moneda, unidad de medida, etc.) y su fuente oficial.
- Particularidades de firma (XMLDSig vs XAdES — ver ADR-0002 como ejemplo de por qué esto importa).
- Casos de prueba conocidos (aceptado, observado, rechazado) y cómo reproducirlos en el ambiente
  de pruebas de SUNAT/OSE correspondiente.
- Librerías/skills de las que depende (enlace a `.claude/skills/deps-*`).

## 4. `docs/dependencies/LEDGER.md` — formato mínimo

Una fila por dependencia externa con: nombre, versión pinneada, fecha de investigación, skill
asociada, publicador verificado (sí/no y por qué), y fecha de "revisar de nuevo antes de" cuando
aplique (ej. dependencias de un ecosistema en transición, como TypeScript en 2026 — ver ADR-0001).

## 5. Principio general

Ningún documento en `docs/` afirma algo sobre una API externa, un servicio de terceros (SUNAT,
AWS, Factus) o una librería sin una fuente verificable citada. Si algo no se pudo verificar,
el documento lo dice explícitamente ("pendiente de verificar") en vez de asumirlo — ver
`docs/sdd/factuya-sdd.md` §16 y `.claude/agents/dependency-skill-agent.md`.
