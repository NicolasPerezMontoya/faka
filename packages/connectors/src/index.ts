// @faka/connectors — interface + skeleton factories + CSVConnector real impl.

export * from "./types.js";

// Per-channel factories re-exported as named imports so callers do
// `import { createCSVConnector } from '@faka/connectors'`.
export { createCSVConnector } from "./csv/index.js";
export { createWordPressConnector } from "./wordpress/index.js";
export { createMercadoLibreConnector } from "./mercadolibre/index.js";
export { createDropiConnector } from "./dropi/index.js";
export { createPOSConnector } from "./pos/index.js";
export { createWhatsAppConnector } from "./whatsapp/index.js";
export { createFalabellaConnector } from "./falabella/index.js";

// Cross-cutting helpers from Plan 1.2.4.
export { idempotencyKey, idempotentUpsert } from "./idempotency.js";
export { withRetryAndDLQ } from "./retry.js";
export { recordConnectorRun } from "./observability.js";
