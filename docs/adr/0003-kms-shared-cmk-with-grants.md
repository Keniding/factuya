# ADR-0003: KMS — una CMK asimétrica compartida + un Grant por tenant, no una CMK por tenant

- Estado: aceptado
- Fecha: 2026-07-31

## Contexto

`docs/sdd/factuya-sdd.md` §9 exige que la clave privada de firma de cada tenant nunca salga de
KMS/CloudHSM, y que "cada operación de firma se autoriza contra la clave KMS específica del
tenant". Leído literalmente, esto sugiere una CMK (customer managed key) de KMS por tenant.

Antes de implementar `KmsSigner` (hasta ahora un stub sin terminar en
`packages/signing/src/kms-signer.ts`, nunca ejecutado contra AWS real — ver el comentario de esa
clase), se investigó el costo real de esa lectura literal: cada CMK cuesta **$1.00/mes,
prorrateado por hora**, sin importar su volumen de uso. Con una CMK por tenant, el costo de KMS
crece de forma estrictamente lineal con el número de tenants, sin techo — a 500 tenants son
~$500/mes solo en llaves, más que el costo variable de todo el resto del pipeline combinado (API
Gateway + Lambda + Step Functions + DynamoDB + S3 para el mismo volumen, ver el desglose de costos
discutido en esta conversación).

AWS documenta explícitamente una alternativa para este caso — aislar tenants sin crear una llave
por tenant — usando **Grants**: un permiso de acceso a una operación específica sobre una CMK
compartida, otorgable y revocable por tenant de forma independiente, sin costo de mantenimiento
mensual propio (a diferencia de una CMK). El propio blog de seguridad de AWS recomienda esta
estrategia explícitamente para arquitecturas SaaS multi-tenant como la de Factuya.

## Decisión

- `packages/signing` implementa `KmsSigner` contra **una única CMK asimétrica compartida** (RSA
  2048, alineada con el `SignatureMethod` RSA-SHA256 que ya exige SUNAT — ver ADR-0002), no una
  CMK por tenant. Puede haber más de una CMK por **ambiente** (ej. una en `staging`, otra en
  `production`), pero nunca una por **tenant**.
- El aislamiento por tenant (la propiedad de que dar de alta, modificar, o revocar el acceso de un
  tenant no afecte a los demás) se logra con un **Grant de KMS por tenant** sobre esa CMK
  compartida, no con una llave física separada. Alta de un tenant nuevo = crear un Grant; baja o
  revocación de emergencia de un tenant = `RetireGrant`/`RevokeGrant` de su Grant, sin tocar la
  CMK ni el acceso de ningún otro tenant.
- `TenantConfig.certificate.signerRef` (ver `packages/shared-types`) pasa a representar una
  referencia al Grant del tenant (no a una CMK propia) cuando `submissionChannel` implica firma
  vía KMS.
- Dependencia nueva: `@aws-sdk/client-kms`, investigada siguiendo el proceso de
  `.claude/agents/dependency-skill-agent.md` — ver `.claude/skills/deps-aws-sdk-client-kms.md` y
  la fila correspondiente en `docs/dependencies/LEDGER.md`.

## Fuentes verificadas (2026-07-31)

