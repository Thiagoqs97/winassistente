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
