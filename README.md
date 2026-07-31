# Factuya

Middleware agnóstico de facturación electrónica. Recibe un JSON simple, arma el comprobante en el
estándar del país correspondiente, lo firma digitalmente, lo envía al canal habilitado del tenant
(SUNAT directo o su OSE contratado) y devuelve un resultado normalizado — sin que el sistema que
integra Factuya necesite saber nada de SOAP, UBL, XMLDSig ni de las reglas internas de cada país.

MVP: Perú (SUNAT). Arquitectura lista para sumar países (Colombia/Factus-DIAN como fase 2).

## Empezar aquí

- **Spec funcional y técnico completo**: [`docs/sdd/factuya-sdd.md`](docs/sdd/factuya-sdd.md)
- **Adaptador Perú (SUNAT) — cómo funciona y cómo probarlo**: [`docs/adapters/pe-sunat.md`](docs/adapters/pe-sunat.md)
- **Decisiones de arquitectura**: [`docs/adr/`](docs/adr/README.md)
- **Cómo se trabaja en este repo** (ramas, commits, documentación): [`docs/policies/`](docs/policies/)
- **Cómo se investigan e integran dependencias** (sin alucinar versiones ni APIs):
  [`.claude/agents/dependency-skill-agent.md`](.claude/agents/dependency-skill-agent.md) y el
  ledger en [`docs/dependencies/LEDGER.md`](docs/dependencies/LEDGER.md)

## Estado

MVP funcional de punta a punta para Perú: `InvoiceRequest` agnóstico → UBL 2.1 Factura → firma
XMLDSig real → SOAP `sendBill` → CDR parseado, con pruebas reales (no mockeadas) — ver
`docs/adapters/pe-sunat.md` para el detalle y las limitaciones conocidas y documentadas
explícitamente (contador de correlativo en memoria, `KmsSigner` sin implementar, distinción
aceptado-con-observaciones pendiente de verificar contra el catálogo oficial).

```bash
bun install
bun run typecheck
bun test                 # unitarias + integración de componente (servidor SOAP local real)
bun run test:integration # incluye la prueba contra SUNAT beta real (requiere salida a internet)
```

Pendiente: adaptador `co-factus` (fase 2), orquestación Step Functions/Lambda real (SDD §5),
persistencia DynamoDB de series/correlativos, y `KmsSigner` de producción.
