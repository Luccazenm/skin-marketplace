-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consentAnalytics" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentAnalyticsAt" TIMESTAMP(3),
ADD COLUMN     "consentMarketingEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentMarketingEmailAt" TIMESTAMP(3);
