


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."cashfree_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "event_type" "text",
    "order_id" "text",
    "cf_payment_id" "text",
    "refund_id" "text",
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "attempts" integer DEFAULT 1 NOT NULL,
    "payload" "jsonb" NOT NULL,
    "payload_hash" "text" NOT NULL,
    "signature" "text",
    "webhook_timestamp" "text",
    "received_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp without time zone,
    "failure_reason" "text"
);


ALTER TABLE "public"."cashfree_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cashfree_webhook_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "idempotency_key" "text",
    "event_type" "text",
    "order_id" "text",
    "cf_payment_id" "text",
    "refund_id" "text",
    "processing_status" "text" NOT NULL,
    "payload_hash" "text" NOT NULL,
    "signature_present" boolean DEFAULT false NOT NULL,
    "webhook_timestamp" "text",
    "rejection_reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "received_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cashfree_webhook_audit_status_valid" CHECK (("processing_status" = ANY (ARRAY['received'::"text", 'duplicate'::"text", 'concurrent_duplicate'::"text", 'processed'::"text", 'failed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."cashfree_webhook_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."food_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid",
    "title" character varying(150) NOT NULL,
    "description" "text",
    "quantity" integer NOT NULL,
    "remaining_quantity" integer NOT NULL,
    "price" numeric(10,2) DEFAULT 0,
    "is_free" boolean DEFAULT true,
    "pickup_start_time" timestamp with time zone NOT NULL,
    "pickup_end_time" timestamp with time zone NOT NULL,
    "latitude" numeric(9,6) NOT NULL,
    "longitude" numeric(9,6) NOT NULL,
    "status" character varying(20) DEFAULT 'active'::character varying,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "ngo_id" "uuid",
    "ngo_requested" boolean DEFAULT false,
    "ngo_requested_at" timestamp without time zone,
    "location" "public"."geography"(Point,4326),
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp without time zone,
    CONSTRAINT "check_price_vs_free" CHECK (((("is_free" = true) AND ("price" = (0)::numeric)) OR (("is_free" = false) AND ("price" > (0)::numeric))))
);


ALTER TABLE "public"."food_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ngo_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid",
    "ngo_id" "uuid",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "requested_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "responded_at" timestamp with time zone
);


ALTER TABLE "public"."ngo_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ngos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "organization_name" character varying(150),
    "registration_number" character varying(100),
    "service_radius_km" integer DEFAULT 10,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "urgent_flag" boolean DEFAULT false,
    "total_active_listings" integer DEFAULT 0,
    "banned_until" timestamp without time zone,
    "latitude" double precision,
    "longitude" double precision,
    "location" "public"."geography"(Point,4326),
    "is_verified" boolean DEFAULT false,
    "rejection_reason" "text"
);


ALTER TABLE "public"."ngos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" character varying(50),
    "title" character varying(150),
    "message" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "listing_id" "uuid"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operational_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "alert_key" "text" NOT NULL,
    "category" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "first_seen_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "occurrences" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."operational_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operational_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "event_name" "text" NOT NULL,
    "request_id" "text",
    "user_id" "uuid",
    "role" "text",
    "reservation_id" "uuid",
    "payment_session_id" "text",
    "queue_job_id" "text",
    "worker_name" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "correlation_id" "text"
);


