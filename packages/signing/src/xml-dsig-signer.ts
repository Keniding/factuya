import { SignedXml } from "xml-crypto";
import type { ErrorFirstCallback, SignatureAlgorithm } from "xml-crypto";
import type { Signer } from "./signer";

/**
 * Firma XMLDSig del comprobante SUNAT, delegando la operación criptográfica a un `Signer`
 * inyectado (local en dev/test, KMS en producción). NO es XAdES — ver docs/adr/0002.
 *
 * Basado en el hallazgo real documentado en
 * .claude/skills/deps-xml-crypto/04-kms-integration.md (leído del código fuente instalado de
 * xml-crypto, no asumido):
 *   1. `computeSignature` exige `this.privateKey != null` aunque el SignatureAlgorithm custom no
 *      la use — se pasa un placeholder explícito e identificable, nunca una clave real.
 *   2. Un Signer async (KMS) solo puede integrarse vía el overload de `computeSignature` con
 *      callback — el camino síncrono no soporta un `getSignature` que devuelva una Promise.
 *   3. `SignatureAlgorithms` exige un constructor sin argumentos (`new algo()`, verificado en
 *      `signed-xml.js:findSignatureAlgorithm`) — se resuelve con una clase anónima generada por
 *      clausura que captura el `Signer` inyectado, sin necesidad de estado global.
 */

const RSA_SHA256_URI = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256_URI = "http://www.w3.org/2001/04/xmlenc#sha256";
const EXCLUSIVE_C14N_URI = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED_SIGNATURE_URI = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/** Placeholder no nulo requerido por xml-crypto — nunca se usa como clave real (ver arriba). */
const PRIVATE_KEY_PLACEHOLDER = Buffer.from("factuya-signing-delegated-to-injected-signer");

function makeDelegatedSignatureAlgorithm(signer: Signer): new () => SignatureAlgorithm {
  return class DelegatedSignatureAlgorithm implements SignatureAlgorithm {
    getAlgorithmName(): typeof RSA_SHA256_URI {
      return RSA_SHA256_URI;
    }

    // La interfaz SignatureAlgorithm sobrecarga getSignature (síncrona vs con callback) — hay
    // que declarar las mismas sobrecargas exactas para que tsc6 la acepte como implementación.
    getSignature(signedInfo: string, privateKey: unknown): string;
    getSignature(signedInfo: string, privateKey: unknown, callback: ErrorFirstCallback<string>): void;
    getSignature(
      signedInfo: string,
      _ignoredPrivateKey: unknown,
      callback?: ErrorFirstCallback<string>,
    ): string | void {
      if (!callback) {
        throw new Error(
          "DelegatedSignatureAlgorithm solo soporta el flujo asíncrono de computeSignature(xml, options, callback) — ver .claude/skills/deps-xml-crypto/04-kms-integration.md",
        );
      }
      signer.sign(new TextEncoder().encode(signedInfo)).then(
        (sigBytes) => callback(null, Buffer.from(sigBytes).toString("base64")),
        (err: unknown) => callback(err instanceof Error ? err : new Error(String(err))),
      );
      return undefined;
    }

    verifySignature(): boolean {
      throw new Error("No usado en el flujo de emisión de Factuya (solo firma, no verificación)");
    }
  };
}

export interface SignUblXmlOptions {
  /** xpath (con local-name(), sin depender de resolución de prefijos) del nodo donde insertar el ds:Signature. */
  insertionXPath: string;
  signatureId?: string;
}

/**
 * Firma un XML UBL 2.1 ya construido (con el placeholder ext:UBLExtensions/ext:ExtensionContent
 * vacío) e inserta el ds:Signature dentro de ese nodo, según lo que exige SUNAT (ver
 * docs/sdd/factuya-sdd.md §8-9 y docs/adr/0002).
 */
export function signUblXml(
  unsignedXml: string,
  signer: Signer,
  options: SignUblXmlOptions,
): Promise<string> {
  const sig = new SignedXml({
    publicCert: signer.getPublicCertificatePem(),
    privateKey: PRIVATE_KEY_PLACEHOLDER,
    signatureAlgorithm: RSA_SHA256_URI,
    canonicalizationAlgorithm: EXCLUSIVE_C14N_URI,
  });

  sig.SignatureAlgorithms[RSA_SHA256_URI] = makeDelegatedSignatureAlgorithm(signer);

  // isEmptyUri: true -> <Reference URI=""> (referencia "todo el documento" del propio estándar
  // XML-DSig). Sin esto, xml-crypto usa ensureHasId() y agrega él mismo un atributo `Id="_0"` al
  // elemento raíz seleccionado por xpath para poder apuntarle con `URI="#_0"` — hallazgo real
  // encontrado tras un rechazo de SUNAT beta ("element Invoice ... had undefined attribute Id"):
  // el XSD de UBL InvoiceType no declara un atributo `Id` en el elemento raíz, así que ese
  // atributo inyectado rompe la validación estricta del XML incluso siendo una firma válida.
  sig.addReference({
    xpath: "/*",
    digestAlgorithm: SHA256_URI,
    transforms: [ENVELOPED_SIGNATURE_URI, EXCLUSIVE_C14N_URI],
    isEmptyUri: true,
  });

  return new Promise((resolve, reject) => {
    sig.computeSignature(
      unsignedXml,
      {
        location: { reference: options.insertionXPath, action: "append" },
        attrs: { Id: options.signatureId ?? "FactuyaSign" },
      },
      (err, signedXmlInstance) => {
        if (err || !signedXmlInstance) {
          reject(err ?? new Error("computeSignature no devolvió resultado"));
          return;
        }
        resolve(signedXmlInstance.getSignedXml());
      },
    );
  });
}
