# Ledger de dependencias investigadas — Factuya

Registro de toda dependencia externa que entra al monorepo. Ninguna dependencia se agrega a un
`package.json` sin una fila aquí y sin su skill correspondiente en `.claude/skills/deps-<paquete>/`.
Ver `docs/sdd/factuya-sdd.md` §16 y `.claude/agents/dependency-skill-agent.md`.

| Paquete | Versión pinneada | Fecha investigación | Publicador verificado | Skill | Revisar de nuevo antes de |
|---|---|---|---|---|---|
| `xml-crypto` | 6.1.2 | 2026-07-31 | Sí — org `node-saml` en GitHub/npm, 501+ dependientes, mantenido activamente | [`deps-xml-crypto`](../../.claude/skills/deps-xml-crypto.md) | Sin fecha fija — revisar si SUNAT cambia el estándar de firma exigido, o si aparece una v7 con breaking changes |
| `typescript` (compilador, no dependencia de runtime) | 6.0.2 (`@typescript/typescript6`) | 2026-07-31 | Sí — equipo oficial de TypeScript/Microsoft | N/A (decisión documentada en ADR-0001, no requiere skill de API porque es tooling, no código consumido en runtime) | GA de TypeScript 7.1 (~oct. 2026) — reevaluar soporte de `typescript-eslint`/test runner |

> Cada nueva fila debe llenarse *antes* de que la dependencia aparezca en un `package.json`, como
> parte del mismo PR que la introduce (política en `docs/policies/git-workflow.md` §3).
