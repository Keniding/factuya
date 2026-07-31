# 01 — Instalación y procedencia

## Instalación (Bun, no npm/yarn en este monorepo)

```bash
bun add xml-crypto
```

Verificado en este entorno el 2026-07-31 con `bun 1.3.11`:

```
bun add v1.3.11
Resolving dependencies
Resolved, downloaded and extracted [16]
Saved lockfile
installed xml-crypto@6.1.2
```

Versión resuelta: **6.1.2**. No se fijó de memoria — es la que Bun resolvió como última versión
publicada al momento de instalar. Volver a correr `bun info xml-crypto` antes de asumir que sigue
siendo la vigente si pasa mucho tiempo entre esta investigación y la implementación real.

## Verificación de publicador (obligatoria antes de confiar en el paquete)

Del `package.json` real instalado (`node_modules/xml-crypto/package.json`):

```json
{
  "name": "xml-crypto",
  "version": "6.1.2",
  "repository": { "type": "git", "url": "https://github.com/node-saml/xml-crypto.git" },
  "license": "MIT",
  "engines": { "node": ">=16" }
}
```

- Repositorio: `node-saml/xml-crypto` en GitHub — `node-saml` es una organización establecida en el
  espacio de librerías SAML/XML de Node.js (mantiene también `node-saml/node-saml`, usada por
  Passport.js y otros). No es una cuenta personal aislada ni un fork reciente sin historial.
  el nombre del paquete (`xml-crypto`, sin scope) coincide con el nombre "canónico" que usa la
  comunidad — no es un paquete con nombre parecido tipo `xml-crypto-js` o `@random/xml-crypto`.
- Dependientes: ~501 proyectos en el registro de npm lo declaran como dependencia (dato obtenido
  en la búsqueda previa a la instalación) — señal de adopción real, no un paquete recién publicado
  con pocos usuarios.
- Licencia MIT, sin restricciones para uso comercial.
- **Alerta detectada durante la investigación**: existen paquetes scoped casi idénticos en npm
  (`@subu1979/xml-crypto`, forks personales) con mucha menos adopción. **No usar esos** — el
  paquete correcto para Factuya es `xml-crypto` a secas, de `node-saml`.

## Dependencias que trae xml-crypto (relevantes para auditoría de superficie)

De su `package.json`:

```json
"dependencies": {
  "@xmldom/is-dom-node": "^1.0.1",
  "@xmldom/xmldom": "^0.8.10",
  "xpath": "^0.0.33"
}
```

`@xmldom/xmldom` es el parser XML que usa internamente (org `@xmldom`, también legítima/activa,
sucesora del antiguo paquete `xmldom` que fue deprecado por vulnerabilidades — vale la pena tenerlo
en cuenta si en algún momento se audita indirectamente esta dependencia transitiva).

## Runtime objetivo

`engines.node >= 16` — compatible con el runtime Node.js LTS oficial de Lambda que usa Factuya
para producción (ver `docs/sdd/factuya-sdd.md` §11; Bun es solo la herramienta de desarrollo/build,
no el runtime de despliegue). No se detectó ninguna dependencia de APIs específicas de Node que no
estén disponibles también bajo Bun para desarrollo/test local.
