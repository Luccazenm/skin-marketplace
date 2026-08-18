import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Injects the authenticated user into the handler.
 * Only works on routes protected by JwtAuthGuard — without the guard,
 * there is no user on the request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
