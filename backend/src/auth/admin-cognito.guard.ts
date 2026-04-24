import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Request } from 'express';

/**
 * AdminCognitoAuthGuard
 * Validates JWTs issued by the ADMIN Cognito User Pool.
 * Completely separate from CognitoAuthGuard which validates client pool tokens.
 * Apply this guard to all /admin/* routes.
 */
@Injectable()
export class AdminCognitoAuthGuard implements CanActivate {
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(private readonly configService: ConfigService) {
    const userPoolId = this.configService.get<string>('ADMIN_COGNITO_USER_POOL_ID');
    const clientId   = this.configService.get<string>('ADMIN_COGNITO_CLIENT_ID');

    if (!userPoolId || !clientId) {
      throw new Error(
        'AdminCognitoAuthGuard: ADMIN_COGNITO_USER_POOL_ID and ADMIN_COGNITO_CLIENT_ID must be set in .env',
      );
    }

    this.verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'access',
      clientId,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token   = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No access token provided');
    }

    try {
      const payload = await this.verifier.verify(token);
      (request as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Admin token is invalid or has expired');
    }
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader !== 'string') return null;
    if (!authHeader.startsWith('Bearer ')) return null;
    return authHeader.slice(7);
  }
}
