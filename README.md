# Factuya

Middleware agnóstico de facturación electrónica. Recibe un JSON simple, arma el comprobante en el
estándar del país correspondiente, lo firma digitalmente, lo envía al canal habilitado del tenant
(SUNAT directo o su OSE contratado) y devuelve un resultado normalizado — sin que el sistema que
integra Factuya necesite saber nada de SOAP, UBL, XMLDSig ni de las reglas internas de cada país.

MVP: Perú (SUNAT). Arquitectura lista para sumar países (Colombia/Factus-DIAN como fase 2).

## Empezar aquí

- **Spec funcional y técnico completo**: [`docs/sdd/factuya-sdd.md`](docs/sdd/factuya-sdd.md)
- **Flujos: sin Factuya, con Factuya, y qué sigue** (incluye el estado honesto del proyecto):
  [`docs/flows.md`](docs/flows.md)
- **Adaptador Perú (SUNAT) — cómo funciona y cómo probarlo**: [`docs/adapters/pe-sunat.md`](docs/adapters/pe-sunat.md)
- **API HTTP y documentación interactiva**: [`apps/api/README.md`](apps/api/README.md)
- **Decisiones de arquitectura**: [`docs/adr/`](docs/adr/README.md)
- **Cómo se trabaja en este repo** (ramas, commits, documentación): [`docs/policies/`](docs/policies/)
- **Cómo se investigan e integran dependencias** (sin alucinar versiones ni APIs):
  [`.claude/agents/dependency-skill-agent.md`](.claude/agents/dependency-skill-agent.md) y el
  ledger en [`docs/dependencies/LEDGER.md`](docs/dependencies/LEDGER.md)

## Estado

**No está completo al 100%** — ver `docs/flows.md` para el detalle honesto de qué falta. Lo que
sí es real y está validado de punta a punta contra SUNAT beta (no mockeado): `InvoiceRequest`
agnóstico → UBL 2.1 Factura → firma XMLDSig real → SOAP `sendBill` → CDR parseado → API HTTP
(`apps/api`) con documentación interactiva en `GET /docs`. Cuatro corridas reales consecutivas,
todas `ACCEPTED` con CDR real de SUNAT.

```bash
bun install
bun run typecheck
bun test                     # unitarias + integración de componente (servidor SOAP local real)
bun run test:integration     # incluye la prueba contra SUNAT beta real (requiere salida a internet)
bun run apps/api/src/index.ts # levanta la API en :3000 — documentación interactiva en /docs
```

Pendiente (orden de dependencia completo en `docs/flows.md`): multi-tenant real, `KmsSigner`
contra AWS real, infraestructura como código (Step Functions/Lambda/DynamoDB/S3), flujo asíncrono
SUNAT y notas de crédito/débito, webhooks, y el adaptador `co-factus` (Colombia, fase 2).
