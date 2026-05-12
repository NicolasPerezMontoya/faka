import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { CanonicalProduct, Channel, MappingProfile } from './types.js';
import { normalizeBarcode } from './normalize.js';

export function loadProfile(profilesDir: string, channel: Channel, type: 'products'): MappingProfile {
  const path = join(profilesDir, `${channel}-${type}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Mapping profile not found: ${path}\n` +
      `Create it before running. See docs/csv-templates/${channel}.md and scripts/discovery/profiles/_template.json.`
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return raw as MappingProfile;
}

export function discoverInputs(inputDir: string, channel: Channel): string[] {
  const dir = join(inputDir, channel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.csv') && f.includes('products'))
    .map((f) => join(dir, f));
}

function get(row: Record<string, string>, sourceCol: string | undefined): string | undefined {
  if (!sourceCol) return undefined;
  const v = row[sourceCol];
  if (v === undefined || v === null) return undefined;
  const trimmed = String(v).trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/,/g, '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function loadProductsCSV(
  filePath: string,
  profile: MappingProfile
): CanonicalProduct[] {
  const text = readFileSync(filePath, 'utf-8');
  const rows = parse(text, {
    columns: true,
    delimiter: profile.delimiter ?? ',',
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as Array<Record<string, string>>;

  const map = profile.column_map;

  const out: CanonicalProduct[] = [];
  for (const row of rows) {
    const external_id = get(row, map.external_id);
    const name = get(row, map.name);
    if (!external_id || !name) {
      continue;
    }
    out.push({
      channel: profile.channel,
      external_id,
      sku: get(row, map.sku),
      name,
      description: get(row, map.description),
      category: get(row, map.category),
      brand: get(row, map.brand),
      price: num(get(row, map.price)),
      cost: num(get(row, map.cost)),
      barcode: normalizeBarcode(get(row, map.barcode)),
      supplier_code: get(row, map.supplier_code),
      image_url: get(row, map.image_url),
      status: get(row, map.status),
      raw_row: row,
    });
  }
  return out;
}

export function loadChannel(
  inputDir: string,
  profilesDir: string,
  channel: Channel
): { products: CanonicalProduct[]; files: string[] } {
  const profile = loadProfile(profilesDir, channel, 'products');
  const files = discoverInputs(inputDir, channel);
  const products: CanonicalProduct[] = [];
  for (const file of files) {
    products.push(...loadProductsCSV(file, profile));
  }
  return { products, files: files.map((f) => basename(f)) };
}
