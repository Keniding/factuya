# Política de ramas y commits — Factuya

Vinculante para todo el monorepo. Referenciada desde `docs/sdd/factuya-sdd.md` §15.

## 1. Ramas

Formato: `<tipo>/<scope>-<descripción-corta-en-kebab-case>`

**Tipos válidos** (alineados con Conventional Commits):

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva |
| `fix` | Corrección de bug |
| `docs` | Solo documentación (SDD, ADR, policies, READMEs) |
| `refactor` | Cambio de código sin alterar comportamiento externo |
| `test` | Solo tests |
| `chore` | Tareas de mantenimiento (deps, CI, tooling) |
| `infra` | Cambios en IaC (`infra/`) |
| `adapter` | Cambios acotados a un adaptador de país específico |

**Scope**: el paquete o área afectada — `core-domain`, `pe-sunat`, `co-factus`, `signing`, `api`,
`infra`, `docs`, `deps`.

Ejemplos:
```
feat/pe-sunat-build-ubl-invoice
fix/signing-kms-timeout-retry
docs/adr-typescript-version-pin
chore/deps-add-xml-crypto
adapter/pe-sunat-credit-note-mapping
```

- Nunca commitear directo a `main`. Todo cambio entra por rama + PR.
- Una rama = un cambio lógico. No mezclar `feat` con `refactor` no relacionado en la misma rama.

## 2. Commits — Conventional Commits

Formato: `tipo(scope): resumen en imperativo, minúscula, sin punto final`

```
feat(pe-sunat): implementar mapeo de InvoiceRequest a UBL 2.1 factura

El adaptador necesitaba traducir el modelo agnóstico a los namespaces
cac/cbc exigidos por la Guía XML UBL 2.1 de SUNAT antes de poder firmar.

Refs: docs/sdd/factuya-sdd.md#8
```

- **Subject** (primera línea): qué cambia, en imperativo, ≤72 caracteres.
- **Body** (opcional pero recomendado en cambios no triviales): el *porqué*, no el *qué* — el diff
  ya muestra el qué.
- **Footer**: referencias a ADR/issue/SDD cuando aplique; `BREAKING CHANGE:` si rompe un contrato
  de API o de puerto (`CountryAdapter`, `InvoiceRequest`, etc.).
- Commits que introducen una dependencia nueva **deben** referenciar la skill correspondiente en
  el footer: `Deps-skill: .claude/skills/deps-<paquete>.md`.

Tipos de commit: mismos que los tipos de rama (§1).

## 3. Pull Requests

Un PR no se aprueba si:

- Introduce una dependencia nueva en cualquier `package.json` del monorepo sin su skill
  correspondiente en `.claude/skills/deps-<paquete>/` (ver `docs/sdd/factuya-sdd.md` §16 y
  `.claude/agents/dependency-skill-agent.md`).
- Toma una decisión de arquitectura no trivial (elección de librería core, cambio de flujo de
  firma, cambio de canal de envío a SUNAT, etc.) sin un ADR en `docs/adr/`.
- Modifica el comportamiento de un adaptador de país sin actualizar su documentación en
  `docs/adapters/<pais>.md` (ver `docs/policies/documentation.md`).
- No pasa `bun test` y el type-check con TypeScript 6 (ver ADR-0001) en CI.

Merge: squash merge a `main`, mensaje de squash = el mejor commit `tipo(scope): resumen` que
resuma el PR completo.

## 4. Excepciones

Cualquier excepción a esta política (ej. un hotfix urgente en producción) se documenta en el PR
explicando por qué, y se abre un follow-up si algo queda pendiente (ADR o skill faltante).
