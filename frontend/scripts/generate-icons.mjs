// Generates the approved DitPath app-icon, favicon, PWA, Apple touch, and social-card assets.
//
// Authoritative artwork:
//   src/lib/assets/ditpath-icon-material.svg  (full-detail brand illustration)
//   src/lib/assets/ditpath-icon-small.svg     (flat small-size brand illustration)
//
// Approved usage:
//   - full-detail artwork cropped to its visible bounds, scaled to 75% of the
//     tile width, and centered on warm paper: 192/512 app icons and Apple touch;
//   - the same composition at 85% scale: maskable icons;
//   - full-detail artwork on warm paper: the 1200x630 social card;
//   - small-size colour artwork with a 0.75px warm-paper rim on a transparent
//     background: favicon PNGs and ICO.
//
// The navigation bar is text-only. Maskable artwork is scaled to 85% so the lever
// tips remain inside the 40% safe radius. The small artwork already uses its own
// tight optical crop, so its supplied viewBox is preserved. favicon.svg is a
// transparent source artifact and is intentionally not linked; the linked PNG/ICO
// set carries the paper rim so the dark artwork stays legible on dark browser chrome.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src/lib/assets');
const outDir = path.join(root, 'static');
const materialSource = path.join(sourceDir, 'ditpath-icon-material.svg');
const smallSource = path.join(sourceDir, 'ditpath-icon-small.svg');

// Mirrors the light-theme paper and ink tokens in src/app.css.
const PAPER = '#F3F2ED';
const INK = '#252620';
const MUTED = '#4F5147';
const FOREST = '#2F6B50';
const PAPER_RGB = { r: 0xf3, g: 0xf2, b: 0xed };

// The small artwork's supplied viewBox is its optical crop. The favicon rim is
// generated at 4x and downsampled, keeping its thickness near 0.75 CSS px.
const RIM_SCALE = 4;
const RIM_PX = 0.75;

// App icons crop the full artwork to its visible bounds, scale that content to
// 75% of the tile width, and center it on the paper canvas. Maskable icons use
// the same composition at 85% scale to preserve the 40% safe radius.
const MATERIAL_RENDER_SIZE = 1024;
const MATERIAL_ALPHA_THRESHOLD = 32;
const APP_ICON_VISIBLE_WIDTH = 0.75;
const MASKABLE_SCALE = 0.85;

function minifySvg(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/<title[\s\S]*?<\/title>\s*/i, '')
    .replace(/<desc[\s\S]*?<\/desc>\s*/i, '')
    .replace(/\s(?:role|aria-labelledby)="[^"]*"/gi, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function deriveSmallArtwork(smallSourceText) {
  return minifySvg(smallSourceText.replace(/<\?xml[^>]*\?>\s*/i, ''));
}

function buildIco(entries) {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize + entrySize * entries.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4); // image count

  let offset = headerSize + entrySize * entries.length;
  entries.forEach(({ size, data }, i) => {
    const base = headerSize + entrySize * i;
    const dim = size >= 256 ? 0 : size; // 0 means 256 in ICO
    header.writeUInt8(dim, base); // width
    header.writeUInt8(dim, base + 1); // height
    header.writeUInt8(0, base + 2); // colour count
    header.writeUInt8(0, base + 3); // reserved
    header.writeUInt16LE(1, base + 4); // planes
    header.writeUInt16LE(32, base + 6); // bit count
    header.writeUInt32LE(data.length, base + 8); // bytes in resource
    header.writeUInt32LE(offset, base + 12); // image offset
    offset += data.length;
  });

  return Buffer.concat([header, ...entries.map((entry) => entry.data)]);
}

function paperCanvas(width, height = width) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: PAPER
    }
  });
}

async function measureMaterialBounds() {
  const { data, info } = await sharp(materialSource)
    .resize(MATERIAL_RENDER_SIZE, MATERIAL_RENDER_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > MATERIAL_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

async function renderAppIcon(size, bounds) {
  const trimmed = await sharp(materialSource)
    .resize(MATERIAL_RENDER_SIZE, MATERIAL_RENDER_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .ensureAlpha()
    .extract(bounds)
    .png()
    .toBuffer();

  const targetWidth = Math.round(size * APP_ICON_VISIBLE_WIDTH);
  const targetHeight = Math.round((bounds.height / bounds.width) * targetWidth);
  const art = await sharp(trimmed)
    .resize(targetWidth, targetHeight, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const left = Math.round((size - targetWidth) / 2);
  const top = Math.round((size - targetHeight) / 2);

  return paperCanvas(size)
    .composite([{ input: art, left, top }])
    .flatten({ background: PAPER })
    .removeAlpha()
    .png()
    .toBuffer();
}

async function renderMaskableIcon(size, bounds) {
  const base = await renderAppIcon(size, bounds);
  const artSize = Math.round(size * MASKABLE_SCALE);
  const art = await sharp(base).resize(artSize, artSize, { kernel: 'lanczos3' }).png().toBuffer();
  const left = Math.round((size - artSize) / 2);
  const top = Math.round((size - artSize) / 2);

  return paperCanvas(size)
    .composite([{ input: art, left, top }])
    .flatten({ background: PAPER })
    .removeAlpha()
    .png()
    .toBuffer();
}

function dilate(mask, width, height, radius) {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          output[ny * width + nx] = 1;
        }
      }
    }
  }
  return output;
}

