import axios from 'axios';
import { pool } from '../db/pool.js';
import { iterateProdutos, getProdutoDetalhe, extrairImagemUrl } from './bling.js';
import { ensureProductBucket, uploadProductImage } from './storage.js';

// Normalização p/ casamento: tira acento, minúsculo, colapsa não-alfanumérico.
// Estrito de propósito (começamos só com match seguro; afrouxamos depois).
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove acentos (NFD os separa em marcas)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface OurProduct {
  id: number;
  codigo: string | null;
  descricao: string;
}

function pushTo(map: Map<string, OurProduct[]>, key: string, p: OurProduct): void {
  const arr = map.get(key);
  if (arr) arr.push(p);
  else map.set(key, [p]);
}

// Monta os índices da nossa base por SKU e por nome (ambos normalizados).
function indexar(ours: OurProduct[]): { bySku: Map<string, OurProduct[]>; byName: Map<string, OurProduct[]> } {
  const bySku = new Map<string, OurProduct[]>();
  const byName = new Map<string, OurProduct[]>();
  for (const p of ours) {
    const sku = norm(p.codigo);
    if (sku) pushTo(bySku, sku, p);
    const name = norm(p.descricao);
    if (name) pushTo(byName, name, p);
  }
  return { bySku, byName };
}

export interface DiagnosticoResult {
  ourTotal: number;
  blingTotal: number;
  matchedBySku: number;
  matchedByName: number;
  matchedTotal: number;
  faltantes: Array<{ id: number; codigo: string | null; descricao: string }>;
}

// Dry-run: mede quantos dos NOSSOS produtos casam com o Bling por SKU exato
// ou nome exato (e únicos). Não baixa imagem nenhuma. Devolve os faltantes.
export async function diagnosticoBling(): Promise<DiagnosticoResult> {
  const { rows: ours } = await pool.query<OurProduct>(
    'SELECT id, codigo, descricao FROM products WHERE ativo = true',
  );
  const { bySku, byName } = indexar(ours);

  const matchedIds = new Set<number>();
  let matchedBySku = 0;
  let matchedByName = 0;
  let blingTotal = 0;

  for await (const bp of iterateProdutos()) {
    blingTotal++;
    const sku = norm(bp.codigo);
    const skuCands = sku ? bySku.get(sku) : undefined;
    if (skuCands && skuCands.length === 1 && !matchedIds.has(skuCands[0].id)) {
      matchedIds.add(skuCands[0].id);
      matchedBySku++;
      continue;
    }
    const name = norm(bp.nome);
    const nameCands = name ? byName.get(name) : undefined;
    if (nameCands && nameCands.length === 1 && !matchedIds.has(nameCands[0].id)) {
      matchedIds.add(nameCands[0].id);
      matchedByName++;
      continue;
    }
  }

  const faltantes = ours
    .filter((p) => !matchedIds.has(p.id))
    .map((p) => ({ id: p.id, codigo: p.codigo, descricao: p.descricao }));

  return {
    ourTotal: ours.length,
    blingTotal,
    matchedBySku,
    matchedByName,
    matchedTotal: matchedIds.size,
    faltantes,
  };
}

export interface MapearResult {
  ourTotal: number;
  mapped: number;
  bySku: number;
  byName: number;
}

