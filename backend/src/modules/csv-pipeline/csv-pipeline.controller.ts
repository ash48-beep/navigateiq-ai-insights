import {
  Controller,
  Post,
  Param,
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
import { CsvPipelineService } from './csv-pipeline.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminCognitoAuthGuard)
@Controller('admin/clients')
export class CsvPipelineController {
  constructor(private readonly pipelineService: CsvPipelineService) {}

  /**
   * POST /api/v1/admin/clients/:slug/upload-csv
   * Accepts a multipart/form-data CSV file, runs the full pipeline:
   *   analyze → PUT to stage → COPY INTO staging → cast to final table
   */
  @Post(':slug/upload-csv')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload CSV and load into client Snowflake table' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
    }),
  )
  async uploadCsv(
    @Param('slug') slug: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded. Send the CSV as form-data field "file".');
    }

    const name: string = file.originalname || '';
    if (!name.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are accepted.');
    }

    return this.pipelineService.uploadAndLoad(slug, file.buffer as Buffer, name);
  }
}
