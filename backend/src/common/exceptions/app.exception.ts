import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(
    message: string = 'Internal Server Error',
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly details?: any
  ) {
    super(message, statusCode);
    this.name = 'AppException';
  }
}
