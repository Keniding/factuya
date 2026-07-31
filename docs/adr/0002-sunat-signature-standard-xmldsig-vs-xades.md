# ADR-0002: SUNAT usa XMLDSig, no XAdES; Colombia (Factus/DIAN) sí requiere XAdES-EPES

- Estado: aceptado
- Fecha: 2026-07-31

## Contexto

El SDD v0.1 (§8-9) describía la firma del comprobante SUNAT como "XML-DSig/XAdES" de forma
intercambiable. Antes de elegir la librería de firma para `packages/signing` y el adaptador
`pe-sunat`, se verificó la especificación real, porque XMLDSig y XAdES no son lo mismo: XAdES es
una extensión de XMLDSig que agrega propiedades calificadas (`xades:QualifyingProperties`:
identidad del firmante, política de firma, timestamp) — una librería que solo implementa XMLDSig
plano no puede producir una firma XAdES-EPES completa, y viceversa, usar una librería XAdES pesada
donde solo se necesita XMLDSig plano añade complejidad y superficie de fallo innecesarias.

Verificación contra las Guías de Elaboración de Documentos XML UBL 2.1 de SUNAT (factura, boleta,
nota de crédito, nota de débito — publicadas en cpe.sunat.gob.pe) y fuentes de implementadores:
SUNAT exige una firma **XMLDSig estándar W3C**, enveloped, con `ds:SignedInfo` (canonicalización
`exclusive-c14n`, `SignatureMethod` RSA-SHA256), consignada dentro de `ext:UBLExtensions` y
referenciada por `cac:Signature` en el UBL. **No** exige `xades:QualifyingProperties` ni ningún
otro artefacto XAdES.

En contraste, Colombia/DIAN exige perfil **XAdES-EPES** (Extended Policy Electronic Signature) —
confirmado por la documentación de Factus y por la práctica de otros proveedores del mercado
colombiano. Esto significa que el adaptador `co-factus` (fase 2) **no puede reutilizar** la misma
librería de firma que `pe-sunat` sin extenderla, o necesita una librería distinta orientada a
XAdES.

## Decisión

- `packages/signing` para el adaptador `pe-sunat` implementa **XMLDSig estándar** (no XAdES).
  Librería de referencia investigada y documentada como skill: `xml-crypto` (org `node-saml`,
  paquete npm `xml-crypto`) — ver `.claude/skills/deps-xml-crypto.md`.
- El adaptador `co-factus` (fase 2) requiere su propia investigación de librería XAdES-EPES
  (candidatas a evaluar en su momento con el mismo proceso del §16 del SDD: `xmldsigjs`/`xadesjs`
  u otras vigentes al momento de implementar fase 2 — no fijar ahora una elección que podría
  quedar desactualizada para cuando se implemente).
- Se corrige la terminología en el SDD (v0.2, §3 y §8-9) para no volver a conflacionar ambos
  términos.

## Fuentes verificadas (2026-07-31)

- Guías de Elaboración de Documentos XML UBL 2.1 (Factura, Boleta, Nota de Crédito, Nota de
  Débito) — cpe.sunat.gob.pe/sites/default/files/inline-files/ (PDFs oficiales SUNAT).
- [XML UBL 2.1 SUNAT — Firma Digital, Llama.pe](https://llama.pe/xml-ubl-2.1-sunat)
- [Firma Digital — FE Primer, Greenter](https://fe-primer.greenter.dev/docs/sign/)
- Documentación de Factus (referenciada en la investigación previa del SDD v0.1) sobre firma de
  documentos DIAN.
- npm registry: `xml-crypto` (org `node-saml`), `xmldsigjs`, consultados 2026-07-31 — ver detalle
  de legitimidad de publicador en `.claude/skills/deps-xml-crypto/01-installation-and-provenance.md`.

## Consecuencias

- `packages/signing` no debe importar ni depender de ninguna librería con "xades" en el nombre
  para el flujo `pe-sunat` — sería una dependencia innecesaria y una superficie de ataque/fallo
  extra sin beneficio.
- Cuando se implemente `co-factus` en fase 2, este ADR es la referencia de que se necesita una
  librería/skill nueva, no una extensión trivial de `xml-crypto`.
- El glosario del SDD (§3) queda como la fuente de verdad de la diferencia XMLDSig/XAdES para
  evitar que el error se repita en documentación futura.
