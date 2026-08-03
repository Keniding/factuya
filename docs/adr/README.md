# Architecture Decision Records (ADR)

Registro de decisiones de arquitectura de Factuya. Cada ADR documenta una decisión no trivial,
el contexto que la motivó, las fuentes que se verificaron (no se aceptan decisiones basadas en
memoria/entrenamiento del LLM sin verificar contra una fuente actual — ver
`docs/sdd/factuya-sdd.md` §16), y las consecuencias.

## Cuándo escribir un ADR

- Elegir o cambiar una dependencia core (runtime, compilador, librería de firma, SDK).
- Cualquier decisión que afecte a más de un paquete del monorepo.
- Cualquier corrección a una afirmación técnica hecha en una versión anterior del SDD.
- Decisiones de seguridad/cumplimiento (custodia de claves, canal de envío a SUNAT, etc.).

## Formato

Usar `NNNN-titulo-corto-en-kebab-case.md`, numeración correlativa. Plantilla:

```markdown
# ADR-NNNN: Título

- Estado: propuesto | aceptado | reemplazado por ADR-XXXX
- Fecha: YYYY-MM-DD

## Contexto

## Decisión

## Fuentes verificadas
(enlaces + fecha de verificación — no vale "se sabe que...")

## Consecuencias
```

## Índice

| ADR | Título | Estado |
|---|---|---|
| [0001](0001-typescript-version-pin.md) | Pin de TypeScript 6.0.2 sobre 7.0.2 para build/CI | Aceptado |
| [0002](0002-sunat-signature-standard-xmldsig-vs-xades.md) | SUNAT usa XMLDSig, no XAdES; Colombia sí requiere XAdES-EPES | Aceptado |
| [0003](0003-kms-shared-cmk-with-grants.md) | KMS: una CMK compartida + Grants por tenant, no una CMK por tenant | Reemplazado por ADR-0005 |
| [0004](0004-multi-tenant-api-key-auth.md) | Multi-tenant real en apps/api: API Key (no JWT) resuelta vía TenantRegistry | Aceptado |
| [0005](0005-kms-one-cmk-per-tenant.md) | KMS: una CMK por tenant (corrige ADR-0003 — lectura incorrecta de la fuente citada) | Aceptado |
| [0006](0006-tenant-certificate-import.md) | POST /v1/tenants/{id}/certificate: import de la clave real del tenant (RFC 5649 AES-KWP + RSA-OAEP) | Aceptado |
