import { PeSunatAdapter } from "@factuya/adapter-pe-sunat";
import { LocalPemKeySigner } from "@factuya/signing";
import type { TenantConfig } from "@factuya/shared-types";
import { generateDevCertificate } from "./dev-certificate";

/**
 * Configuración de un único tenant de desarrollo, resuelta desde variables de entorno con
 * defaults que apuntan al ambiente beta real de SUNAT (credenciales públicas de prueba
 * documentadas en docs/adapters/pe-sunat.md, no un secreto).
 *
 * LIMITACIÓN DELIBERADA (ver docs/flows.md, "qué falta"): esto NO es el enrutamiento multi-tenant
 * real que describe docs/sdd/factuya-sdd.md §5/§9 — no hay resolución de tenant por API key, no
 * hay certificados por tenant en KMS/Secrets Manager, y el certificado se genera efímero en cada
 * arranque del proceso. Es la configuración mínima real para que `apps/api` pueda emitir un
 * comprobante de verdad contra SUNAT en desarrollo local, no una simulación de la arquitectura
 * multi-tenant de producción.
 */

const SUNAT_ENDPOINT_URL =
  process.env.SUNAT_ENDPOINT_URL ?? "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService";
const SUNAT_RUC = process.env.SUNAT_RUC ?? "20000000001";
const SUNAT_SOL_USER = process.env.SUNAT_SOL_USER ?? "MODDATOS";
const SUNAT_SOL_PASSWORD = process.env.SUNAT_SOL_PASSWORD ?? "moddatos";
const ISSUER_LEGAL_NAME = process.env.SUNAT_ISSUER_NAME ?? "EMPRESA DEMO SAC";

const devCertificate = generateDevCertificate();
const devSigner = new LocalPemKeySigner(devCertificate.privateKeyPem, devCertificate.publicCertPem);

export const devTenant: TenantConfig = {
  tenantId: "dev-tenant",
  country: "PE",
  submissionChannel: "SUNAT_DIRECT",
  issuer: { taxId: SUNAT_RUC, legalName: ISSUER_LEGAL_NAME },
  certificate: { publicCertificatePem: devCertificate.publicCertPem, signerRef: "local-dev-ephemeral" },
};

export const peSunatAdapter = new PeSunatAdapter({
  endpointUrl: SUNAT_ENDPOINT_URL,
  signer: devSigner,
  credentials: { ruc: SUNAT_RUC, solUser: SUNAT_SOL_USER, solPassword: SUNAT_SOL_PASSWORD },
});
