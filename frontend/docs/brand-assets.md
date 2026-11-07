# DitPath brand assets

The approved DitPath icon is a dual-paddle telegraph key. The source artwork was
supplied as `ditpath-icon.svg` and `ditpath-icon-material.svg`; byte-identical
build copies are kept in [src/lib/assets](../src/lib/assets) so the frontend
Docker build context is self-contained. The source hashes are asserted in
[pwa.test.ts](../src/lib/pwa.test.ts).

## Source artwork

| Source                                                                   | SHA-256                                                            | Use                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| [ditpath-icon-flat.svg](../src/lib/assets/ditpath-icon-flat.svg)         | `c8c5dd54397fab2371e51facffdfac1fc07674b6c9feb222fccf81f2520059b9` | Crisp favicon silhouette and navbar alpha mask              |
| [ditpath-icon-material.svg](../src/lib/assets/ditpath-icon-material.svg) | `0ebb015764c6703538ac4b8fa0b346219ae1051d88b3b8db5ab953a6746f9022` | 192/512 app icons, maskable icons, Apple touch, social card |

Do not redesign the key or edit the generated PNG/ICO assets by hand. Change the
approved source SVG, then run:

```sh
cd frontend
npm run icons
```

`npm run icons` is a maintainer command; normal verification and builds consume
the committed outputs.

## Approved usage

| Surface                                                 | Artwork                                         | Background                                |
| ------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| `icon-192.png`, `icon-512.png`                          | Material                                        | Opaque warm paper `#F3F2ED`               |
| `icon-maskable-192.png`, `icon-maskable-512.png`        | Material at 85% scale                           | Opaque warm paper                         |
| `apple-touch-icon.png` (180)                            | Material                                        | Opaque warm paper                         |
| `favicon.svg`, `favicon.ico`, `favicon-16/32/48/64.png` | Flat monochrome key silhouette, tightly cropped | Opaque warm paper                         |
| Navbar `ditpath-mark.png`                               | Flat transparent alpha silhouette               | Rendered in the current `--accent` colour |
| `og-image.png` (1200×630)                               | Material                                        | Warm paper with DitPath wordmark          |

The maskable artwork is scaled to 85%, keeping its maximum content radius inside
the 40% maskable safe radius. The source content occupies roughly 371×337 px in
the 512 viewBox; its maximum content radius is about 231 px, so the native safe
limit would be 88.7% without additional padding.

The favicon crop removes the source's transparent margins but does not alter the
key geometry. The 16 px favicon intentionally uses the monochrome silhouette:
the full-colour artwork remains legible at 32 px and above, but collapses into a
dark/gold blob at 16 px.

## Generated outputs

The icon generator writes:

- `static/favicon.svg`, `static/favicon.ico`, `static/favicon-16/32/48/64.png`
- `static/apple-touch-icon.png`
- `static/icon-192.png`, `static/icon-512.png`
- `static/icon-maskable-192.png`, `static/icon-maskable-512.png`
- `static/og-image.png` (1200×630)
- `static/manifest.webmanifest`
- `src/lib/assets/ditpath-mark.png` (transparent navbar mask)

## PWA and accessibility

The manifest uses the public name **DitPath**, `display: standalone`, a `/`
start URL and scope, warm-paper background, and a dark theme colour. The existing
service worker remains responsible for offline shells; its `morsestep-cache-`
prefix and all IndexedDB/localStorage identifiers are intentionally unchanged so
existing users keep their progress and settings.

The icon assets are decorative. The header link is named by the visible DitPath
wordmark, and the social image alt text is supplied from
[seo.ts](../src/lib/seo.ts).
