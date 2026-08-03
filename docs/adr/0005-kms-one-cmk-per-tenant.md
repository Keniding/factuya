# ADR-0005: KMS — una CMK por tenant (reemplaza ADR-0003)

- Estado: aceptado
- Fecha: 2026-08-03

## Contexto

Al diseñar `POST /v1/tenants/{id}/certificate` (el flujo para que cada tenant registre su propio
certificado de firma), surgió un conflicto real entre dos decisiones ya tomadas:

- `docs/sdd/factuya-sdd.md` §13 (modelo de responsabilidad legal, ya decidido): Factuya es un
  proxy tecnológico, **no** un OSE/PSE — cada tenant mantiene **su propia identidad tributaria**
  frente a SUNAT, incluyendo su propio certificado digital.
- ADR-0003 (ya implementado y validado en vivo): **una única CMK de KMS compartida entre todos
  los tenants**, con Grants solo para controlar quién puede invocar `Sign`.

El problema: en KMS, una CMK es exactamente un par de llaves. Si todos los tenants comparten la
misma CMK, **todos firman con la misma llave privada** — todos los comprobantes de todos los
tenants quedarían firmados con la misma identidad criptográfica, sin importar el RUC del emisor.
Eso contradice directamente el §13: no hay forma de que cada tenant tenga "su propia identidad
tributaria" si la llave de firma es la misma para todos. Un Grant controla *quién puede invocar
Sign*, no *con qué identidad criptográfica se firma* — son propiedades distintas, y ADR-0003
resolvía la primera sin darse cuenta de que dejaba sin resolver la segunda, que es la que
realmente importa para cumplir el §13.

### La causa raíz: una lectura incorrecta de la fuente citada en ADR-0003

ADR-0003 citó [Simplify multi-tenant encryption with a cost-conscious AWS KMS key strategy](https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/)
(AWS Architecture Blog) como fuente para "una CMK compartida entre tenants, aislada con Grants".
Al releer el artículo completo para resolver este conflicto, el texto real dice otra cosa. AWS
describe tres modelos:

1. **Shared key** (una CMK para todos los tenants) — el propio artículo dice que esto **no
   alcanza** para proveedores SaaS con "marcos estrictos de seguridad y cumplimiento" que
   requieren aislamiento real por tenant.
2. **Silo** (una CMK por cada combinación tenant×servicio) — genera demasiadas llaves y problemas
   de cuota de servicio.
3. **Centralizado (el que recomiendan)**: **una CMK por tenant**, consolidada en una cuenta
   central — el ahorro del que habla el artículo es consolidar *los distintos servicios de un
   mismo tenant* (ej. S3 + DynamoDB + firma, todos del mismo tenant) en una sola llave, **no**
   compartir una llave entre tenants distintos.

Es decir: la fuente citada en ADR-0003 recomienda exactamente lo que ADR-0003 decidió **no**
hacer. Se malinterpretó "una llave por tenant" (consolidando servicios) como "una llave para
todos los tenants" al escribir el ADR original — un error real de lectura, no una limitación de
KMS ni un cambio de opinión sin fundamento.

## Alternativas evaluadas antes de decidir (para no repetir el mismo tipo de error)

- **AWS Payment Cryptography** (servicio dedicado a operaciones de pago, soporta firma RSA-2048):
  mismo costo por llave activa que KMS (`$1.00/mes`), pero las operaciones de firma cuestan entre
  25 y 66 veces más por llamada (`$0.0002`/llamada en el primer tier vs `$0.000003`/llamada de
  KMS Sign). No resuelve el problema de costo — está pensado para bajo volumen de operaciones de
  alto valor (terminales POS), no para firmar muchas facturas.
- **AWS CloudHSM**: `$1.60`/hora por instancia de HSM (~`$1.168`/mes), mínimo 2 para alta
  disponibilidad (~`$2.336`/mes) — solo se vuelve más barato que CMKs individuales de KMS pasados
  los ~2.300 tenants (`$1`/mes cada una). Irrelevante a la escala considerada para este MVP.
