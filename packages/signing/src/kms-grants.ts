import { CreateGrantCommand, RetireGrantCommand, type KMSClient } from "@aws-sdk/client-kms";

/**
 * Aislamiento por tenant sobre la CMK compartida (ver ADR-0003 y
 * `.claude/skills/deps-aws-sdk-client-kms.md`). Cada tenant recibe su propio Grant `Sign`-only
 * sobre la misma llave — dar de alta o revocar el acceso de un tenant nunca toca la CMK ni a
 * ningún otro tenant.
 *
 * LÍMITE REAL A NO ASUMIR COMO MÁS DE LO QUE ES (ver el skill, sección "GrantConstraints NO
 * aplica a Sign"): el Grant aísla por *revocación y auditoría* (cada `grantId` es rastreable a un
 * tenant), no porque KMS distinga criptográficamente qué tenant hizo la llamada — todos los
 * Grants de tenant comparten el mismo `GranteePrincipal` (el rol del backend de Factuya). Que se
 * use el `grantToken` correcto para el tenant correcto sigue siendo responsabilidad del código
 * que llama a `KmsSigner`, resuelto desde `TenantConfig` (igual que leer la fila correcta de una
 * base de datos).
 */

export interface CreateTenantGrantOptions {
  client: KMSClient;
  /** ARN o key ID de la CMK compartida (ver ADR-0003). */
  keyId: string;
  /** ARN del rol/usuario IAM del backend de Factuya — el mismo para todos los tenants. */
  granteePrincipalArn: string;
  /**
   * Identificador único y estable del tenant, usado como `Name` del Grant para que reintentar
   * esta llamada con los mismos parámetros no cree Grants duplicados (ver el comentario real de
   * `CreateGrantRequest.Name` en los tipos instalados: sin `Name`, cada `CreateGrant` genera un
   * `GrantId` nuevo incluso con parámetros idénticos).
   */
  tenantId: string;
}

export interface TenantGrant {
  grantId: string;
  grantToken: string;
}

/** Da de alta el acceso de firma de un tenant nuevo — no requiere tocar la CMK ni otros tenants. */
export async function createTenantGrant(options: CreateTenantGrantOptions): Promise<TenantGrant> {
  const response = await options.client.send(
    new CreateGrantCommand({
      KeyId: options.keyId,
      GranteePrincipal: options.granteePrincipalArn,
      RetiringPrincipal: options.granteePrincipalArn,
      Operations: ["Sign"],
      Name: options.tenantId,
    }),
  );

  if (!response.GrantId || !response.GrantToken) {
    throw new Error(`CreateGrant no devolvió GrantId/GrantToken para el tenant ${options.tenantId}`);
  }
  return { grantId: response.GrantId, grantToken: response.GrantToken };
}

/**
 * Revoca el acceso de un tenant específico — el resto de tenants (y la CMK compartida) no se ven
 * afectados. Usar ante fin de contrato, impago, o sospecha de compromiso de las credenciales del
 * tenant.
 */
export async function retireTenantGrant(client: KMSClient, grantToken: string): Promise<void> {
  await client.send(new RetireGrantCommand({ GrantToken: grantToken }));
}
