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

export async function sendBill(
  endpointUrl: string,
  fileName: string,
  zipBytes: Uint8Array,
  credentials: SunatSoapCredentials,
): Promise<SendBillResult> {
  const contentFileBase64 = Buffer.from(zipBytes).toString("base64");
  const envelope = buildSendBillEnvelope(fileName, contentFileBase64, credentials);
  const wsUsername = `${credentials.ruc}${credentials.solUser}`;

  // HALLAZGO EMPÍRICO (no solo de fuentes secundarias): una primera corrida real contra el
  // endpoint beta devolvió HTTP 401 con un cuerpo HTML genérico servido por nginx ("401
  // Authorization Required"), no un SOAP Fault XML. Esa firma de respuesta es característica del
  // módulo auth_basic de nginx actuando como gate delante del servicio SOAP, antes de que el
  // WS-Security del body llegue a evaluarse — por eso se agrega también HTTP Basic Auth con las
  // mismas credenciales de WS-Security. Pendiente de confirmar con una corrida real desde un
  // entorno con salida a internet (ver docs/adapters/pe-sunat.md, "Limitación de este entorno");
  // si esto no resuelve un 401 real, revisar ahí antes de asumir que es un bug distinto.
  const basicAuth = Buffer.from(`${wsUsername}:${credentials.solPassword}`).toString("base64");

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

  if (response.status === 401) {
    throw new Error(
      `SUNAT/proxy devolvió HTTP 401 (Authorization Required). Si el cuerpo es HTML genérico de nginx (no un SOAP Fault XML), es un gate de autenticación HTTP delante del servicio, no un rechazo del WS-Security del body — ver el comentario en sendBill() y docs/adapters/pe-sunat.md. Cuerpo: ${bodyText.slice(0, 500)}`,
    );
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
