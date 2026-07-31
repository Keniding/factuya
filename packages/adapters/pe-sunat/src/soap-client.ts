import { XMLParser } from "fast-xml-parser";

/**
 * Cliente SOAP mínimo para el servicio billService de SUNAT (sendBill), construido a mano
 * (sin librería de cliente SOAP genérica) porque la superficie que se necesita es una sola
 * operación con un envelope simple — ver docs/adapters/pe-sunat.md para las fuentes usadas
 * para verificar endpoint, namespace y formato de WS-Security (no se pudo descargar el WSDL
 * crudo en este entorno por política de red del sandbox; verificado por fuentes secundarias
 * cruzadas — re-verificar contra el WSDL real antes de producción, ver limitaciones en ese doc).
 */

export interface SunatSoapCredentials {
  ruc: string;
  solUser: string;
  solPassword: string;
}

export interface SendBillResult {
  applicationResponseZip: Uint8Array;
}

export class SunatSoapFault extends Error {
  constructor(
    public readonly faultCode: string,
    public readonly faultString: string,
  ) {
    super(`SUNAT SOAP fault ${faultCode}: ${faultString}`);
  }
}

function buildSendBillEnvelope(
  fileName: string,
  contentFileBase64: string,
  credentials: SunatSoapCredentials,
): string {
  const wsUsername = `${credentials.ruc}${credentials.solUser}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${wsUsername}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${credentials.solPassword}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendBill>
      <fileName>${fileName}</fileName>
      <contentFile>${contentFileBase64}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>`;
}

const responseParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

/**
 * Un 401 con cuerpo HTML genérico de nginx ("401 Authorization Required"), no un SOAP Fault XML,
 * es la firma de un nodo del pool de e-beta.sunat.gob.pe que exige auth_basic delante del
 * servicio. Distingue este caso de un SOAP Fault real (que siempre es XML), para no reintentar
 * un rechazo legítimo del WS-Security del body.
 */
function isNginxAuthGateBody(bodyText: string): boolean {
  return !bodyText.trimStart().startsWith("<?xml") && !bodyText.includes("<soap");
}

const MAX_401_RETRIES = 4;
const RETRY_BACKOFF_MS = [250, 500, 1000, 2000];

export async function sendBill(
  endpointUrl: string,
  fileName: string,
  zipBytes: Uint8Array,
  credentials: SunatSoapCredentials,
): Promise<SendBillResult> {
  const contentFileBase64 = Buffer.from(zipBytes).toString("base64");
  const envelope = buildSendBillEnvelope(fileName, contentFileBase64, credentials);
  const wsUsername = `${credentials.ruc}${credentials.solUser}`;
  const basicAuth = Buffer.from(`${wsUsername}:${credentials.solPassword}`).toString("base64");

  // HALLAZGO EMPÍRICO, confirmado con múltiples corridas reales (2026-07-31, ver
  // docs/adapters/pe-sunat.md): el pool de e-beta.sunat.gob.pe es inconsistente entre sus propios
  // nodos — el MISMO envelope, sin variar nada, devuelve HTTP 200 o HTTP 401 con cuerpo HTML de
  // nginx de forma intercalada entre requests consecutivos (confirmado con 8 intentos idénticos:
  // ~3/8 en 401 sin el header Authorization, 0/8 con el header en la misma corrida). No es un
  // problema de credenciales ni de WS-Security — es infraestructura de beta con auth_basic
  // habilitado en un subconjunto de nodos detrás del balanceador. Enviar Authorization: Basic
  // reduce la tasa de 401 pero no la elimina de forma determinista, por eso además se reintenta
  // un número acotado de veces ante ese 401 específico antes de darlo por error real.
  let lastNginxGateError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_401_RETRIES; attempt++) {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "",
        Authorization: `Basic ${basicAuth}`,
      },
      body: envelope,
    });

    const bodyText = await response.text();

    if (response.status === 401 && isNginxAuthGateBody(bodyText)) {
      lastNginxGateError = new Error(
        `SUNAT/proxy devolvió HTTP 401 (Authorization Required) con cuerpo HTML de nginx, no un SOAP Fault — nodo inconsistente del pool de beta (ver docs/adapters/pe-sunat.md). Intento ${attempt + 1}/${MAX_401_RETRIES + 1}. Cuerpo: ${bodyText.slice(0, 300)}`,
      );
      if (attempt < MAX_401_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS[attempt]));
        continue;
      }
      throw lastNginxGateError;
    }

    const parsed = responseParser.parse(bodyText);
    const envelopeBody = parsed?.Envelope?.Body;

    const fault = envelopeBody?.Fault;
    if (fault) {
      throw new SunatSoapFault(String(fault.faultcode ?? "UNKNOWN"), String(fault.faultstring ?? bodyText));
    }

    const applicationResponseBase64 = envelopeBody?.sendBillResponse?.applicationResponse;
    if (!applicationResponseBase64 || !response.ok) {
      throw new Error(
        `Respuesta inesperada de SUNAT (HTTP ${response.status}): no se encontró applicationResponse. Cuerpo: ${bodyText.slice(0, 500)}`,
      );
    }

    return { applicationResponseZip: new Uint8Array(Buffer.from(String(applicationResponseBase64), "base64")) };
  }

  // Inalcanzable: el loop siempre retorna o lanza dentro del cuerpo — TypeScript no puede probarlo.
  throw lastNginxGateError ?? new Error("sendBill: fallo desconocido en el loop de reintento");
}
