import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface NumericInsight {
  type: 'numeric';
  count: number;
  null_count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  median: number;
  p10: number;
  p90: number;
  std_dev: number;
}

interface CategoricalInsight {
  type: 'categorical';
  count: number;
  null_count: number;
  unique_count: number;
  top_values: { value: string; count: number }[];
}

interface DateInsight {
  type: 'date';
  count: number;
  null_count: number;
  earliest: string;
  latest: string;
  span_days: number;
}

type ColumnInsight = NumericInsight | CategoricalInsight | DateInsight;

interface DatasetInsights {
  total_rows: number;
  total_columns: number;
  columns: Record<string, ColumnInsight>;
}

interface AnalystPayload {
  sql: string | null;
  explanation: string | null;
  insights: DatasetInsights;
  sample_rows: Record<string, unknown>[];
  all_rows?: Record<string, unknown>[];
}

export interface EnhanceResult {
  success: boolean;
  markdown: string | null;
  technical_insights: string | null;
  error?: string;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAX_INSIGHT_COLUMNS = 60;
const TOKEN_SAFE_LIMIT = 60_000;    // tighter cap — triggers earlier on large payloads
const SAMPLE_ROW_COUNT = 50;        // rows sent to GPT for context on large datasets
const SMALL_DATASET_THRESHOLD = 50; // send full rows only for small result sets (≤50 rows)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/;

@Injectable()
export class OpenAIService {
  private readonly openai: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      console.warn(
        'OpenAI API key not configured. OpenAI features will be disabled.',
      );
      this.openai = null;
      return;
    }

