# ADR-0001: Pin de TypeScript 6.0.2 sobre 7.0.2 para build/CI

- Estado: aceptado
- Fecha: 2026-07-31

## Contexto

El SDD v0.1 no especificaba versión de TypeScript. Antes de escribir el primer `package.json`,
se investigó cuál es la versión estable vigente, en vez de asumir una desde el entrenamiento del
modelo (política §16 del SDD).

Hallazgo: el paquete `typescript` en npm está en **7.0.2** (GA desde el 8 de julio de 2026),
la primera versión estable del compilador reescrito en Go ("tsgo"), con builds hasta 8-12x más
rápidos. Existe también un paquete separado `@typescript/typescript6` en **6.0.2**, publicado por
el propio equipo de TypeScript como puente para quien necesite quedarse en el compilador clásico
basado en JS.

El problema: TypeScript 7.0 **se lanzó sin API programática estable** — esa API recién llega
establecida en TypeScript 7.1 (estimado ~octubre 2026). Herramientas que dependen de esa API
programática para funcionar —`typescript-eslint`, `ts-jest`/equivalentes basados en el compiler
host, `ts-morph`, y los type-checkers de plantillas de Vue/Svelte/Astro— **no corren sobre TS 7.0**
todavía. Una encuesta de compatibilidad (abril 2026) sobre 15 librerías de pipeline encontró que 9
llaman funciones de la API que ya no existen en TS7.

Esto es directamente relevante para Factuya: el proyecto necesita ESLint (`typescript-eslint`) y
un test runner con soporte TS funcionando desde el día uno, en un monorepo con lógica crítica de
firma digital y cálculo tributario donde no es aceptable perder linting/testing por una migración
de compilador a medio madurar.

## Decisión

- Fijar `typescript` en la serie **6.0.2** (vía `@typescript/typescript6`) como fuente de verdad
  para type-check, build y CI en todo el monorepo (`apps/*`, `packages/*`).
- Permitir opcionalmente correr `tsgo` (TS 7 nativo) en paralelo, en CI o en el editor, **solo**
  como chequeo rápido no bloqueante (feedback de velocidad), nunca como el type-check que decide
  si un PR pasa.
- Revisar esta decisión cuando TypeScript 7.1 alcance GA y se confirme que `typescript-eslint`,
  el test runner elegido y `ts-morph` (si se usa) soportan la API estable de 7.1. Registrar la
  reevaluación en `docs/dependencies/LEDGER.md`.

## Fuentes verificadas (2026-07-31)

- [TypeScript 7 Now Stable — TechTimes](https://www.techtimes.com/articles/320049/20260710/typescript-7-now-stable-10-faster-builds-not-vue-svelte-yet.htm)
- [Speedier type checks in TypeScript 7.0 — The Register](https://www.theregister.com/devops/2026/07/09/speedier-type-checks-in-typescript-70-as-first-stable-go-release-ships/5268828)
- [TypeScript 6.0 ships as final JS-based release — Visual Studio Magazine](https://visualstudiomagazine.com/articles/2026/03/23/typescript-6-0-ships-as-final-javascript-based-release-clears-path-for-go-native-7-0.aspx)
- [Why Your TypeScript 7 Upgrade Broke ESLint, ts-jest, and ts-morph — Dev Encyclopedia](https://devencyclopedia.com/blog/typescript-7-broke-eslint-ts-jest-ts-morph)
- [TypeScript 7.0 migration: 10x compiler, adopt in stages — ecorpit.com](https://ecorpit.com/typescript-7-migration-readiness-eslint-astro-blockers-2026/)
- npm registry: paquete `typescript` (7.0.2) y `@typescript/typescript6` (6.0.2), consultados 2026-07-31.

## Consecuencias

- El `package.json` raíz fija `"typescript": "6.0.2"` (paquete `@typescript/typescript6` bajo el
  alias `typescript`, o el mecanismo de alias que Bun soporte al momento de implementar — verificar
  contra la documentación de Bun al escribir el `package.json`, no asumir sintaxis).
- CI corre `tsc --noEmit` (TS6) como gate obligatorio; `tsgo` es un job informativo aparte.
- Este ADR debe revisarse activamente, no queda "fijo para siempre": es una decisión con fecha de
  vencimiento implícita (GA de TS 7.1).
