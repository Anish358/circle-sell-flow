ALTER TABLE "listings" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_idempotency_key_unique" UNIQUE("idempotency_key");