import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Request } from 'express';

/**
 * CognitoAuthGuard — multi-tenant aware
 *
 * Instead of being hardcoded to one Cognito pool, this guard reads the
 * pool ID directly from the JWT's `iss` (issuer) claim and verifies the
 * token against whichever pool issued it.
 *
 * A verifier is created once per pool ID and cached — so the JWKS fetch
 * only happens once per pool, not on every request.
 */
@Injectable()
export class CognitoAuthGuard implements CanActivate {
  // Cache: poolId → verifier instance
  private readonly verifierCache = new Map<
    string,
    ReturnType<typeof CognitoJwtVerifier.create>
  >();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token   = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No access token provided');
    }

    // Decode the pool ID from the JWT without verifying it yet
    const poolId = this.extractPoolId(token);
    if (!poolId) {
      throw new UnauthorizedException('Unable to determine Cognito pool from token');
    }

    // Get or create a verifier for this pool
    const verifier = this.getVerifier(poolId);

    try {
      const payload = await verifier.verify(token);
      (request as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token is invalid or has expired');
    }
  }

  /**
   * Decode the JWT payload (no verification) and extract the pool ID
   * from the `iss` claim.
   * iss looks like: https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_XXXXXXX
   * Pool ID is the last segment after the final slash.
   */
  private extractPoolId(token: string): string | null {
    try {
      const [, payloadBase64] = token.split('.');
      const payload = JSON.parse(
        Buffer.from(payloadBase64, 'base64url').toString('utf8'),
      );
      const iss: string = payload.iss ?? '';
      // Last segment of the issuer URL is the pool ID
      const poolId = iss.split('/').pop();
      return poolId || null;
    } catch {
      return null;
    }
  }

  /**
   * Return a cached verifier for the given pool ID.
   * Creates one on first use — subsequent requests reuse it.
   * clientId is not checked here since each pool has exactly one app
   * client and we do not want to hardcode IDs per client.
   */
  private getVerifier(poolId: string) {
    if (!this.verifierCache.has(poolId)) {
      const verifier = CognitoJwtVerifier.create({
        userPoolId: poolId,
        tokenUse:   'access',
        clientId:   null, // skip clientId check — pool-level validation is sufficient
      });
      this.verifierCache.set(poolId, verifier);
    }
    return this.verifierCache.get(poolId)!;
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader !== 'string') return null;
    if (!authHeader.startsWith('Bearer ')) return null;
    return authHeader.slice(7);
  }
}
