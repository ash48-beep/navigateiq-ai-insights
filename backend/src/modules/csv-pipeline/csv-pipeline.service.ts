import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { CsvAnalyzerService, ColumnAnalysis, CsvAnalysisResult } from './csv-analyzer.service';
import { ClientSnowflakeService } from './client-snowflake.service';
import { ClientsService } from '../clients/clients.service';
import { SnowflakeAnalystService } from '../snowflake-analyst/snowflake-analyst.service';
import { OpenAIService } from '../openai/openai.service';

export type UploadMode = 'replace' | 'append' | 'append_extend';

export interface UploadResult {
  mode: UploadMode;
  rowsLoaded: number;
  tableName: string;
  columnsDetected: {
    name: string;
    type: string;
    format?: string;
    confident?: boolean;
  }[];
  newColumns?: string[];
  warnings: { column: string; nullCount: number; message: string }[];
  ambiguousColumns: string[];
}

@Injectable()
export class CsvPipelineService {
  private readonly logger = new Logger(CsvPipelineService.name);

  constructor(
    private readonly analyzer: CsvAnalyzerService,
    private readonly sfService: ClientSnowflakeService,
    private readonly clientsService: ClientsService,
    private readonly analystService: SnowflakeAnalystService,
    private readonly openaiService: OpenAIService,
  ) {}

  // ── Main entry point ─────────────────────────────────────────────────────

  async uploadAndLoad(
    clientSlug: string,
    fileBuffer: Buffer,
    mode: UploadMode = 'replace',
  ): Promise<UploadResult> {

    // 1. Load & validate client config
    const client = await this.clientsService.getClient(clientSlug);

    const missingFields: string[] = [];
    if (!client.snowflakeAccount)  missingFields.push('Account');
    if (!client.snowflakeUser)     missingFields.push('User');
    if (!client.snowflakePassword) missingFields.push('Password');
    if (!client.snowflakeDatabase) missingFields.push('Database');
    if (!client.snowflakeSchema)   missingFields.push('Schema');
    if (!client.snowflakeTable)    missingFields.push('Target Table Name');

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Snowflake config incomplete. Missing: ${missingFields.join(', ')}. ` +
        'Fill these in under the Data Config section.',
      );
    }

    const tableName     = client.snowflakeTable!.toUpperCase();
    const stageName     = (client.snowflakeStageName || 'CSV_UPLOAD_STAGE').toUpperCase();
    const existingDates = (client.dateColumns || {}) as Record<string, string>;

    // 2. Analyze CSV
    const analysis = this.analyzer.analyze(fileBuffer, existingDates);
    this.logger.log(`CSV analysis: ${analysis.columns.length} cols, ${analysis.rowCount} sample rows`);

    const updatedDateCols: Record<string, string> = { ...existingDates };
    const ambiguousColumns: string[] = [];

    for (const col of analysis.columns) {
      if (col.detectedType === 'date' && col.dateFormat) {
        updatedDateCols[col.sanitizedName] = col.dateFormat;
        if (!col.confident) ambiguousColumns.push(col.sanitizedName);
      }
    }

    if (Object.keys(updatedDateCols).length > 0) {
      await this.clientsService.updateClient(clientSlug, { dateColumns: updatedDateCols });
    }

    // 3. Write CSV to temp file
    const tmpFilename = `csv_${clientSlug}_${Date.now()}.csv`;
    const tmpPath     = path.join(os.tmpdir(), tmpFilename);
    fs.writeFileSync(tmpPath, fileBuffer);

    let connection: any;
    try {
      // 4. Connect
      connection = await this.sfService.createConnection(client);

      // 5. Stage + file format
      await this.sfService.execute(connection, `CREATE STAGE IF NOT EXISTS ${stageName}`);

      await this.sfService.execute(connection, `
        CREATE OR REPLACE FILE FORMAT csv_pipeline_fmt
          TYPE                     = 'CSV'
          FIELD_OPTIONALLY_ENCLOSED_BY = '"'
          SKIP_HEADER              = 1
          NULL_IF                  = ('NULL', 'null', 'N/A', '')
          EMPTY_FIELD_AS_NULL      = TRUE
          TRIM_SPACE               = TRUE
      `);

      // 6. PUT file to stage
      await this.sfService.execute(
        connection,
        `PUT file://${tmpPath} @${stageName} AUTO_COMPRESS=FALSE OVERWRITE=TRUE`,
      );
      this.logger.log(`PUT to @${stageName} done`);

