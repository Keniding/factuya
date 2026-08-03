import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { BadRequestError } from "./validate-invoice-request";

/** Ver ADR-0006 — el tenant trae su propio certificado/clave, PEM por separado (no .pfx). */
export interface TenantCertificateRequest {
  ruc: string;
  legalName: string;
  certificatePem: string;
  privateKeyPem: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseTenantCertificateRequest(body: unknown): TenantCertificateRequest {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestError("El cuerpo de la solicitud debe ser un objeto");
  }
  const v = body as Record<string, unknown>;

  if (!isNonEmptyString(v.ruc)) {
    throw new BadRequestError("ruc es requerido", ["ruc debe ser el RUC del tenant"]);
  }
  if (!isNonEmptyString(v.legalName)) {
    throw new BadRequestError("legalName es requerido", ["legalName es la razón social del tenant"]);
  }
  if (!isNonEmptyString(v.certificatePem)) {
    throw new BadRequestError("certificatePem es requerido", ["certificatePem debe ser un certificado X.509 en PEM"]);
  }
  if (!isNonEmptyString(v.privateKeyPem)) {
    throw new BadRequestError("privateKeyPem es requerido", [
      "privateKeyPem debe ser la clave privada RSA correspondiente, en PEM (PKCS#8 o PKCS#1)",
    ]);
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(v.certificatePem);
  } catch (err) {
    throw new BadRequestError("certificatePem inválido", [
      `No se pudo parsear como certificado X.509: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }

  let privateKeyPublicDer: Buffer;
  try {
    const privateKey = createPrivateKey(v.privateKeyPem);
    if (privateKey.asymmetricKeyType !== "rsa") {
      throw new Error(`tipo de clave "${privateKey.asymmetricKeyType}", se esperaba "rsa"`);
    }
    privateKeyPublicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  } catch (err) {
    throw new BadRequestError("privateKeyPem inválido", [
      `No se pudo parsear como clave privada RSA: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }

  // Confirmar que el certificado y la clave privada son del mismo par — un error común al subir
  // ambos archivos por separado. Comparar las llaves públicas en DER es más confiable que
  // comparar los PEM como texto (distintos saltos de línea/encabezados no importan aquí).
  const certificatePublicDer = certificate.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  if (Buffer.compare(certificatePublicDer, privateKeyPublicDer) !== 0) {
    throw new BadRequestError("certificatePem y privateKeyPem no corresponden al mismo par de llaves", [
      "La llave pública del certificado no coincide con la llave pública derivada de privateKeyPem",
    ]);
  }

  return {
    ruc: v.ruc,
    legalName: v.legalName,
    certificatePem: v.certificatePem,
    privateKeyPem: v.privateKeyPem,
  };
}