async function renderFavicon(size) {
  const base = size * RIM_SCALE;
  const art = await sharp(smallSource)
    .resize(base, base, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const coverage = new Uint8Array(base * base);
  for (let i = 0; i < base * base; i += 1) {
    if (art.data[i * 4 + 3] > 8) coverage[i] = 1;
  }
  const outlined = dilate(coverage, base, base, Math.max(1, Math.round(RIM_PX * RIM_SCALE)));

  const rgba = Buffer.alloc(base * base * 4);
  for (let i = 0; i < base * base; i += 1) {
    const alpha = art.data[i * 4 + 3] / 255;
    const inverse = 1 - alpha;
    rgba[i * 4] = Math.round(art.data[i * 4] * alpha + PAPER_RGB.r * inverse);
    rgba[i * 4 + 1] = Math.round(art.data[i * 4 + 1] * alpha + PAPER_RGB.g * inverse);
    rgba[i * 4 + 2] = Math.round(art.data[i * 4 + 2] * alpha + PAPER_RGB.b * inverse);
    rgba[i * 4 + 3] = outlined[i] ? 255 : 0;
  }

  return sharp(rgba, { raw: { width: base, height: base, channels: 4 } })
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

function socialCardText() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect x="560" y="180" width="56" height="4" rx="2" fill="${FOREST}"/>
  <text x="560" y="286" font-family="'Avenir Next', Avenir, 'Trebuchet MS', sans-serif" font-size="76" font-weight="700" letter-spacing="-2" fill="${INK}">DitPath</text>
  <text x="560" y="354" font-family="'Avenir Next', Avenir, 'Trebuchet MS', sans-serif" font-size="38" font-weight="500" fill="${INK}">Learn Morse by ear.</text>
  <text x="560" y="414" font-family="'Avenir Next', Avenir, 'Trebuchet MS', sans-serif" font-size="24" fill="${MUTED}">Guided Koch lessons, free practice,</text>
  <text x="560" y="448" font-family="'Avenir Next', Avenir, 'Trebuchet MS', sans-serif" font-size="24" fill="${MUTED}">and clear progress.</text>
  <text x="560" y="526" font-family="'Avenir Next', Avenir, 'Trebuchet MS', sans-serif" font-size="20" font-weight="600" letter-spacing="1.5" fill="${FOREST}">FREE · NO ACCOUNT NEEDED TO START</text>
</svg>`);
}

async function generate() {
  const smallSourceText = await readFile(smallSource, 'utf8');

  await mkdir(outDir, { recursive: true });

  const faviconSvg = deriveSmallArtwork(smallSourceText);

  await writeFile(path.join(outDir, 'favicon.svg'), faviconSvg);
  console.log('wrote static/favicon.svg');

  const faviconSizes = [16, 32, 48, 64];
  const faviconPngs = [];
  for (const size of faviconSizes) {
    const png = await renderFavicon(size);
    faviconPngs.push({ size, data: png });
    await writeFile(path.join(outDir, `favicon-${size}.png`), png);
    console.log(`wrote static/favicon-${size}.png`);
  }

  const icoFile = path.join(outDir, 'favicon.ico');
  await writeFile(icoFile, buildIco(faviconPngs.filter(({ size }) => size <= 48)));
  console.log('wrote static/favicon.ico');

  const materialBounds = await measureMaterialBounds();

  const apple = await renderAppIcon(180, materialBounds);
  await writeFile(path.join(outDir, 'apple-touch-icon.png'), apple);
  console.log('wrote static/apple-touch-icon.png');

  await writeFile(path.join(outDir, 'icon-512.png'), await renderAppIcon(512, materialBounds));
  await writeFile(path.join(outDir, 'icon-192.png'), await renderAppIcon(192, materialBounds));
  console.log('wrote static/icon-192.png');
  console.log('wrote static/icon-512.png');

  await writeFile(
    path.join(outDir, 'icon-maskable-512.png'),
    await renderMaskableIcon(512, materialBounds)
  );
  await writeFile(
    path.join(outDir, 'icon-maskable-192.png'),
    await renderMaskableIcon(192, materialBounds)
  );
  console.log('wrote static/icon-maskable-192.png');
  console.log('wrote static/icon-maskable-512.png');

  const socialBase = await paperCanvas(1200, 630).png().toBuffer();
  const socialIcon = await sharp(materialSource).resize(420, 420).png().toBuffer();
  const social = await sharp(socialBase)
    .composite([
      { input: socialIcon, left: 80, top: 105 },
      { input: socialCardText(), left: 0, top: 0 }
    ])
    .flatten({ background: PAPER })
    .removeAlpha()
    .png()
    .toFile(path.join(outDir, 'og-image.png'));
  console.log(`wrote static/og-image.png (${social.width}x${social.height})`);

  const manifest = {
    name: 'DitPath',
    short_name: 'DitPath',
    description: 'Learn Morse by ear with guided Koch lessons, free practice, and clear progress.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: PAPER,
    theme_color: '#191917',
    categories: ['education'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  };
  await writeFile(
    path.join(outDir, 'manifest.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  console.log('wrote static/manifest.webmanifest');
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
