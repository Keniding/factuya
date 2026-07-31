# 05 — Known issues, CVEs y alternativas descartadas

## CVEs conocidas (verificadas 2026-07-31, no de memoria)

| CVE | Descripción | Versiones afectadas | ¿Afecta a la versión pinneada (6.1.2)? |
|---|---|---|---|
| [CVE-2025-29775](https://github.com/advisories/GHSA-x3m8-899r-f7c3) | Bypass de verificación de firma XML vía comentarios dentro de `DigestValue` — un atacante puede alterar contenido firmado y seguir pasando la verificación | `< 2.1.6`, `>= 3.0.0 < 3.2.1`, `>= 4.0.0 < 6.0.1` | **No** — parchada desde 6.0.1, la versión pinneada es 6.1.2 |
| [CVE-2025-29774](https://advisories.gitlab.com/pkg/npm/xml-crypto/CVE-2025-29774) | Bypass de autenticación/autorización relacionado con verificación de firma | `< 6.0.1`, `< 3.2.1`, `< 2.1.6` | **No** — mismo corte que la anterior |
| [CVE-2024-32962](https://security.snyk.io/vuln/SNYK-JS-XMLCRYPTO-6751737) | Verificación incorrecta por defecto: valida validez de la firma pero no autorización del firmante | Versiones previas al fix | Relevante como *práctica de uso*, no solo de versión — ver nota abajo |

**Nota de uso, no solo de versión**: el hallazgo de CVE-2024-32962 (validar la firma pero no quién
firmó) es un recordatorio de que `xml-crypto` verifica que una firma sea *criptográficamente
válida*, no que el firmante sea *quien Factuya espera* — si en algún punto Factuya usa
`checkSignature()` para validar un CDR o una respuesta firmada, el código debe además comparar
explícitamente el certificado/firmante contra el esperado (el certificado del tenant o el de
SUNAT/OSE), no confiar solo en `checkSignature() === true`.

## Deprecación activa en el propio README (relevante si se usa verificación)

El README oficial marca como deprecado el acceso a `.getReferences()` y `.references`, con esta
advertencia textual del proyecto:

> The content in them should be treated as unsigned. [...] migrate to the `.getSignedReferences()`
> API. [...] This will help prevent future XML signature wrapping attacks.

Si `packages/signing` (o cualquier futura verificación de respuestas firmadas) usa `xml-crypto`
para *verificar* algo, debe usar `getSignedReferences()`, nunca `.references`/`.getReferences()`.

## Requisito de entorno mencionado en el README

> A pre requisite it to have openssl installed and its /bin to be on the system path.

Relevante para el runtime de Lambda: el runtime Node.js oficial de Lambda incluye OpenSSL vía el
módulo `crypto` nativo de Node, por lo que esto normalmente no es un problema en Lambda — pero si
se corre en un entorno de build/CI distinto (contenedor mínimo, etc.), verificar que OpenSSL esté
disponible antes de asumir que los tests de firma van a correr sin configuración extra.

## Alternativas evaluadas y descartadas (con motivo, para no re-evaluarlas sin razón)

- **`xmldsigjs`** (última versión detectada: 2.8.7): implementación de XMLDSig sobre Web Crypto
  API, pensada para funcionar igual en browser y Node. Se descartó para el MVP porque `xml-crypto`
  ya es la referencia de facto del ecosistema Node (501+ dependientes, org `node-saml` con
  trayectoria), y Factuya no necesita compatibilidad con browser en `packages/signing` (corre solo
  en Lambda). Si en el futuro se necesita firmar en el cliente/browser por algún motivo, reevaluar
  `xmldsigjs` con este mismo proceso.
- **Forks scoped de `xml-crypto`** (`@subu1979/xml-crypto` y similares): descartados por baja
  adopción y procedencia no verificable como mantenedor oficial — ver `01-installation-and-provenance.md`.
- **Reescribir el firmado a mano sobre el módulo `crypto` de Node**: descartado — reimplementar
  canonicalización XML exclusiva (`exclusive-c14n`) correctamente es no trivial y es exactamente el
  tipo de trabajo donde un error sutil (namespace mal canonicalizado) puede generar una firma que
  SUNAT rechaza silenciosamente. Usar una librería madura y auditada es más seguro que reescribirla
  (mismo principio que el SDD ya aplicaba para el mapeo UBL — ver §4 punto 5 y §8).