ALTER TABLE "public"."operational_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_order_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text" NOT NULL,
    "payer_user_id" "uuid",
    "reservation_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[] NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "status" "text" DEFAULT 'creating'::"text" NOT NULL,
    "payment_session_id" "text",
    "reservation_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "gateway_response" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "failure_reason" "text",
    "recovery_attempts" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "recovered_at" timestamp without time zone,
    CONSTRAINT "payment_order_attempts_amount_nonnegative" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "payment_order_attempts_recovery_attempts_nonnegative" CHECK (("recovery_attempts" >= 0)),
    CONSTRAINT "payment_order_attempts_status_valid" CHECK (("status" = ANY (ARRAY['creating'::"text", 'gateway_created'::"text", 'db_inserted'::"text", 'committed'::"text", 'recovery_pending'::"text", 'recovered'::"text", 'abandoned'::"text", 'manual_review_required'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payment_order_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_id" "uuid",
    "order_id" "text" NOT NULL,
    "payment_session_id" "text",
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text",
    "status" "text" DEFAULT 'created'::"text",
    "payment_method" "text",
    "transaction_id" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "refund_id" "text",
    "refund_status" "text" DEFAULT 'not_requested'::"text",
    "food_amount" numeric DEFAULT 0,
    "reliability_deposit_amount" numeric DEFAULT 0,
    "reliability_deposit_status" "text" DEFAULT 'not_required'::"text",
    "reliability_deposit_refund_id" "text",
    "reliability_deposit_refunded_at" timestamp without time zone,
    "reliability_deposit_retained_at" timestamp without time zone,
    "gateway_status" "text",
    "last_webhook_event_key" "text",
    "last_reconciled_at" timestamp without time zone,
    "reconciliation_status" "text",
    "reconciliation_attempts" integer DEFAULT 0,
    "refund_attempts" integer DEFAULT 0,
    "reliability_deposit_refund_attempts" integer DEFAULT 0,
    "payment_terminal_at" timestamp without time zone,
    "refund_terminal_at" timestamp without time zone,
    "financial_state_version" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['created'::"text", 'pending'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text", 'expired'::"text", 'refund_pending'::"text", 'refund_failed'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_ownership" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "payment_session_id" "text" NOT NULL,
    "payer_user_id" "uuid" NOT NULL,
    "payer_role" "text" NOT NULL,
    "provider_id" "uuid",
    "beneficiary_user_id" "uuid",
    "beneficiary_role" "text",
    "platform_account_id" "text",
    "deposit_owner_user_id" "uuid",
    "deposit_owner_role" "text",
    "refund_target_user_id" "uuid",
    "refund_target_role" "text",
    "commission_receiver_user_id" "uuid",
    "commission_receiver_role" "text",
    "food_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "deposit_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "commission_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "ownership_version" integer DEFAULT 1 NOT NULL,
    "snapshot_hash" "text" NOT NULL,
    "source_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_ownership_amounts_nonnegative" CHECK ((("food_amount" >= (0)::numeric) AND ("deposit_amount" >= (0)::numeric) AND ("commission_amount" >= (0)::numeric))),
    CONSTRAINT "payment_ownership_currency_present" CHECK (("length"("trim"("currency")) > 0)),
    CONSTRAINT "payment_ownership_version_positive" CHECK (("ownership_version" > 0))
);


ALTER TABLE "public"."payment_ownership" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation_type" "text" NOT NULL,
    "operation_source" "text" DEFAULT 'unspecified'::"text",
    "reservation_id" "uuid",
    "payment_session_id" "text",
    "payment_ownership_id" "uuid",
    "actor_user_id" "uuid",
    "actor_role" "text",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "financial_operations_amount_nonnegative" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "financial_operations_currency_present" CHECK (("length"("trim"("currency")) > 0)),
    CONSTRAINT "financial_operations_retry_count_nonnegative" CHECK (("retry_count" >= 0)),
    CONSTRAINT "financial_operations_status_valid" CHECK (("status" = ANY (ARRAY['planned'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text", 'skipped'::"text", 'retained'::"text"])))
);


ALTER TABLE "public"."financial_operations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_state_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "reservation_id" "uuid",
    "order_id" "text",
    "old_payment_status" "text",
    "new_payment_status" "text",
    "old_refund_status" "text",
    "new_refund_status" "text",
    "old_deposit_status" "text",
    "new_deposit_status" "text",
    "transition_source" "text" DEFAULT 'database_trigger'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_state_transitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."penalties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "ngo_id" "uuid",
    "reservation_id" "uuid",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."penalties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "reported_by" "uuid" NOT NULL,
    "reservation_id" "uuid",
    "reason" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp without time zone,
    "reviewed_by_admin" "uuid"
);


ALTER TABLE "public"."provider_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid",
    "reviewer_id" "uuid",
    "rating" integer,
    "review" "text",
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "reservation_id" "uuid",
    CONSTRAINT "ratings_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid",
    "user_id" "uuid",
    "quantity_reserved" integer NOT NULL,
    "status" "text" DEFAULT 'reserved'::character varying,
    "reserved_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "assigned_volunteer_id" "uuid",
    "task_status" "text" DEFAULT 'pending'::character varying,
    "assigned_at" timestamp with time zone,
    "pickup_type" "text" DEFAULT 'self'::"text",
    "pickup_code" character varying(6),
    "completed_at" timestamp without time zone,
    "receive_code" "text",
    "picked_up_at" timestamp with time zone,
    "payment_status" "text" DEFAULT 'not_required'::"text",
    "payment_expires_at" timestamp without time zone,
    "total_amount" numeric(10,2),
    "payment_context" "jsonb" DEFAULT '{}'::"jsonb",
    "payment_retryable" boolean DEFAULT true,
    CONSTRAINT "valid_task_state" CHECK ((("pickup_type" = 'self'::"text") OR ("task_status" IS NOT NULL)))
);


ALTER TABLE "public"."reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "restaurant_name" "text",
    "fssai_number" "text",
    "fssai_certificate_url" "text",
    "service_radius_km" integer,
    "latitude" double precision,
    "longitude" double precision,
    "location" "public"."geography"(Point,4326),
    "created_at" timestamp without time zone DEFAULT "now"(),
    "is_verified" boolean DEFAULT false,
    "rejection_reason" "text"
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100),
    "phone" character varying(15) NOT NULL,
    "email" character varying(150),
    "role" character varying(20),
    "profile_image" "text",
    "is_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "fcm_token" "text",
    "is_available" boolean DEFAULT true,
    "penalty_count" integer DEFAULT 0,
    "banned_until" timestamp with time zone,
    "address" "text",
    "latitude" double precision,
    "longitude" double precision,
    "location" "public"."geography"(Point,4326),
    "refresh_token" "text",
    "refresh_token_expiry" timestamp without time zone,
    "reliability_deposit_amount" numeric DEFAULT 0,
    "requires_reliability_deposit" boolean DEFAULT false,
    "last_penalty_at" timestamp without time zone,
    "successful_pickups_count" integer DEFAULT 0,
    "restriction_level" integer DEFAULT 0,
    "restriction_reason" "text",
    "cooldown_until" timestamp without time zone,
    "trust_score" numeric DEFAULT 100,
    "restriction_type" "text",
    "total_successful_pickups" integer DEFAULT 0,
    "total_failed_pickups" integer DEFAULT 0,
    "refresh_token_family" "text",
    "refresh_token_device" "text",
    "refresh_token_last_used_at" timestamp without time zone,
    "last_auth_activity_at" timestamp without time zone,
    CONSTRAINT "users_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['user'::character varying, 'admin'::character varying, 'provider'::character varying, 'ngo'::character varying, 'volunteer'::character varying])::"text"[])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteer_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ngo_id" "uuid",
    "volunteer_id" "uuid",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "requested_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "responded_at" timestamp with time zone,
    "request_type" "text" DEFAULT 'ngo_invite'::"text" NOT NULL
);


ALTER TABLE "public"."volunteer_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteer_stats" (
    "volunteer_id" "uuid" NOT NULL,
    "total_assigned" integer DEFAULT 0,
    "total_completed" integer DEFAULT 0,
    "total_timeouts" integer DEFAULT 0,
    "avg_completion_time" double precision DEFAULT 0,
    "banned_until" timestamp without time zone
);


ALTER TABLE "public"."volunteer_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "ngo_id" "uuid",
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "status" character varying(20) DEFAULT 'active'::character varying
);


ALTER TABLE "public"."volunteers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worker_heartbeats" (
    "worker_name" "text" NOT NULL,
    "queue_name" "text",
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "last_job_id" "text",
    "last_seen_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."worker_heartbeats" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_payment_ownership_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'payment_ownership rows are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_payment_ownership_mutation"() OWNER TO "postgres";


CREATE TRIGGER "trg_payment_ownership_immutable" BEFORE UPDATE OR DELETE ON "public"."payment_ownership" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_payment_ownership_mutation"();


CREATE OR REPLACE FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'cashfree_webhook_audit_log rows are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"() OWNER TO "postgres";


CREATE TRIGGER "trg_cashfree_webhook_audit_immutable" BEFORE UPDATE OR DELETE ON "public"."cashfree_webhook_audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"();


CREATE OR REPLACE FUNCTION "public"."prevent_financial_state_transition_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'financial_state_transitions rows are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_financial_state_transition_mutation"() OWNER TO "postgres";


CREATE TRIGGER "trg_financial_state_transitions_immutable" BEFORE UPDATE OR DELETE ON "public"."financial_state_transitions" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_state_transition_mutation"();


CREATE OR REPLACE FUNCTION "public"."guard_payment_financial_state_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  old_status TEXT := COALESCE(OLD.status, 'created');
  new_status TEXT := COALESCE(NEW.status, old_status);
  old_refund_status TEXT := COALESCE(OLD.refund_status, 'not_requested');
  new_refund_status TEXT := COALESCE(NEW.refund_status, old_refund_status);
  old_deposit_status TEXT := COALESCE(OLD.reliability_deposit_status, 'not_required');
  new_deposit_status TEXT := COALESCE(NEW.reliability_deposit_status, old_deposit_status);
BEGIN
  IF old_status = 'refunded' AND new_status <> 'refunded' THEN
    RAISE EXCEPTION 'Illegal payment state transition from refunded to %', new_status;
  END IF;

  IF old_status = 'paid' AND new_status IN ('created','pending','failed','expired') THEN
    RAISE EXCEPTION 'Illegal payment state transition from paid to %', new_status;
  END IF;

  IF old_status = 'refund_pending' AND new_status IN ('created','pending','paid','failed','expired') THEN
    RAISE EXCEPTION 'Illegal payment state transition from refund_pending to %', new_status;
  END IF;

  IF old_status = 'refund_failed' AND new_status IN ('created','pending','paid','failed','expired') THEN
    RAISE EXCEPTION 'Illegal payment state transition from refund_failed to %', new_status;
  END IF;

  IF old_status IN ('failed','expired') AND new_status IN ('created','pending','paid') THEN
    RAISE EXCEPTION 'Illegal payment state transition from % to %', old_status, new_status;
  END IF;

  IF old_refund_status = 'refunded' AND new_refund_status <> 'refunded' THEN
    RAISE EXCEPTION 'Illegal refund status transition from refunded to %', new_refund_status;
  END IF;

  IF old_refund_status = 'refund_failed' AND new_refund_status = 'refund_pending'
     AND new_status <> 'refund_pending' THEN
    RAISE EXCEPTION 'Illegal stale refund status transition from refund_failed to refund_pending';
  END IF;

  IF old_deposit_status IN ('refunded','retained')
     AND new_deposit_status <> old_deposit_status THEN
    RAISE EXCEPTION 'Illegal reliability deposit transition from % to %',
      old_deposit_status,
      new_deposit_status;
  END IF;

  IF new_status IN ('paid','failed','expired','refunded','refund_failed')
     AND OLD.payment_terminal_at IS NULL THEN
    NEW.payment_terminal_at = NOW();
  END IF;

  IF new_status IN ('refunded','refund_failed')
     AND OLD.refund_terminal_at IS NULL THEN
    NEW.refund_terminal_at = NOW();
  END IF;

  IF old_status IS DISTINCT FROM new_status
     OR old_refund_status IS DISTINCT FROM new_refund_status
     OR old_deposit_status IS DISTINCT FROM new_deposit_status THEN
    NEW.financial_state_version = COALESCE(OLD.financial_state_version, 0) + 1;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_payment_financial_state_transition"() OWNER TO "postgres";


CREATE TRIGGER "trg_payments_financial_state_guard" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."guard_payment_financial_state_transition"();


CREATE OR REPLACE FUNCTION "public"."log_payment_financial_state_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.refund_status IS DISTINCT FROM NEW.refund_status
     OR OLD.reliability_deposit_status IS DISTINCT FROM NEW.reliability_deposit_status THEN
    INSERT INTO financial_state_transitions (
      payment_id,
      reservation_id,
      order_id,
      old_payment_status,
      new_payment_status,
      old_refund_status,
      new_refund_status,
      old_deposit_status,
      new_deposit_status,
      metadata
    )
    VALUES (
      NEW.id,
      NEW.reservation_id,
      NEW.order_id,
      OLD.status,
      NEW.status,
      OLD.refund_status,
      NEW.refund_status,
      OLD.reliability_deposit_status,
      NEW.reliability_deposit_status,
      jsonb_build_object(
        'gateway_status', NEW.gateway_status,
        'reconciliation_status', NEW.reconciliation_status,
        'financial_state_version', NEW.financial_state_version
      )
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_payment_financial_state_transition"() OWNER TO "postgres";


CREATE TRIGGER "trg_payments_financial_state_transition_log" AFTER UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."log_payment_financial_state_transition"();


ALTER TABLE ONLY "public"."cashfree_webhook_events"
    ADD CONSTRAINT "cashfree_webhook_events_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."cashfree_webhook_events"
    ADD CONSTRAINT "cashfree_webhook_events_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."cashfree_webhook_audit_log"
    ADD CONSTRAINT "cashfree_webhook_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."food_listings"
    ADD CONSTRAINT "food_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."food_listings"
    ADD CONSTRAINT "food_listings_remaining_quantity_nonnegative" CHECK (("remaining_quantity" >= 0)) NOT VALID;



ALTER TABLE ONLY "public"."ngo_requests"
    ADD CONSTRAINT "ngo_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ngos"
    ADD CONSTRAINT "ngos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operational_alerts"
    ADD CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operational_events"
    ADD CONSTRAINT "operational_events_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."payment_order_attempts"
    ADD CONSTRAINT "payment_order_attempts_order_id_key" UNIQUE ("order_id");


ALTER TABLE ONLY "public"."payment_order_attempts"
    ADD CONSTRAINT "payment_order_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_order_id_key" UNIQUE ("order_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."financial_state_transitions"
    ADD CONSTRAINT "financial_state_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "unique_fssai" UNIQUE ("fssai_number");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "unique_listing_reviewer" UNIQUE ("listing_id", "reviewer_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "unique_notification_per_listing" UNIQUE ("user_id", "type", "listing_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "unique_phone" UNIQUE ("phone");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "unique_provider_restaurant" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "unique_rating_per_reservation" UNIQUE ("reservation_id");



ALTER TABLE ONLY "public"."ngos"
    ADD CONSTRAINT "unique_registration" UNIQUE ("registration_number");



ALTER TABLE ONLY "public"."ngos"
    ADD CONSTRAINT "unique_user_ngo" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "unique_user_restaurant" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."volunteers"
    ADD CONSTRAINT "unique_volunteer_ngo" UNIQUE ("user_id", "ngo_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_phone_unique" UNIQUE ("phone");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."volunteer_requests"
    ADD CONSTRAINT "volunteer_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."volunteer_stats"
    ADD CONSTRAINT "volunteer_stats_pkey" PRIMARY KEY ("volunteer_id");



ALTER TABLE ONLY "public"."volunteers"
    ADD CONSTRAINT "volunteers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."worker_heartbeats"
    ADD CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_name");



CREATE INDEX "idx_cashfree_webhook_events_order" ON "public"."cashfree_webhook_events" USING "btree" ("order_id", "received_at" DESC);



CREATE INDEX "idx_cashfree_webhook_events_order_recent" ON "public"."cashfree_webhook_events" USING "btree" ("order_id", "received_at" DESC, "status") WHERE ("order_id" IS NOT NULL);



CREATE INDEX "idx_cashfree_webhook_events_status" ON "public"."cashfree_webhook_events" USING "btree" ("status", "received_at" DESC);


CREATE INDEX "idx_cashfree_webhook_audit_order" ON "public"."cashfree_webhook_audit_log" USING "btree" ("order_id", "received_at" DESC) WHERE ("order_id" IS NOT NULL);


CREATE INDEX "idx_cashfree_webhook_audit_refund" ON "public"."cashfree_webhook_audit_log" USING "btree" ("refund_id", "received_at" DESC) WHERE ("refund_id" IS NOT NULL);


CREATE INDEX "idx_cashfree_webhook_audit_status" ON "public"."cashfree_webhook_audit_log" USING "btree" ("processing_status", "received_at" DESC);



CREATE INDEX "idx_food_listings_active_scan" ON "public"."food_listings" USING "btree" ("pickup_end_time", "remaining_quantity", "created_at" DESC) WHERE ((("status")::"text" = 'active'::"text") AND ("is_deleted" = false));



CREATE INDEX "idx_food_listings_location_gist" ON "public"."food_listings" USING "gist" ("location");



CREATE INDEX "idx_food_listings_provider_status" ON "public"."food_listings" USING "btree" ("provider_id", "status", "pickup_end_time" DESC);



CREATE INDEX "idx_food_listings_visibility" ON "public"."food_listings" USING "btree" ("status", "is_deleted", "pickup_end_time");



CREATE INDEX "idx_food_location" ON "public"."food_listings" USING "btree" ("latitude", "longitude");



CREATE INDEX "idx_food_ngo" ON "public"."food_listings" USING "btree" ("ngo_id");



CREATE INDEX "idx_food_remaining" ON "public"."food_listings" USING "btree" ("remaining_quantity");



CREATE INDEX "idx_food_status" ON "public"."food_listings" USING "btree" ("status");



CREATE INDEX "idx_ngo_requests_pending_listing" ON "public"."ngo_requests" USING "btree" ("listing_id", "status", "id") WHERE (("status")::"text" = 'pending'::"text");



CREATE INDEX "idx_ngos_location" ON "public"."ngos" USING "gist" ("location");



CREATE INDEX "idx_ngos_verification" ON "public"."ngos" USING "btree" ("is_verified", "created_at" DESC);



CREATE INDEX "idx_notifications_user_read" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE UNIQUE INDEX "idx_operational_alerts_open_key" ON "public"."operational_alerts" USING "btree" ("alert_key") WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_operational_events_category" ON "public"."operational_events" USING "btree" ("category", "severity", "created_at" DESC);



CREATE INDEX "idx_operational_events_correlation" ON "public"."operational_events" USING "btree" ("correlation_id", "created_at" DESC) WHERE ("correlation_id" IS NOT NULL);



CREATE INDEX "idx_operational_events_created" ON "public"."operational_events" USING "btree" ("created_at" DESC);


CREATE INDEX "idx_payment_order_attempts_payer" ON "public"."payment_order_attempts" USING "btree" ("payer_user_id", "created_at" DESC) WHERE ("payer_user_id" IS NOT NULL);


CREATE INDEX "idx_payment_order_attempts_status_updated" ON "public"."payment_order_attempts" USING "btree" ("status", "updated_at");



CREATE UNIQUE INDEX "idx_payments_deposit_refund_id_unique" ON "public"."payments" USING "btree" ("reliability_deposit_refund_id") WHERE ("reliability_deposit_refund_id" IS NOT NULL);



CREATE INDEX "idx_payments_order" ON "public"."payments" USING "btree" ("order_id");



CREATE INDEX "idx_payments_order_reservation_lock" ON "public"."payments" USING "btree" ("order_id", "reservation_id", "id");



CREATE INDEX "idx_payments_order_status" ON "public"."payments" USING "btree" ("order_id", "status");



CREATE INDEX "idx_payments_reconciliation" ON "public"."payments" USING "btree" ("status", "reconciliation_status", "last_reconciled_at");



CREATE UNIQUE INDEX "idx_payments_refund_id_unique" ON "public"."payments" USING "btree" ("refund_id") WHERE ("refund_id" IS NOT NULL);



CREATE INDEX "idx_payments_refund_pending" ON "public"."payments" USING "btree" ("reservation_id", "status", "refund_status", "updated_at" DESC) WHERE ("status" = ANY (ARRAY['refund_pending'::"text", 'refund_failed'::"text", 'paid'::"text", 'success'::"text"]));



CREATE INDEX "idx_payments_reservation" ON "public"."payments" USING "btree" ("reservation_id");



CREATE INDEX "idx_payments_reservation_status_updated" ON "public"."payments" USING "btree" ("reservation_id", "status", "updated_at" DESC);


CREATE INDEX "idx_payment_ownership_payer" ON "public"."payment_ownership" USING "btree" ("payer_user_id", "payer_role", "created_at" DESC);


CREATE INDEX "idx_payment_ownership_payment_session" ON "public"."payment_ownership" USING "btree" ("payment_session_id", "created_at" DESC);


CREATE INDEX "idx_payment_ownership_provider" ON "public"."payment_ownership" USING "btree" ("provider_id", "created_at" DESC) WHERE ("provider_id" IS NOT NULL);


CREATE INDEX "idx_payment_ownership_refund_target" ON "public"."payment_ownership" USING "btree" ("refund_target_user_id", "refund_target_role", "created_at" DESC) WHERE ("refund_target_user_id" IS NOT NULL);


CREATE INDEX "idx_payment_ownership_reservation" ON "public"."payment_ownership" USING "btree" ("reservation_id", "created_at" DESC);


CREATE UNIQUE INDEX "idx_payment_ownership_reservation_session_version" ON "public"."payment_ownership" USING "btree" ("reservation_id", "payment_session_id", "ownership_version");


CREATE UNIQUE INDEX "idx_financial_operations_idempotency_key" ON "public"."financial_operations" USING "btree" ("idempotency_key");


CREATE INDEX "idx_financial_operations_operation_source" ON "public"."financial_operations" USING "btree" ("operation_source", "created_at" DESC);


CREATE INDEX "idx_financial_operations_payment_ownership" ON "public"."financial_operations" USING "btree" ("payment_ownership_id", "created_at" DESC) WHERE ("payment_ownership_id" IS NOT NULL);


CREATE INDEX "idx_financial_operations_payment_session" ON "public"."financial_operations" USING "btree" ("payment_session_id", "created_at" DESC) WHERE ("payment_session_id" IS NOT NULL);


CREATE INDEX "idx_financial_operations_reservation" ON "public"."financial_operations" USING "btree" ("reservation_id", "created_at" DESC) WHERE ("reservation_id" IS NOT NULL);


CREATE INDEX "idx_financial_operations_status" ON "public"."financial_operations" USING "btree" ("status", "updated_at" DESC);


CREATE INDEX "idx_financial_state_transitions_payment" ON "public"."financial_state_transitions" USING "btree" ("payment_id", "created_at" DESC);


CREATE INDEX "idx_financial_state_transitions_reservation" ON "public"."financial_state_transitions" USING "btree" ("reservation_id", "created_at" DESC) WHERE ("reservation_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_payments_transaction_id_unique" ON "public"."payments" USING "btree" ("transaction_id") WHERE ("transaction_id" IS NOT NULL);



CREATE INDEX "idx_provider_reports_provider_status" ON "public"."provider_reports" USING "btree" ("provider_id", "status", "created_at" DESC);



CREATE UNIQUE INDEX "idx_provider_reports_unique_pending" ON "public"."provider_reports" USING "btree" ("provider_id", "reported_by", "reservation_id") WHERE (("status" = 'pending'::"text") AND ("reservation_id" IS NOT NULL));



CREATE INDEX "idx_ratings_listing_id" ON "public"."ratings" USING "btree" ("listing_id");



CREATE INDEX "idx_ratings_reservation_id" ON "public"."ratings" USING "btree" ("reservation_id");



CREATE INDEX "idx_ratings_reviewer_id" ON "public"."ratings" USING "btree" ("reviewer_id");



CREATE INDEX "idx_reservations_listing" ON "public"."reservations" USING "btree" ("listing_id");



CREATE INDEX "idx_reservations_listing_payment_state" ON "public"."reservations" USING "btree" ("listing_id", "status", "payment_status", "id");



CREATE INDEX "idx_reservations_listing_reserved" ON "public"."reservations" USING "btree" ("listing_id", "reserved_at" DESC);



CREATE INDEX "idx_reservations_listing_status" ON "public"."reservations" USING "btree" ("listing_id", "status", "task_status", "reserved_at" DESC);



CREATE INDEX "idx_reservations_payment_reconcile_order" ON "public"."reservations" USING "btree" ("status", "payment_status", "payment_expires_at", "reserved_at", "id") WHERE (("status" = 'payment_pending'::"text") AND ("payment_status" = 'pending'::"text"));



CREATE INDEX "idx_reservations_pending_payment" ON "public"."reservations" USING "btree" ("payment_status", "status", "payment_expires_at") WHERE (("status" = 'payment_pending'::"text") AND ("payment_status" = 'pending'::"text"));



CREATE INDEX "idx_reservations_user" ON "public"."reservations" USING "btree" ("user_id");



CREATE INDEX "idx_reservations_user_lifecycle" ON "public"."reservations" USING "btree" ("user_id", "pickup_type", "task_status", "reserved_at" DESC);



CREATE INDEX "idx_reservations_user_status" ON "public"."reservations" USING "btree" ("user_id", "status", "reserved_at" DESC);



CREATE INDEX "idx_reservations_volunteer_tasks" ON "public"."reservations" USING "btree" ("assigned_volunteer_id", "task_status", "assigned_at" DESC) WHERE ("assigned_volunteer_id" IS NOT NULL);



CREATE INDEX "idx_restaurants_verification" ON "public"."restaurants" USING "btree" ("is_verified", "created_at" DESC);



CREATE INDEX "idx_users_location" ON "public"."users" USING "gist" ("location");



CREATE INDEX "idx_volunteer_requests_lookup" ON "public"."volunteer_requests" USING "btree" ("ngo_id", "volunteer_id", "request_type", "status");



CREATE INDEX "idx_volunteers_ngo" ON "public"."volunteers" USING "btree" ("ngo_id");



CREATE INDEX "idx_volunteers_status" ON "public"."volunteers" USING "btree" ("status");



CREATE INDEX "idx_volunteers_user" ON "public"."volunteers" USING "btree" ("user_id");



CREATE UNIQUE INDEX "unique_active_reservation" ON "public"."reservations" USING "btree" ("user_id", "listing_id") WHERE ((("status" = ANY (ARRAY['reserved'::"text", 'pending'::"text", 'volunteer_started'::"text", 'picked_from_provider'::"text", 'delivered'::"text", 'picked_up'::"text", 'completed'::"text"])) OR ("task_status" = ANY (ARRAY['self_pickup'::"text", 'pending'::"text", 'assigned'::"text", 'in_progress'::"text", 'volunteer_started'::"text", 'picked_from_provider'::"text", 'delivered'::"text"]))) AND (NOT (("status" = 'payment_pending'::"text") AND ("payment_status" = 'pending'::"text"))) AND (COALESCE("status", ''::"text") <> ALL (ARRAY['cancelled'::"text", 'expired'::"text", 'failed'::"text", 'payment_failed'::"text", 'abandoned_payment'::"text", 'expired_payment'::"text", 'cancelled_before_confirmation'::"text"])) AND (COALESCE("payment_status", ''::"text") <> ALL (ARRAY['failed'::"text", 'expired'::"text", 'abandoned'::"text", 'cancelled'::"text"])));



CREATE UNIQUE INDEX "unique_pending_payment_reservation" ON "public"."reservations" USING "btree" ("user_id", "listing_id") WHERE (("status" = 'payment_pending'::"text") AND ("payment_status" = 'pending'::"text"));



CREATE UNIQUE INDEX "unique_volunteer_active_task" ON "public"."reservations" USING "btree" ("assigned_volunteer_id") WHERE (("assigned_volunteer_id" IS NOT NULL) AND ("task_status" = ANY (ARRAY[('in_progress'::character varying)::"text", ('picked_from_provider'::character varying)::"text"])));



CREATE UNIQUE INDEX "users_email_unique_idx" ON "public"."users" USING "btree" ("lower"(TRIM(BOTH FROM "email"))) WHERE (("email" IS NOT NULL) AND (TRIM(BOTH FROM "email") <> ''::"text"));



CREATE UNIQUE INDEX "users_phone_unique_idx" ON "public"."users" USING "btree" (TRIM(BOTH FROM "phone")) WHERE (("phone" IS NOT NULL) AND (TRIM(BOTH FROM "phone") <> ''::"text"));



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "fk_ratings_listing" FOREIGN KEY ("listing_id") REFERENCES "public"."food_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "fk_ratings_reservation" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "fk_ratings_reviewer" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."food_listings"
    ADD CONSTRAINT "food_listings_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "public"."ngos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."food_listings"
    ADD CONSTRAINT "food_listings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ngo_requests"
    ADD CONSTRAINT "ngo_requests_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."food_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ngo_requests"
    ADD CONSTRAINT "ngo_requests_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "public"."ngos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ngos"
    ADD CONSTRAINT "ngos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."payment_order_attempts"
    ADD CONSTRAINT "payment_order_attempts_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_beneficiary_user_id_fkey" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_commission_receiver_user_id_fkey" FOREIGN KEY ("commission_receiver_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_deposit_owner_user_id_fkey" FOREIGN KEY ("deposit_owner_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_refund_target_user_id_fkey" FOREIGN KEY ("refund_target_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_payment_ownership_id_fkey" FOREIGN KEY ("payment_ownership_id") REFERENCES "public"."payment_ownership"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."financial_state_transitions"
    ADD CONSTRAINT "financial_state_transitions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;


ALTER TABLE ONLY "public"."financial_state_transitions"
    ADD CONSTRAINT "financial_state_transitions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "public"."ngos"("id");



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id");



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_reviewed_by_admin_fkey" FOREIGN KEY ("reviewed_by_admin") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."food_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_assigned_volunteer_id_fkey" FOREIGN KEY ("assigned_volunteer_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."food_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."volunteer_requests"
    ADD CONSTRAINT "volunteer_requests_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "public"."ngos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_requests"
    ADD CONSTRAINT "volunteer_requests_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_stats"
    ADD CONSTRAINT "volunteer_stats_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."volunteers"
    ADD CONSTRAINT "volunteers_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "public"."ngos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteers"
    ADD CONSTRAINT "volunteers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."cashfree_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."cashfree_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."cashfree_webhook_events" TO "service_role";


GRANT ALL ON TABLE "public"."cashfree_webhook_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."cashfree_webhook_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."cashfree_webhook_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."food_listings" TO "anon";
GRANT ALL ON TABLE "public"."food_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."food_listings" TO "service_role";



GRANT ALL ON TABLE "public"."ngo_requests" TO "anon";
GRANT ALL ON TABLE "public"."ngo_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."ngo_requests" TO "service_role";



GRANT ALL ON TABLE "public"."ngos" TO "anon";
GRANT ALL ON TABLE "public"."ngos" TO "authenticated";
GRANT ALL ON TABLE "public"."ngos" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."operational_alerts" TO "anon";
GRANT ALL ON TABLE "public"."operational_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."operational_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."operational_events" TO "anon";
GRANT ALL ON TABLE "public"."operational_events" TO "authenticated";
GRANT ALL ON TABLE "public"."operational_events" TO "service_role";


GRANT ALL ON TABLE "public"."payment_order_attempts" TO "anon";
GRANT ALL ON TABLE "public"."payment_order_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_order_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";


GRANT ALL ON TABLE "public"."financial_state_transitions" TO "anon";
GRANT ALL ON TABLE "public"."financial_state_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_state_transitions" TO "service_role";



GRANT ALL ON TABLE "public"."penalties" TO "anon";
GRANT ALL ON TABLE "public"."penalties" TO "authenticated";
GRANT ALL ON TABLE "public"."penalties" TO "service_role";



GRANT ALL ON TABLE "public"."provider_reports" TO "anon";
GRANT ALL ON TABLE "public"."provider_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_reports" TO "service_role";



GRANT ALL ON TABLE "public"."ratings" TO "anon";
GRANT ALL ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";



GRANT ALL ON TABLE "public"."reservations" TO "anon";
GRANT ALL ON TABLE "public"."reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."reservations" TO "service_role";



GRANT ALL ON TABLE "public"."restaurants" TO "anon";
GRANT ALL ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_requests" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_requests" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_stats" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_stats" TO "service_role";



GRANT ALL ON TABLE "public"."volunteers" TO "anon";
GRANT ALL ON TABLE "public"."volunteers" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteers" TO "service_role";



GRANT ALL ON TABLE "public"."worker_heartbeats" TO "anon";
GRANT ALL ON TABLE "public"."worker_heartbeats" TO "authenticated";
GRANT ALL ON TABLE "public"."worker_heartbeats" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
