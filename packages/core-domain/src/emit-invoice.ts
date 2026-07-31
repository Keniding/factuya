import type { InvoiceRequest, InvoiceResult, TenantConfig } from "@factuya/shared-types";
import type { CountryAdapter } from "./country-adapter";

export interface EmitInvoiceOptions {
  /** Máximo de intentos de polling para el flujo asíncrono. Default: 10. */
  maxPollAttempts?: number;
  /**
   * Función de espera entre intentos de polling — inyectable para tests
   * (evita `setTimeout` real en unit tests). Default: espera real con backoff.
   */
  wait?: (attempt: number) => Promise<void>;
}

const defaultWait = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30_000)));

/**
 * Orquesta el flujo completo de emisión: build -> sign -> submit -> (poll si es async).
 * Ver docs/sdd/factuya-sdd.md §5 (Step Functions en producción sigue esta misma secuencia lógica;
 * esta función es la versión "en proceso" usada para tests y para correr el paso a paso local).
 */
export async function emitInvoice(
  adapter: CountryAdapter,
  request: InvoiceRequest,
  tenant: TenantConfig,
  options: EmitInvoiceOptions = {},
): Promise<InvoiceResult> {
  const built = await adapter.build(request, tenant);
  const signed = await adapter.sign(built, tenant);
  const submission = await adapter.submit(signed, tenant);

  if (submission.kind === "SYNC") {
    return submission.result;
  }

  const maxAttempts = options.maxPollAttempts ?? 10;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await adapter.checkStatus(submission.ticket, tenant);
    if (status.status !== "PENDING") {
      return status;
    }
    await wait(attempt);
  }

  return {
    status: "PENDING",
    countryDocumentId: submission.ticket,
    rawProviderResponse: { reason: "max_poll_attempts_exceeded", ticket: submission.ticket },
  };
}
