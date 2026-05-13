// @faka/schema — shared Zod schemas + TS types across the monorepo.
// Re-exported in dependency order: enums first, composite shapes next,
// helpers last.

export * from "./channel.js";
export * from "./connector-run-kind.js";
export * from "./match-method.js";
export * from "./canonical-product.js";
export * from "./mapping-profile.js";
export * from "./normalized-product.js";
export * from "./normalized-order.js";
export * from "./normalized-order-item.js";
export * from "./customer-hint.js";
export * from "./audit-event.js";
export * from "./normalize.js";
