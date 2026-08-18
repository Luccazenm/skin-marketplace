import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { auditContext } from '../audit/audit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

@ApiTags('deposits')
@Controller('deposits')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Post()
  @ApiOperation({
    summary: 'Requests a deposit of items',
    description:
      'Records the intent and queues the trade offer. Sending is done by ' +
      'the bot service — this route does not talk to Steam to create the ' +
      'offer.',
  })
  @ApiResponse({ status: 201, description: 'Deposit queued' })
  @ApiResponse({
    status: 400,
    description: 'No trade URL, item unavailable, or not in the inventory',
  })
  @ApiResponse({ status: 409, description: 'Item is already in another trade' })
  @ApiResponse({ status: 503, description: 'No Trade Bot available' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateDepositDto,
    @Req() req: Request,
  ) {
    const offer = await this.deposits.requestDeposit(
      user,
      dto.assetIds,
      auditContext(req),
    );

    return {
      id: offer.id,
      status: offer.status,
      itemCount: offer.requestedAssetIds.length,
      createdAt: offer.createdAt,
    };
  }
}
