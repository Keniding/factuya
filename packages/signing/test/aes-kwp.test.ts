import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { aesKeyUnwrapWithPadding, aesKeyWrapWithPadding } from "../src/aes-kwp";

/**
 * Vectores de prueba oficiales de RFC 5649 §6 (https://www.rfc-editor.org/rfc/rfc5649) — no
 * inventados. Ver ADR-0006 para por qué esto se implementó a mano.
 */
describe("aesKeyWrapWithPadding — vectores oficiales de RFC 5649", () => {
  const kek = Buffer.from("5840df6e29b02af1ab493b705bf16ea1ae8338f4dcc176a8", "hex");

  it("Example 1: 20 octetos de texto plano, KEK de 192 bits", () => {
    const plaintext = Buffer.from("c37b7e6492584340bed12207808941155068f738", "hex");
    const expected = "138bdeaa9b8fa7fc61f97742e72248ee5ae6ae5360d1ae6a5f54f373fa543b6a";
    expect(aesKeyWrapWithPadding(kek, plaintext).toString("hex")).toBe(expected);
  });

  it("Example 2: 7 octetos de texto plano, KEK de 192 bits", () => {
    const plaintext = Buffer.from("466f7250617369", "hex");
    const expected = "afbeb0f07dfbf5419200f2ccb50bb24f";
    expect(aesKeyWrapWithPadding(kek, plaintext).toString("hex")).toBe(expected);
  });
});

describe("aesKeyWrapWithPadding / aesKeyUnwrapWithPadding — round-trip", () => {
  it("hace round-trip exacto con una clave privada RSA-2048 real (153 bloques)", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const der = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
    const kek = Buffer.from(
      Array.from({ length: 32 }, (_, i) => i), // KEK determinístico, no hace falta aleatoriedad para este test
    );

    const wrapped = aesKeyWrapWithPadding(kek, der);
    expect(wrapped.length).toBe(Math.ceil(der.length / 8) * 8 + 8);

    const unwrapped = aesKeyUnwrapWithPadding(kek, wrapped);
    expect(Buffer.compare(unwrapped, der)).toBe(0);
  });

  it("hace round-trip exacto con datos de un solo bloque (8 bytes)", () => {
    const kek = Buffer.alloc(32, 7);
    const plaintext = Buffer.from("12345678");
    const wrapped = aesKeyWrapWithPadding(kek, plaintext);
    expect(wrapped.length).toBe(16);
    expect(Buffer.compare(aesKeyUnwrapWithPadding(kek, wrapped), plaintext)).toBe(0);
  });

  it("hace round-trip exacto con datos que no son múltiplo de 8 (requieren padding)", () => {
    const kek = Buffer.alloc(32, 3);
    const plaintext = Buffer.from("no es multiplo de ocho bytes exactos");
    const wrapped = aesKeyWrapWithPadding(kek, plaintext);
    expect(Buffer.compare(aesKeyUnwrapWithPadding(kek, wrapped), plaintext)).toBe(0);
  });

  it("unwrap lanza un error claro si la KEK es incorrecta", () => {
    const kek = Buffer.alloc(32, 1);
    const wrongKek = Buffer.alloc(32, 2);
    const wrapped = aesKeyWrapWithPadding(kek, Buffer.from("datos de prueba mas largos que un bloque"));
    expect(() => aesKeyUnwrapWithPadding(wrongKek, wrapped)).toThrow(/AIV inválido/);
  });
});
