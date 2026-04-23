import { Module } from '@nestjs/common';
import { CognitoAuthGuard } from './cognito.guard';

@Module({
  providers: [CognitoAuthGuard],
  exports:   [CognitoAuthGuard],
})
export class AuthModule {}
