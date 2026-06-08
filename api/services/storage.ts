import { getSupabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const BUCKET = 'produtos';

// Garante o bucket público de imagens de produto. Idempotente — seguro chamar
// no início de cada sync.
export async function ensureProductBucket(): Promise<void> {
  const sb = getSupabase();
  const { data } = await sb.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '5MB',
  });
  if (error && !/already exists/i.test(error.message)) throw error;
  logger.info('Bucket de imagens de produto criado', { bucket: BUCKET });
}

// Sobe a imagem e devolve a URL pública. A `key` deve ser estável por produto
// (ex.: o SKU) pra um re-sync SOBRESCREVER (upsert) em vez de duplicar arquivo.
export async function uploadProductImage(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const sb = getSupabase();
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const path = `${key}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
