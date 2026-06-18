import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = process.cwd();
const out = path.join(root, 'public', 'herowin-v2.png');
const bgBuf = await fs.readFile(path.join(root, 'public', 'hero-bg.webp'));
const logoBuf = await fs.readFile(path.join(root, 'public', 'logowin.png'));

const data = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;

const products = [
  { url: 'https://wrmjoadnntahudqhtfgr.supabase.co/storage/v1/object/public/produtos/3994.jpg', x: 1118, y: 244, w: 284, h: 350, rot: -3 },
  { url: 'https://wrmjoadnntahudqhtfgr.supabase.co/storage/v1/object/public/produtos/4093.jpg', x: 1384, y: 174, w: 325, h: 420, rot: 3 },
  { url: 'https://wrmjoadnntahudqhtfgr.supabase.co/storage/v1/object/public/produtos/3134.jpg', x: 922, y: 358, w: 250, h: 270, rot: 4 },
  { url: 'https://wrmjoadnntahudqhtfgr.supabase.co/storage/v1/object/public/produtos/3438.jpg', x: 1685, y: 334, w: 248, h: 292, rot: -3 },
  { url: 'https://wrmjoadnntahudqhtfgr.supabase.co/storage/v1/object/public/produtos/2942.jpg', x: 1246, y: 512, w: 210, h: 190, rot: 2 },
  { url: 'https://wrmjoadnntahudqhtfgr.supabase.co/storage/v1/object/public/produtos/3215.jpg', x: 1504, y: 518, w: 206, h: 180, rot: -2 },
];

async function fetchDataUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const ab = await r.arrayBuffer();
  const mime = r.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return data(Buffer.from(ab), mime);
}

const imgs = await Promise.all(products.map(async (p) => ({ ...p, src: await fetchDataUrl(p.url) })));
const bg = data(bgBuf, 'image/webp');
const logo = data(logoBuf, 'image/png');

const productSvg = imgs.map((p) => `
  <g transform="rotate(${p.rot} ${p.x + p.w / 2} ${p.y + p.h / 2})">
    <rect x="${p.x - 16}" y="${p.y - 16}" width="${p.w + 32}" height="${p.h + 32}" rx="28" fill="rgba(255,255,255,0.09)" stroke="rgba(244,191,77,0.32)"/>
    <rect x="${p.x - 16}" y="${p.y - 16}" width="${p.w + 32}" height="${p.h + 32}" rx="28" fill="url(#cardGrad)"/>
    <image href="${p.src}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" preserveAspectRatio="xMidYMid meet"/>
  </g>
`).join('\n');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="2048" height="820" viewBox="0 0 2048 820" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="dark" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#020a19" stop-opacity="0.99"/>
      <stop offset="0.44" stop-color="#06142e" stop-opacity="0.91"/>
      <stop offset="0.76" stop-color="#071226" stop-opacity="0.43"/>
      <stop offset="1" stop-color="#020817" stop-opacity="0.28"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#f7d778"/>
      <stop offset="0.48" stop-color="#d7a835"/>
      <stop offset="1" stop-color="#9b6b18"/>
    </linearGradient>
    <linearGradient id="cardGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.13"/>
      <stop offset="1" stop-color="#071226" stop-opacity="0.20"/>
    </linearGradient>
    <radialGradient id="glow" cx="74%" cy="40%" r="58%">
      <stop offset="0" stop-color="#e1aa36" stop-opacity="0.46"/>
      <stop offset="0.42" stop-color="#12366c" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#020817" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="16" stdDeviation="17" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <image href="${bg}" width="2048" height="820" preserveAspectRatio="xMidYMid slice"/>
  <rect width="2048" height="820" fill="url(#dark)"/>
  <rect width="2048" height="820" fill="url(#glow)"/>
  <path d="M0 704 H1062 L1140 820 H0 Z" fill="#071326" opacity="0.94"/>
  <path d="M0 704 H1062 L1140 820" fill="none" stroke="#d5a63a" stroke-width="3" opacity="0.85"/>
  <path d="M1392 0 L1280 160 H2048" fill="none" stroke="#d5a63a" stroke-width="3" opacity="0.9"/>
  <g opacity="0.15" stroke="#8bb2e8" stroke-width="1">
    ${Array.from({ length: 17 }, (_, i) => `<line x1="${i * 72}" y1="0" x2="${i * 72}" y2="820"/>`).join('')}
    ${Array.from({ length: 10 }, (_, i) => `<line x1="0" y1="${i * 72}" x2="2048" y2="${i * 72}"/>`).join('')}
  </g>

  <image href="${logo}" x="118" y="66" width="124" height="124" preserveAspectRatio="xMidYMid meet"/>

  <g transform="translate(118,286)">
    <text x="0" y="0" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="86" font-weight="900" fill="#ffffff" letter-spacing="-1">SUPLEMENTOS</text>
    <text x="0" y="90" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="72" font-weight="900" fill="url(#gold)" letter-spacing="-1">PARA VENDER MAIS</text>
    <text x="0" y="150" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#dbe7ff">Whey | Creatina | Pre-treino | Snacks | Vitaminas</text>
    <g transform="translate(0,204)">
      <rect x="0" y="0" width="220" height="62" rx="16" fill="url(#gold)"/>
      <text x="110" y="40" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="900" fill="#071226">VER PRODUTOS</text>
      <rect x="244" y="0" width="278" height="62" rx="16" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)"/>
      <text x="383" y="39" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#ffffff">Pedido pelo catalogo</text>
    </g>
  </g>

  <g filter="url(#shadow)">
    ${productSvg}
  </g>

  <g transform="translate(118,756)">
    <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="900" fill="#d7b76d" letter-spacing="2">MARCAS DO CATALOGO</text>
    <text x="390" y="0" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="800" fill="#ffffff" letter-spacing="1">VITAO  |  MAX TITANIUM  |  NEW MILLEN  |  SHARK PRO  |  INTEGRALMEDICA  |  VITAFOR  |  DUX</text>
  </g>
</svg>`;

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 2048 }, font: { loadSystemFonts: true } });
await fs.writeFile(out, resvg.render().asPng());
console.log(out);
