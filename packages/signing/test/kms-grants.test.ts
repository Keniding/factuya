import { describe, expect, it } from "bun:test";
import { CreateGrantCommand, RetireGrantCommand, type KMSClient } from "@aws-sdk/client-kms";
import { createTenantGrant, retireTenantGrant } from "../src/kms-grants";

/** Ver la nota de docs/dependencies/LEDGER.md — fake de KMSClient, no una corrida real contra AWS. */
function fakeKmsClient(handler: (command: unknown) => unknown): KMSClient {
  return { send: async (command: unknown) => handler(command) } as unknown as KMSClient;
}

describe("createTenantGrant", () => {
  it("crea un Grant Sign-only con GranteePrincipal y RetiringPrincipal iguales, y Name = tenantId", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const client = fakeKmsClient((command) => {
      expect(command).toBeInstanceOf(CreateGrantCommand);
      capturedInput = (command as CreateGrantCommand).input as unknown as Record<string, unknown>;
      return { GrantId: "grant-123", GrantToken: "token-abc" };
    });

    const result = await createTenantGrant({
      client,
      keyId: "arn:aws:kms:us-east-1:111122223333:key/shared-cmk",
      granteePrincipalArn: "arn:aws:iam::111122223333:role/factuya-backend",
      tenantId: "tenant-42",
    });

    expect(result).toEqual({ grantId: "grant-123", grantToken: "token-abc" });
    expect(capturedInput?.KeyId).toBe("arn:aws:kms:us-east-1:111122223333:key/shared-cmk");
    expect(capturedInput?.GranteePrincipal).toBe("arn:aws:iam::111122223333:role/factuya-backend");
    expect(capturedInput?.RetiringPrincipal).toBe("arn:aws:iam::111122223333:role/factuya-backend");
    expect(capturedInput?.Operations).toEqual(["Sign"]);
    expect(capturedInput?.Name).toBe("tenant-42");
  });

  it("lanza un error claro si CreateGrant no devuelve GrantId/GrantToken", async () => {
    const client = fakeKmsClient(() => ({}));

    await expect(
      createTenantGrant({
        client,
        keyId: "key-id",
        granteePrincipalArn: "arn:aws:iam::111122223333:role/factuya-backend",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow(/no devolvió GrantId\/GrantToken/);
  });
});

describe("retireTenantGrant", () => {
  it("llama a RetireGrant con el GrantToken del tenant", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const client = fakeKmsClient((command) => {
      expect(command).toBeInstanceOf(RetireGrantCommand);
      capturedInput = (command as RetireGrantCommand).input as unknown as Record<string, unknown>;
      return {};
    });

    await retireTenantGrant(client, "token-abc");

    expect(capturedInput?.GrantToken).toBe("token-abc");
  });
});
