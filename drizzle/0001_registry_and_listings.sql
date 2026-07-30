CREATE TYPE "public"."field_render_as" AS ENUM('input', 'textarea', 'date', 'switch', 'radio', 'dropdown', 'chips', 'checkboxes', 'multiselect');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('text', 'textarea', 'number', 'boolean', 'date', 'single_select', 'multi_select');--> statement-breakpoint
CREATE TYPE "public"."listing_condition" AS ENUM('new', 'like_new', 'excellent', 'good', 'fair');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'active', 'sold', 'removed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('seller', 'admin');--> statement-breakpoint
CREATE TABLE "field_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "field_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_groups_slug_unique" UNIQUE("slug"),
	CONSTRAINT "field_groups_slug_format" CHECK ("field_groups"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"type" "field_type" NOT NULL,
	"render_as" "field_render_as" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"placeholder" text,
	"help_text" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fields_slug_unique" UNIQUE("slug"),
	CONSTRAINT "fields_slug_format" CHECK ("fields"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "fields_config_is_object" CHECK (jsonb_typeof("fields"."config") = 'object'),
	CONSTRAINT "fields_render_as_matches_type" CHECK (
        ("fields"."type" = 'text'          AND "fields"."render_as" = 'input')                                 OR
        ("fields"."type" = 'textarea'      AND "fields"."render_as" = 'textarea')                              OR
        ("fields"."type" = 'number'        AND "fields"."render_as" = 'input')                                  OR
        ("fields"."type" = 'date'          AND "fields"."render_as" = 'date')                                   OR
        ("fields"."type" = 'boolean'       AND "fields"."render_as" IN ('radio', 'switch'))                     OR
        ("fields"."type" = 'single_select' AND "fields"."render_as" IN ('radio', 'dropdown', 'chips'))          OR
        ("fields"."type" = 'multi_select'  AND "fields"."render_as" IN ('checkboxes', 'multiselect', 'chips'))
      )
);
--> statement-breakpoint
CREATE TABLE "field_options" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "field_options_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"field_id" integer NOT NULL,
	"value_slug" text NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_options_field_id_value_slug_key" UNIQUE("field_id","value_slug"),
	CONSTRAINT "field_options_value_slug_format" CHECK ("field_options"."value_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "category_fields" (
	"category_id" integer NOT NULL,
	"field_id" integer NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"group_id" integer,
	"default_value" jsonb,
	"visible_when" jsonb,
	"help_text" text,
	"filterable" boolean DEFAULT false NOT NULL,
	"prominent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_fields_category_id_field_id_pk" PRIMARY KEY("category_id","field_id"),
	CONSTRAINT "category_fields_visible_when_is_object" CHECK (jsonb_typeof("category_fields"."visible_when") = 'object')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'seller' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"category_id" integer NOT NULL,
	"seller_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"condition" "listing_condition" NOT NULL,
	"city" text NOT NULL,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_slug_unique" UNIQUE("slug"),
	CONSTRAINT "listings_slug_format" CHECK ("listings"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "listings_attributes_is_object" CHECK (jsonb_typeof("listings"."attributes") = 'object'),
	CONSTRAINT "listings_price_positive" CHECK ("listings"."price_paise" > 0 AND "listings"."price_paise" <= 100000000000),
	CONSTRAINT "listings_title_length" CHECK (char_length(btrim("listings"."title")) BETWEEN 3 AND 140),
	CONSTRAINT "listings_currency_format" CHECK ("listings"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "listing_images" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "listing_images_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"listing_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_options" ADD CONSTRAINT "field_options_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_fields" ADD CONSTRAINT "category_fields_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_fields" ADD CONSTRAINT "category_fields_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_fields" ADD CONSTRAINT "category_fields_group_id_field_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."field_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fields_archived_at_idx" ON "fields" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "field_options_field_id_sort_idx" ON "field_options" USING btree ("field_id","sort");--> statement-breakpoint
CREATE INDEX "category_fields_category_id_sort_idx" ON "category_fields" USING btree ("category_id","sort");--> statement-breakpoint
CREATE INDEX "category_fields_field_id_idx" ON "category_fields" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "listings_status_created_at_idx" ON "listings" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listings_category_id_created_at_idx" ON "listings" USING btree ("category_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listings_seller_id_idx" ON "listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "listings_attributes_gin_idx" ON "listings" USING gin ("attributes" jsonb_ops);--> statement-breakpoint
CREATE INDEX "listing_images_listing_id_sort_idx" ON "listing_images" USING btree ("listing_id","sort");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);