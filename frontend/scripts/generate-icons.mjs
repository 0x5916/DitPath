// Generates the approved DitPath app-icon, favicon, PWA, Apple touch, and social-card assets.
//
// Authoritative artwork:
//   src/lib/assets/ditpath-icon-material.svg  (full-detail brand illustration)
//   src/lib/assets/ditpath-icon-small.svg     (flat small-size brand illustration)
//
// Approved usage:
//   - full-detail artwork + warm paper background: 192/512 app icons, maskable
//     icons, Apple touch icon, and the 1200x630 social card;
//   - small-size colour artwork on warm paper: favicon PNG/ICO/SVG;
//   - small-size artwork as a transparent alpha silhouette: navbar mark.
//
// Maskable artwork is scaled to 85% so the lever tips remain inside the 40% safe
// radius. The small artwork already uses its own tight optical crop, so its
// supplied viewBox is preserved.
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
const markPng = path.join(sourceDir, 'ditpath-mark.png');

// Mirrors the light-theme paper and ink tokens in src/app.css.
const PAPER = '#F3F2ED';
const INK = '#252620';
const MUTED = '#4F5147';
const FOREST = '#2F6B50';
const KEY = '#161C23';

// The small artwork's supplied viewBox is its optical crop. Preserve it and use
// the same rectangle for the paper tile behind the favicon.
const SMALL_VIEWBOX = { x: 64, y: 64, width: 416, height: 416 };
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

function deriveSmallArtwork(smallSourceText, { paper = false, color = null } = {}) {
  let svg = smallSourceText.replace(/<\?xml[^>]*\?>\s*/i, '');

  if (color) {
    svg = svg.replace(/(fill|stroke)="#[0-9a-fA-F]{6}"/g, `$1="${color}"`);
  }

  if (paper) {
    const { x, y, width, height } = SMALL_VIEWBOX;
    svg = svg.replace(
      /(<svg\b[^>]*>)/i,
      `$1<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${PAPER}"/>`
    );
  }

  return minifySvg(svg);
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

async function renderMaterialOnPaper(size, scale = 1) {
  const artSize = Math.round(size * scale);
  const art = await sharp(materialSource).resize(artSize, artSize).png().toBuffer();
  const left = Math.round((size - artSize) / 2);
  const top = Math.round((size - artSize) / 2);
  return paperCanvas(size)
    .composite([{ input: art, left, top }])
    .flatten({ background: PAPER })
    .removeAlpha()
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

  const faviconSvg = deriveSmallArtwork(smallSourceText, { paper: true });
  const markSvg = deriveSmallArtwork(smallSourceText, { color: KEY });
  const faviconSvgBuffer = Buffer.from(faviconSvg);

  await writeFile(path.join(outDir, 'favicon.svg'), faviconSvg);
  console.log('wrote static/favicon.svg');

  const faviconSizes = [16, 32, 48, 64];
  const faviconPngs = [];
  for (const size of faviconSizes) {
    const png = await sharp(faviconSvgBuffer)
      .resize(size, size)
      .flatten({ background: PAPER })
      .removeAlpha()
      .png()
      .toBuffer();
    faviconPngs.push({ size, data: png });
    await writeFile(path.join(outDir, `favicon-${size}.png`), png);
    console.log(`wrote static/favicon-${size}.png`);
  }

  const icoFile = path.join(outDir, 'favicon.ico');
  await writeFile(icoFile, buildIco(faviconPngs.filter(({ size }) => size <= 48)));
  console.log('wrote static/favicon.ico');

  const mark = await sharp(Buffer.from(markSvg)).resize(256, 256).png().toBuffer();
  await writeFile(markPng, mark);
  console.log('wrote src/lib/assets/ditpath-mark.png');

  const apple = await renderMaterialOnPaper(512);
  await sharp(apple)
    .resize(180, 180)
    .flatten({ background: PAPER })
    .removeAlpha()
    .png()
    .toFile(path.join(outDir, 'apple-touch-icon.png'));
  console.log('wrote static/apple-touch-icon.png');

  const icon512 = await renderMaterialOnPaper(512);
  const icon192 = await sharp(icon512).resize(192, 192).png().toBuffer();
  await writeFile(
    path.join(outDir, 'icon-512.png'),
    await sharp(icon512).flatten({ background: PAPER }).removeAlpha().png().toBuffer()
  );
  await writeFile(path.join(outDir, 'icon-192.png'), icon192);
  console.log('wrote static/icon-192.png');
  console.log('wrote static/icon-512.png');

  const maskable512 = await renderMaterialOnPaper(512, MASKABLE_SCALE);
  const maskable192 = await sharp(maskable512).resize(192, 192).png().toBuffer();
  await writeFile(
    path.join(outDir, 'icon-maskable-512.png'),
    await sharp(maskable512).flatten({ background: PAPER }).removeAlpha().png().toBuffer()
  );
  await writeFile(path.join(outDir, 'icon-maskable-192.png'), maskable192);
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