      // 7. Load into VARCHAR staging table
      const stagingTable = `${tableName}_STAGING`;
      const colDefs = analysis.sanitizedHeaders.map(c => `"${c}" VARCHAR`).join(', ');

      await this.sfService.execute(
        connection,
        `CREATE OR REPLACE TABLE ${stagingTable} (${colDefs})`,
      );

      await this.sfService.execute(connection, `
        COPY INTO ${stagingTable}
        FROM @${stageName}/${tmpFilename}
        FILE_FORMAT = (FORMAT_NAME = csv_pipeline_fmt)
        ON_ERROR    = 'CONTINUE'
      `);

      const countRows = await this.sfService.execute(
        connection, `SELECT COUNT(*) AS CNT FROM ${stagingTable}`,
      );
      const rowsLoaded: number = countRows[0]?.CNT ?? countRows[0]?.cnt ?? 0;
      this.logger.log(`Rows in staging: ${rowsLoaded}`);

      // 8. Mode-specific final table operation
      let newColumns: string[] | undefined;
      let rowCountWarning: { column: string; nullCount: number; message: string } | null = null;

      if (mode === 'replace') {
        rowCountWarning = await this.doReplace(connection, analysis, tableName, stagingTable, rowsLoaded);

      } else if (mode === 'append') {
        await this.doAppend(connection, analysis, tableName, stagingTable, client.snowflakeSchema!);

      } else if (mode === 'append_extend') {
        newColumns = await this.doAppendExtend(
          connection, analysis, tableName, stagingTable, client.snowflakeSchema!,
        );
      }

      // 9. Null-count warnings on typed columns
      const warnings = await this.collectNullWarnings(connection, analysis, tableName);
      if (rowCountWarning) warnings.unshift(rowCountWarning);

      // 10. Drop staging table
      await this.sfService.execute(connection, `DROP TABLE IF EXISTS ${stagingTable}`);

      // 11. Regenerate semantic model (replace and append_extend only — schema changed)
      if (mode !== 'append') {
        try {
          const modelName    = `${clientSlug}_semantic_model`;
          const baseYaml     = this.buildSemanticYaml(client, tableName, analysis.columns, modelName);
          const enrichedYaml = await this.openaiService.enrichSemanticModel(
            baseYaml,
            analysis.columns.map(c => ({ name: c.sanitizedName, type: c.detectedType })),
            client.name, tableName,
            client.snowflakeDatabase || '', client.snowflakeSchema || '',
          );
          await this.analystService.uploadAndReloadModel(enrichedYaml, modelName);
          this.logger.log('Semantic model enriched, uploaded and reloaded');
        } catch (err) {
          this.logger.error(`Semantic model generation failed (non-fatal): ${err.message}`);
        }
      }

