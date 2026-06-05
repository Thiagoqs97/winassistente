import { Router } from 'express';
import axios from 'axios';
import { logger } from '../lib/logger.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const setupRouter = Router();

// Escopado no caminho: um `.use` sem path bloquearia (403) requests de outros routers
// montados depois em '/api' — em especial o dashboardRouter. Ver comentário em server.ts.
setupRouter.use('/setup-webhook', requireAuth, requireRole('admin'));

setupRouter.post('/setup-webhook', async (req, res) => {
  const { appUrl } = req.body;
  try {
    const webhookPayload = {
      webhook: {
        enabled: true,
        url: `${appUrl}/api/webhook/evolution`,
        webhookByEvents: false,
        webhookBase64: true,
        events: ['MESSAGES_UPSERT'],
      },
    };
    const response = await axios.post(
      `${process.env.EVO_URL}/webhook/set/${process.env.EVO_INSTANCE}`,
      webhookPayload,
      { headers: { apikey: process.env.EVO_APIKEY } }
    );
    res.json({ success: true, data: response.data });
  } catch (err: any) {
    logger.error('Webhook setup failed', { err: err?.response?.data || err?.message });
    res.status(500).json({ error: err?.response?.data || err.message });
  }
});
