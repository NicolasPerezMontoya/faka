#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { CanonicalProduct, Channel, DiscoveryReport, MatchMethod, MatchResult } from './types.js';
import { loadChannel } from './load-csv.js';
import { buildIndex, matchDeterministic } from './cascade.js';
import {
  arbitrateWithLLM,
  promoteToMatch,
  resolveLLMConfig,
  summarizeConfig,
  estimateCallCost,
  type LLMProvider,
} from './llm-arbiter.js';
import { writeJSONReport, writeMarkdownReport } from './report.js';

interface RuntimeConfig {
  inputDir: string;
  outputDir: string;
  profilesDir: string;
  anchorChannel: Channel;
  enableLLMArbiter: boolean;
  embeddingThresholdHigh: number;
  embeddingThresholdMid: number;
  cliProvider?: LLMProvider;
  cliModel?: string;
  maxLLMCalls: number;
}

const CHANNELS_TO_LOAD: Channel[] = ['wordpress', 'mercadolibre', 'dropi', 'pos', 'whatsapp'];

function defaultConfig(): RuntimeConfig {
  const envMax = parseInt(process.env.LLM_MAX_CALLS ?? '', 10);
  return {
    inputDir: resolve(process.cwd(), '../../scratch/raw-csvs'),
    outputDir: resolve(process.cwd(), '../../docs'),
    profilesDir: resolve(process.cwd(), 'profiles'),
    anchorChannel: 'pos',
    enableLLMArbiter: true,
    embeddingThresholdHigh: 0.7,
    embeddingThresholdMid: 0.45,
    maxLLMCalls: Number.isFinite(envMax) && envMax > 0 ? envMax : 100,
  };
}

function parseArgs(argv: string[]): Partial<RuntimeConfig> {
  const overrides: Partial<RuntimeConfig> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-llm') overrides.enableLLMArbiter = false;
    else if (arg === '--no-embeddings') {
      overrides.embeddingThresholdHigh = 999;
      overrides.embeddingThresholdMid = 999;
    } else if (arg === '--anchor' && argv[i + 1]) {
      overrides.anchorChannel = argv[++i] as Channel;
    } else if (arg === '--input-dir' && argv[i + 1]) {
      overrides.inputDir = resolve(argv[++i]!);
    } else if (arg === '--max-llm' && argv[i + 1]) {
      overrides.maxLLMCalls = parseInt(argv[++i]!, 10);
    } else if (arg === '--provider' && argv[i + 1]) {
      overrides.cliProvider = argv[++i] as LLMProvider;
    } else if (arg === '--model' && argv[i + 1]) {
      overrides.cliModel = argv[++i]!;
    }
  }
  return overrides;
}

