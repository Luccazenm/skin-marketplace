-- CreateEnum
CREATE TYPE "SkinVariant" AS ENUM ('NORMAL', 'STATTRAK', 'SOUVENIR');

-- CreateEnum
CREATE TYPE "ItemAcquisition" AS ENUM ('USER_DEPOSIT', 'PLATFORM_BUYOUT');

-- CreateEnum
CREATE TYPE "ItemLocation" AS ENUM ('USER_INVENTORY', 'INBOUND', 'BOT_CUSTODY', 'OUTBOUND', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PAID', 'AWAITING_UNLOCK', 'READY_TO_DELIVER', 'DELIVERING', 'DELIVERED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'PURCHASE', 'SALE', 'BUYOUT', 'FEE', 'REFUND', 'CHARGEBACK', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TradeOfferType" AS ENUM ('DEPOSIT', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "TradeOfferStatus" AS ENUM ('CREATED', 'PENDING_CONFIRMATION', 'SENT', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('ONLINE', 'OFFLINE', 'MAINTENANCE', 'LOCKED', 'BANNED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,
    "steamId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "profileUrl" TEXT,
    "steamCreatedAt" TIMESTAMP(3),
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "displayCurrency" TEXT NOT NULL DEFAULT 'USD',
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "tradeUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkinTemplate" (
    "id" TEXT NOT NULL,
    "marketHashName" TEXT NOT NULL,
    "weapon" TEXT NOT NULL,
    "skinName" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "collection" TEXT,
    "variant" "SkinVariant" NOT NULL DEFAULT 'NORMAL',
    "minFloat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxFloat" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "hasStickerSlots" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "inspectLink" TEXT,
    "referencePrice" DECIMAL(12,2),
    "referencePriceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkinTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerId" TEXT,
    "assetId" TEXT NOT NULL,
    "float" DOUBLE PRECISION NOT NULL,
    "paintSeed" INTEGER NOT NULL,
    "paintIndex" INTEGER NOT NULL,
    "defIndex" INTEGER NOT NULL,
    "location" "ItemLocation" NOT NULL DEFAULT 'USER_INVENTORY',
    "botId" TEXT,
    "tradeLockUntil" TIMESTAMP(3),
    "acquisitionType" "ItemAcquisition" NOT NULL DEFAULT 'USER_DEPOSIT',
    "acquisitionCost" DECIMAL(12,2),
    "acquiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSticker" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "stickerName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "wear" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemSticker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PAID',
    "price" DECIMAL(12,2) NOT NULL,
    "feeAmount" DECIMAL(12,2) NOT NULL,
    "sellerPayout" DECIMAL(12,2) NOT NULL,
    "deliverableAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "tradeOfferId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2),
    "sourceAmount" DECIMAL(30,10),
    "sourceCurrency" TEXT,
    "fxRate" DECIMAL(18,8),
    "provider" TEXT,
    "providerRef" TEXT,
    "idempotencyKey" TEXT,
    "listingId" TEXT,
    "orderId" TEXT,
    "parentId" TEXT,
    "description" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOffer" (
    "id" TEXT NOT NULL,
    "type" "TradeOfferType" NOT NULL,
    "status" "TradeOfferStatus" NOT NULL DEFAULT 'CREATED',
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "steamOfferId" TEXT,
    "tradeUrl" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TradeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOfferItem" (
    "id" TEXT NOT NULL,
    "tradeOfferId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeOfferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "tradeUrl" TEXT,
    "credentialRef" TEXT NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'OFFLINE',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "maxItems" INTEGER NOT NULL DEFAULT 900,
    "tradeHoldUntil" TIMESTAMP(3),
    "lastHeartbeat" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_steamId_key" ON "User"("steamId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SkinTemplate_marketHashName_key" ON "SkinTemplate"("marketHashName");

-- CreateIndex
CREATE INDEX "Item_ownerId_idx" ON "Item"("ownerId");

-- CreateIndex
CREATE INDEX "Item_templateId_idx" ON "Item"("templateId");

-- CreateIndex
CREATE INDEX "Item_location_idx" ON "Item"("location");

-- CreateIndex
CREATE INDEX "Item_botId_idx" ON "Item"("botId");

-- CreateIndex
CREATE INDEX "Item_assetId_idx" ON "Item"("assetId");

-- CreateIndex
CREATE INDEX "Item_acquisitionType_idx" ON "Item"("acquisitionType");

-- CreateIndex
CREATE INDEX "Item_defIndex_paintIndex_paintSeed_float_idx" ON "Item"("defIndex", "paintIndex", "paintSeed", "float");

-- CreateIndex
CREATE INDEX "Item_location_tradeLockUntil_idx" ON "Item"("location", "tradeLockUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_itemId_key" ON "Listing"("itemId");

-- CreateIndex
CREATE INDEX "Listing_sellerId_idx" ON "Listing"("sellerId");

-- CreateIndex
CREATE INDEX "Listing_active_price_idx" ON "Listing"("active", "price");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tradeOfferId_key" ON "Order"("tradeOfferId");

-- CreateIndex
CREATE INDEX "Order_buyerId_createdAt_idx" ON "Order"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_listingId_idx" ON "Order"("listingId");

-- CreateIndex
CREATE INDEX "Order_itemId_idx" ON "Order"("itemId");

-- CreateIndex
CREATE INDEX "Order_status_deliverableAt_idx" ON "Order"("status", "deliverableAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_provider_providerRef_idx" ON "Transaction"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "Transaction_listingId_idx" ON "Transaction"("listingId");

-- CreateIndex
CREATE INDEX "Transaction_orderId_idx" ON "Transaction"("orderId");

-- CreateIndex
CREATE INDEX "Transaction_userId_type_status_idx" ON "Transaction"("userId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOffer_steamOfferId_key" ON "TradeOffer"("steamOfferId");

-- CreateIndex
CREATE INDEX "TradeOffer_userId_createdAt_idx" ON "TradeOffer"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeOffer_botId_idx" ON "TradeOffer"("botId");

-- CreateIndex
CREATE INDEX "TradeOffer_status_idx" ON "TradeOffer"("status");

-- CreateIndex
CREATE INDEX "TradeOfferItem_itemId_idx" ON "TradeOfferItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOfferItem_tradeOfferId_itemId_key" ON "TradeOfferItem"("tradeOfferId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_steamId_key" ON "Bot"("steamId");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_username_key" ON "Bot"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_credentialRef_key" ON "Bot"("credentialRef");

-- CreateIndex
CREATE INDEX "Bot_status_idx" ON "Bot"("status");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SkinTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSticker" ADD CONSTRAINT "ItemSticker_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tradeOfferId_fkey" FOREIGN KEY ("tradeOfferId") REFERENCES "TradeOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOfferItem" ADD CONSTRAINT "TradeOfferItem_tradeOfferId_fkey" FOREIGN KEY ("tradeOfferId") REFERENCES "TradeOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOfferItem" ADD CONSTRAINT "TradeOfferItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Escrito a mao: o Prisma nao gera CHECK constraints.
-- Se este bloco sumir numa migration futura, foi apagado por engano.
-- ---------------------------------------------------------------------------

-- Lancamento de valor zero nao existe no ledger.
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_amount_nao_zero" CHECK ("amount" <> 0);

-- Coerencia entre tipo e sinal, so para os tipos de uma perna so.
-- FEE, BUYOUT, REFUND e ADJUSTMENT ficam de fora de proposito: eles geram
-- duas linhas com sinais opostos (uma na conta do usuario, outra na conta
-- da plataforma), entao o sinal depende do lado e nao pode ser fixado aqui.
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_tipo_sinal" CHECK (
    CASE "type"
      WHEN 'DEPOSIT'    THEN "amount" > 0   -- dinheiro externo entrando
      WHEN 'WITHDRAWAL' THEN "amount" < 0   -- dinheiro externo saindo
      WHEN 'CHARGEBACK' THEN "amount" < 0   -- debito forcado
      WHEN 'PURCHASE'   THEN "amount" < 0   -- comprador sempre debitado
      WHEN 'SALE'       THEN "amount" > 0   -- vendedor sempre creditado
      ELSE TRUE
    END
  );
