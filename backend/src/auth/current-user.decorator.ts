import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.guard.js';

/**
 * Entrega al controller el usuario autenticado que dejó AuthGuard.
 * Sustituye a la cabecera `x-user-id` que se usaba antes de existir la
 * autenticación: el cliente ya no puede elegir en nombre de quién actúa.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      // Sólo ocurre si se usa el decorador en una ruta sin AuthGuard.
      throw new UnauthorizedException('La ruta requiere un usuario autenticado.');
    }

    return request.user;
  },
);