async function main(): Promise<void> {
  const cfg: RuntimeConfig = { ...defaultConfig(), ...parseArgs(process.argv.slice(2)) };

  let llmCfg = resolveLLMConfig({ cliProvider: cfg.cliProvider, cliModel: cfg.cliModel });
  if (cfg.enableLLMArbiter && llmCfg.provider !== 'none') {
    if (!process.env[llmCfg.apiKeyEnv]) {
      console.warn(`⚠️  ${llmCfg.apiKeyEnv} not set — LLM arbiter disabled.`);
      cfg.enableLLMArbiter = false;
      llmCfg = { ...llmCfg, provider: 'none' };
    }
  } else if (llmCfg.provider === 'none' && cfg.enableLLMArbiter) {
    console.warn(`⚠️  No LLM provider detected (no API keys in env). LLM arbiter disabled.`);
    cfg.enableLLMArbiter = false;
  }

  console.log(`🧠 LLM: ${summarizeConfig(llmCfg)}`);

  if (!existsSync(cfg.inputDir)) {
    console.error(`❌ Input dir not found: ${cfg.inputDir}`);
    console.error(`   Create the directory structure described in scripts/discovery/README.md`);
    process.exit(1);
  }

  console.log(`📂 Loading CSVs from ${cfg.inputDir}`);
  const loaded: Array<{ channel: Channel; products: CanonicalProduct[]; files: string[] }> = [];
  for (const ch of CHANNELS_TO_LOAD) {
    try {
      const { products, files } = loadChannel(cfg.inputDir, cfg.profilesDir, ch);
      if (products.length > 0) {
        loaded.push({ channel: ch, products, files });
        console.log(`   ✓ ${ch}: ${products.length} products (${files.length} files)`);
      } else {
        console.log(`   - ${ch}: 0 products`);
      }
    } catch (err) {
      console.log(`   - ${ch}: skipped (${(err as Error).message.split('\n')[0]})`);
    }
  }

  if (loaded.length < 2) {
    console.error(`❌ Need at least 2 channels with data. Loaded: ${loaded.length}`);
    process.exit(1);
  }

  const anchorLoad = loaded.find((l) => l.channel === cfg.anchorChannel);
  if (!anchorLoad) {
    console.error(`❌ Anchor channel '${cfg.anchorChannel}' has no products loaded.`);
    console.error(`   Available: ${loaded.map((l) => l.channel).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🎯 Anchor: ${cfg.anchorChannel} (${anchorLoad.products.length} products)`);
  const anchorIndex = buildIndex(anchorLoad.products);

  const matches: MatchResult[] = [];
  const unresolved: Array<{ anchor: CanonicalProduct; topCandidates: CanonicalProduct[] }> = [];
  const totals_by_channel: Record<string, number> = {};
  totals_by_channel[anchorLoad.channel] = anchorLoad.products.length;

  for (const other of loaded) {
    if (other.channel === anchorLoad.channel) continue;
    totals_by_channel[other.channel] = other.products.length;
    console.log(`\n🔍 Matching ${other.channel} → ${cfg.anchorChannel} (${other.products.length} products)`);

    for (const product of other.products) {
      const det = matchDeterministic(product, anchorIndex);
      if (det.matched) {
        matches.push(det.matched);
      } else {
        unresolved.push({
          anchor: product,
          topCandidates: det.jaccardCandidates.map((c) => c.candidate),
        });
      }
    }
  }

  console.log(`\n📊 Deterministic stages complete: ${matches.length} matches, ${unresolved.length} unresolved.`);

  let llmCalls = 0;
  if (cfg.enableLLMArbiter && unresolved.length > 0 && llmCfg.provider !== 'none') {
    const llmTargets = unresolved.slice(0, Math.min(cfg.maxLLMCalls, unresolved.length));
    console.log(`\n🤖 LLM arbiter: ${llmTargets.length} hard cases via ${llmCfg.provider}:${llmCfg.model}`);
    for (const u of llmTargets) {
      if (u.topCandidates.length === 0) continue;
      const cand = u.topCandidates[0]!;
      const decision = await arbitrateWithLLM(
        { anchor: u.anchor, candidate: cand },
        llmCfg
      );
      llmCalls++;
      matches.push(promoteToMatch({ anchor: u.anchor, candidate: cand }, decision));
    }
  }

  const matches_by_method = {} as Record<MatchMethod, number>;
  const initMethods: MatchMethod[] = [
    'barcode_exact', 'supplier_code_exact', 'sku_exact', 'normalized_name_exact',
    'embeddings_high', 'embeddings_mid', 'llm_arbiter_match', 'llm_arbiter_reject', 'unresolved',
  ];
  for (const m of initMethods) matches_by_method[m] = 0;

  for (const m of matches) {
    matches_by_method[m.method] = (matches_by_method[m.method] ?? 0) + 1;
  }
  matches_by_method.unresolved = Math.max(
    0,
    unresolved.length - (matches_by_method.llm_arbiter_match + matches_by_method.llm_arbiter_reject)
  );

  const nonAnchorTotal = loaded
    .filter((l) => l.channel !== anchorLoad.channel)
    .reduce((sum, l) => sum + l.products.length, 0) || 1;

  const automaticHits =
    matches_by_method.barcode_exact +
    matches_by_method.supplier_code_exact +
    matches_by_method.sku_exact +
    matches_by_method.normalized_name_exact +
    matches_by_method.embeddings_high +
    matches_by_method.llm_arbiter_match;
  const reviewNeeded = matches_by_method.embeddings_mid + matches_by_method.unresolved + matches_by_method.llm_arbiter_reject;

  const recommendation = buildRecommendation(matches_by_method, llmCfg);

  const report: DiscoveryReport = {
    generated_at: new Date().toISOString(),
    config: {
      anchorChannel: cfg.anchorChannel,
      embeddingThresholdHigh: cfg.embeddingThresholdHigh,
      embeddingThresholdMid: cfg.embeddingThresholdMid,
      llmProvider: llmCfg.provider === 'none' ? 'openai' : (llmCfg.provider as 'openai' | 'anthropic'),
      llmModelName: llmCfg.model || '(none)',
    },
    inputs: loaded.flatMap((l) =>
      l.files.map((f) => ({ channel: l.channel, file: f, row_count: l.products.length / l.files.length }))
    ),
    totals_by_channel,
    matches_by_method,
    match_rate_automatic: automaticHits / nonAnchorTotal,
    match_rate_review_needed: reviewNeeded / nonAnchorTotal,
    unresolved_samples: unresolved.slice(0, 20).map((u) => ({
      anchor: `${u.anchor.channel}:${u.anchor.external_id} — ${u.anchor.name}`,
      candidates: u.topCandidates.slice(0, 3).map((c) => `${c.channel}:${c.external_id} — ${c.name}`),
    })),
    hard_cases_for_llm: unresolved.length,
    llm_calls_made: llmCalls,
    llm_cost_estimate_usd: estimateCallCost(llmCalls, llmCfg),
    recommendation,
  };

  const jsonPath = resolve(cfg.outputDir, 'discovery-report.json');
  const mdPath = resolve(cfg.outputDir, 'discovery-report.md');
  writeJSONReport(jsonPath, report);
  writeMarkdownReport(mdPath, report);

  console.log(`\n✅ Done.`);
  console.log(`   Automatic match rate: ${(report.match_rate_automatic * 100).toFixed(1)}%`);
  console.log(`   Review queue size:    ${(report.match_rate_review_needed * 100).toFixed(1)}%`);
  console.log(`   JSON:  ${jsonPath}`);
  console.log(`   MD:    ${mdPath}`);
}

function buildRecommendation(
  byMethod: Record<MatchMethod, number>,
  llmCfg: { provider: string; model: string }
): DiscoveryReport['recommendation'] {
  const reviewQueue = byMethod.embeddings_mid + byMethod.unresolved + byMethod.llm_arbiter_reject;
  const llmContribution = byMethod.llm_arbiter_match;
  const llmRejectRate = byMethod.llm_arbiter_match + byMethod.llm_arbiter_reject > 0
    ? byMethod.llm_arbiter_reject / (byMethod.llm_arbiter_match + byMethod.llm_arbiter_reject)
    : 0;

  let rationale = `LLM arbiter resolvió ${llmContribution} casos automáticamente`;
  if (llmRejectRate > 0) {
    rationale += ` (tasa rechazo ${(llmRejectRate * 100).toFixed(0)}%)`;
  }
  rationale += `. Modelo: ${llmCfg.provider}:${llmCfg.model}. Si la tasa de rechazo > 30%, considerar subir a Sonnet/GPT-4o.`;

  return {
    starting_llm: `${llmCfg.provider}:${llmCfg.model}`,
    rationale,
    expected_validation_queue: reviewQueue,
  };
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
