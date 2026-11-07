#!/usr/bin/env node
// Builds the app icons (favicon, home screen, PWA) from the menu mark, so the two never
// drift apart: design/icons/own/outline/climb-contours.svg (a climb crossing contour
// lines, inspired by Simujaules) in white on the brand colour.
//
// Usage: node scripts/build-app-icons.mjs   (npm run build:app-icons)
//
//   public/icons/icon-32.png, icon-192.png, icon-512.png  rounded square, transparent corners
//   public/icons/icon-180.png                             full bleed (iOS rounds it itself)
//   public/icons/icon-512-maskable.png                    full bleed, mark inside the safe zone
//
// Colours come from the tokens (brand.theme behind, map.icon.on for the mark).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { tokens } from '../public/js/tokens.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARK = join(ROOT, 'design', 'icons', 'own', 'outline', 'climb-contours.svg');
const OUT = join(ROOT, 'public', 'icons');

/** The mark's drawing: its <svg> attributes that matter and its inner elements. */
function mark() {
  const svg = readFileSync(MARK, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const [, open, inner] = svg.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  const attr = (a) => open.match(new RegExp(`\\s${a}="([^"]*)"`))?.[1];
  return { inner, stroke: attr('stroke-width') ?? '2' };
}

/**
 * An icon `size` px wide: the brand colour (a rounded square of `radius` × size, or
 * the full square), and the 24-unit mark scaled to `scale` × size, centred.
 */
function iconSvg(size, { radius = 0, scale }) {
  const { inner, stroke } = mark();
  const k = (size * scale) / 24, off = (size - size * scale) / 2;
  const bg = radius ? `<rect width="${size}" height="${size}" rx="${size * radius}"` : `<rect width="${size}" height="${size}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg} fill="${tokens.brand.theme}"/>
  <g transform="translate(${off} ${off}) scale(${k})" color="${tokens.map.icon.on}" fill="none" stroke="currentColor"
     stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
</svg>`;
}

const ICONS = [
  ['icon-32.png', 32, { radius: 0.22, scale: 0.78 }], // small: the mark fills more of it
  ['icon-192.png', 192, { radius: 0.22, scale: 0.66 }],
  ['icon-512.png', 512, { radius: 0.22, scale: 0.66 }],
  ['icon-180.png', 180, { scale: 0.66 }],
  // Maskable: launchers may crop to a circle of 80 % of the side; keep the mark inside.
  ['icon-512-maskable.png', 512, { scale: 0.52 }],
];

for (const [file, size, opts] of ICONS) {
  await sharp(Buffer.from(iconSvg(size, opts))).png().toFile(join(OUT, file));
  console.log(`icons/${file}: ${size} px`);
}
