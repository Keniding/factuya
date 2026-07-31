import type { InvoiceLine, InvoiceRequest, Party, PartyRef, TenantConfig } from "@factuya/shared-types";
import {
  CUSTOMIZATION_ID,
  DEFAULT_UNIT_CODE,
  IGV_TAX_SCHEME_ID,
  IGV_TAX_SCHEME_NAME,
  IGV_TAX_TYPE_CODE,
  INVOICE_TYPE_CODE_FACTURA,
  INVOICE_TYPE_CODE_LIST_ID,
  PARTY_ID_SCHEME_RUC,
  TAX_EXEMPTION_REASON_CODE_GRAVADO,
  UBL_VERSION_ID,
} from "./catalogs";

/**
 * Construye el XML UBL 2.1 de una Factura (tipo 01) sin firmar, a partir del modelo agnóstico
 * de Factuya. Estructura y orden de elementos verificados contra un XML real generado por
 * Greenter (referencia de facto del ecosistema) — ver docs/adapters/pe-sunat.md para la fuente
 * exacta y qué se dejó fuera de alcance a propósito (ver comentarios inline "MVP:").
 *
 * El nodo ext:ExtensionContent se deja vacío a propósito — ahí es donde
 * packages/signing/src/xml-dsig-signer.ts inserta el ds:Signature (ver docs/adr/0002).
 */

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function money(amount: number): string {
  return amount.toFixed(2);
}

function buildPartyBlock(party: PartyRef | Party, isSupplier: boolean): string {
  const schemeId = "taxIdType" in party && party.taxIdType ? party.taxIdType : PARTY_ID_SCHEME_RUC;
  const address = "address" in party ? party.address : undefined;

  const addressBlock = address
    ? `<cac:RegistrationAddress>
        ${address.ubigeo ? `<cbc:ID>${address.ubigeo}</cbc:ID>` : ""}
        <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>
        ${address.district ? `<cbc:District>${cdata(address.district)}</cbc:District>` : ""}
        ${address.province ? `<cbc:CityName>${cdata(address.province)}</cbc:CityName>` : ""}
        ${address.department ? `<cbc:CountrySubentity>${cdata(address.department)}</cbc:CountrySubentity>` : ""}
        ${address.line ? `<cac:AddressLine><cbc:Line>${cdata(address.line)}</cbc:Line></cac:AddressLine>` : ""}
        <cac:Country><cbc:IdentificationCode>${address.countryCode}</cbc:IdentificationCode></cac:Country>
      </cac:RegistrationAddress>`
    : "";

  const nameBlock = isSupplier && "legalName" in party
    ? `<cac:PartyName><cbc:Name>${cdata(party.legalName)}</cbc:Name></cac:PartyName>`
    : "";

  return `<cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="${schemeId}">${party.taxId}</cbc:ID></cac:PartyIdentification>
      ${nameBlock}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${cdata(party.legalName)}</cbc:RegistrationName>
        ${addressBlock}
      </cac:PartyLegalEntity>
    </cac:Party>`;
}

function buildInvoiceLine(line: InvoiceLine, currency: string): string {
  return `<cac:InvoiceLine>
    <cbc:ID>${line.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${line.unitCode || DEFAULT_UNIT_CODE}">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(line.lineExtensionAmount)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${currency}">${(line.unitPrice + line.taxAmount / line.quantity).toFixed(6)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${money(line.taxAmount)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${money(line.lineExtensionAmount)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">${money(line.taxAmount)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${line.taxPercent}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>${TAX_EXEMPTION_REASON_CODE_GRAVADO}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID>${IGV_TAX_SCHEME_ID}</cbc:ID>
            <cbc:Name>${IGV_TAX_SCHEME_NAME}</cbc:Name>
            <cbc:TaxTypeCode>${IGV_TAX_TYPE_CODE}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>${cdata(line.description)}</cbc:Description>
      ${line.sellerItemId ? `<cac:SellersItemIdentification><cbc:ID>${line.sellerItemId}</cbc:ID></cac:SellersItemIdentification>` : ""}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${line.unitPrice.toFixed(6)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

export function buildFacturaUbl(request: InvoiceRequest, tenant: TenantConfig, documentId: string): string {
  const igv = request.taxes.find((t) => t.scheme === "IGV");
  const taxAmount = igv?.taxAmount ?? request.lines.reduce((sum, l) => sum + l.taxAmount, 0);
  const taxableAmount = igv?.taxableAmount ?? request.lines.reduce((sum, l) => sum + l.lineExtensionAmount, 0);
  const lineExtensionTotal = request.lines.reduce((sum, l) => sum + l.lineExtensionAmount, 0);
  const payableAmount = lineExtensionTotal + taxAmount;

  const noteBlock = request.amountInWords
    ? `<cbc:Note languageLocaleID="1000">${cdata(request.amountInWords)}</cbc:Note>`
    : ""; // MVP: SUNAT recomienda el monto en letras; se omite si el caller no lo provee (ver docs/adapters/pe-sunat.md, limitación conocida)

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>${UBL_VERSION_ID}</cbc:UBLVersionID>
  <cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID>
  <cbc:ID>${documentId}</cbc:ID>
  <cbc:IssueDate>${request.issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${request.issueTime ?? "00:00:00"}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="${INVOICE_TYPE_CODE_LIST_ID}">${INVOICE_TYPE_CODE_FACTURA}</cbc:InvoiceTypeCode>
  ${noteBlock}
  <cbc:DocumentCurrencyCode>${request.currency}</cbc:DocumentCurrencyCode>
  <cac:Signature>
    <cbc:ID>${tenant.issuer.taxId}</cbc:ID>
    <cbc:Note>Factuya</cbc:Note>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${tenant.issuer.taxId}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${cdata(tenant.issuer.legalName)}</cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference><cbc:URI>#FactuyaSign</cbc:URI></cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    ${buildPartyBlock(request.issuer, true)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${buildPartyBlock(request.customer, false)}
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${request.currency}">${money(taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${request.currency}">${money(taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${request.currency}">${money(taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>${IGV_TAX_SCHEME_ID}</cbc:ID>
          <cbc:Name>${IGV_TAX_SCHEME_NAME}</cbc:Name>
          <cbc:TaxTypeCode>${IGV_TAX_TYPE_CODE}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${request.currency}">${money(lineExtensionTotal)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${request.currency}">${money(payableAmount)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${request.currency}">${money(payableAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${request.lines.map((line) => buildInvoiceLine(line, request.currency)).join("\n  ")}
</Invoice>`;
}
