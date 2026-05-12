import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { DiscoveryReport } from './types.js';

export function writeJSONReport(path: string, report: DiscoveryReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8');
}

export function writeMarkdownReport(path: string, report: DiscoveryReport): void {
  mkdirSync(dirname(path), { recursive: true });

  const total = Object.values(report.totals_by_channel).reduce((a, b) => a + b, 0);
  const auto = report.match_rate_automatic;
  const review = report.match_rate_review_needed;
  const methodRows = Object.entries(report.matches_by_method)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `| \`${m}\` | ${n} | ${pct(n / total)} |`)
    .join('\n');

  const sampleRows = report.unresolved_samples
    .slice(0, 10)
    .map((s, i) => `${i + 1}. **${s.anchor}**\n   Top candidates: ${s.candidates.slice(0, 3).map((c) => `\`${c}\``).join(', ') || '_none_'}`)
    .join('\n');

  const lines = [
    `# Discovery Report — Catálogo Matching Baseline`,
    ``,
    `Generated: ${report.generated_at}`,
    ``,
    `## Configuración`,
    ``,
    `- Anchor channel: \`${report.config.anchorChannel}\``,
    `- LLM provider: \`${report.config.llmProvider}\` (\`${report.config.llmModelName}\`)`,
    `- Embedding/Jaccard thresholds: high ≥ ${report.config.embeddingThresholdHigh}, mid ≥ ${report.config.embeddingThresholdMid}`,
    ``,
    `## Inputs`,
    ``,
    '| Channel | File | Rows |',
    '|---------|------|-----:|',
    ...report.inputs.map((i) => `| \`${i.channel}\` | \`${i.file}\` | ${i.row_count} |`),
    ``,
    `## Totales por canal`,
    ``,
    '| Channel | Productos cargados |',
    '|---------|-------------------:|',
    ...Object.entries(report.totals_by_channel).map(([ch, n]) => `| \`${ch}\` | ${n} |`),
    ``,
    `## Matches contra anchor (\`${report.config.anchorChannel}\`)`,
    ``,
    '| Método | # matches | % del total no-anchor |',
    '|--------|----------:|----------------------:|',
    methodRows || '| _(sin datos)_ | 0 | 0% |',
    ``,
    `**Tasa automática (sin revisión humana):** ${pct(auto)}`,
    `**Tasa que requiere revisión:** ${pct(review)}`,
    ``,
    `**Llamadas LLM:** ${report.llm_calls_made} / ${report.hard_cases_for_llm} casos duros`,
    `**Costo estimado IA:** USD ${report.llm_cost_estimate_usd.toFixed(4)}`,
    ``,
    `## Casos no resueltos (muestra)`,
    ``,
    sampleRows || '_No unresolved samples._',
    ``,
    `## Recomendación`,
    ``,
    `- **Modelo IA inicial recomendado:** \`${report.recommendation.starting_llm}\``,
    `- **Por qué:** ${report.recommendation.rationale}`,
    `- **Cola de validación esperada al arrancar Fase 2:** ${report.recommendation.expected_validation_queue} ítems`,
    ``,
    `---`,
    ``,
    `*Generado por \`scripts/discovery/match-explorer.ts\`. Re-correr con \`npm run match\` cada vez que llegue un CSV nuevo o se ajuste un mapping profile.*`,
    ``,
  ];

  writeFileSync(path, lines.join('\n'), 'utf-8');
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export { join };
