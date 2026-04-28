import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { CsvAnalyzerService, ColumnAnalysis } from './csv-analyzer.service';
import { ClientSnowflakeService } from './client-snowflake.service';
import { ClientsService, ClientRecord } from '../clients/clients.service';
import { SnowflakeAnalystService } from '../snowflake-analyst/snowflake-analyst.service';
import { OpenAIService } from '../openai/openai.service';

export interface UploadResult {
  rowsLoaded: number;
  tableName: string;
  columnsDetected: {
    name: string;
    type: string;
    format?: string;
    confident?: boolean;
  }[];
  warnings: { column: string; nullCount: number; message: string }[];
  ambiguousColumns: string[];  // date cols where day/month order couldn't be confirmed
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

  async uploadAndLoad(
    clientSlug: string,
    fileBuffer: Buffer,
    _originalFilename: string,
  ): Promise<UploadResult> {
    // ── 1. Load client config ─────────────────────────────────────────────
    const client = await this.clientsService.getClient(clientSlug);

    const missingFields: string[] = [];
    if (!client.snowflakeAccount)  missingFields.push('Account');
    if (!client.snowflakeUser)     missingFields.push('User');
    if (!client.snowflakePassword) missingFields.push('Password');
    if (!client.snowflakeWarehouse) missingFields.push('Warehouse');
    if (!client.snowflakeDatabase) missingFields.push('Database');
    if (!client.snowflakeSchema)   missingFields.push('Schema');
    if (!client.snowflakeTable)    missingFields.push('Target Table Name');

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Snowflake config incomplete for this client. Missing: ${missingFields.join(', ')}. ` +
        'Fill these in under the Snowflake Connection and Data Config sections.',
      );
    }

    const tableName      = (client.snowflakeTable    || 'UPLOADED_DATA').toUpperCase();
    const stageName      = (client.snowflakeStageName || 'CSV_UPLOAD_STAGE').toUpperCase();
    const idPrefix       = client.idPrefix ?? 'L-';   // empty string = no ID column
    const existingDates  = (client.dateColumns || {}) as Record<string, string>;

    // ── 2. Analyze CSV ────────────────────────────────────────────────────
    const analysis = this.analyzer.analyze(fileBuffer, existingDates);
    this.logger.log(
      `CSV analysis: ${analysis.columns.length} columns, ${analysis.rowCount} sample rows`,
    );

    // Track which date columns are newly detected (so we can save back to config)
    const updatedDateCols: Record<string, string> = { ...existingDates };
    const ambiguousColumns: string[] = [];

    for (const col of analysis.columns) {
      if (col.detectedType === 'date' && col.dateFormat) {
        updatedDateCols[col.sanitizedName] = col.dateFormat;
        if (!col.confident) {
          ambiguousColumns.push(col.sanitizedName);
        }
      }
    }

    // Persist detected date column formats back to ClientRegistry
    if (Object.keys(updatedDateCols).length > 0) {
      await this.clientsService.updateClient(clientSlug, { dateColumns: updatedDateCols });
    }

    // ── 3. Write CSV to temp file (needed for Snowflake PUT command) ───────
    const tmpFilename = `csv_${clientSlug}_${Date.now()}.csv`;
    const tmpPath     = path.join(os.tmpdir(), tmpFilename);
    fs.writeFileSync(tmpPath, fileBuffer);
    this.logger.log(`CSV saved to temp: ${tmpPath}`);

    let connection: any;
    try {
      // ── 4. Connect to client's Snowflake ──────────────────────────────
      connection = await this.sfService.createConnection(client);

      // ── 5. Create internal stage if not exists ─────────────────────────
      await this.sfService.execute(
        connection,
        `CREATE STAGE IF NOT EXISTS ${stageName}`,
      );

      // ── 6. Define a reusable CSV file format ───────────────────────────
      await this.sfService.execute(connection, `
        CREATE OR REPLACE FILE FORMAT csv_pipeline_fmt
          TYPE                   = 'CSV'
          FIELD_OPTIONALLY_ENCLOSED_BY = '"'
          SKIP_HEADER            = 1
          NULL_IF                = ('NULL', 'null', 'N/A', '')
          EMPTY_FIELD_AS_NULL    = TRUE
          TRIM_SPACE             = TRUE
      `);

      // ── 7. PUT file to internal stage ──────────────────────────────────
      // snowflake-sdk handles PUT by reading from the local filesystem path
      await this.sfService.execute(
        connection,
        `PUT file://${tmpPath} @${stageName} AUTO_COMPRESS=FALSE OVERWRITE=TRUE`,
      );
      this.logger.log(`File uploaded to stage @${stageName}`);

      // ── 8. Create staging table — all VARCHAR (no type errors possible) ─
      const stagingTable = `${tableName}_STAGING`;
      const colDefs      = analysis.sanitizedHeaders
        .map(col => `"${col}" VARCHAR`)
        .join(', ');

      await this.sfService.execute(
        connection,
        `CREATE OR REPLACE TABLE ${stagingTable} (${colDefs})`,
      );

      // ── 9. COPY INTO staging table ─────────────────────────────────────
      await this.sfService.execute(connection, `
        COPY INTO ${stagingTable}
        FROM @${stageName}/${tmpFilename}
        FILE_FORMAT = (FORMAT_NAME = csv_pipeline_fmt)
        ON_ERROR    = 'CONTINUE'
      `);

