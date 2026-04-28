import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CsvPipelineController } from '../csv-pipeline.controller';
import { CsvPipelineService } from '../csv-pipeline.service';
import { AdminCognitoAuthGuard } from '../../../auth/admin-cognito.guard';

const mockUploadResult = {
  rowsLoaded: 30,
  tableName: 'ALPHA_DATA',
  columnsDetected: [],
  warnings: [],
  ambiguousColumns: [],
};

const mockPipelineService = {
  uploadAndLoad: jest.fn().mockResolvedValue(mockUploadResult),
};

describe('CsvPipelineController', () => {
  let controller: CsvPipelineController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CsvPipelineController],
      providers: [{ provide: CsvPipelineService, useValue: mockPipelineService }],
    })
      .overrideGuard(AdminCognitoAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CsvPipelineController>(CsvPipelineController);
  });

  afterEach(() => jest.clearAllMocks());

  it('throws BadRequestException when no file is provided', async () => {
    await expect(controller.uploadCsv('alpha', null as any))
      .rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for non-CSV file extension', async () => {
    const file = { originalname: 'data.xlsx', buffer: Buffer.from('') };
    await expect(controller.uploadCsv('alpha', file as any))
      .rejects.toThrow(BadRequestException);
  });

  it('calls pipelineService.uploadAndLoad with slug, buffer, and filename', async () => {
    const file = { originalname: 'leads.csv', buffer: Buffer.from('a,b\n1,2') };
    await controller.uploadCsv('alpha', file as any);
    expect(mockPipelineService.uploadAndLoad).toHaveBeenCalledWith(
      'alpha',
      file.buffer,
      'leads.csv',
    );
  });

  it('returns the upload result from the service', async () => {
    const file = { originalname: 'data.csv', buffer: Buffer.from('a\n1') };
    const result = await controller.uploadCsv('alpha', file as any);
    expect(result).toEqual(mockUploadResult);
  });

  it('accepts .CSV extension (case-insensitive)', async () => {
    const file = { originalname: 'DATA.CSV', buffer: Buffer.from('a\n1') };
    await expect(controller.uploadCsv('alpha', file as any)).resolves.toBeDefined();
  });
});
