# 02 — Superficie de API real (leída de `lib/*.d.ts`, no de documentación de terceros)

## Export principal

```typescript
export { C14nCanonicalization, C14nCanonicalizationWithComments } from "./c14n-canonicalization";
export { ExclusiveCanonicalization, ExclusiveCanonicalizationWithComments } from "./exclusive-canonicalization";
export { SignedXml } from "./signed-xml";
export * from "./types";
export * from "./utils";
```

Todo el trabajo de Factuya pasa por la clase `SignedXml`.

## Constructor y opciones (`SignedXmlOptions`, de `types.d.ts`)

```typescript
interface SignedXmlOptions {
  idMode?: "wssecurity";
  idAttribute?: string;
  privateKey?: crypto.KeyLike;      // ver 04-kms-integration.md: esto NO puede quedar vacío aunque no se use una clave local
  publicCert?: crypto.KeyLike;
  signatureAlgorithm?: SignatureAlgorithmType;
  canonicalizationAlgorithm?: CanonicalizationAlgorithmType;
  inclusiveNamespacesPrefixList?: string | string[];
  implicitTransforms?: ReadonlyArray<CanonicalizationOrTransformAlgorithmType>;
  keyInfoAttributes?: Record<string, string>;
  getKeyInfoContent?(args?: GetKeyInfoContentArgs): string | null;
  getCertFromKeyInfo?(keyInfo?: Node | null): string | null;
}
```

## Constantes de algoritmo soportadas (URIs exactas — usar estas literales, no inventarlas)

De `types.d.ts`:

```typescript
type CanonicalizationAlgorithmType =
  | "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
  | "http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments"
  | "http://www.w3.org/2001/10/xml-exc-c14n#"                    // exclusive c14n — la que exige SUNAT
  | "http://www.w3.org/2001/10/xml-exc-c14n#WithComments";

type HashAlgorithmType =
  | "http://www.w3.org/2000/09/xmldsig#sha1"
  | "http://www.w3.org/2001/04/xmlenc#sha256"                    // SHA-256 — la que exige SUNAT
  | "http://www.w3.org/2001/04/xmlenc#sha512";

type SignatureAlgorithmType =
  | "http://www.w3.org/2000/09/xmldsig#rsa-sha1"
  | "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"          // RSA-SHA256 — la que exige SUNAT
  | "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512"
  | "http://www.w3.org/2000/09/xmldsig#hmac-sha1";
```

## Métodos clave de `SignedXml` (de `signed-xml.d.ts`)

- `addReference({ xpath, transforms, digestAlgorithm, uri, ... })` — declara qué nodo del XML se
  firma y con qué digest.
- `computeSignature(xml: string): void` — variante **síncrona**.
- `computeSignature(xml: string, callback: ErrorFirstCallback<SignedXml>): void` — variante
  **asíncrona**, necesaria para delegar la firma a KMS (ver `04-kms-integration.md`).
- `computeSignature(xml: string, options: ComputeSignatureOptions, callback): void` — asíncrona +
  opciones (`prefix`, `location`, etc.).
- `getSignedXml(): string` — el XML final firmado, solo válido después de `computeSignature`.
- `checkSignature(xml: string): boolean` / con callback — verificación de firma (relevante si
  Factuya alguna vez necesita validar una firma entrante, ver advertencia de seguridad en
  `05-known-issues-and-alternatives.md`).

## Extensibilidad (la pieza que hace posible integrar KMS)

`SignedXml` expone diccionarios públicos de algoritmos registrables en tiempo de ejecución:

```typescript
CanonicalizationAlgorithms: Record<CanonicalizationOrTransformAlgorithmType, new () => CanonicalizationOrTransformationAlgorithm>;
HashAlgorithms: Record<HashAlgorithmType, new () => HashAlgorithm>;
SignatureAlgorithms: Record<SignatureAlgorithmType, new () => SignatureAlgorithm>;
```

La interfaz que hay que implementar para un algoritmo de firma custom (`SignatureAlgorithm`, de
`types.d.ts`):

```typescript
interface SignatureAlgorithm {
  getSignature(signedInfo: crypto.BinaryLike, privateKey: crypto.KeyLike): string;
  getSignature(signedInfo: crypto.BinaryLike, privateKey: crypto.KeyLike, callback?: ErrorFirstCallback<string>): void;
  verifySignature(material: string, key: crypto.KeyLike, signatureValue: string): boolean;
  verifySignature(material: string, key: crypto.KeyLike, signatureValue: string, callback?: ErrorFirstCallback<boolean>): void;
  getAlgorithmName(): SignatureAlgorithmType;
}
```

Esto es exactamente el punto de extensión que Factuya necesita para reemplazar "firmar con una
clave local" por "firmar llamando a AWS KMS" — desarrollado en detalle en el siguiente archivo.
