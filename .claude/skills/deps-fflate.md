---
name: deps-fflate
description: "Referencia investigada de fflate, la librería de compresión usada en Factuya para comprimir el XML UBL firmado a .zip antes de sendBill (exigencia de SUNAT) y para descomprimir el CDR que SUNAT devuelve. Úsala cuando se escriba o revise código en packages/adapters/pe-sunat relacionado con el empaquetado ZIP del comprobante o la lectura del CDR comprimido."
---

# fflate — skill de dependencia (Factuya · adapters/pe-sunat)

Instalado de verdad con `bun add fflate` y verificado contra `lib/node.d.cts` real — 2026-07-31.

## Procedencia

- Paquete: `fflate`, versión resuelta **0.8.3**.
- Repositorio: `101arrowz/fflate` en GitHub (Arjun Barrett) — librería de compresión pura JS
  ampliamente adoptada, sin dependencias nativas (relevante para Lambda: no requiere bindings
  nativos que compliquen el empaquetado del artefacto).
- Tamaño declarado por el propio proyecto: "~8kB" — relevante para cold-start de Lambda.

## API real usada (de `lib/node.d.cts`)

```typescript
function zipSync(data: Zippable, opts?: ZipOptions): Uint8Array;
function unzipSync(data: Uint8Array, opts?: UnzipOptions): Unzipped;
function strToU8(str: string, latin1?: boolean): Uint8Array;
function strFromU8(dat: Uint8Array, latin1?: boolean): string;
```

### Comprimir el XML firmado (paso "Compresión" de SDD §8.4)

```typescript
import { strToU8, zipSync } from "fflate";

// SUNAT exige el nombre RUC-TIPO-SERIE-CORRELATIVO.xml dentro de un .zip con el mismo nombre base
function buildSunatZip(signedXml: string, xmlFileName: string): Uint8Array {
  return zipSync({ [xmlFileName]: strToU8(signedXml) }, { level: 6 });
}
```

### Descomprimir el CDR recibido

```typescript
import { strFromU8, unzipSync } from "fflate";

function extractCdrXml(cdrZipBytes: Uint8Array): string {
  const files = unzipSync(cdrZipBytes);
  const entryName = Object.keys(files).find((name) => name.toUpperCase().endsWith(".XML"));
  if (!entryName) throw new Error("El ZIP del CDR no contiene un archivo .xml");
  return strFromU8(files[entryName]!);
}
```

## Known issue a vigilar

`zipSync`/`unzipSync` trabajan en memoria (`Uint8Array`) — para comprobantes normales (un XML de
pocos KB) esto es irrelevante, pero si en el futuro Factuya maneja resúmenes diarios con miles de
líneas, vigilar el uso de memoria en la Lambda (límite de memoria configurado) antes de asumir que
escala sin ajuste.