// Persiste o id do Bling em products.bling_id pros que casam com certeza.
// Roda uma vez; o sync de imagem usa esse id (evita re-varrer o Bling por lote).
export async function mapearProdutos(): Promise<MapearResult> {
  const { rows: ours } = await pool.query<OurProduct>(
    'SELECT id, codigo, descricao FROM products WHERE ativo = true',
  );
  const { bySku, byName } = indexar(ours);

  const claimed = new Set<number>();
  const ourIds: number[] = [];
  const blingIds: number[] = [];
  let bySkuCount = 0;
  let byNameCount = 0;

  for await (const bp of iterateProdutos()) {
    const sku = norm(bp.codigo);
    const skuCands = sku ? bySku.get(sku) : undefined;
    if (skuCands && skuCands.length === 1 && !claimed.has(skuCands[0].id)) {
      claimed.add(skuCands[0].id);
      ourIds.push(skuCands[0].id);
      blingIds.push(bp.id);
      bySkuCount++;
      continue;
    }
    const name = norm(bp.nome);
    const nameCands = name ? byName.get(name) : undefined;
    if (nameCands && nameCands.length === 1 && !claimed.has(nameCands[0].id)) {
      claimed.add(nameCands[0].id);
      ourIds.push(nameCands[0].id);
      blingIds.push(bp.id);
      byNameCount++;
      continue;
    }
  }

  if (ourIds.length > 0) {
    // Um UPDATE só, casando os arrays por posição (unnest).
    await pool.query(
      `UPDATE products p SET bling_id = v.bid
       FROM (SELECT unnest($1::int[]) AS oid, unnest($2::bigint[]) AS bid) v
       WHERE p.id = v.oid`,
      [ourIds, blingIds],
    );
  }

  return { ourTotal: ours.length, mapped: ourIds.length, bySku: bySkuCount, byName: byNameCount };
}

// Sniff por magic bytes quando o servidor não manda um content-type image/*
// confiável (o S3 do Bling às vezes devolve octet-stream nas URLs assinadas).
function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function downloadImagem(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 20000 });
    const buffer = Buffer.from(res.data);
    if (buffer.length === 0) return null;
    const header = String(res.headers['content-type'] ?? '');
    const contentType = header.startsWith('image/') ? header : (sniffImage(buffer) ?? 'image/jpeg');
    return { buffer, contentType };
  } catch {
    return null;
  }
}

export interface SyncProgress {
  processed: number;
  comFoto: number;
  semFoto: number;
  restantes: number;
  done: boolean;
}

// Processa um lote dos produtos mapeados (bling_id != null) ainda sem sync de
// imagem, até esgotar OU estourar o orçamento de tempo (Vercel limita a função).
// Cada produto: detalhe do Bling -> URL da imagem -> baixa -> sobe no Storage ->
// grava imagem_url. Marca imagem_sync_em sempre (achando foto ou não) pra o
// proximo lote retomar de onde parou. Reentrante: e so chamar de novo ate done.
export async function syncImagensBatch(budgetMs = 210000): Promise<SyncProgress> {
  await ensureProductBucket();
  const startedAt = Date.now();
  let processed = 0;
  let comFoto = 0;
  let semFoto = 0;

  while (Date.now() - startedAt < budgetMs) {
    const { rows } = await pool.query<{ id: number; codigo: string | null; bling_id: number }>(
      `SELECT id, codigo, bling_id FROM products
       WHERE ativo = true AND bling_id IS NOT NULL AND imagem_sync_em IS NULL
       ORDER BY id LIMIT 15`,
    );
    if (rows.length === 0) break;

    for (const p of rows) {
      let imagemUrl: string | null = null;
      try {
        const detalhe = await getProdutoDetalhe(p.bling_id);
        const src = extrairImagemUrl(detalhe);
        if (src) {
          const img = await downloadImagem(src);
          if (img) {
            const key = (p.codigo ?? String(p.id)).replace(/[^a-zA-Z0-9._-]/g, '_');
            imagemUrl = await uploadProductImage(key, img.buffer, img.contentType);
          }
        }
      } catch {
        // marca como processado mesmo no erro, pra não travar o lote num item
      }
      await pool.query(
        'UPDATE products SET imagem_url = COALESCE($1, imagem_url), imagem_sync_em = now() WHERE id = $2',
        [imagemUrl, p.id],
      );
      processed++;
      if (imagemUrl) comFoto++;
      else semFoto++;
      if (Date.now() - startedAt >= budgetMs) break;
      await sleep(350); // respeita o rate limit do Bling (3 req/s)
    }
  }

  const { rows: rem } = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM products
     WHERE ativo = true AND bling_id IS NOT NULL AND imagem_sync_em IS NULL`,
  );
  return { processed, comFoto, semFoto, restantes: rem[0].c, done: rem[0].c === 0 };
}
