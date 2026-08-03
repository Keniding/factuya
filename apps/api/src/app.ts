import type { TenantConfig } from "@factuya/shared-types";
import type { CountryAdapter } from "@factuya/core-domain";
import { emitInvoice } from "@factuya/core-domain";
import type { KMSClient } from "@aws-sdk/client-kms";
import { createTenantSigningKey } from "@factuya/signing";
import { randomUUID } from "node:crypto";
import { authenticate, authenticateAdmin, UnauthorizedError } from "./auth";
import { generateApiKey } from "./api-key";
import type { TenantRegistry } from "./tenant-registry";
import { getInvoice, saveInvoice } from "./invoice-store";
import { PE_CATALOGS } from "./catalogs";
import { BadRequestError, parseInvoiceRequest } from "./validate-invoice-request";
import { parseTenantCertificateRequest } from "./validate-tenant-certificate-request";
import { OPENAPI_YAML_PATH, SCALAR_STANDALONE_JS_PATH, renderDocsHtml } from "./scalar-docs";

/**
 * El handler HTTP real de `apps/api`, separado de `index.ts` (que solo arma las dependencias
 * reales — certificado efímero, PeSunatAdapter apuntando a SUNAT beta — y llama a `Bun.serve`).
 * Esta separación existe para poder probar el ruteo/autenticación con dependencias falsas
 * (`apps/api/test/app.test.ts`), sin abrir un puerto real ni depender de la red hacia SUNAT.
 *
 * Multi-tenant real (ADR-0004): /v1/* exige `Authorization: Bearer <api_key>`, resuelto contra
 * `tenantRegistry`. /health, /docs, /openapi.yaml, /vendor/*, y /v1/catalogs son públicas a
 * propósito.
 *
 * Desviación deliberada del contrato aspiracional del SDD: POST /v1/invoices responde 201 con el
 * resultado final en el cuerpo (no 202 + webhook), porque `PeSunatAdapter` en este MVP solo
 * implementa el flujo síncrono de SUNAT (`sendBill`) — no hay nada que sondear de forma asíncrona
 * todavía (ver docs/adapters/pe-sunat.md).
 */

export interface AppDependencies {
  tenantRegistry: TenantRegistry;
  countryAdapter: CountryAdapter;
  kmsClient: KMSClient;
  adminApiKeyHash: string;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function unauthorizedResponse(err: UnauthorizedError): Response {
  return json({ error: err.message }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}

export function createApp(deps: AppDependencies): (req: Request) => Promise<Response> {
  const { tenantRegistry, countryAdapter, kmsClient, adminApiKeyHash } = deps;

  async function handleCreateInvoice(req: Request, tenant: TenantConfig): Promise<Response> {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return json({ error: "El cuerpo de la solicitud debe ser JSON válido" }, { status: 400 });
    }

    let request;
    try {
      request = parseInvoiceRequest(rawBody, tenant.tenantId);
    } catch (err) {
      if (err instanceof BadRequestError) {
        return json({ error: err.message, details: err.details }, { status: 400 });
      }
      throw err;
    }

    const id = randomUUID();
    try {
      const result = await emitInvoice(countryAdapter, request, tenant);
      saveInvoice(id, tenant.tenantId, result);
      return json({ id, ...result }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ id, error: message }, { status: 502 });
    }
  }

  function handleGetInvoice(id: string, tenant: TenantConfig): Response {
    const stored = getInvoice(id, tenant.tenantId);
    if (!stored) {
      return json({ error: `No existe un comprobante con id ${id}` }, { status: 404 });
    }
    return json({ id: stored.id, createdAt: stored.createdAt, ...stored.result });
  }

