import { createCipheriv, createDecipheriv } from "node:crypto";

/**
 * AES Key Wrap with Padding (RFC 5649) — implementado a mano porque ni `node:crypto` ni la
 * WebCrypto de Bun exponen este cifrador, y no se encontró una dependencia npm activamente
 * mantenida que lo implemente (ver ADR-0006). Necesario para envolver una clave privada RSA de
 * longitud arbitraria antes de importarla a KMS vía `RSA_AES_KEY_WRAP_SHA_256`
 * (`packages/signing/src/kms-tenant-key-import.ts`).
 *
 * Validado contra los vectores de prueba oficiales de RFC 5649 §6 — ver
 * `packages/signing/test/aes-kwp.test.ts` — y contra un round-trip con una clave RSA-2048 real
 * (153 bloques) antes de usarse contra KMS real.
 */

const AIV_MAGIC = 0xa65959a6;

function ecbEncryptBlock(kek: Buffer, block16: Buffer): Buffer {
  const cipher = createCipheriv(`aes-${kek.length * 8}-ecb`, kek, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block16), cipher.final()]);
}

function ecbDecryptBlock(kek: Buffer, block16: Buffer): Buffer {
  const decipher = createDecipheriv(`aes-${kek.length * 8}-ecb`, kek, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(block16), decipher.final()]);
}

/** `kek` debe ser de 16, 24, o 32 bytes (AES-128/192/256) — AWS KMS exige 32 (AES-256). */
export function aesKeyWrapWithPadding(kek: Buffer, plaintext: Buffer): Buffer {
  const mli = plaintext.length;
  const paddedLength = Math.ceil(mli / 8) * 8;
  const padded = Buffer.alloc(paddedLength);
  plaintext.copy(padded);

  const aiv = Buffer.alloc(8);
  aiv.writeUInt32BE(AIV_MAGIC, 0);
  aiv.writeUInt32BE(mli, 4);

  if (paddedLength === 8) {
    return ecbEncryptBlock(kek, Buffer.concat([aiv, padded]));
  }

  const n = paddedLength / 8;
  const r: Buffer[] = [];
  for (let i = 0; i < n; i++) r.push(Buffer.from(padded.subarray(i * 8, i * 8 + 8)));

  let a = Buffer.from(aiv);
  for (let j = 0; j <= 5; j++) {
    for (let i = 1; i <= n; i++) {
      const b = ecbEncryptBlock(kek, Buffer.concat([a, r[i - 1]!]));
      const msb = b.subarray(0, 8);
      const lsb = b.subarray(8, 16);
      const t = n * j + i;
      const tBuf = Buffer.alloc(8);
      tBuf.writeBigUInt64BE(BigInt(t));
      const newA = Buffer.alloc(8);
      for (let k = 0; k < 8; k++) newA[k] = msb[k]! ^ tBuf[k]!;
      a = newA;
      r[i - 1] = Buffer.from(lsb);
    }
  }

  return Buffer.concat([a, ...r]);
}

/** Inverso de `aesKeyWrapWithPadding` — usado solo en tests, para validar el wrap sin depender de KMS. */
export function aesKeyUnwrapWithPadding(kek: Buffer, wrapped: Buffer): Buffer {
  const n = wrapped.length / 8 - 1;
  let a = Buffer.from(wrapped.subarray(0, 8));
  const r: Buffer[] = [];
  for (let i = 0; i < n; i++) r.push(Buffer.from(wrapped.subarray(8 + i * 8, 16 + i * 8)));

  if (n === 1) {
    const block = ecbDecryptBlock(kek, Buffer.concat([a, r[0]!]));
    a = Buffer.from(block.subarray(0, 8));
    r[0] = Buffer.from(block.subarray(8, 16));
  } else {
    for (let j = 5; j >= 0; j--) {
      for (let i = n; i >= 1; i--) {
        const t = n * j + i;
        const tBuf = Buffer.alloc(8);
        tBuf.writeBigUInt64BE(BigInt(t));
        const xored = Buffer.alloc(8);
        for (let k = 0; k < 8; k++) xored[k] = a[k]! ^ tBuf[k]!;
        const block = ecbDecryptBlock(kek, Buffer.concat([xored, r[i - 1]!]));
        a = Buffer.from(block.subarray(0, 8));
        r[i - 1] = Buffer.from(block.subarray(8, 16));
      }
    }
  }

  const aivMagic = a.readUInt32BE(0);
  const mli = a.readUInt32BE(4);
  if (aivMagic !== AIV_MAGIC) {
    throw new Error("aesKeyUnwrapWithPadding: AIV inválido — la clave o los datos envueltos no son correctos");
  }
  return Buffer.concat(r).subarray(0, mli);
}
