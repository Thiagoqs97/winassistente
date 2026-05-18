import * as xlsx from 'xlsx';
import { openai } from '../lib/openai.js';
import { logger } from '../lib/logger.js';

export async function transcribeAudio(base64: string): Promise<string> {
  const audioBuffer = Buffer.from(base64, 'base64');
  const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
  const audioFile = new File([audioBlob], 'audio.ogg', { type: 'audio/ogg' });
  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'pt',
  });
  return transcription.text;
}

export async function describeImage(base64: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Esta é uma foto de uma lista de pedidos. Extraia todos os produtos e quantidades mencionados. Responda apenas com a lista de itens encontrados no formato: "Produto - Quantidade".',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64}` },
        },
      ],
    }],
    max_tokens: 1024,
  });
  return resp.choices[0].message.content || '';
}

// Lê planilha .xlsx/.xls (até 200 primeiras linhas) e devolve como string.
export function parseSpreadsheet(base64: string): string {
  const buffer = Buffer.from(base64, 'base64');
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', header: 1 }) as any[][];
  const lines = rows
    .slice(0, 200)
    .map((r: any[]) => r.filter((c: any) => String(c).trim() !== '').join(' | '))
    .filter((l: string) => l.trim().length > 0);
  logger.info('planilha processada', { linhas: lines.length });
  return `Pedido recebido em planilha:\n${lines.join('\n')}`;
}

export function parseCsv(base64: string): string {
  return `Pedido recebido em CSV:\n${Buffer.from(base64, 'base64').toString('utf-8').slice(0, 4000)}`;
}
