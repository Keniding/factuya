# docs/aws/ — guías de integración con AWS real

Guías paso a paso para verificar piezas de Factuya contra servicios reales de AWS (no
mockeados/simulados) — carpeta separada de `docs/adr/` (decisiones) y `docs/adapters/`
(adaptadores de país) porque esta agrupa procedimientos operativos: qué crear, con qué permisos,
y cómo confirmar que algo funciona en una cuenta real.

Convención de esta carpeta:

- `<tema>.md` — la guía pública, sin ningún valor específico de una cuenta (ID de cuenta, ARNs,
  nombres de recursos reales). Se commitea siempre.
- `<tema>.private.md` — la copia de trabajo de quien sigue la guía, con los valores reales de su
  propia cuenta. **Nunca se commitea** — `docs/aws/*.private.md` está en `.gitignore` a
  propósito. Nunca poner Access Keys/Secret Keys ahí tampoco, ni en ningún archivo del repo.

## Índice

| Guía | Verifica |
|---|---|
| [`kms-live-verification.md`](kms-live-verification.md) | `KmsSigner` (`packages/signing`) contra AWS KMS real — CMK compartida + Grant por tenant, ver ADR-0003 |
