# 04 — Integración con AWS KMS (hallazgo central de esta investigación)

El SDD (§9) exige que la clave privada de cada tenant nunca salga de KMS/CloudHSM y que `Sign()`
sea una llamada a KMS, no una operación con la clave en memoria de la Lambda. Esto se logra
implementando la interfaz `SignatureAlgorithm` de `xml-crypto` (ver `02-api-surface.md`) — pero
leyendo el código fuente real (no solo el README) aparecen dos detalles no obvios que hay que
resolver a propósito, no por accidente.

## Hallazgo 1: `computeSignature` exige `privateKey != null` aunque no se use

De `lib/signed-xml.js` (código real instalado, no un supuesto):

```js
calculateSignatureValue(doc, callback) {
    const signedInfoCanon = this.getCanonSignedInfoXml(doc);
    const signer = this.findSignatureAlgorithm(this.signatureAlgorithm);
    if (this.privateKey == null) {
        throw new Error("Private key is required to compute signature");
    }
    if (typeof callback === "function") {
        signer.getSignature(signedInfoCanon, this.privateKey, callback);
    } else {
        this.signatureValue = signer.getSignature(signedInfoCanon, this.privateKey);
    }
}
```

Este chequeo `this.privateKey == null` se ejecuta **antes** de llamar al `SignatureAlgorithm`
custom, sin excepción — incluso si el `SignatureAlgorithm` registrado nunca va a usar
`this.privateKey` porque firma vía KMS. Si se instancia `SignedXml` sin `privateKey`, revienta con
`"Private key is required to compute signature"` sin importar que el algoritmo custom esté bien
implementado.

**Consecuencia práctica para `packages/signing`**: hay que pasar un valor no nulo en `privateKey`
aunque no se use como clave real — por ejemplo, un `Buffer` o string placeholder identificable
(`Buffer.from("kms-managed")`), documentado con un comentario explícito en el código para que
nadie lo confunda con una clave real ni intente usarlo como tal. El `SignatureAlgorithm` custom
recibe ese valor como segundo parámetro de `getSignature()` y debe **ignorarlo explícitamente**.

## Hallazgo 2: el camino síncrono no sirve — hay que usar el overload con callback

`SignatureAlgorithm.getSignature` tiene dos formas (de `types.d.ts`):

```typescript
getSignature(signedInfo: crypto.BinaryLike, privateKey: crypto.KeyLike): string;                                   // síncrona
getSignature(signedInfo: crypto.BinaryLike, privateKey: crypto.KeyLike, callback?: ErrorFirstCallback<string>): void; // asíncrona
```

Una llamada a AWS KMS (`Sign` API) es intrínsecamente asíncrona (red). El camino síncrono de
`computeSignature(xml)` **no puede** esperar una Promise dentro de `getSignature()` — asumiría
(incorrectamente) que el valor de retorno ya es el string de firma. Hay que usar, de punta a
punta, el overload asíncrono:

```typescript
sig.computeSignature(xml, options, (err, signedXmlInstance) => { ... });
```

que internamente invoca `signer.getSignature(signedInfoCanon, this.privateKey, callback)` — y ahí
sí el `SignatureAlgorithm` custom puede hacer `await kmsClient.send(new SignCommand(...))` dentro
de una función async y llamar `callback(null, base64Signature)` cuando KMS responde.

## Esqueleto de `SignatureAlgorithm` respaldado por KMS

```typescript
import type { SignatureAlgorithm, ErrorFirstCallback } from "xml-crypto";
import { KMSClient, SignCommand } from "@aws-sdk/client-kms"; // pendiente de su propia skill deps-aws-sdk-client-kms

class KmsRsaSha256SignatureAlgorithm implements SignatureAlgorithm {
  constructor(private readonly kms: KMSClient, private readonly kmsKeyId: string) {}

  getAlgorithmName(): "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" {
    return "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  }

  // La sobrecarga síncrona no se soporta intencionalmente — KMS es de red.
  getSignature(signedInfo: string, _ignoredPrivateKey: unknown, callback?: ErrorFirstCallback<string>): string | void {
    if (!callback) {
      throw new Error("KmsRsaSha256SignatureAlgorithm solo soporta el flujo asíncrono de computeSignature(xml, options, callback)");
    }
    this.signViaKms(signedInfo).then(
      (sigBase64) => callback(null, sigBase64),
      (err) => callback(err instanceof Error ? err : new Error(String(err))),
    );
  }

  private async signViaKms(signedInfo: string): Promise<string> {
    // Verificar el nombre exacto del SigningAlgorithm contra la documentación vigente de la API
    // de KMS al implementar (ver docs/sdd/factuya-sdd.md §9 — no asumirlo de memoria).
    const result = await this.kms.send(
      new SignCommand({
        KeyId: this.kmsKeyId,
        Message: Buffer.from(signedInfo, "utf8"),
        MessageType: "RAW",
        SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
      }),
    );
    if (!result.Signature) throw new Error("KMS no devolvió una firma");
    return Buffer.from(result.Signature).toString("base64");
  }

  verifySignature(): boolean {
    throw new Error("No usado en el flujo de emisión de Factuya — la verificación de CDR no pasa por esta clase");
  }
}
```

**Pendiente explícito**: el nombre exacto del algoritmo de KMS (`RSASSA_PKCS1_V1_5_SHA_256`) y la
disponibilidad de `MessageType: "RAW"` deben confirmarse contra la documentación vigente del SDK
`@aws-sdk/client-kms` en el momento de implementar `packages/signing` — esta skill documenta
`xml-crypto`, no el SDK de AWS; ese SDK necesita su propia investigación con este mismo agente
(`dependency-skill-agent`) antes de escribir el código real, y su propia skill
`deps-aws-sdk-client-kms`.

## Registro del algoritmo custom

```typescript
sig.SignatureAlgorithms["http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"] =
  KmsRsaSha256SignatureAlgorithm as unknown as new () => SignatureAlgorithm;
```

Nota: el tipo de `SignatureAlgorithms` espera un constructor `new () => SignatureAlgorithm` sin
argumentos (ver `02-api-surface.md`), pero `KmsRsaSha256SignatureAlgorithm` necesita el cliente KMS
y el `kmsKeyId` del tenant en su constructor. Esto es una tensión real entre el diseño de
extensibilidad de `xml-crypto` (pensado para algoritmos stateless) y la necesidad de Factuya de
un algoritmo con estado por tenant — **resolver explícitamente al implementar** (opciones: una
fábrica que registre una instancia distinta de `SignedXml` por request/tenant en vez de reusar una
global, o un wrapper con closure). No se resuelve aquí para no fijar prematuramente un patrón sin
haberlo probado contra el resto de `packages/signing`.
