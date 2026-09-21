import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

/** Usuario identificado a partir del token, disponible en cada petición. */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

/** Petición HTTP una vez que el guard ha identificado al usuario. */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/** Contenido del token que emite AuthService. */
interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Protege los endpoints que exigen un usuario autenticado.
 * Lee la cabecera `Authorization: Bearer <token>`, comprueba la firma y deja
 * al usuario en `request.user`, de donde lo toma el decorador @CurrentUser().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'Falta el token de acceso. Use la cabecera Authorization: Bearer <token>.',
      );
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      // Firma inválida, token manipulado o caducado: el motivo exacto no se
      // devuelve al cliente.
      throw new UnauthorizedException('El token de acceso no es válido o ha caducado.');
    }

    request.user = { id: payload.sub, email: payload.email };

    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    return scheme === 'Bearer' && token ? token : null;
  }
}
