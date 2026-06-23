# Tranqui — navegá sin avenidas

App de navegación GPS (PWA) tipo Waze/Google Maps, pero con una vuelta de tuerca:
**la opción de evitar avenidas** y rutear por calles internas más tranquilas.

Hecha para instalarse directo en el celular desde el navegador — sin App Store.

## Qué hace
- 🗺️ Mapa en vivo (MapLibre + OpenFreeMap, tiles gratis sin límite).
- 📍 Tu ubicación en tiempo real con rumbo.
- 🔎 Buscador de destinos (OpenStreetMap / Nominatim).
- 🧭 Navegación paso a paso con **voz en español**.
- 🚫 **Evitar avenidas** con 3 niveles de intensidad (suave / medio / fuerte).
- 📊 Te dice qué % de la ruta va por avenidas.
- 🌙 Modo noche, pantalla siempre encendida mientras navegás, recálculo si te salís de la ruta.

## Servicios que usa (todos gratis)
| Función | Servicio | Key |
|---|---|---|
| Mapa | OpenFreeMap | no |
| Búsqueda | Nominatim (OSM) | no |
| Ruteo normal | OSRM demo | no |
| **Evitar avenidas** | GraphHopper (custom model) | **sí, gratis** |

> Sin key de GraphHopper la app funciona igual y rutea, pero "evitar avenidas"
> necesita GraphHopper porque es el único motor gratis que permite penalizar
> avenidas (`road_class == PRIMARY/SECONDARY/TRUNK`).

## Conseguir la API key gratis de GraphHopper (2 min)
1. Creá cuenta en https://www.graphhopper.com/dashboard/#/register
2. Entrá a **API Keys** → copiá la key.
3. En la app: **⚙ Ajustes** → pegá la key → **Guardar**.

Plan gratis: ~500 rutas por día. De sobra para uso personal.

## Cómo instalarla en el iPhone
1. Abrí la URL pública en **Safari**.
2. Tocá **Compartir** (el cuadrito con la flecha) → **Agregar a inicio**.
3. Listo: queda como app con ícono, a pantalla completa.

> En Android es igual desde Chrome (te aparece "Instalar app").

## Correr en local
Es estática, no necesita build:
```bash
cd ~/maps-sin-avenidas
python3 -m http.server 8080
# abrí http://localhost:8080
```

## Estructura
```
index.html              # shell
css/style.css           # UI
js/app.js               # mapa + GPS + ruteo + navegación + voz
manifest.webmanifest    # PWA
sw.js                   # service worker (shell offline)
vendor/                 # MapLibre GL (local)
icons/                  # íconos + generador Pillow
```

## Roadmap (fase 2)
- App nativa iOS con **CarPlay** (requiere cuenta Apple Developer + entitlement
  `com.apple.developer.carplay-maps`, aprobado por Apple).
- Tráfico en tiempo real (fuente paga: TomTom/HERE/Mapbox).
- Caché de tiles offline por zona.
