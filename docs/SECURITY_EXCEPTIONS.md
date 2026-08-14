# Excepciones de seguridad

Las excepciones de este documento son temporales, explícitas y ejecutables. No reducen el umbral general de seguridad de EAUTO-AI: cualquier vulnerability/advisory distinta de las enumeradas aquí debe hacer fallar CI.

## EAUTO-SEC-2026-08-IMAGE-SIZE

**Estado:** activa y temporal  
**Registrada:** 14 de agosto de 2026  
**Expira:** 14 de septiembre de 2026 a las 23:59:59 UTC  
**Paquete:** `image-size@1.2.1`  
**Relación:** dependencia transitiva actual a través de Metro; no se autoriza como dependencia directa  
**Severidad upstream:** high

### Advisories permitidas

- `GHSA-w3rx-r6r6-pgpr` — ICNS parser puede entrar en un loop infinito ante una entrada especialmente construida.
- `GHSA-5p2g-fcmc-qvqq` — JXL/HEIF parsers pueden entrar en loops infinitos ante cajas especialmente construidas.

Al registrar esta excepción, GitHub Advisory Database no declara una `first_patched_version` para `image-size` en ninguna de estas dos advisories. Por lo tanto, esta excepción no sustituye una actualización disponible: mantiene el gate cerrado para todo lo demás mientras upstream no ofrece un parche consumible por el árbol actual.

### Controles compensatorios

`npm run audit:ci` ejecuta `npm audit --json` y falla salvo que se cumplan **todas** estas condiciones:

1. todas las entradas del grafo de vulnerabilidades derivan exclusivamente de las dos advisories anteriores;
2. la única raíz permitida es `image-size`;
3. la versión observada sigue siendo exactamente `1.2.1`;
4. `image-size` permanece indirecta y en `node_modules/image-size`;
5. el conjunto exacto de advisories no cambia;
6. la excepción no ha superado su fecha de expiración.

Cualquier advisory nueva, cambio de versión, cambio de scope, dependencia directa o expiración convierte el gate en fallo. No se utiliza `--audit-level` para esconder findings y no se acepta `npm audit fix --force` cuando implica degradar el stack móvil para aparentar un verde.

### Alcance

La excepción aplica únicamente al camino transitivo observado en el lockfile y en la salida actual de `npm audit`. No concede permiso para consumir `image-size` directamente ni para procesar input no confiable con ese paquete desde código de aplicación.

### Cierre

La excepción debe eliminarse tan pronto como ocurra cualquiera de estos eventos:

- exista una versión parcheada compatible;
- Expo/Metro deje de depender del paquete vulnerable;
- el árbol de dependencias cambie de forma material;
- llegue la fecha de expiración.

El cierre requiere refrescar el lockfile, ejecutar `npm run audit:ci`, verificar CI exact-head y eliminar la lógica de excepción si ya no es necesaria.
