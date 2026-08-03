# Verificación en vivo de KmsSigner contra AWS real

`KmsSigner` (`packages/signing/src/kms-signer.ts`) y el módulo de Grants (`kms-grants.ts`) están
implementados y verificados contra la documentación/tipos oficiales de `@aws-sdk/client-kms` (ver
ADR-0003 y `.claude/skills/deps-aws-sdk-client-kms.md`), pero — a diferencia del adaptador SUNAT,
que sí corrió contra el servicio real de SUNAT beta — nunca se ejecutaron contra una cuenta de AWS
real. Esta guía documenta, paso a paso y sin valores de ninguna cuenta específica, cómo cerrar esa
brecha. Sigue el mismo principio de `docs/sdd/factuya-sdd.md` §16: nada se da por probado sin una
corrida real.

**No sube nada específico de tu cuenta a este documento.** Los valores reales (ID de cuenta, ARNs,
nombre de perfil) van en `docs/aws/kms-live-verification.private.md`, que está en `.gitignore` a
propósito — nunca se commitea.

## Antes de empezar

- Usa una **cuenta de AWS separada de prueba/desarrollo si es posible**, o al menos un usuario IAM
  dedicado, nunca la cuenta root ni un usuario ya usado para otra cosa.
- El costo de esta verificación es de centavos, no de dólares: una CMK cuesta $1/mes prorrateado
  por hora (ver la discusión de costos ya documentada en esta conversación/ADR-0003) — crearla,
  usarla unos minutos, y programar su borrado cuesta una fracción de centavo. Aun así, es un cargo
  real en una cuenta real.
- Si esta máquina tiene configurados perfiles de AWS de **otras cuentas u otros clientes** (revisa
  con `aws configure list-profiles`), ten cuidado de no mezclar contextos — todos los comandos de
  esta guía especifican `--profile` explícitamente por esa razón, nunca dependen del perfil
  `default` implícito.

## Paso 1 — Crear un usuario IAM dedicado, solo acceso programático

El asistente de creación de usuario de la consola de AWS tiene tres pantallas propias
("Especificar los detalles de la persona" / "Establecer permisos" / "Revisar y crear") — esta
sección sigue esas tres pantallas en orden, con lo que hay que hacer en cada una.

### 1a. IAM → Users → Create user — pantalla "Especificar los detalles de la persona"

- Nombre de usuario: `factuya-dev` (nombrado por *ambiente*, no "test" — coherente con ADR-0003,
  que ya piensa en una CMK compartida por ambiente: dev, staging, producción).
- **Dejar sin marcar** "Proporcione acceso de usuario a la consola de administración de AWS" —
  este usuario solo necesita acceso programático (CLI/SDK), nunca va a iniciar sesión en la
  consola web.
- Clic en "Siguiente".

### 1b. Pantalla "Establecer permisos" — crear la policy (todavía no existe en tu cuenta)

Esta cuenta ya trae más de mil policies administradas por AWS para todo tipo de servicios —
**buscar "Kms" en ese listado no sirve**, va a aparecer algo como `ROSAKMSProviderPolicy` (una
policy de AWS para un producto completamente distinto — Red Hat OpenShift/ROSA, con una condición
que exige un tag `red-hat: true` que nuestros recursos nunca van a tener). Hay que **crear una
policy propia**, nueva, no buscar una existente:

1. Con "Attach policies directly" seleccionado, clic en **"Crear política"** — abre una pestaña
   nueva.
