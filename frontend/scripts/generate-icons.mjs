// Generates the favicon and social-image set from the original vector source.
// Artwork: src/lib/assets/favicon.svg (1024x1024, transparent dot/dash).
// Color: the default --accent token in src/app.css.
// Outputs into static/:
//   - favicon.ico (16/32/48 multi-size)   (legacy ICO favicon)
//   - favicon.svg                       (minified artwork with the brand color)
//   - apple-touch-icon.png (180x180)      (iOS home-screen / bookmark icon)
//   - og-image.png (512x512)              (default social card, see src/lib/seo.ts).
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src/lib/assets/favicon.svg');
const outDir = path.join(root, 'static');

/** Render the artwork at a given size. */
function render(artwork, size) {
  return sharp(artwork).resize(size, size).png().toBuffer();
}

/** Build a multi-size .ico from PNG buffers (PNG-in-ICO, supported on Vista+). */
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
    header.writeUInt8(0, base + 2); // color count
    header.writeUInt8(0, base + 3); // reserved
    header.writeUInt16LE(1, base + 4); // planes
    header.writeUInt16LE(32, base + 6); // bit count
    header.writeUInt32LE(data.length, base + 8); // bytes in resource
    header.writeUInt32LE(offset, base + 12); // image offset
    offset += data.length;
  });

  return Buffer.concat([header, ...entries.map((entry) => entry.data)]);
}

/** Minify the source SVG into a single line without the XML declaration. */
function minifySvg(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function generate() {
  const [svg, styles] = await Promise.all([
    readFile(source, 'utf8'),
    readFile(path.join(root, 'src/app.css'), 'utf8')
  ]);
  const defaultTokens = styles.match(/:root\s*\{([^}]+)\}/)?.[1];
  const accent = defaultTokens?.match(/--accent:\s*(#[\da-f]{6})\s*;/i)?.[1];
  if (!accent) throw new Error('Missing default --accent hex color in src/app.css');
  if (!svg.includes('currentColor')) throw new Error('Icon artwork must use currentColor');
  const coloredSvg = svg.replaceAll('currentColor', accent);
  const artwork = Buffer.from(coloredSvg);

  await mkdir(outDir, { recursive: true });

  // Default social card image (512x512).
  const ogFile = path.join(outDir, 'og-image.png');
  await writeFile(ogFile, await render(artwork, 512));
  console.log(`wrote ${path.relative(root, ogFile)}`);

  // iOS home-screen / bookmark icon (180x180).
  const appleFile = path.join(outDir, 'apple-touch-icon.png');
  await writeFile(appleFile, await render(artwork, 180));
  console.log(`wrote ${path.relative(root, appleFile)}`);

  // Legacy multi-size ICO favicon (16/32/48).
  const icoEntries = [];
  for (const size of [16, 32, 48]) {
    icoEntries.push({ size, data: await render(artwork, size) });
  }
  const icoFile = path.join(outDir, 'favicon.ico');
  await writeFile(icoFile, buildIco(icoEntries));
  console.log(`wrote ${path.relative(root, icoFile)}`);

  // Minified favicon, kept in sync with the artwork and app accent.
  const svgFile = path.join(outDir, 'favicon.svg');
  await writeFile(svgFile, minifySvg(coloredSvg));
  console.log(`wrote ${path.relative(root, svgFile)}`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
