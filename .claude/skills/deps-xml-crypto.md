---
name: deps-xml-crypto
description: "Referencia investigada de la librería xml-crypto (XMLDSig para Node.js/Bun), la dependencia elegida para firmar los comprobantes UBL 2.1 del adaptador pe-sunat de Factuya. Úsala SIEMPRE que se escriba o revise código en packages/signing o packages/adapters/pe-sunat que arme, firme o verifique la firma XMLDSig de un comprobante SUNAT — incluye el uso real de la clase SignedXml, cómo delegar la operación de firma a AWS KMS en vez de una clave privada local, y las CVEs conocidas del paquete. NO uses esta skill para firma XAdES-EPES (Colombia/DIAN) — ver ADR-0002, esa es una librería distinta todavía sin investigar."
---

# xml-crypto — skill de dependencia (Factuya · packages/signing, adapters/pe-sunat)

Esta skill se generó siguiendo el proceso de `.claude/agents/dependency-skill-agent.md`: el
paquete se instaló de verdad con Bun en un entorno aislado, se leyeron sus tipos (`.d.ts`) y su
código fuente en `node_modules/xml-crypto`, y se contrastó contra su README oficial y su historial
de CVEs — nada de lo que sigue viene de memoria del modelo.

**Por qué esta librería y no una de XAdES**: SUNAT exige XMLDSig estándar (enveloped,
`exclusive-c14n`, RSA-SHA256), no XAdES — ver `docs/adr/0002-sunat-signature-standard-xmldsig-vs-xades.md`.
`xml-crypto` implementa exactamente XMLDSig, nada más, que es lo correcto para este caso.

## Índice de contenido detallado

1. [`01-installation-and-provenance.md`](deps-xml-crypto/01-installation-and-provenance.md) — cómo instalar con Bun, verificación de publicador/legitimidad, versión pinneada.
2. [`02-api-surface.md`](deps-xml-crypto/02-api-surface.md) — la clase `SignedXml`, sus opciones, y los algoritmos soportados (constantes URI exactas leídas de los tipos).
3. [`03-sunat-xmldsig-signing-flow.md`](deps-xml-crypto/03-sunat-xmldsig-signing-flow.md) — cómo configurar `SignedXml` para producir exactamente la firma que exige la Guía XML UBL 2.1 de SUNAT.
4. [`04-kms-integration.md`](deps-xml-crypto/04-kms-integration.md) — **el hallazgo más importante**: cómo delegar `getSignature()` a AWS KMS de forma asíncrona sin que la clave privada pase nunca por la Lambda, y una gotcha real del código fuente que hay que resolver para lograrlo.
5. [`05-known-issues-and-alternatives.md`](deps-xml-crypto/05-known-issues-and-alternatives.md) — CVEs conocidas (parcheadas en la versión pinneada), deprecaciones activas, y alternativas descartadas y por qué.

## Resumen ejecutivo (para quien solo necesita lo esencial)

- Paquete: `xml-crypto`, versión pinneada **6.1.2**, publicador **`node-saml`** (org de GitHub
  legítima y activa — no confundir con forks scoped como `@subu1979/xml-crypto`).
- Uso en Factuya: `packages/signing` expone una función que arma una instancia de `SignedXml`,
  registra un `SignatureAlgorithm` custom cuyo `getSignature()` llama a AWS KMS de forma asíncrona
  (vía el overload con `callback` de `computeSignature`), y devuelve el XML firmado.
- Riesgo conocido y ya cubierto: CVE-2025-29775/CVE-2025-29774 (bypass de verificación de firma)
  afectan versiones `< 6.0.1` — la versión pinneada (6.1.2) ya está parchada. Igual se documenta
  para que quede explícito por qué el pin es 6.1.2 y no una versión menor asumida "porque sí".
