import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { AdminCognitoAuthGuard } from '../../auth/admin-cognito.guard';
import { CsvPipelineService, UploadMode } from './csv-pipeline.service';

const VALID_MODES: UploadMode[] = ['replace', 'append', 'append_extend'];

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminCognitoAuthGuard)
@Controller('admin/clients')
export class CsvPipelineController {
  constructor(private readonly pipelineService: CsvPipelineService) {}

  /**
   * POST /api/v1/admin/clients/:slug/upload-csv
   * Multipart form-data fields:
   *   file  — the CSV file
   *   mode  — 'replace' | 'append' | 'append_extend'  (default: 'replace')
   */
  @Post(':slug/upload-csv')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload CSV and load into client Snowflake table' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    }),
  )
  async uploadCsv(
    @Param('slug') slug: string,
    @UploadedFile() file: any,
    @Body('mode') rawMode?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded. Send the CSV as form-data field "file".');
    }
    if (!(file.originalname || '').toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are accepted.');
    }

    const mode: UploadMode = VALID_MODES.includes(rawMode as UploadMode)
      ? (rawMode as UploadMode)
      : 'replace';

    return this.pipelineService.uploadAndLoad(
      slug,
      file.buffer as Buffer,
      mode,
    );
  }
}
