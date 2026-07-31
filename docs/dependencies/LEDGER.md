# Ledger de dependencias investigadas — Factuya

Registro de toda dependencia externa que entra al monorepo. Ninguna dependencia se agrega a un
`package.json` sin una fila aquí y sin su skill correspondiente en `.claude/skills/deps-<paquete>/`.
Ver `docs/sdd/factuya-sdd.md` §16 y `.claude/agents/dependency-skill-agent.md`.

| Paquete | Versión pinneada | Fecha investigación | Publicador verificado | Skill | Revisar de nuevo antes de |
|---|---|---|---|---|---|
| `xml-crypto` | 6.1.2 | 2026-07-31 | Sí — org `node-saml` en GitHub/npm, 501+ dependientes, mantenido activamente | [`deps-xml-crypto`](../../.claude/skills/deps-xml-crypto.md) | Sin fecha fija — revisar si SUNAT cambia el estándar de firma exigido, o si aparece una v7 con breaking changes |
| `@typescript/typescript6` (compilador, binario `tsc6`) | 6.0.2 | 2026-07-31 — instalado de verdad con `bun add -D`, ver addendum en ADR-0001 | Sí — equipo oficial de TypeScript/Microsoft | N/A (decisión documentada en ADR-0001, no requiere skill de API porque es tooling, no código consumido en runtime) | GA de TypeScript 7.1 (~oct. 2026) — reevaluar soporte de `typescript-eslint`/test runner |
| `@types/bun` | 1.3.14 | 2026-07-31 | Sí — org oficial `oven-sh` (mantenedores de Bun) | N/A (tipos ambientales, no API que se llame directamente) | Sin fecha fija — actualizar junto con la versión de Bun instalada |
| `fast-xml-parser` | 5.10.1 | 2026-07-31 | Sí — org `NaturalIntelligence` en GitHub/npm, muy adoptado | [`deps-fast-xml-parser`](../../.claude/skills/deps-fast-xml-parser.md) | Sin fecha fija — solo se usa `XMLParser`; si algún día se considera `XMLBuilder`, ya está deprecado en esta versión, no usar sin re-investigar |
| `fflate` | 0.8.3 | 2026-07-31 | Sí — autor `101arrowz`, sin dependencias nativas, muy adoptado | [`deps-fflate`](../../.claude/skills/deps-fflate.md) | Sin fecha fija |
| `@xmldom/xmldom` | 0.8.13 | 2026-07-31 — ya inspeccionado como dependencia transitiva de `xml-crypto`, promovido a devDependency directa en `packages/signing` y `packages/adapters/pe-sunat` porque los tests lo importan directamente (`DOMParser`) | Sí — sucesor mantenido del paquete `xmldom` original (deprecado por vulnerabilidades) | Cubierto dentro de [`deps-xml-crypto`](../../.claude/skills/deps-xml-crypto.md) (01-installation-and-provenance.md la menciona como dependencia) | Sin fecha fija |

> Cada nueva fila debe llenarse *antes* de que la dependencia aparezca en un `package.json`, como
> parte del mismo PR que la introduce (política en `docs/policies/git-workflow.md` §3).
