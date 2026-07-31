import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface DevCertificate {
  privateKeyPem: string;
  publicCertPem: string;
}

/**
 * Config mínima y autocontenida para openssl, sin depender del openssl.cnf del sistema — ver
 * packages/signing/test/generate-test-certificate.ts para el hallazgo original (algunos builds de
 * OpenSSL, ej. Git for Windows/MinGW 3.5.7, rechazan `authorityKeyIdentifier=keyid:always` de su
 * propio config por defecto). Esta es una copia deliberada para uso en runtime (no en tests): un
 * certificado autofirmado de un solo uso no necesita authorityKeyIdentifier.
 */
const DEV_CERT_OPENSSL_CONFIG = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_dev
prompt = no

[req_distinguished_name]
CN = Factuya Dev Server
O = Factuya
C = PE

[v3_dev]
basicConstraints = critical,CA:true
subjectKeyIdentifier = hash
`;

/**
 * Genera un certificado autofirmado efímero al arrancar `apps/api`, únicamente para desarrollo
 * local contra el ambiente beta de SUNAT (que no exige certificado registrado — ver
 * docs/adapters/pe-sunat.md). NUNCA usar en producción: en producción cada tenant tiene su propio
 * certificado real, custodiado en KMS/CloudHSM (ver docs/sdd/factuya-sdd.md §9,
 * packages/signing/src/kms-signer.ts).
 */
export function generateDevCertificate(): DevCertificate {
  const dir = mkdtempSync(join(tmpdir(), "factuya-api-dev-cert-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const configPath = join(dir, "openssl.cnf");
  try {
    writeFileSync(configPath, DEV_CERT_OPENSSL_CONFIG);
    const result = spawnSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-days", "1", "-nodes", "-config", configPath],
      { stdio: "pipe" },
    );
    if (result.status !== 0) {
      throw new Error(`openssl falló generando el certificado efímero de desarrollo: ${result.stderr?.toString()}`);
    }
    return {
      privateKeyPem: readFileSync(keyPath, "utf8"),
      publicCertPem: readFileSync(certPath, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
