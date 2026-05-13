/**
 * Connector registry — instantiates all 7 factories (6 channel skeletons
 * + CSVConnector) and exposes them by canal. RESEARCH §5.
 *
 * Each factory reads its config from process.env (placeholders in F1;
 * real values land in the target phase env).
 */

import {
  createCSVConnector,
  createDropiConnector,
  createFalabellaConnector,
  createMercadoLibreConnector,
  createPOSConnector,
  createWhatsAppConnector,
  createWordPressConnector,
  type ChannelConnector,
} from '@faka/connectors';
import type { Channel } from '@faka/schema';

export type Registry = Record<Channel, ChannelConnector | null>;

export function buildRegistry(): Registry {
  return {
    'csv-upload': createCSVConnector({}),
    wordpress: createWordPressConnector({
      baseUrl: process.env.WORDPRESS_API_URL ?? '',
      apiKey: process.env.WORDPRESS_API_KEY ?? '',
    }),
    mercadolibre: createMercadoLibreConnector({
      clientId: process.env.ML_CLIENT_ID ?? '',
      clientSecret: process.env.ML_CLIENT_SECRET ?? '',
    }),
    dropi: createDropiConnector({
      username: process.env.DROPI_USER ?? '',
      password: process.env.DROPI_PASS ?? '',
    }),
    pos: createPOSConnector({
      webhookSecret: process.env.POS_WEBHOOK_SECRET ?? '',
      csvFallback: true,
    }),
    pos1: null,    // alias for pos in F1 — same connector
    pos2: null,    // alias for pos in F1
    whatsapp: createWhatsAppConnector({
      phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID,
      accessToken: process.env.META_WA_ACCESS_TOKEN,
      webhookVerifyToken: process.env.META_WA_WEBHOOK_VERIFY_TOKEN,
    }),
    falabella: createFalabellaConnector({
      apiKey: process.env.FALABELLA_API_KEY,
      enabled: process.env.FALABELLA_ENABLED === 'true',
    }),
  };
}