  /**
   * ADR-0005/ADR-0006: crea una CMK dedicada para este tenant, importa su clave privada real, y
   * lo registra con una API key nueva. Admin-only (ver `authenticateAdmin`) — la API key del
   * tenant recién creado se devuelve **una sola vez**, no se puede volver a consultar.
   */
  async function handleCreateTenantCertificate(req: Request, tenantId: string): Promise<Response> {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return json({ error: "El cuerpo de la solicitud debe ser JSON válido" }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseTenantCertificateRequest(rawBody);
    } catch (err) {
      if (err instanceof BadRequestError) {
        return json({ error: err.message, details: err.details }, { status: 400 });
      }
      throw err;
    }

    let imported: { keyId: string };
    try {
      imported = await createTenantSigningKey(kmsClient, parsed.privateKeyPem, `Factuya tenant ${tenantId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `No se pudo importar la clave a KMS: ${message}` }, { status: 502 });
    }

    const apiKey = generateApiKey();
    const tenant: TenantConfig = {
      tenantId,
      country: "PE",
      submissionChannel: "SUNAT_DIRECT",
      issuer: { taxId: parsed.ruc, legalName: parsed.legalName },
      certificate: { publicCertificatePem: parsed.certificatePem, signerRef: imported.keyId },
    };
    await tenantRegistry.register(apiKey, tenant);

    return json({ tenantId, apiKey, kmsKeyId: imported.keyId }, { status: 201 });
  }

  function handleGetCatalog(country: string, catalog: string): Response {
    if (country !== "PE") {
      return json({ error: `País no soportado en este MVP: ${country}` }, { status: 404 });
    }
    const entries = PE_CATALOGS[catalog];
    if (!entries) {
      return json({ error: `Catálogo desconocido: ${catalog}`, catalogosDisponibles: Object.keys(PE_CATALOGS) }, { status: 404 });
    }
    return json(entries);
  }

  return async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const { method } = req;

    if (method === "GET" && pathname === "/health") {
      return json({ status: "ok" });
    }

    if (method === "GET" && pathname === "/openapi.yaml") {
      return new Response(Bun.file(OPENAPI_YAML_PATH), { headers: { "Content-Type": "application/yaml" } });
    }

    if (method === "GET" && pathname === "/vendor/scalar-standalone.js") {
      return new Response(Bun.file(SCALAR_STANDALONE_JS_PATH), { headers: { "Content-Type": "application/javascript" } });
    }

    if (method === "GET" && (pathname === "/docs" || pathname === "/docs/")) {
      return new Response(renderDocsHtml(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const catalogMatch = pathname.match(/^\/v1\/catalogs\/([^/]+)\/([^/]+)$/);
    if (method === "GET" && catalogMatch) {
      return handleGetCatalog(catalogMatch[1]!, catalogMatch[2]!);
    }

    // Admin-only (ver ADR-0006) — se resuelve antes del bloque de auth de tenant de abajo, porque
    // usa un mecanismo de autenticación distinto (una sola API key de administrador, no un
    // TenantRegistry).
    const tenantCertificateMatch = pathname.match(/^\/v1\/tenants\/([^/]+)\/certificate$/);
    if (method === "POST" && tenantCertificateMatch) {
      try {
        authenticateAdmin(req, adminApiKeyHash);
      } catch (err) {
        if (err instanceof UnauthorizedError) return unauthorizedResponse(err);
        throw err;
      }
      return handleCreateTenantCertificate(req, tenantCertificateMatch[1]!);
    }

    if (pathname.startsWith("/v1/")) {
      let tenant: TenantConfig;
      try {
        tenant = await authenticate(req, tenantRegistry);
      } catch (err) {
        if (err instanceof UnauthorizedError) return unauthorizedResponse(err);
        throw err;
      }

      if (method === "POST" && pathname === "/v1/invoices") {
        return handleCreateInvoice(req, tenant);
      }

      const invoiceMatch = pathname.match(/^\/v1\/invoices\/([^/]+)$/);
      if (method === "GET" && invoiceMatch) {
        return handleGetInvoice(invoiceMatch[1]!, tenant);
      }
    }

    return json({ error: "Not found" }, { status: 404 });
  };
}
