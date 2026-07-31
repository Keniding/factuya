import { describe, expect, it } from "bun:test";
import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { LocalPemKeySigner } from "../src/local-pem-signer";
import { signUblXml } from "../src/xml-dsig-signer";
import { generateTestCertificate } from "./generate-test-certificate";

/**
 * checkSignature() NO descubre el nodo <Signature> por sí solo — hay que ubicarlo con
 * findSignatures() y cargarlo con loadSignature() antes. Verificado leyendo signed-xml.js
 * (checkSignature llama directo a getCanonSignedInfoXml, que depende de this.signatureNode,
 * el cual solo se llena vía loadSignature). No está explícito en el README con este nivel de
 * detalle — se documenta también en .claude/skills/deps-xml-crypto/02-api-surface.md.
 */
function verifySignedXml(signedXml: string): boolean {
  const doc = new DOMParser().parseFromString(signedXml);
  // Hallazgo real (leyendo signed-xml.js): el constructor de SignedXml resetea
  // getCertFromKeyInfo a SignedXml.noop salvo que se pase explícitamente, a diferencia de
  // getKeyInfoContent que sí cae a su propio default. Sin esto, checkSignature() nunca logra
  // extraer el certificado del <KeyInfo> embebido y falla con "KeyInfo or publicCert or
  // privateKey is required to validate signature" aunque el KeyInfo esté presente en el XML.
  const verifier = new SignedXml({ getCertFromKeyInfo: SignedXml.getCertFromKeyInfo });
  const [signatureNode] = verifier.findSignatures(doc);
  if (!signatureNode) return false;
  verifier.loadSignature(signatureNode);
  return verifier.checkSignature(signedXml);
}

const TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:factuya:test:Invoice" xmlns:ext="urn:factuya:test:ext">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <ID>F001-1</ID>
</Invoice>`;

describe("signUblXml (con LocalPemKeySigner real, sin mocks de criptografía)", () => {
  it("produce una firma XMLDSig que xml-crypto puede verificar de vuelta", async () => {
    const cert = generateTestCertificate();
    const signer = new LocalPemKeySigner(cert.privateKeyPem, cert.publicCertPem);

    const signedXml = await signUblXml(TEST_XML, signer, {
      insertionXPath: "//*[local-name(.)='ExtensionContent']",
    });

    expect(signedXml).toContain("<Signature");
    expect(signedXml).toContain("SignatureValue");

    expect(verifySignedXml(signedXml)).toBe(true);
  });

  it("rechaza una firma si el XML fue alterado después de firmarlo", async () => {
    const cert = generateTestCertificate();
    const signer = new LocalPemKeySigner(cert.privateKeyPem, cert.publicCertPem);

    const signedXml = await signUblXml(TEST_XML, signer, {
      insertionXPath: "//*[local-name(.)='ExtensionContent']",
    });

    const tampered = signedXml.replace("F001-1", "F001-9999");

    expect(verifySignedXml(tampered)).toBe(false);
  });
});
