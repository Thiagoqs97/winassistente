import axios from 'axios';
import { logger } from '../lib/logger.js';

export async function sendWhatsAppMessage(number: string, text: string): Promise<void> {
  try {
    await axios.post(
      `${process.env.EVO_URL}/message/sendText/${process.env.EVO_INSTANCE}`,
      { number, text },
      { headers: { apikey: process.env.EVO_APIKEY } }
    );
  } catch (err: any) {
    logger.error('Failed to send WhatsApp message', {
      number,
      err: err?.response?.data || err?.message,
    });
  }
}

// Envia um documento (PDF, planilha etc.) via Evolution.
// Não levanta erro — falha de envio do anexo não pode quebrar o fluxo principal
// (a mensagem de texto com o orçamento já foi entregue antes).
export async function sendWhatsAppDocument(opts: {
  number: string;
  buffer: Buffer;
  fileName: string;
  mimetype?: string;
  caption?: string;
}): Promise<boolean> {
  try {
    await axios.post(
      `${process.env.EVO_URL}/message/sendMedia/${process.env.EVO_INSTANCE}`,
      {
        number: opts.number,
        mediatype: 'document',
        mimetype: opts.mimetype || 'application/pdf',
        fileName: opts.fileName,
        media: opts.buffer.toString('base64'),
        caption: opts.caption,
      },
      { headers: { apikey: process.env.EVO_APIKEY } }
    );
    return true;
  } catch (err: any) {
    logger.error('Failed to send WhatsApp document', {
      number: opts.number,
      fileName: opts.fileName,
      err: err?.response?.data || err?.message,
    });
    return false;
  }
}
