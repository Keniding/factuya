import { describe, expect, it } from "bun:test";
import { generateApiKey, hashApiKey, hashesEqual } from "../src/api-key";

describe("api-key", () => {
  it("genera keys con el prefijo fty_ y suficiente entropía para no repetirse", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith("fty_")).toBe(true);
    expect(b.startsWith("fty_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("hashApiKey es determinístico y sensible a cualquier cambio en la key", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toBe(hashApiKey(`${key}x`));
  });

  it("hashesEqual compara hashes reales correctamente", () => {
    const hashA = hashApiKey("some-key");
    const hashB = hashApiKey("some-key");
    const hashC = hashApiKey("other-key");
    expect(hashesEqual(hashA, hashB)).toBe(true);
    expect(hashesEqual(hashA, hashC)).toBe(false);
  });

  it("hashesEqual no lanza con hashes de largo distinto (evita crash de timingSafeEqual)", () => {
    expect(hashesEqual("ab", "abcd")).toBe(false);
  });
});
