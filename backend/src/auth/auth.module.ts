import { Module } from '@nestjs/common';
import { CognitoAuthGuard } from './cognito.guard';
import { AdminCognitoAuthGuard } from './admin-cognito.guard';

@Module({
  providers: [CognitoAuthGuard, AdminCognitoAuthGuard],
  exports:   [CognitoAuthGuard, AdminCognitoAuthGuard],
})
export class AuthModule {}

