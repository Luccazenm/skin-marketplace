import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Messages under the bell, newest first',
    description:
      'Returns the event and its values, not a finished sentence — the ' +
      'wording lives in the frontend so it can be translated.',
  })
  async list(@CurrentUser() user: User) {
    const [items, unread] = await Promise.all([
      this.notifications.list(user.id),
      this.notifications.unreadCount(user.id),
    ]);

    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        params: n.params,
        targetType: n.targetType,
        targetId: n.targetId,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    };
  }

  @Post('read')
  @ApiOperation({
    summary: 'Marks everything currently unread as read',
    description:
      'Scoped to the caller. There is no way to mark another account’s ' +
      'messages as read.',
  })
  async markRead(@CurrentUser() user: User) {
    return { read: await this.notifications.markAllRead(user.id) };
  }
}
