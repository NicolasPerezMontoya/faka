import { z } from "zod";
import { ChannelSchema } from "./channel.js";

/**
 * Mapping profile — maps source-CSV column names to canonical fields.
 *
 * Matches the shape of `scripts/discovery/profiles/_template.json` AND the
 * `csv_mapping_profiles.column_map_json` jsonb column from migration 0003.
 *
 * PATTERNS §5.3 (LOCKED): do NOT redesign this shape. The 4 pre-seed
 * profiles inserted by seed.sql already conform to this contract.
 *
 * `production` extends the base with DB-side metadata (id, version,
 * created_by, is_active) — the discovery script uses the base shape only.
 */

export const ProfileTypeSchema = z.enum([
  "orders",
  "products",
  "order_items",
  "inventory",
  "mixto",
]);
export type ProfileType = z.infer<typeof ProfileTypeSchema>;

export const MappingProfileSchema = z.object({
  channel: ChannelSchema,
  type: ProfileTypeSchema,
  delimiter: z.string().optional(),
  column_map: z.record(z.string(), z.string()),
  defaults: z.record(z.string(), z.unknown()).optional(),
});

export type MappingProfile = z.infer<typeof MappingProfileSchema>;

/** Production row in csv_mapping_profiles — adds DB metadata. */
export const ProductionMappingProfileSchema = MappingProfileSchema.extend({
  id: z.string().uuid(),
  nombre: z.string(),
  version: z.number().int().positive(),
  is_active: z.boolean(),
  reglas_json: z.record(z.string(), z.unknown()).nullable().optional(),
  creado_por: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type ProductionMappingProfile = z.infer<
  typeof ProductionMappingProfileSchema
>;
