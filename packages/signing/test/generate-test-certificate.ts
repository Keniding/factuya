import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface TestCertificate {
  privateKeyPem: string;
  publicCertPem: string;
}

/**
 * Config mínima y autocontenida, en vez de depender del openssl.cnf del sistema. Hallazgo
 * empírico: el openssl.cnf por defecto de algunas instalaciones (ej. Git for Windows/MinGW,
 * OpenSSL 3.5.7) define `[v3_ca]` con `authorityKeyIdentifier=keyid:always,issuer`, y esa
 * variante de build rechaza la opción `always` en tiempo de parseo de config
 * ("unknown option ... v2i_AUTHORITY_KEYID"), aunque el mismo comando funcione sin problema en
 * otras instalaciones de OpenSSL. Un certificado autofirmado de un solo uso para tests no
 * necesita authorityKeyIdentifier — basta basicConstraints + subjectKeyIdentifier — así que se
 * evita el problema por completo en vez de intentar adivinar la sintaxis correcta por entorno.
 */
const TEST_CERT_OPENSSL_CONFIG = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_test
prompt = no

[req_distinguished_name]
CN = Factuya Test
O = Factuya
C = PE

[v3_test]
basicConstraints = critical,CA:true
subjectKeyIdentifier = hash
`;

/**
 * Genera un certificado autofirmado desechable con openssl, solo para tests. SUNAT beta no
 * exige certificado registrado (ver docs/adapters/pe-sunat.md), por eso esto es válido para
 * pruebas de integración contra beta, pero nunca debe usarse en producción.
 * No se commitea nada al repo — se genera y se descarta en cada corrida de test.
 */
export function generateTestCertificate(): TestCertificate {
  const dir = mkdtempSync(join(tmpdir(), "factuya-test-cert-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const configPath = join(dir, "openssl.cnf");
  try {
    writeFileSync(configPath, TEST_CERT_OPENSSL_CONFIG);
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-nodes",
        "-config",
        configPath,
      ],
      { stdio: "pipe" },
    );
    if (result.status !== 0) {
      throw new Error(`openssl falló generando el certificado de prueba: ${result.stderr?.toString()}`);
    }
    return {
      privateKeyPem: readFileSync(keyPath, "utf8"),
      publicCertPem: readFileSync(certPath, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
