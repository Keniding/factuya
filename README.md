# Factuya

Middleware agnóstico de facturación electrónica. Recibe un JSON simple, arma el comprobante en el
estándar del país correspondiente, lo firma digitalmente, lo envía al canal habilitado del tenant
(SUNAT directo o su OSE contratado) y devuelve un resultado normalizado — sin que el sistema que
integra Factuya necesite saber nada de SOAP, UBL, XMLDSig ni de las reglas internas de cada país.

MVP: Perú (SUNAT). Arquitectura lista para sumar países (Colombia/Factus-DIAN como fase 2).

## Empezar aquí

- **Spec funcional y técnico completo**: [`docs/sdd/factuya-sdd.md`](docs/sdd/factuya-sdd.md)
- **Decisiones de arquitectura**: [`docs/adr/`](docs/adr/README.md)
- **Cómo se trabaja en este repo** (ramas, commits, documentación): [`docs/policies/`](docs/policies/)
- **Cómo se investigan e integran dependencias** (sin alucinar versiones ni APIs):
  [`.claude/agents/dependency-skill-agent.md`](.claude/agents/dependency-skill-agent.md) y el
  ledger en [`docs/dependencies/LEDGER.md`](docs/dependencies/LEDGER.md)

## Estado

Fase de especificación. Aún no hay código de aplicación — el siguiente paso es el JSON Schema de
`InvoiceRequest`/`InvoiceLine`/`TaxSummary` y correr `dependency-skill-agent` sobre el resto de
dependencias core antes de escribir el primer `package.json`.
