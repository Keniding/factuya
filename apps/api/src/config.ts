import { KMSClient } from "@aws-sdk/client-kms";
import { PeSunatAdapter } from "@factuya/adapter-pe-sunat";
import { LocalPemKeySigner } from "@factuya/signing";
import type { TenantConfig } from "@factuya/shared-types";
import { generateDevCertificate } from "./dev-certificate";
import { generateApiKey, hashApiKey } from "./api-key";
import { LocalTenantRegistry } from "./tenant-registry";

/**
 * Ver ADR-0004: multi-tenant real vía LocalTenantRegistry (dev) — reemplaza el `devTenant` fijo
 * que existía antes. El mecanismo de autenticación/resolución ya es el real (Bearer API key,
 * hash SHA-256, TenantRegistry inyectable); lo que sigue siendo de desarrollo es la
 * implementación en memoria y que todos los tenants sembrados comparten el mismo certificado/
 * `Signer` (el flujo real de "cada tenant sube o registra su propio certificado" es
 * `POST /v1/tenants/{id}/certificate`, fuera de alcance de ADR-0004 — ver docs/flows.md).
 */

const SUNAT_ENDPOINT_URL =
  process.env.SUNAT_ENDPOINT_URL ?? "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService";
const SUNAT_RUC = process.env.SUNAT_RUC ?? "20000000001";
const SUNAT_SOL_USER = process.env.SUNAT_SOL_USER ?? "MODDATOS";
const SUNAT_SOL_PASSWORD = process.env.SUNAT_SOL_PASSWORD ?? "moddatos";
const ISSUER_LEGAL_NAME = process.env.SUNAT_ISSUER_NAME ?? "EMPRESA DEMO SAC";

const devCertificate = generateDevCertificate();
const devSigner = new LocalPemKeySigner(devCertificate.privateKeyPem, devCertificate.publicCertPem);

const devTenant: TenantConfig = {
  tenantId: "dev-tenant",
  country: "PE",
  submissionChannel: "SUNAT_DIRECT",
  issuer: { taxId: SUNAT_RUC, legalName: ISSUER_LEGAL_NAME },
  certificate: { publicCertificatePem: devCertificate.publicCertPem, signerRef: "local-dev-ephemeral" },
};

export const tenantRegistry = new LocalTenantRegistry();

const devApiKey = process.env.FACTUYA_DEV_API_KEY ?? generateApiKey();
// LocalTenantRegistry.register no tiene ningún await interno — se resuelve en el mismo tick, por
// eso es seguro no esperar la promesa aquí (arranque síncrono del módulo).
void tenantRegistry.register(devApiKey, devTenant);

export const peSunatAdapter = new PeSunatAdapter({
  endpointUrl: SUNAT_ENDPOINT_URL,
  signer: devSigner,
  credentials: { ruc: SUNAT_RUC, solUser: SUNAT_SOL_USER, solPassword: SUNAT_SOL_PASSWORD },
});

/**
 * Cliente de KMS para `POST /v1/tenants/{id}/certificate` (ADR-0005/ADR-0006) — importa la clave
 * real de cada tenant a su propia CMK. En desarrollo local usa `AWS_PROFILE` (ver
 * docs/aws/kms-live-verification.md); en producción (Lambda) no hace falta — el rol de ejecución
 * ya trae credenciales.
 */
const AWS_REGION = process.env.AWS_REGION ?? "us-east-2";
export const kmsClient = new KMSClient({
  region: AWS_REGION,
  ...(process.env.AWS_PROFILE ? { profile: process.env.AWS_PROFILE } : {}),
});

/**
 * API key de administrador para `POST /v1/tenants/{id}/certificate` — mecanismo temporal (ver
 * ADR-0006): no reemplaza un sistema de roles/permisos real, que debe diseñarse antes de
 * producción.
 */
const adminApiKey = process.env.FACTUYA_ADMIN_API_KEY ?? generateApiKey();
export const adminApiKeyHash = hashApiKey(adminApiKey);

export function logDevTenantInfo(): void {
  console.log(`Tenant de desarrollo: ${devTenant.tenantId} (RUC ${devTenant.issuer.taxId}, canal ${devTenant.submissionChannel})`);
  console.log(`API key de desarrollo: ${devApiKey}`);
  console.log(`Usar con: Authorization: Bearer ${devApiKey}`);
  console.log(`API key de administrador (POST /v1/tenants/:id/certificate): ${adminApiKey}`);
}
