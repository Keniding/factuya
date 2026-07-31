---
name: deps-fast-xml-parser
description: "Referencia investigada de fast-xml-parser, usado en Factuya SOLO para parsear la respuesta XML del CDR de SUNAT (ApplicationResponse) y extraer ResponseCode/Description — no para construir el UBL de salida. Úsala cuando se escriba o revise código en packages/adapters/pe-sunat que lea la respuesta de SUNAT/OSE. Incluye un hallazgo importante: la clase XMLBuilder de esta librería está deprecada en la versión instalada, por eso el UBL de Factuya se arma con plantillas de string controladas manualmente y no con este builder."
---

# fast-xml-parser — skill de dependencia (Factuya · adapters/pe-sunat, solo parseo de respuestas)

Instalado de verdad con `bun add fast-xml-parser` y verificado contra `src/fxp.d.ts` real —
2026-07-31.

## Procedencia

- Paquete: `fast-xml-parser`, versión resuelta **5.10.1**.
- Repositorio: `NaturalIntelligence/fast-xml-parser` en GitHub — proyecto establecido y muy
  adoptado (uno de los parsers XML puro-JS más usados del ecosistema Node), sin scope sospechoso.
- Licencia MIT.

## Uso en Factuya: solo `XMLParser`, nunca `XMLBuilder`

```typescript
export class XMLParser {
  constructor(options?: X2jOptions);
  parse(xmlData: string | Uint8Array): any;
}
```

**Hallazgo real, no de memoria**: en `src/fxp.d.ts` de la v5.10.1, `XMLBuilder` está marcado
explícitamente:

```typescript
/**
 * @deprecated Use npm package 'fast-xml-builder' instead
 */
export class XMLBuilder {
  constructor(options?: XmlBuilderOptions);
  build(jObj: any): string;
}
```

Por eso Factuya **no usa `XMLBuilder` de este paquete** para construir el UBL 2.1 de salida — el
adaptador `pe-sunat` arma el XML con plantillas de string controladas manualmente (ver
`docs/adapters/pe-sunat.md`), porque además UBL exige orden estricto de elementos según su XSD y
un builder genérico basado en un objeto JS no garantiza ese orden sin configuración cuidadosa
adicional. `fast-xml-parser` se usa exclusivamente para **parsear** el `ApplicationResponse`
(CDR) que SUNAT devuelve, donde sí basta con leer valores, no producir XML válido contra un XSD
estricto.

## Opciones reales usadas para parsear el CDR

De `X2jOptions` (leído de los tipos instalados, no asumido):

```typescript
const parser = new XMLParser({
  ignoreAttributes: true,   // default: true — el CDR no necesita atributos para leer ResponseCode/Description
  removeNSPrefix: true,     // simplifica cac:DocumentResponse -> DocumentResponse, evita lidiar con prefijos ds/cac/cbc variables
});
const parsed = parser.parse(cdrXmlString);
```

Con `removeNSPrefix: true` los nodos quedan accesibles sin prefijo de namespace (ej.
`parsed.ApplicationResponse.DocumentResponse.Response.ResponseCode`), lo cual es más robusto ante
comprobantes cuyo prefijo exacto puede variar entre productor y validador.

## Known issue a vigilar

`XMLValidator` también está deprecado en esta versión ("Use fast-xml-validator instead") — Factuya
no lo usa (no se necesita validar XSD con esta librería), pero si en el futuro alguien quiere
agregar validación de esquema, no usar `XMLValidator` de este paquete sin re-investigar primero.