- [AWS Key Management Service Pricing](https://aws.amazon.com/kms/pricing/) — $1.00/mes por CMK
  (prorrateado por hora), tiers de precio por tipo de operación.
- [Simplify multi-tenant encryption with a cost-conscious AWS KMS key strategy](https://aws-news.com/article/2025-08-21-simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy)
  (AWS Security Blog) — recomienda explícitamente una CMK compartida por ambiente/servicio en vez
  de una CMK por tenant, usando Grants para el aislamiento.
- [Grants in AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/grants.html) (AWS KMS
  Developer Guide) — semántica real de `CreateGrant`/`RetireGrant`/`RevokeGrant`, constraints por
  operación.
- [ScheduleKeyDeletion](https://docs.aws.amazon.com/kms/latest/APIReference/API_ScheduleKeyDeletion.html)
  — confirma que una CMK en estado `PendingDeletion` no genera cargo durante la ventana de espera
  (7-30 días), relevante para el ciclo de vida de la(s) CMK(s) de ambiente.
- No se encontró, al momento de esta investigación, una línea de precio explícita y separada para
  las operaciones de gestión de Grants (`CreateGrant`/`RetireGrant`/`ListGrants`) en la página
  oficial de pricing — se documenta como no verificado con precisión en vez de asumir que caen en
  un tier específico; de cualquier forma, el volumen de estas llamadas (una por alta/baja de
  tenant, no por factura) las hace irrelevantes en costo incluso en el tier más caro conocido
  ($0.15/10.000 requests).

## Consecuencias

- El costo de KMS en producción queda prácticamente fijo (~$1/mes por CMK de ambiente) en vez de
  crecer linealmente con el número de tenants — la razón original de este ADR.
- `KmsSigner` necesita recibir, además del `keyId` de la CMK compartida, un mecanismo para
  resolver/aplicar el Grant del tenant antes de firmar (ver implementación en
  `packages/signing/src/kms-signer.ts` y el módulo de gestión de Grants que la acompaña).
- Revocar el acceso de un tenant específico (ej. por impago, por fin de contrato, por sospecha de
  compromiso de sus credenciales) es una operación aislada (`RetireGrant` de ese Grant) que no
  requiere rotar ni afectar la CMK compartida ni a ningún otro tenant — cumple la propiedad de
  aislamiento que motivó esta decisión.
- **No implementado con una cuenta de AWS real todavía** (ver limitación ya documentada en el
  stub de `KmsSigner` y en `docs/adapters/pe-sunat.md`): esta decisión y el código que la
  implementa están verificados contra la documentación oficial vigente de KMS, pero no contra el
  servicio real hasta que exista una cuenta de AWS de prueba disponible — no se debe dar por
  "100% validado" en el mismo sentido que el adaptador SUNAT (que sí corrió contra el servicio
  real de SUNAT beta) hasta que se confirme con una corrida real.
- Si en el futuro un requisito regulatorio o contractual exigiera aislamiento físico de llave por
  tenant (no solo lógico vía Grant) para algún tenant específico, ese sería un caso excepcional a
  resolver con una CMK dedicada para ese tenant puntual, no un cambio del default para todos.

## Addendum verificado con una corrida real (2026-08-02)

El bullet de arriba sobre "no implementado con una cuenta de AWS real todavía" ya no aplica —
se corrió una verificación real siguiendo `docs/aws/kms-live-verification.md`, contra un usuario
IAM dedicado (`factuya-dev`, permisos mínimos, sin acceso a consola) en una cuenta de AWS real:

- CMK asimétrica creada (`RSA_2048`, `SIGN_VERIFY`).
- Grant `Sign`-only creado para un tenant de prueba (`createTenantGrant`).
- `KmsSigner.sign()` firmó un mensaje real usando ese Grant.
- La firma se verificó con `crypto.verify()` de Node contra la llave pública real obtenida de KMS
  (`GetPublicKey`) — confirma que `RSASSA_PKCS1_V1_5_SHA_256`/`MessageType: RAW` produce
  exactamente la firma esperada contra el servicio real, no solo que la llamada no lanzó error.
- Limpieza confirmada después: `RetireGrant` del Grant de prueba, y `ScheduleKeyDeletion` de la
  CMK — verificado con `DescribeKey` que el estado quedó en `PendingDeletion` (sin costo durante
  la ventana de espera).

`KmsSigner` y el diseño de Grants de este ADR quedan con el mismo nivel de confianza que el
adaptador SUNAT (validado contra el servicio real, no solo contra documentación/tipos). Detalle
completo y reproducible en `docs/aws/kms-live-verification.md` y
`packages/signing/test/integration/kms-live.integration.test.ts`.