2. En esa pestaña, cambiar a la sub-pestaña **JSON** del editor.
3. Borrar el contenido de ejemplo y pegar exactamente esto (las acciones que `KmsSigner`/
   `kms-grants.ts` necesitan, ni una más):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FactuyaDevKmsSigner",
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:DescribeKey",
        "kms:GetPublicKey",
        "kms:CreateGrant",
        "kms:RetireGrant",
        "kms:RevokeGrant",
        "kms:ListGrants",
        "kms:Sign",
        "kms:ScheduleKeyDeletion",
        "kms:TagResource",
        "kms:CreateAlias",
        "kms:DeleteAlias"
      ],
      "Resource": "*"
    }
  ]
}
```

4. "Siguiente" → en la pantalla de revisión ("Revisar y crear"), completar:
   - **Nombre de la política**: `FactuyaDevKmsSignerPolicy`. Si la consola rechaza el nombre con
     "Los caracteres no son válidos" aunque se vea correcto, es casi siempre un carácter
     invisible pegado del copiar/pegar (espacio al final, comilla inteligente, etc.) — borrar el
     campo entero y escribir el nombre a mano en vez de pegarlo.
   - **Descripción** (opcional, pero déjala — explica el propósito sin depender de que alguien
     recuerde esta conversación):
     ```
     Permisos mínimos para que Factuya (packages/signing/KmsSigner) firme documentos vía AWS KMS,
     usando una CMK asimétrica compartida por ambiente con aislamiento por tenant vía Grants en vez
     de una CMK por tenant (ver ADR-0003 del repo). Incluye: crear/describir la CMK, crear y revocar
     Grants Sign-only por tenant, firmar, obtener la llave pública, y programar el borrado de la CMK.
     Uso: verificación en vivo de KmsSigner en ambiente dev (docs/aws/kms-live-verification.md).
     ```
   - Antes de crear, confirmar que "Permisos definidos en esta política" muestra **KMS — Limitado:
     Enumerar, Administración de permisos, Leer, Escribir, Etiquetado — Todos los recursos** (así
     es como la consola resume las 12 acciones del JSON pegado en el paso 3 — si dice otro
     servicio o "Acceso completo", revisar que el JSON se haya pegado bien).
   - Clic en "Crear política". Queda guardada como policy "administrada por el cliente" de esta
     cuenta, no una de AWS.
5. Volver a la pestaña del asistente de creación de usuario (si se cerró, entrar de nuevo por
   IAM → Users → `factuya-dev` → Add permissions → Attach policies directly).
6. En el buscador de políticas, esta vez buscar `FactuyaDevKmsSignerPolicy` (el nombre exacto, no
   "Kms") — debería aparecer bajo "Administrada por el cliente". Marcarla y continuar.

### 1c. Pantalla "Revisar y crear" → generar las access keys

Revisar que el usuario sea `factuya-dev`, sin acceso a consola, con `FactuyaDevKmsSignerPolicy`
adjunta → "Crear persona".

Entrar al usuario creado → pestaña **Security credentials** → **Create access key** →
**"Command Line Interface (CLI)"** → confirmar → copiar el Access Key ID y el Secret Access Key.
**No pegar estos valores en ningún archivo del repo ni en ninguna conversación con un asistente.**

## Paso 2 — Configurar las credenciales localmente

En tu propia terminal (no dentro de una sesión de asistente que registre lo que escribes):

```bash
aws configure --profile factuya-dev
```

Pide Access Key ID, Secret Access Key, región (la región donde vive tu cuenta — verificar en la
consola, no asumir), y formato de salida (`json`).

## Paso 3 — Verificar la conexión

```bash
aws sts get-caller-identity --profile factuya-dev
```

Este comando **no expone ningún secreto** — solo confirma la cuenta/ARN del usuario. Anotar el
ARN devuelto (lo necesitarás en el paso 4 como variable de entorno) en tu copia privada de esta
guía, no aquí.

## Paso 4 — Correr el test de verificación en vivo

`packages/signing/test/integration/kms-live.integration.test.ts` hace, contra el servicio real,
exactamente lo que describe ADR-0003:

1. Crea una CMK asimétrica (`RSA_2048`, `KeyUsage: SIGN_VERIFY`).
2. Crea un Grant `Sign`-only (`kms-grants.ts::createTenantGrant`) usando tu propio ARN como
   `GranteePrincipal`/`RetiringPrincipal` (obtenido de `sts:GetCallerIdentity`, no hardcodeado).
3. Firma un mensaje de prueba con `KmsSigner`, usando ese Grant.
4. Obtiene la llave pública real (`GetPublicKey`) y verifica la firma con `crypto.verify()` de
   Node — confirma que KMS produjo una firma RSA-SHA256/PKCS1v1.5 válida, no solo que la llamada
   no lanzó error.
5. Limpia: retira el Grant y programa el borrado de la CMK (`ScheduleKeyDeletion`, ventana mínima
   de 7 días — sin costo durante esa espera, ver ADR-0003).

Por seguridad (esta máquina puede tener perfiles de **otras cuentas** configurados), el test tiene
**tres gates explícitos** y nunca corre por accidente ni usa el perfil `default` implícito:

```bash
FACTUYA_KMS_LIVE_TEST=1 \
AWS_PROFILE=factuya-dev \
FACTUYA_KMS_LIVE_TEST_PRINCIPAL_ARN="<el ARN del paso 3>" \
bun test packages/signing/test/integration/kms-live.integration.test.ts
```

`FACTUYA_KMS_LIVE_TEST_PRINCIPAL_ARN` es el ARN que devolvió `sts get-caller-identity` en el paso
3 — se usa como `GranteePrincipal`/`RetiringPrincipal` del Grant de prueba (ver ADR-0003). Se pide
como variable en vez de que el test lo resuelva solo, para no agregar `@aws-sdk/client-sts` como
dependencia nueva únicamente para esto.

Sin los tres valores, el test se omite con un mensaje claro — mismo patrón honesto que
`sunat-beta.integration.test.ts` (se omite explícitamente en vez de fallar confuso o fingir que
pasó).

## Paso 5 — Registrar el resultado

Si el test pasa: actualizar `packages/signing/README.md`, `docs/flows.md` y el SDD (§17) para que
dejen de decir "pendiente de verificación en vivo" — con la fecha real de la corrida, igual que se
hizo para el adaptador SUNAT en `docs/adapters/pe-sunat.md`.

Si algo falla: **no es necesariamente un bug** de `KmsSigner` — puede ser un permiso faltante en la
policy de arriba, o un detalle real de la API que la documentación no dejó claro. Documentar el
hallazgo real (igual que se hizo con el 401 intermitente de SUNAT beta) antes de "arreglarlo" a
ciegas.
