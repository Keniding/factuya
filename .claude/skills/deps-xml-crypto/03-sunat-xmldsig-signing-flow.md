# 03 — Configuración para el flujo de firma SUNAT

Basado en la Guía de Elaboración de Documentos XML UBL 2.1 de SUNAT (ver ADR-0002) y en el README
oficial de `xml-crypto` (sección "Signing Xml documents" y "Customizing Algorithms").

## Parámetros exigidos por SUNAT, mapeados a la API real de `xml-crypto`

| Requisito SUNAT | Constante/propiedad en `xml-crypto` |
|---|---|
| Canonicalización exclusive c14n | `canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#"` |
| Digest SHA-256 | `digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256"` en `addReference` |
| Firma RSA-SHA256 | `signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"` |
| Firma enveloped (dentro del propio UBL) | transform `"http://www.w3.org/2000/09/xmldsig#enveloped-signature"` en `addReference` |
| Firma dentro de `ext:UBLExtensions`/`cac:Signature` | se controla con las opciones `location`/`prefix`/`attrs` de `computeSignature`, apuntando el `xpath` de `addReference` al nodo raíz del `Invoice`/`CreditNote`/etc. — **verificar el xpath exacto contra la Guía XML UBL 2.1 del tipo de comprobante correspondiente al implementar, no asumirlo genérico para los 4 tipos de documento** |

## Esqueleto de uso (adaptado del ejemplo oficial del README, con los algoritmos de SUNAT)

```typescript
import { SignedXml } from "xml-crypto";

function buildSunatSignedXml(unsignedUblXml: string, tenantCert: { publicPem: string }) {
  const sig = new SignedXml({
    publicCert: tenantCert.publicPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    // privateKey se omite intencionalmente aquí — ver 04-kms-integration.md
  });

  sig.addReference({
    xpath: "/*", // placeholder — reemplazar por el xpath real del nodo raíz UBL al implementar
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });

  // computeSignature real usa el overload async — ver 04-kms-integration.md
}
```

Este esqueleto es deliberadamente incompleto en el xpath y en la llamada final a
`computeSignature` — completarlo requiere primero fijar el mapeo exacto `InvoiceRequest` → UBL
(pendiente, ver "próximo paso" en `docs/sdd/factuya-sdd.md`) y decidir el punto exacto de inserción
de `cac:Signature` según la Guía XML UBL 2.1 vigente del tipo de comprobante. No se hardcodea aquí
un xpath "genérico" para no dar una falsa sensación de que ya está verificado contra la guía
oficial.
