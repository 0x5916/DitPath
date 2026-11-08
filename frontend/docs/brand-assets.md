# DitPath brand assets

The approved DitPath brand illustration is a dual-paddle telegraph key. The
design package supplies `ditpath-full.svg` and `ditpath-small.svg`; byte-identical
build copies are kept in [src/lib/assets](../src/lib/assets) so the frontend
Docker build context is self-contained. The source hashes are asserted in
[pwa.test.ts](../src/lib/pwa.test.ts).

## Source artwork

| Source                                                                   | SHA-256                                                            | Use                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| [ditpath-icon-material.svg](../src/lib/assets/ditpath-icon-material.svg) | `2e0463d3a494d66acb7eaae61dd7603d9bc10e99be3ac97df8f57ce0bc58860f` | Full-detail artwork for app icons, Apple touch, social |
| [ditpath-icon-small.svg](../src/lib/assets/ditpath-icon-small.svg)       | `4933a84ff85587c71d2ae5a6cc6b0bd2676eecbf624c3ad2a558f0616576e434` | Small-size colour favicons                             |

Do not redesign the key or edit the generated PNG/ICO assets by hand. Change the
approved source SVG, then run:

```sh
cd frontend
npm run icons
```

`npm run icons` is a maintainer command; normal verification and builds consume
the committed outputs.

## Approved usage

| Surface                                  | Artwork                                            | Background                       |
| ---------------------------------------- | -------------------------------------------------- | -------------------------------- |
| `icon-192.png`, `icon-512.png`           | Full-detail at 75% visible width, centered         | Opaque warm paper `#F3F2ED`      |
| `apple-touch-icon.png` (180)             | Full-detail at 75% visible width, centered         | Opaque warm paper                |
| `favicon.svg`                            | Small-size colour artwork                          | Transparent, unlinked source     |
| `favicon.ico`, `favicon-16/32/48/64.png` | Small-size colour artwork with a 0.75 px paper rim | Transparent                      |
| `og-image.png` (1200×630)                | Full-detail                                        | Warm paper with DitPath wordmark |

The full artwork content occupies roughly 371×342 px in the 512 viewBox. App
icons crop to those visible bounds, scale the content to 75% of the tile width,
and center it. This replaces the previous full-canvas margins and makes the key
larger in the Dock.

The manifest publishes only `any` icons. Chrome selects a maskable icon for the
installed app icon when one is available, which reduced the visible key to the
safe-area scale (63.9% width). Removing the maskable entries lets the installed
icon use the full 75% composition. Android falls back to the same 75% any icon;
its launcher mask may crop the outer paddle edges under aggressive masks.

The small artwork supplies its own tight optical crop, so the generator preserves
its `64 64 416 416` viewBox. Favicon PNGs are rendered at 4× with a 0.75 px
warm-paper rim around the outer silhouette, then downsampled. The rim keeps the
dark artwork separated from dark browser chrome without an opaque paper tile. It
is effectively invisible on the light paper theme.

`favicon.svg` remains a transparent source artifact but is intentionally not
linked from the document head. Linking it would let browsers choose an unrimmed
SVG and bypass the rimmed PNG/ICO set. The 16 px PNG is still the densest use and
remains the least detailed; browsers use the larger favicon files when the tab
size allows. The navigation bar is text-only.

## Generated outputs

The icon generator writes:

- `static/favicon.svg` (transparent source; not linked)
- `static/favicon.ico`, `static/favicon-16/32/48/64.png` (colour artwork with paper rim)
- `static/apple-touch-icon.png`
- `static/icon-192.png`, `static/icon-512.png`
- `static/og-image.png` (1200×630)
- `static/manifest.webmanifest`

`favicon.ico` contains the 16, 32, and 48 px colour entries; the 64 px PNG remains
available to browsers that request it.

## PWA and accessibility

The manifest uses the public name **DitPath**, `display: standalone`, a `/`
start URL and scope, warm-paper background, and a dark theme colour. The existing
service worker remains responsible for offline shells; its `morsestep-cache-`
prefix and all IndexedDB/localStorage identifiers are intentionally unchanged so
existing users keep their progress and settings.

The icon assets are decorative. The header link is named by the visible DitPath
wordmark, and the social image alt text is supplied from
[seo.ts](../src/lib/seo.ts).
