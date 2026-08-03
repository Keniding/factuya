# docs/aws/ — infraestructura y guías de integración con AWS real

Todo lo relacionado a AWS real (no mockeado/simulado) vive acá — carpeta separada de `docs/adr/`
(decisiones) y `docs/adapters/` (adaptadores de país) porque esta agrupa el estado y los
procedimientos operativos: qué existe hoy en la cuenta, qué falta, con qué permisos, y cómo se
verificó cada pieza.

**Empezar por [`aws-infrastructure-sdd.md`](aws-infrastructure-sdd.md)** — el documento vivo que
trackea el estado de cada servicio de AWS involucrado (IAM, KMS, Lambda, Step Functions, DynamoDB,
S3, etc.), qué está verificado en vivo vs. solo diseñado, y qué sigue. Se actualiza en cada sesión
de trabajo en vez de dejar cada avance como una nota suelta.

Convención de las guías paso a paso (`<tema>.md`):

- `<tema>.md` — la guía pública, sin ningún valor específico de una cuenta (ID de cuenta, ARNs,
  nombres de recursos reales). Se commitea siempre.
- `<tema>.private.md` — la copia de trabajo de quien sigue la guía, con los valores reales de su
  propia cuenta. **Nunca se commitea** — `docs/aws/*.private.md` está en `.gitignore` a
  propósito. Nunca poner Access Keys/Secret Keys ahí tampoco, ni en ningún archivo del repo.

## Índice

| Documento | Qué es |
|---|---|
| [`aws-infrastructure-sdd.md`](aws-infrastructure-sdd.md) | Estado vivo de toda la infraestructura AWS — empezar aquí |
| [`kms-live-verification.md`](kms-live-verification.md) | Guía paso a paso: `KmsSigner` (`packages/signing`) contra AWS KMS real — CMK compartida + Grant por tenant, ver ADR-0003 |