      return {
        mode,
        rowsLoaded,
        tableName,
        columnsDetected: analysis.columns.map(c => ({
          name:      c.sanitizedName,
          type:      c.detectedType,
          format:    c.dateFormat,
          confident: c.confident,
        })),
        newColumns,
        warnings,
        ambiguousColumns,
      };

    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      if (connection) await this.sfService.destroy(connection);
    }
  }

  // ── Mode: Replace ────────────────────────────────────────────────────────

  private async doReplace(
    connection: any,
    analysis: CsvAnalysisResult,
    tableName: string,
    stagingTable: string,
    newRowCount: number,
  ): Promise<{ column: string; nullCount: number; message: string } | null> {
    // Row count sanity check — warn if new CSV is < 10% of existing table
    let warning: { column: string; nullCount: number; message: string } | null = null;
    try {
      const result = await this.sfService.execute(
        connection, `SELECT COUNT(*) AS CNT FROM ${tableName}`,
      );
      const existingCount: number = result[0]?.CNT ?? result[0]?.cnt ?? 0;
      if (existingCount > 0 && newRowCount < existingCount * 0.1) {
        warning = {
          column: 'ROW_COUNT',
          nullCount: 0,
          message:
            `Row count warning: existing table had ${existingCount.toLocaleString()} rows but ` +
            `new CSV has only ${newRowCount.toLocaleString()} rows. Verify you uploaded the correct file.`,
        };
        this.logger.warn(`[replace] Row count sanity — existing: ${existingCount}, new: ${newRowCount}`);
      }
    } catch { /* table doesn't exist yet — no check needed */ }

    const selectParts = this.buildSelectParts(analysis.columns);
    await this.sfService.execute(connection, `
      CREATE OR REPLACE TABLE ${tableName} AS
      SELECT ${selectParts.join(', ')}
      FROM ${stagingTable}
    `);
    this.logger.log(`[replace] Table ${tableName} recreated`);
    return warning;
  }

  // ── Mode: Append (same columns, MERGE on ID) ─────────────────────────────

  private async doAppend(
    connection: any,
    analysis: CsvAnalysisResult,
    tableName: string,
    stagingTable: string,
    schema: string,
  ): Promise<void> {
    const existingCols = await this.getExistingColumns(connection, tableName, schema);

    if (existingCols.length === 0) {
      this.logger.warn(`[append] Table ${tableName} not found — falling back to replace`);
      await this.doReplace(connection, analysis, tableName, stagingTable, analysis.rowCount);
      return;
    }

    const csvCols = analysis.sanitizedHeaders;

    // Schema diff check
    const missing = existingCols.filter(c => !csvCols.includes(c));
    const extra   = csvCols.filter(c => !existingCols.includes(c));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Append failed — CSV is missing columns that exist in the table: ${missing.join(', ')}. ` +
        'Make sure the CSV has all existing columns, or use Full Replace.',
      );
    }
    if (extra.length > 0) {
      throw new BadRequestException(
        `Append failed — CSV has extra columns not in the table: ${extra.join(', ')}. ` +
        'Use "Append + new columns" mode to extend the schema, or use Full Replace.',
      );
    }

    // Require ID column for MERGE deduplication
    if (!csvCols.includes('ID')) {
      throw new BadRequestException(
        'Append mode requires an "ID" column in your CSV for deduplication. ' +
        'Add an "ID" column with a unique value per row, or use Full Replace.',
      );
    }

    // MERGE: update rows with matching ID, insert new ones
    const selectParts = this.buildSelectParts(analysis.columns);
    const dataCols    = csvCols.filter(c => c !== 'ID');
    const updateSet   = dataCols.map(c => `target."${c}" = source."${c}"`).join(', ');
    const insertCols  = csvCols.map(c => `"${c}"`).join(', ');
    const insertVals  = csvCols.map(c => `source."${c}"`).join(', ');

    await this.sfService.execute(connection, `
      MERGE INTO ${tableName} AS target
      USING (SELECT ${selectParts.join(', ')} FROM ${stagingTable}) AS source
      ON target."ID" = source."ID"
      WHEN MATCHED THEN UPDATE SET ${updateSet}
      WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})
    `);
    this.logger.log(`[append] MERGE INTO ${tableName} done`);
  }

  // ── Mode: Append + extend schema ─────────────────────────────────────────

  private async doAppendExtend(
    connection: any,
    analysis: CsvAnalysisResult,
    tableName: string,
    stagingTable: string,
    schema: string,
  ): Promise<string[]> {
    const existingCols = await this.getExistingColumns(connection, tableName, schema);

    if (existingCols.length === 0) {
      this.logger.warn(`[append_extend] Table ${tableName} not found — falling back to replace`);
      await this.doReplace(connection, analysis, tableName, stagingTable, analysis.rowCount);
      return [];
    }

    const csvCols = analysis.sanitizedHeaders;

    // All existing columns must be present in the CSV (no removals allowed)
    const missing = existingCols.filter(c => !csvCols.includes(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Append+extend failed — CSV is missing existing columns: ${missing.join(', ')}. ` +
        'All existing columns must be present. Use Full Replace to change the schema entirely.',
      );
    }

    // Require ID column for MERGE deduplication
    if (!csvCols.includes('ID')) {
      throw new BadRequestException(
        'Append+extend mode requires an "ID" column for deduplication. ' +
        'Add an "ID" column or use Full Replace.',
      );
    }

    // Identify new columns
    const newCols = csvCols.filter(c => !existingCols.includes(c));
    this.logger.log(`[append_extend] New columns to add: ${newCols.join(', ') || 'none'}`);

    // ALTER TABLE to add new columns
    for (const col of newCols) {
      const colAnalysis = analysis.columns.find(c => c.sanitizedName === col);
      let snowflakeType = 'VARCHAR';
      if (colAnalysis?.detectedType === 'numeric') snowflakeType = 'DOUBLE';
      if (colAnalysis?.detectedType === 'date')    snowflakeType = 'DATE';

      await this.sfService.execute(
        connection,
        `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${col}" ${snowflakeType}`,
      );
    }

    // MERGE: update rows with matching ID, insert new ones (including new columns)
    const selectParts = this.buildSelectParts(analysis.columns);
    const dataCols    = csvCols.filter(c => c !== 'ID');
    const updateSet   = dataCols.map(c => `target."${c}" = source."${c}"`).join(', ');
    const insertCols  = csvCols.map(c => `"${c}"`).join(', ');
    const insertVals  = csvCols.map(c => `source."${c}"`).join(', ');

    await this.sfService.execute(connection, `
      MERGE INTO ${tableName} AS target
      USING (SELECT ${selectParts.join(', ')} FROM ${stagingTable}) AS source
      ON target."ID" = source."ID"
      WHEN MATCHED THEN UPDATE SET ${updateSet}
      WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})
    `);
    this.logger.log(`[append_extend] MERGE INTO ${tableName} with ${newCols.length} new column(s)`);

    return newCols;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildSelectParts(columns: ColumnAnalysis[]): string[] {
    return columns.map(col => {
      const q = `"${col.sanitizedName}"`;
      if (col.detectedType === 'date' && col.dateFormat) {
        return `TRY_TO_DATE(${q}, '${col.dateFormat}') AS ${q}`;
      } else if (col.detectedType === 'numeric') {
        return `TRY_TO_DOUBLE(${q}) AS ${q}`;
      }
      return q;
    });
  }

  private async getExistingColumns(
    connection: any,
    tableName: string,
    schema: string,
  ): Promise<string[]> {
    try {
      const rows = await this.sfService.execute(connection, `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = UPPER('${schema}')
          AND TABLE_NAME   = UPPER('${tableName}')
        ORDER BY ORDINAL_POSITION
      `);
      return rows.map((r: any) => r.COLUMN_NAME ?? r.column_name ?? '').filter(Boolean);
    } catch {
      return [];
    }
  }

  private async collectNullWarnings(
    connection: any,
    analysis: CsvAnalysisResult,
    tableName: string,
  ): Promise<{ column: string; nullCount: number; message: string }[]> {
    const warnings: { column: string; nullCount: number; message: string }[] = [];

    for (const col of analysis.columns) {
      if (col.detectedType !== 'date' && col.detectedType !== 'numeric') continue;
      try {
        const result = await this.sfService.execute(
          connection,
          `SELECT COUNT(*) AS CNT FROM ${tableName} WHERE "${col.sanitizedName}" IS NULL`,
        );
        const nullCount: number = result[0]?.CNT ?? result[0]?.cnt ?? 0;
        if (nullCount > 0) {
          warnings.push({
            column: col.sanitizedName,
            nullCount,
            message: col.detectedType === 'date'
              ? `${nullCount} row(s) had unparseable date values in "${col.sanitizedName}" (format: ${col.dateFormat}${!col.confident ? ' — auto-guessed' : ''}).`
              : `${nullCount} row(s) had non-numeric values in "${col.sanitizedName}".`,
          });
        }
      } catch { /* ignore — column may not exist in append_extend partial state */ }
    }

    return warnings;
  }

  private buildSemanticYaml(
    client: any,
    tableName: string,
    columns: ColumnAnalysis[],
    modelName: string,
  ): string {
    const dimensions = columns
      .filter(c => c.detectedType !== 'numeric')
      .map(c => ({
        name:      c.sanitizedName.toLowerCase(),
        expr:      c.sanitizedName,
        data_type: c.detectedType === 'date' ? 'DATE' : 'VARCHAR',
      }));

    const facts = columns
      .filter(c => c.detectedType === 'numeric')
      .map(c => ({
        name:                c.sanitizedName.toLowerCase(),
        expr:                c.sanitizedName,
        data_type:           'NUMBER',
        default_aggregation: 'sum',
      }));

    const model = {
      name: modelName,
      tables: [{
        name:       tableName.toLowerCase(),
        base_table: {
          database: client.snowflakeDatabase,
          schema:   client.snowflakeSchema,
          table:    tableName,
        },
        ...(dimensions.length > 0 ? { dimensions } : {}),
        ...(facts.length > 0      ? { facts }      : {}),
      }],
    };

    return yaml.dump(model, { indent: 2, lineWidth: -1 });
  }
}
