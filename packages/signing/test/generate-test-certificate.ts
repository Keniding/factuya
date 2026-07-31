import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface TestCertificate {
  privateKeyPem: string;
  publicCertPem: string;
}

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
  try {
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
        "-subj",
        "/CN=Factuya Test/O=Factuya/C=PE",
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
