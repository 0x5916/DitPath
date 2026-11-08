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

async function maxContentRadius(relativePath: string) {
  const { data, info } = await sharp(file(relativePath))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const paper = [data[0], data[1], data[2]];
  let maximum = 0;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const delta = Math.max(
        Math.abs(data[offset] - paper[0]),
        Math.abs(data[offset + 1] - paper[1]),
        Math.abs(data[offset + 2] - paper[2])
      );
      if (delta > 16) {
        maximum = Math.max(
          maximum,
          Math.hypot(x - (info.width - 1) / 2, y - (info.height - 1) / 2)
        );
      }
    }
  }

  return { maximum, safeRadius: info.width * 0.4 };
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

    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', purpose: 'any' }),
        expect.objectContaining({
          src: '/icon-maskable-192.png',
          sizes: '192x192',
          purpose: 'maskable'
        }),
        expect.objectContaining({
          src: '/icon-maskable-512.png',
          sizes: '512x512',
          purpose: 'maskable'
        })
      ])
    );
  });

  it('keeps app and Apple touch icons opaque at the required sizes', async () => {
    await assertOpaquePng('static/icon-192.png', 192);
    await assertOpaquePng('static/icon-512.png', 512);
    await assertOpaquePng('static/icon-maskable-192.png', 192);
    await assertOpaquePng('static/icon-maskable-512.png', 512);
    await assertOpaquePng('static/apple-touch-icon.png', 180);
    await assertOpaquePng('static/favicon-16.png', 16);
    await assertOpaquePng('static/favicon-32.png', 32);
    await assertOpaquePng('static/favicon-48.png', 48);
    await assertOpaquePng('static/favicon-64.png', 64);
  });

  it('keeps maskable content inside the 40% safe radius', async () => {
    for (const path of ['static/icon-maskable-192.png', 'static/icon-maskable-512.png']) {
      const { maximum, safeRadius } = await maxContentRadius(path);
      expect(maximum, path).toBeLessThanOrEqual(safeRadius);
    }
  });

  it('uses the approved small colour artwork on the favicon paper tile', () => {
    const favicon = readFileSync(file('static/favicon.svg'), 'utf8');
    expect(favicon).toContain('viewBox="64 64 416 416"');
    expect(favicon).toContain('fill="#F3F2ED"');
    expect(favicon).toContain('fill="#161C23"');
    expect(favicon).toContain('fill="#D4B16D"');
    expect(favicon).toContain('fill="#BAC6CC"');
    expect(favicon).not.toContain('url(#');
  });

  it('ships a 1200x630 opaque social card and a transparent navbar mask', async () => {
    const social = await metadata('static/og-image.png');
    expect(social.width).toBe(1200);
    expect(social.height).toBe(630);
    expect(social.hasAlpha).toBe(false);

    const mark = await metadata('src/lib/assets/ditpath-mark.png');
    expect(mark.width).toBe(256);
    expect(mark.height).toBe(256);
    expect(mark.hasAlpha).toBe(true);
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
