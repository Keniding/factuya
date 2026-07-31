import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface TestCertificate {
  privateKeyPem: string;
  publicCertPem: string;
}

/**
 * Genera un certificado autofirmado desechable con openssl, solo para tests — SUNAT beta no
 * exige certificado registrado (ver docs/adapters/pe-sunat.md). Copia local a esta suite de
 * paquete (duplicada intencionalmente desde packages/signing/test/generate-test-certificate.ts
 * para no acoplar tests de un paquete a rutas internas de otro; si se necesita en un tercer
 * paquete, promover a un paquete `@factuya/test-utils` en vez de seguir copiando).
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
