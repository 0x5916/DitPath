import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const root = new URL('../../', import.meta.url);
const file = (relativePath: string) => fileURLToPath(new URL(relativePath, root));

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
};

type Manifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
};

const manifest = JSON.parse(readFileSync(file('static/manifest.webmanifest'), 'utf8')) as Manifest;

async function metadata(relativePath: string) {
  return sharp(file(relativePath)).metadata();
}

function sha256(relativePath: string) {
  return createHash('sha256')
    .update(readFileSync(file(relativePath)))
    .digest('hex');
}

async function assertOpaquePng(relativePath: string, size: number) {
  const info = await metadata(relativePath);
  expect(info.format, relativePath).toBe('png');
  expect(info.width, relativePath).toBe(size);
  expect(info.height, relativePath).toBe(size);
  expect(info.hasAlpha, relativePath).toBe(false);
}

async function assertTransparentPng(relativePath: string, size: number) {
  const info = await metadata(relativePath);
  expect(info.format, relativePath).toBe('png');
  expect(info.width, relativePath).toBe(size);
  expect(info.height, relativePath).toBe(size);
  expect(info.hasAlpha, relativePath).toBe(true);
}

async function cornerAlphas(relativePath: string) {
  const { data, info } = await sharp(file(relativePath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  return [
    alpha(0, 0),
    alpha(info.width - 1, 0),
    alpha(0, info.height - 1),
    alpha(info.width - 1, info.height - 1)
  ];
}

async function contentBounds(relativePath: string) {
  const { data, info } = await sharp(file(relativePath))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const paper = [data[0], data[1], data[2]];
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const delta = Math.max(
        Math.abs(data[offset] - paper[0]),
        Math.abs(data[offset + 1] - paper[1]),
        Math.abs(data[offset + 2] - paper[2])
      );
      if (delta > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

describe('DitPath PWA assets', () => {
  it('keeps the approved source artwork byte-identical', () => {
    expect(sha256('src/lib/assets/ditpath-icon-material.svg')).toBe(
      '2e0463d3a494d66acb7eaae61dd7603d9bc10e99be3ac97df8f57ce0bc58860f'
    );
    expect(sha256('src/lib/assets/ditpath-icon-small.svg')).toBe(
      '4933a84ff85587c71d2ae5a6cc6b0bd2676eecbf624c3ad2a558f0616576e434'
    );
  });

  it('declares the approved install name and icon set', () => {
    expect(manifest.name).toBe('DitPath');
    expect(manifest.short_name).toBe('DitPath');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#F3F2ED');
    expect(manifest.theme_color).toBe('#191917');

    expect(manifest.icons).toEqual([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
    ]);
    expect(manifest.icons.some((icon) => icon.purpose.includes('maskable'))).toBe(false);
  });

  it('keeps app and Apple touch icons opaque at the required sizes', async () => {
    await assertOpaquePng('static/icon-192.png', 192);
    await assertOpaquePng('static/icon-512.png', 512);
    await assertOpaquePng('static/apple-touch-icon.png', 180);
  });

  it('centers the app icon at 75% visible width', async () => {
    for (const [path, size] of [
      ['static/icon-192.png', 192],
      ['static/icon-512.png', 512],
      ['static/apple-touch-icon.png', 180]
    ] as const) {
      const bounds = await contentBounds(path);
      expect(bounds.width / size, path).toBeGreaterThanOrEqual(0.74);
      expect(bounds.width / size, path).toBeLessThanOrEqual(0.77);
      expect(bounds.centerX, path).toBeGreaterThanOrEqual(size / 2 - 1.5);
      expect(bounds.centerX, path).toBeLessThanOrEqual(size / 2 + 1.5);
      expect(bounds.centerY, path).toBeGreaterThanOrEqual(size / 2 - 1.5);
      expect(bounds.centerY, path).toBeLessThanOrEqual(size / 2 + 1.5);
    }
  });

  it('keeps favicon PNGs transparent with a warm-paper rim', async () => {
    for (const size of [16, 32, 48, 64]) {
      const path = `static/favicon-${size}.png`;
      await assertTransparentPng(path, size);
      const corners = await cornerAlphas(path);
      expect(
        corners.every((alpha) => alpha < 8),
        `${path}: ${corners.join(', ')}`
      ).toBe(true);
    }

    const { data, info } = await sharp(file('static/favicon-64.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let paper = 0;
    let artwork = 0;
    for (let i = 0; i < info.width * info.height; i += 1) {
      if (data[i * 4 + 3] < 8) continue;
      const delta = (target: number[]) =>
        Math.max(
          Math.abs(data[i * 4] - target[0]),
          Math.abs(data[i * 4 + 1] - target[1]),
          Math.abs(data[i * 4 + 2] - target[2])
        );
      if (delta([0xf3, 0xf2, 0xed]) <= 8) paper += 1;
      if (delta([0x16, 0x1c, 0x23]) <= 8) artwork += 1;
    }
    expect(paper).toBeGreaterThan(0);
    expect(artwork).toBeGreaterThan(0);
  });

  it('packs transparent 16, 32 and 48 px entries into the ICO', async () => {
    const ico = readFileSync(file('static/favicon.ico'));
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);

    for (let i = 0; i < count; i += 1) {
      const base = 6 + i * 16;
      const size = ico[base] || 256;
      const length = ico.readUInt32LE(base + 8);
      const offset = ico.readUInt32LE(base + 12);
      const info = await sharp(ico.subarray(offset, offset + length)).metadata();
      expect(info.width, `ICO entry ${i}`).toBe(size);
      expect(info.height, `ICO entry ${i}`).toBe(size);
      expect(info.hasAlpha, `ICO entry ${i}`).toBe(true);
    }
  });

  it('ships an unlinked transparent favicon source', () => {
    const favicon = readFileSync(file('static/favicon.svg'), 'utf8');
    expect(favicon).toContain('viewBox="64 64 416 416"');
    expect(favicon).toContain('fill="#161C23"');
    expect(favicon).toContain('fill="#D4B16D"');
    expect(favicon).toContain('fill="#BAC6CC"');
    expect(favicon).not.toContain('fill="#F3F2ED"');
    expect(favicon).not.toContain('url(#');

    const html = readFileSync(file('src/app.html'), 'utf8');
    expect(html).not.toContain('href="/favicon.svg"');
  });

  it('ships a 1200x630 opaque social card', async () => {
    const social = await metadata('static/og-image.png');
    expect(social.width).toBe(1200);
    expect(social.height).toBe(630);
    expect(social.hasAlpha).toBe(false);
  });

  it('links the manifest, app title, theme colours and icons from the document head', () => {
    const html = readFileSync(file('src/app.html'), 'utf8');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="application-name" content="DitPath"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="DitPath"');
    expect(html).toContain('href="/apple-touch-icon.png"');
    expect(html).toContain('href="/favicon-32.png"');
    expect(html.match(/name="theme-color"/g)).toHaveLength(2);
  });

  it('revalidates the manifest and service worker in nginx', () => {
    const nginx = readFileSync(file('nginx.conf'), 'utf8');
    expect(nginx).toMatch(
      /location = \/manifest\.webmanifest\s*\{[\s\S]*?application\/manifest\+json[\s\S]*?Cache-Control "no-cache"/
    );
    expect(nginx).toMatch(
      /location = \/service-worker\.js\s*\{[\s\S]*?application\/javascript[\s\S]*?Cache-Control "no-cache"/
    );
  });
});