      // Check how many rows made it into staging
      const countRows = await this.sfService.execute(
        connection,
        `SELECT COUNT(*) AS CNT FROM ${stagingTable}`,
      );
      const rowsLoaded: number = countRows[0]?.CNT ?? countRows[0]?.cnt ?? 0;
      this.logger.log(`Rows in staging: ${rowsLoaded}`);

      // ── 10. Build typed SELECT for final table ─────────────────────────
      const selectParts: string[] = [];

      // Optional auto-generated ID column (first column)
      if (idPrefix !== '') {
        selectParts.push(
          `'${idPrefix}' || ROW_NUMBER() OVER (ORDER BY (SELECT NULL))::VARCHAR AS "ID"`,
        );
      }

      for (const col of analysis.columns) {
        const q = `"${col.sanitizedName}"`;  // quoted identifier
        if (col.detectedType === 'date' && col.dateFormat) {
          selectParts.push(`TRY_TO_DATE(${q}, '${col.dateFormat}') AS ${q}`);
        } else if (col.detectedType === 'numeric') {
          selectParts.push(`TRY_TO_DOUBLE(${q}) AS ${q}`);
        } else {
          selectParts.push(q);
        }
      }

      // ── 11. Create final typed table ───────────────────────────────────
      await this.sfService.execute(connection, `
        CREATE OR REPLACE TABLE ${tableName} AS
        SELECT ${selectParts.join(', ')}
        FROM ${stagingTable}
      `);
      this.logger.log(`Final table ${tableName} created`);

      // ── 12. Count NULLs in typed columns (data quality warnings) ───────
      const warnings: { column: string; nullCount: number; message: string }[] = [];

      for (const col of analysis.columns) {
        if (col.detectedType === 'date' || col.detectedType === 'numeric') {
          const nullResult = await this.sfService.execute(
            connection,
            `SELECT COUNT(*) AS CNT FROM ${tableName} WHERE "${col.sanitizedName}" IS NULL`,
          );
          const nullCount: number = nullResult[0]?.CNT ?? nullResult[0]?.cnt ?? 0;
          if (nullCount > 0) {
            warnings.push({
              column: col.sanitizedName,
              nullCount,
              message: col.detectedType === 'date'
                ? `${nullCount} row(s) had unparseable date values (loaded as NULL). ` +
                  `Format used: ${col.dateFormat}${!col.confident ? ' (auto-guessed — verify if incorrect)' : ''}`
                : `${nullCount} row(s) had non-numeric values (loaded as NULL).`,
            });
          }
        }
      }

      // ── 13. Clean up staging table ─────────────────────────────────────
      await this.sfService.execute(connection, `DROP TABLE IF EXISTS ${stagingTable}`);

      // ── 14. Generate & upload Cortex Analyst semantic model ────────────
      try {
        const modelName = `${clientSlug}_semantic_model`;
        const baseYaml  = this.buildSemanticYaml(client, tableName, analysis.columns, modelName);

        // Enrich with GPT: adds descriptions + verified_queries
        const enrichedYaml = await this.openaiService.enrichSemanticModel(
          baseYaml,
          analysis.columns.map(c => ({ name: c.sanitizedName, type: c.detectedType })),
          client.name,
          tableName,
          client.snowflakeDatabase || '',
          client.snowflakeSchema   || '',
        );

        await this.analystService.uploadAndReloadModel(enrichedYaml, modelName);
        this.logger.log(`Semantic model enriched, uploaded and reloaded: ${modelName}`);
      } catch (modelErr: any) {
        this.logger.error(`Semantic model update failed: ${modelErr.message}`);
      }

      return {
        rowsLoaded,
        tableName,
        columnsDetected: analysis.columns.map(c => ({
          name:      c.sanitizedName,
          type:      c.detectedType,
          format:    c.dateFormat,
          confident: c.confident,
        })),
        warnings,
        ambiguousColumns,
      };
    } finally {
      // Always clean up temp file and connection
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      if (connection) await this.sfService.destroy(connection);
    }
  }

  // ── Semantic model builder ───────────────────────────────────────────────

  private buildSemanticYaml(
    client: ClientRecord,
    tableName: string,
    columns: ColumnAnalysis[],
    modelName: string,
  ): string {
    const db     = (client.snowflakeDatabase || '').toUpperCase();
    const schema = (client.snowflakeSchema   || '').toUpperCase();
    const tbl    = tableName.toUpperCase();

    const dimensions = columns
      .filter(c => c.detectedType !== 'numeric')
      .map(c => ({
        name:      c.sanitizedName.toLowerCase(),
        expr:      c.sanitizedName,
        data_type: c.detectedType === 'date' ? 'DATE' : 'VARCHAR',
        ...(c.detectedType === 'date' && c.dateFormat
          ? { description: `Date column — format: ${c.dateFormat}` }
          : {}),
      }));

    const facts = columns
      .filter(c => c.detectedType === 'numeric')
      .map(c => ({
        name:      c.sanitizedName.toLowerCase(),
        expr:      c.sanitizedName,
        data_type: 'NUMBER',
      }));

    const model: any = {
      name: modelName,
      description: `Auto-generated semantic model for ${client.name} — table ${tbl}`,
      tables: [
        {
          name: tbl.toLowerCase(),
          base_table: { database: db, schema, table: tbl },
          ...(dimensions.length ? { dimensions } : {}),
          ...(facts.length      ? { facts }      : {}),
        },
      ],
    };

    return yaml.dump(model, { lineWidth: 120, quotingType: '"' });
  }
}
