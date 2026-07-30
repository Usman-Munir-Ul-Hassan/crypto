-- DropForeignKey
ALTER TABLE "Watchlist" DROP CONSTRAINT "Watchlist_user_id_fkey";

-- CreateIndex
CREATE INDEX "CryptoAlert_asset_id_detected_at_idx" ON "CryptoAlert"("asset_id", "detected_at");

-- CreateIndex
CREATE INDEX "CryptoAlert_detected_at_idx" ON "CryptoAlert"("detected_at");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