- **Cifrado de sobre con una CMK compartida solo para envolver** (no para firmar): reduciría el
  costo fijo, pero exige reconstruir la clave privada real de cada tenant en memoria de la
  aplicación en cada operación de firma — exactamente lo que ADR-0003 y `docs/sdd/factuya-sdd.md`
  §9 querían evitar (la clave privada nunca debe existir fuera de KMS/CloudHSM). Se descarta por
  ese motivo, no por costo.

Ninguna alternativa evita el costo de tener N identidades criptográficas distintas cuando se
necesitan N identidades criptográficas distintas — es una propiedad inherente del problema, no
una limitación de una herramienta específica.

## Decisión

- **Una CMK asimétrica (`RSA_2048`, `SIGN_VERIFY`) por tenant**, no una CMK compartida. Cada
  tenant que se da de alta recibe su propia CMK real en KMS.
- `KmsSigner` no cambia su forma de firmar (`Sign`, `RSASSA_PKCS1_V1_5_SHA_256`, `MessageType:
  RAW`) — lo que cambia es que `keyId` ahora identifica la CMK **de ese tenant específico**, no
  una CMK de ambiente compartida.
- El mecanismo de Grants (`kms-grants.ts`, ADR-0003) deja de ser el mecanismo *primario* de
  aislamiento — con una CMK dedicada por tenant, el aislamiento ya lo da la CMK misma, y la
  política de la llave (`Key Policy`) creada junto con la CMK puede autorizar directamente al rol
  IAM del backend de Factuya sin necesitar un Grant adicional. El código de `kms-grants.ts` se
  conserva (sigue siendo código real, probado, y podría reutilizarse para un caso de delegación
  puntual más adelante), pero no es parte obligatoria del flujo de alta de un tenant nuevo.
- Ver ADR-0006 para cómo se provee la clave privada real de cada CMK (el tenant trae su propio
  certificado/clave, importada a su CMK dedicada vía `ImportKeyMaterial`).

## Fuentes verificadas (2026-08-03)

- [Simplify multi-tenant encryption with a cost-conscious AWS KMS key strategy](https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/) —
  releído completo (no solo el resumen de búsqueda usado para ADR-0003): confirma que el modelo
  recomendado es una CMK por tenant, no una CMK compartida.
- [Cloud Payment HSM – AWS Payment Cryptography Pricing](https://aws.amazon.com/payment-cryptography/pricing/) —
  `$1.00` por llave activa/mes, `$2.00`/10.000 llamadas (primeros 20M/mes), `$0.75`/10.000 después.
- [AWS CloudHSM Pricing](https://aws.amazon.com/cloudhsm/pricing/) — `$1.60`/hora por instancia de HSM.
- [AWS KMS now supports importing asymmetric and HMAC keys](https://aws.amazon.com/about-aws/whats-new/2023/06/aws-kms-importing-asymmetric-hmac-keys) —
  confirma que `ImportKeyMaterial` soporta llaves RSA de firma desde junio 2023 (relevante para
  ADR-0006).

## Consecuencias

- El costo de KMS vuelve a escalar linealmente con el número de tenants (~`$1`-`$3`/mes cada uno,
  según la propia fuente citada, considerando rotación) — ya evaluado en conversación con el
  usuario como aceptable incluso a cientos de tenants (`$500`/mes a 500 tenants es una cifra
  pequeña frente al resto de la operación, y mucho menor que lo que cobraría un OSE).
- Se gana lo que ADR-0003 no podía dar: cada tenant tiene una identidad criptográfica real y
  distinta, cumpliendo el §13 del SDD sin ambigüedad.
- `TenantConfig.certificate.signerRef` (ver `packages/shared-types`) pasa a ser el `keyId`/ARN de
  la CMK dedicada de ese tenant, no una referencia a un Grant sobre una CMK compartida.
- Revocar el acceso de un tenant específico ahora es aún más directo que con Grants: deshabilitar
  o programar el borrado de **su propia CMK** (`DisableKey`/`ScheduleKeyDeletion`) revoca el
  acceso y, a diferencia de revocar un Grant sobre una llave compartida, hace además imposible
  que esa identidad vuelva a firmar nunca más — propiedad más fuerte, no más débil, que la que
  ofrecía ADR-0003.
- **No implementado con una cuenta de AWS real todavía** al momento de escribir este ADR — ver
  ADR-0006 y `docs/aws/` para el estado de verificación en vivo de la creación de CMK por tenant
  y el import de clave.