    this.openai = new OpenAI({ apiKey });
  }

  // ─────────────────────────────────────────────
  // PUBLIC METHODS
  // ─────────────────────────────────────────────

  async generateMarkdownResponse(
    userPrompt: string,
    cortexAnalystResponse: any,
  ): Promise<string> {
    const client = this.getClient();

    try {
      const results = this.extractResults(cortexAnalystResponse);

      console.log(
        `[OpenAI] Extracted ${results.length} rows, ` +
          `columns: ${results.length ? Object.keys(results[0]).join(', ') : 'none'}`,
      );

      const payload = this.buildPayload(cortexAnalystResponse, results);
      const userContent = this.buildUserContent(userPrompt, payload);

      this.assertPayloadSafe(this.getSystemPrompt() + userContent);

      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          { role: 'user', content: userContent },
        ],
        temperature: 0.5,
        max_tokens: 1500,
      });

      return (
        completion.choices[0]?.message?.content ??
        'Unable to generate response.'
      );
    } catch (error: any) {
      console.error('OpenAI API Error:', error);

      if (error.message?.includes('maximum context length')) {
        throw new Error(
          'Payload too large. Please try a more specific query.',
        );
      }

      throw new Error(
        `Failed to generate markdown response: ${error.message}`,
      );
    }
  }

  /**
   * Takes a base Cortex Analyst YAML (structurally correct but bare) and uses
   * GPT to add business-meaningful descriptions and verified_queries.
   * Returns the enriched YAML string, or the original if GPT fails.
   */
  async enrichSemanticModel(
    baseYaml: string,
    columns: { name: string; type: 'date' | 'numeric' | 'varchar' }[],
    clientName: string,
    tableName: string,
    database: string,
    schema: string,
  ): Promise<string> {
    if (!this.openai) return baseYaml;

    const columnList = columns
      .map(c => `  - ${c.name} (${c.type})`)
      .join('\n');

    const fqTable = `${database}.${schema}.${tableName}`;

    const systemPrompt = `You are a Cortex Analyst semantic model expert.
Your job is to enrich a base YAML semantic model with business-meaningful descriptions and verified_queries.
Return ONLY valid YAML — no markdown fences, no explanation, no commentary.`;

    const userPrompt = `Client: ${clientName}
Table: ${fqTable}

Columns detected (name and type):
${columnList}

Base YAML to enrich:
\`\`\`yaml
${baseYaml}
\`\`\`

Rules:
1. Add a short, business-meaningful "description" field to every dimension and fact based on the column name and type
2. For facts (numeric), also add a "default_aggregation" field — choose one of: sum, avg, min, max (lowercase only, no COUNT) based on what makes business sense for that column name
3. Do NOT add verified_queries — leave only the fields present in the base YAML plus the new description and default_aggregation fields
4. Keep all existing fields (name, base_table, data_type, expr) unchanged
5. Return ONLY valid YAML — no markdown code fences, no prose`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const raw = completion.choices[0]?.message?.content ?? '';

      // Strip any accidental markdown fences GPT might add
      let cleaned = raw
        .replace(/^```ya?ml\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      // Normalise default_aggregation: lowercase and replace COUNT (invalid in Snowflake) with sum
      cleaned = cleaned.replace(
        /(default_aggregation\s*:\s*)([A-Za-z]+)/g,
        (_match, prefix, value) => {
          const lower = value.toLowerCase();
          return prefix + (lower === 'count' ? 'sum' : lower);
        },
      );

      // Validate it's parseable YAML before returning
      const jsYaml = await import('js-yaml');
      jsYaml.load(cleaned);    // throws if invalid
      return cleaned;
    } catch (err: any) {
      console.error('[OpenAI] Semantic model enrichment failed:', err.message);
      return baseYaml;         // fall back to the structural YAML
    }
  }

  async enhanceResponse(
    cortexResponse: any,
    userPrompt: string,
  ): Promise<EnhanceResult> {
    try {
      const markdown = await this.generateMarkdownResponse(
        userPrompt,
        cortexResponse,
      );

      return {
        success: true,
        markdown,
        technical_insights: cortexResponse.sql ?? null,
      };
    } catch (error: any) {
      console.error('Error enhancing response with OpenAI:', error);

      return {
        success: false,
        markdown: null,
        technical_insights: cortexResponse.sql ?? null,
        error: error.message,
      };
    }
  }

  async *generateMarkdownResponseStream(
    userPrompt: string,
    cortexAnalystResponse: any,
  ): AsyncGenerator<string, void, unknown> {
    const client = this.getClient();

    try {
      const results = this.extractResults(cortexAnalystResponse);

      console.log(
        `[OpenAI Stream] Extracted ${results.length} rows, ` +
          `columns: ${results.length ? Object.keys(results[0]).join(', ') : 'none'}`,
      );

      const payload = this.buildPayload(cortexAnalystResponse, results);
      const userContent = this.buildUserContent(userPrompt, payload);

      this.assertPayloadSafe(this.getSystemPrompt() + userContent);

      const stream = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          { role: 'user', content: userContent },
        ],
        temperature: 0.5,
        max_tokens: 1500,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      }
    } catch (error: any) {
      console.error('OpenAI Streaming API Error:', error);
      throw new Error(
        `Failed to generate streaming markdown response: ${error.message}`,
      );
    }
  }

  async *enhanceResponseStream(
    cortexResponse: any,
    userPrompt: string,
  ): AsyncGenerator<any, void, unknown> {
    try {
      yield { type: 'start', success: true, cortexData: cortexResponse };

      for await (const chunk of this.generateMarkdownResponseStream(
        userPrompt,
        cortexResponse,
      )) {
        yield { type: 'chunk', content: chunk };
      }

      yield { type: 'complete' };
    } catch (error: any) {
      console.error('Error enhancing response with OpenAI streaming:', error);
      yield { type: 'error', error: error.message };
    }
  }

  // ─────────────────────────────────────────────
  // RESULT EXTRACTION
  // Handles every known Cortex Analyst response shape
  // ─────────────────────────────────────────────

  /**
   * Cortex Analyst / Snowflake can return data in many shapes:
   *
   *  1. { results: [ {col: val}, ... ] }                    — array of objects
   *  2. { data: [ {col: val}, ... ] }                       — "data" key variant
   *  3. { rows: [ {col: val}, ... ] }                       — "rows" key variant
   *  4. { columns: ["A","B"], data: [[1,2],[3,4]] }         — columnar format
   *  5. { results: { columns: [...], data: [[...]] } }      — nested columnar
   *  6. { message: { results: [...] } }                     — wrapped in message
   *  7. { result: { data: [...] } }                         — singular "result"
   *  8. [ {col: val}, ... ]                                 — bare array (rare)
   *
   * This method normalises all of them into Record<string, unknown>[].
   */
  private extractResults(response: any): Record<string, unknown>[] {
    if (!response) {
      console.warn('[OpenAI] extractResults called with null/undefined response');
      return [];
    }

    // Log top-level keys for debugging
    if (typeof response === 'object' && !Array.isArray(response)) {
      console.log('[OpenAI] Response keys:', Object.keys(response));
    }

    // Unwrap common wrappers: response.message, response.result
    const unwrapped = response.message ?? response.result ?? response;

    // Try each known location for row data
    const candidates = [
      { label: 'results', data: unwrapped.results },
      { label: 'data', data: unwrapped.data },
      { label: 'rows', data: unwrapped.rows },
      { label: 'root', data: unwrapped },
    ];

    for (const { label, data: candidate } of candidates) {
      if (!candidate) continue;

      // Shape 1/2/3/8: array of objects → use directly
      if (Array.isArray(candidate) && candidate.length > 0) {
        if (typeof candidate[0] === 'object' && !Array.isArray(candidate[0])) {
          console.log(`[OpenAI] Found ${candidate.length} rows via "${label}" (array of objects)`);
          return candidate as Record<string, unknown>[];
        }

        // Shape 4/5: array of arrays → need column names to convert
        if (Array.isArray(candidate[0])) {
          const columns = this.extractColumnNames(unwrapped);
          if (columns.length > 0) {
            const converted = this.columnarToObjects(columns, candidate);
            console.log(`[OpenAI] Converted ${converted.length} rows via "${label}" (columnar format)`);
            return converted;
          }
        }
      }

      // Shape 4/5: candidate is an object with its own columns + data
      if (
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate)
      ) {
        const nested = candidate as any;
        if (Array.isArray(nested.columns) && Array.isArray(nested.data)) {
          const colNames = nested.columns.map((c: any) =>
            typeof c === 'string' ? c : c.name ?? c.label ?? String(c),
          );
          const converted = this.columnarToObjects(colNames, nested.data);
          console.log(`[OpenAI] Converted ${converted.length} rows via "${label}" (nested columnar)`);
          return converted;
        }
      }
    }

    // Nothing found
    console.warn(
      '[OpenAI] Could not extract results. Response shape:',
      JSON.stringify(response).slice(0, 500),
    );
    return [];
  }

  private extractColumnNames(obj: any): string[] {
    const raw =
      obj.columns ?? obj.column_names ?? obj.fields ?? obj.schema?.fields;

    if (!Array.isArray(raw)) return [];

    return raw.map((c: any) =>
      typeof c === 'string' ? c : c.name ?? c.label ?? String(c),
    );
  }

  private columnarToObjects(
    columns: string[],
    rows: any[][],
  ): Record<string, unknown>[] {
    return rows
      .filter(Array.isArray)
      .map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = i < row.length ? row[i] : null;
        }
        return obj;
      });
  }

  // ─────────────────────────────────────────────
  // PAYLOAD BUILDER
  // ─────────────────────────────────────────────

  private buildPayload(
    cortexAnalystResponse: any,
    results: Record<string, unknown>[],
  ): AnalystPayload {
    const insights = this.computeInsights(results);
    const isSmallDataset = results.length <= SMALL_DATASET_THRESHOLD;

    const payload: AnalystPayload = {
      sql: cortexAnalystResponse.sql ?? null,
      explanation: cortexAnalystResponse.explanation ?? null,
      insights,
      // For large datasets send a sample; for small ones skip sample_rows entirely
      // since all_rows already covers the data — avoids sending the same rows twice
      sample_rows: isSmallDataset ? [] : this.sampleResults(results, SAMPLE_ROW_COUNT),
    };

    // For small datasets send all rows once so GPT can reference specific values
    if (isSmallDataset && results.length > 0) {
      payload.all_rows = results;
    }

    return payload;
  }

  // ─────────────────────────────────────────────
  // INSIGHT COMPUTATION
  // Server-side — accurate, free, works on any dataset size
  // ─────────────────────────────────────────────

  private computeInsights(results: Record<string, unknown>[]): DatasetInsights {
    if (!results.length) {
      return { total_rows: 0, total_columns: 0, columns: {} };
    }

    // Collect ALL keys across every row (handles sparse / inconsistent rows)
    const keySet = new Set<string>();
    for (const row of results) {
      for (const k of Object.keys(row)) {
        keySet.add(k);
      }
    }

    const allKeys = Array.from(keySet);
    const selectedKeys = allKeys.slice(0, MAX_INSIGHT_COLUMNS);
    const columns: Record<string, ColumnInsight> = {};

    for (const key of selectedKeys) {
      const rawValues = results.map((r) => r[key]);
      const nullCount = rawValues.filter(
        (v) => v === null || v === undefined || v === '',
      ).length;
      const nonNullValues = rawValues.filter(
        (v) => v !== null && v !== undefined && v !== '',
      );

      if (nonNullValues.length === 0) {
        columns[key] = {
          type: 'categorical',
          count: 0,
          null_count: nullCount,
          unique_count: 0,
          top_values: [],
        };
        continue;
      }

      const numericValues = this.extractNumericValues(nonNullValues);

      if (numericValues.length >= nonNullValues.length * 0.8) {
        columns[key] = this.computeNumericInsight(numericValues, nullCount);
        continue;
      }

      const dateValues = this.extractDateValues(nonNullValues);

      if (dateValues.length >= nonNullValues.length * 0.8) {
        columns[key] = this.computeDateInsight(dateValues, nullCount);
        continue;
      }

      columns[key] = this.computeCategoricalInsight(nonNullValues, nullCount);
    }

    return {
      total_rows: results.length,
      total_columns: allKeys.length,
      columns,
    };
  }

  // ── Numeric helpers ──

  private extractNumericValues(values: unknown[]): number[] {
    const nums: number[] = [];

    for (const v of values) {
      if (typeof v === 'number' && !Number.isNaN(v)) {
        nums.push(v);
        continue;
      }

      if (typeof v === 'string') {
        const cleaned = v.replace(/,/g, '').trim();
        if (cleaned === '') continue;
        const parsed = Number(cleaned);
        if (!Number.isNaN(parsed)) {
          nums.push(parsed);
        }
      }
    }

    return nums;
  }

  private computeNumericInsight(
    values: number[],
    nullCount: number,
  ): NumericInsight {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / n;

    const median =
      n % 2 === 1
        ? sorted[Math.floor(n / 2)]
        : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    const variance =
      values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    return {
      type: 'numeric',
      count: n,
      null_count: nullCount,
      sum: this.round(sum),
      avg: this.round(avg),
      min: sorted[0],
      max: sorted[n - 1],
      median: this.round(median),
      p10: sorted[Math.floor(n * 0.1)],
      p90: sorted[Math.floor(n * 0.9)],
      std_dev: this.round(stdDev),
    };
  }

  // ── Date helpers ──

  private extractDateValues(values: unknown[]): Date[] {
    const dates: Date[] = [];

    for (const v of values) {
      if (v instanceof Date && !isNaN(v.getTime())) {
        dates.push(v);
        continue;
      }

      if (typeof v === 'string' && ISO_DATE_RE.test(v)) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          dates.push(d);
        }
      }
    }

    return dates;
  }

  private computeDateInsight(dates: Date[], nullCount: number): DateInsight {
    const timestamps = dates.map((d) => d.getTime()).sort((a, b) => a - b);
    const earliest = new Date(timestamps[0]);
    const latest = new Date(timestamps[timestamps.length - 1]);
    const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
    const spanDays = Math.round(spanMs / (1000 * 60 * 60 * 24));

    return {
      type: 'date',
      count: dates.length,
      null_count: nullCount,
      earliest: earliest.toISOString().split('T')[0],
      latest: latest.toISOString().split('T')[0],
      span_days: spanDays,
    };
  }

  // ── Categorical helpers ──

  private computeCategoricalInsight(
    values: unknown[],
    nullCount: number,
  ): CategoricalInsight {
    const freq: Record<string, number> = {};

    for (const v of values) {
      const k = String(v);
      freq[k] = (freq[k] || 0) + 1;
    }

    const topValues = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }));

    return {
      type: 'categorical',
      count: values.length,
      null_count: nullCount,
      unique_count: Object.keys(freq).length,
      top_values: topValues,
    };
  }

  // ── Sampling ──

  private sampleResults(
    results: Record<string, unknown>[],
    max: number,
  ): Record<string, unknown>[] {
    if (results.length <= max) return results;

    const sample: Record<string, unknown>[] = [results[0]];
    const step = (results.length - 1) / (max - 1);

    for (let i = 1; i < max - 1; i++) {
      sample.push(results[Math.round(i * step)]);
    }

    sample.push(results[results.length - 1]);
    return sample;
  }

  // ─────────────────────────────────────────────
  // PROMPT HELPERS
  // ─────────────────────────────────────────────

  private getSystemPrompt(): string {
    return `You are a helpful data analyst assistant presenting insights to CXO-level stakeholders.
You will receive pre-computed dataset insights (sum, avg, min, max, median, std_dev, date ranges, top values, etc.) along with sample or complete row data.

Your task:
1. Use the pre-computed insights to answer the user's question — do NOT recompute anything
2. Format the response clearly in markdown for a CXO audience
3. Be concise, actionable, and data-driven
4. If all_rows is provided, present ALL rows in a complete markdown table — NEVER truncate, group, or add an "Others" row

Output format:
### Insights
<Direct answer to the question, derived from the data>

### Interpretation
<How you derived this answer from the provided stats>

### Data Summary
{{DATA_TABLE}}

(The frontend replaces {{DATA_TABLE}} with a live paginated table built directly from the raw database results. Output the literal text {{DATA_TABLE}} here — do NOT render a table yourself, do NOT remove or modify this placeholder.)

### Conclusion *(include only if data is complex)*
<Optional — only for multi-dimensional or nuanced findings>

### Recommendations *(include only if actionable)*
<Optional — CXO-level action pointers based on the data>

Critical rules:
- Use the exact numbers from insights — never approximate or recompute
- Use proper markdown (headers, bold)
- Note any columns with high null_count — data completeness matters
- For date-type columns, reference the date range and span
- If total_rows > 0, the dataset HAS data — always reference it in your Insights and Interpretation
- NEVER say "0 rows" or "no data" if total_rows > 0
- If results are genuinely empty (total_rows is 0), explain that the query returned no matching data`;
  }

  private buildUserContent(
    userPrompt: string,
    payload: AnalystPayload,
  ): string {
    return `User Question: ${userPrompt}

Dataset Insights (pre-computed from full dataset, 100% accurate):
${JSON.stringify(payload, null, 2)}

Instructions:
- insights.total_rows = ${payload.insights.total_rows} — this is how many rows the query returned
- Use insights.columns for all statistics
- null_count shows missing values per column — flag if significant
- sample_rows are for structural context only — do NOT use them for calculations or table rendering
- Format your response as clean markdown for a CXO audience
- IMPORTANT: The data exists and has ${payload.insights.total_rows} rows — present it`;
  }

  // ─────────────────────────────────────────────
  // SAFETY GUARDS
  // ─────────────────────────────────────────────

  private getClient(): OpenAI {
    if (!this.openai) {
      throw new Error(
        'OpenAI service is not configured. Please set OPENAI_API_KEY in environment variables.',
      );
    }
    return this.openai;
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  private assertPayloadSafe(content: string): void {
    const estimatedTokens = this.estimateTokenCount(content);

    if (estimatedTokens > TOKEN_SAFE_LIMIT) {
      throw new Error(
        `Payload too large: ~${estimatedTokens} estimated tokens (limit: ${TOKEN_SAFE_LIMIT}). ` +
          `Try a more specific query or reduce the number of columns.`,
      );
    }
  }

  // ─────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────

  private round(n: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor;
  }
}