import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Injeta o usuário autenticado no handler.
 * Só funciona em rotas protegidas por JwtAuthGuard — sem o guard, não há
 * usuário no request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
