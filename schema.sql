


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


CREATE OR REPLACE FUNCTION "public"."prevent_admin_trust_action_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'admin_trust_actions rows are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_admin_trust_action_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
        BEGIN
          RAISE EXCEPTION 'cashfree_webhook_audit_log rows are immutable';
        END;
        $$;


ALTER FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_compliance_event_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'compliance events are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_compliance_event_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_financial_ledger_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'financial ledger and settlement snapshot rows are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_financial_ledger_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_financial_state_transition_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
        BEGIN
          RAISE EXCEPTION 'financial_state_transitions rows are immutable';
        END;
        $$;


ALTER FUNCTION "public"."prevent_financial_state_transition_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_incident_management_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'incident management rows are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_incident_management_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_payment_ownership_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'payment_ownership rows are immutable';
END;
$$;


ALTER FUNCTION "public"."prevent_payment_ownership_mutation"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_trust_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_user_id" "uuid",
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "idempotency_key" "text",
    "trust_event_key" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_trust_actions_type_check" CHECK (("action_type" = ANY (ARRAY['MANUAL_RESTRICTION'::"text", 'MANUAL_COOLDOWN'::"text", 'MANUAL_RECOVERY_CREDIT'::"text", 'VERIFIED_GOOD_BEHAVIOR'::"text", 'TRUST_REVIEW_FLAG'::"text"])))
);


ALTER TABLE "public"."admin_trust_actions" OWNER TO "postgres";


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
    "received_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cashfree_webhook_audit_log" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."compliance_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_user_id" "uuid",
    "actor_type" "text" DEFAULT 'admin'::"text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "deletion_request_id" "uuid",
    "policy_key" "text",
    "details" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "compliance_events_actor_type_valid" CHECK (("actor_type" = ANY (ARRAY['admin'::"text", 'system'::"text", 'user'::"text"]))),
    CONSTRAINT "compliance_events_event_present" CHECK (("length"(TRIM(BOTH FROM "event_type")) > 0)),
    CONSTRAINT "compliance_events_target_present" CHECK ((("length"(TRIM(BOTH FROM "target_type")) > 0) AND ("length"(TRIM(BOTH FROM "target_id")) > 0)))
);


ALTER TABLE "public"."compliance_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."data_archive_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_table" "text" NOT NULL,
    "source_record_id" "text" NOT NULL,
    "policy_key" "text" NOT NULL,
    "archive_status" "text" DEFAULT 'candidate'::"text" NOT NULL,
    "archive_reason" "text",
    "storage_provider" "text",
    "archive_reference" "text",
    "archived_by_admin_id" "uuid",
    "archived_at" timestamp without time zone,
    "visible_in_audit_center" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "data_archive_records_record_present" CHECK (("length"(TRIM(BOTH FROM "source_record_id")) > 0)),
    CONSTRAINT "data_archive_records_source_present" CHECK (("length"(TRIM(BOTH FROM "source_table")) > 0)),
    CONSTRAINT "data_archive_records_status_valid" CHECK (("archive_status" = ANY (ARRAY['candidate'::"text", 'archived'::"text", 'restored'::"text", 'blocked'::"text", 'legal_hold'::"text"])))
);


ALTER TABLE "public"."data_archive_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."data_deletion_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_type" "text" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "text" NOT NULL,
    "target_user_id" "uuid",
    "requested_by_user_id" "uuid",
    "status" "text" DEFAULT 'REQUESTED'::"text" NOT NULL,
    "reason" "text" NOT NULL,
    "review_note" "text",
    "decision_note" "text",
    "execution_summary" "text",
    "legal_hold" boolean DEFAULT false NOT NULL,
    "policy_key" "text" NOT NULL,
    "approval_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "execution_result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "requested_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "reviewed_by_admin_id" "uuid",
    "reviewed_at" timestamp without time zone,
    "approved_by_admin_id" "uuid",
    "approved_at" timestamp without time zone,
    "executed_by_admin_id" "uuid",
    "executed_at" timestamp without time zone,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "data_deletion_requests_reason_present" CHECK (("length"(TRIM(BOTH FROM "reason")) > 0)),
    CONSTRAINT "data_deletion_requests_status_valid" CHECK (("status" = ANY (ARRAY['REQUESTED'::"text", 'UNDER_REVIEW'::"text", 'APPROVED'::"text", 'REJECTED'::"text", 'EXECUTED'::"text", 'CANCELLED'::"text"]))),
    CONSTRAINT "data_deletion_requests_subject_present" CHECK (("length"(TRIM(BOTH FROM "subject_id")) > 0)),
    CONSTRAINT "data_deletion_requests_subject_type_valid" CHECK (("subject_type" = ANY (ARRAY['user'::"text", 'provider'::"text", 'ngo'::"text", 'volunteer'::"text", 'admin'::"text", 'provider_report_attachment'::"text", 'moderation_appeal_attachment'::"text", 'notification'::"text", 'other'::"text"]))),
    CONSTRAINT "data_deletion_requests_type_valid" CHECK (("request_type" = ANY (ARRAY['account_deletion'::"text", 'data_access'::"text", 'anonymization'::"text", 'evidence_deletion'::"text", 'notification_cleanup'::"text"])))
);


ALTER TABLE "public"."data_deletion_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "payment_id" "uuid",
    "payment_session_id" "text" NOT NULL,
    "payment_ownership_id" "uuid",
    "settlement_allocation_id" "uuid",
    "provider_settlement_id" "uuid",
    "settlement_batch_id" "uuid",
    "event_type" "text" NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" "text",
    "counterparty_user_id" "uuid",
    "counterparty_role" "text",
    "refund_id" "text",
    "source_type" "text" DEFAULT 'system'::"text" NOT NULL,
    "source_id" "text",
    "idempotency_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_ledger_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation_type" "text" NOT NULL,
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
    "operation_source" "text" DEFAULT 'unspecified'::"text",
    CONSTRAINT "financial_operations_amount_nonnegative" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "financial_operations_currency_present" CHECK (("length"(TRIM(BOTH FROM "currency")) > 0)),
    CONSTRAINT "financial_operations_retry_count_nonnegative" CHECK (("retry_count" >= 0)),
    CONSTRAINT "financial_operations_status_valid" CHECK (("status" = ANY (ARRAY['planned'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text", 'skipped'::"text", 'retained'::"text"])))
);


ALTER TABLE "public"."financial_operations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_refund_terminal_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "payment_session_id" "text" NOT NULL,
    "payment_id" "uuid",
    "refund_type" "text" NOT NULL,
    "refund_id" "text",
    "terminal_status" "text" NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_refund_terminal_records" OWNER TO "postgres";


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
    "quantity_unit" "text" DEFAULT 'Piece'::"text" NOT NULL,
    "custom_quantity_unit" "text",
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "dietary_tags" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    CONSTRAINT "check_price_vs_free" CHECK (((("is_free" = true) AND ("price" = (0)::numeric)) OR (("is_free" = false) AND ("price" > (0)::numeric)))),
    CONSTRAINT "food_listings_category_valid" CHECK (("category" = ANY (ARRAY['meals'::"text", 'bakery'::"text", 'beverages'::"text", 'fruits'::"text", 'vegetables'::"text", 'dairy'::"text", 'snacks'::"text", 'prepared_food'::"text", 'grocery'::"text", 'other'::"text"]))),
    CONSTRAINT "food_listings_custom_quantity_unit_valid" CHECK (((("quantity_unit" = 'Other'::"text") AND ("custom_quantity_unit" IS NOT NULL) AND ("length"(TRIM(BOTH FROM "custom_quantity_unit")) > 0)) OR (("quantity_unit" <> 'Other'::"text") AND ("custom_quantity_unit" IS NULL)))),
    CONSTRAINT "food_listings_dietary_tags_valid" CHECK (("dietary_tags" <@ ARRAY['vegetarian'::"text", 'vegan'::"text", 'egg'::"text", 'non_veg'::"text", 'halal'::"text", 'jain'::"text", 'gluten_free'::"text"])),
    CONSTRAINT "food_listings_quantity_unit_valid" CHECK (("quantity_unit" = ANY (ARRAY['Meal Box'::"text", 'Food Packet'::"text", 'Plate'::"text", 'Container'::"text", 'Tray'::"text", 'Loaf'::"text", 'Bottle'::"text", 'Liter'::"text", 'Kilogram'::"text", 'Piece'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."food_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "from_assigned_admin_id" "uuid",
    "to_assigned_admin_id" "uuid",
    "note_id" "uuid",
    "postmortem_id" "uuid",
    "details" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "incident_events_from_status_valid" CHECK ((("from_status" IS NULL) OR ("from_status" = ANY (ARRAY['OPEN'::"text", 'INVESTIGATING'::"text", 'IDENTIFIED'::"text", 'MITIGATING'::"text", 'RESOLVED'::"text", 'CLOSED'::"text"])))),
    CONSTRAINT "incident_events_to_status_valid" CHECK ((("to_status" IS NULL) OR ("to_status" = ANY (ARRAY['OPEN'::"text", 'INVESTIGATING'::"text", 'IDENTIFIED'::"text", 'MITIGATING'::"text", 'RESOLVED'::"text", 'CLOSED'::"text"])))),
    CONSTRAINT "incident_events_type_valid" CHECK (("event_type" = ANY (ARRAY['INCIDENT_CREATED'::"text", 'INCIDENT_ASSIGNED'::"text", 'INCIDENT_STATUS_CHANGED'::"text", 'INCIDENT_RESOLVED'::"text", 'INCIDENT_CLOSED'::"text", 'INCIDENT_NOTE_ADDED'::"text", 'INCIDENT_POSTMORTEM_ADDED'::"text"])))
);


ALTER TABLE "public"."incident_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "note" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "incident_notes_note_present" CHECK (("length"(TRIM(BOTH FROM "note")) > 0))
);


ALTER TABLE "public"."incident_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_postmortems" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "root_cause" "text" NOT NULL,
    "impact_summary" "text" NOT NULL,
    "detection_method" "text" NOT NULL,
    "resolution_summary" "text" NOT NULL,
    "follow_up_actions" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "incident_postmortems_detection_present" CHECK (("length"(TRIM(BOTH FROM "detection_method")) > 0)),
    CONSTRAINT "incident_postmortems_followups_present" CHECK (("length"(TRIM(BOTH FROM "follow_up_actions")) > 0)),
    CONSTRAINT "incident_postmortems_impact_present" CHECK (("length"(TRIM(BOTH FROM "impact_summary")) > 0)),
    CONSTRAINT "incident_postmortems_resolution_present" CHECK (("length"(TRIM(BOTH FROM "resolution_summary")) > 0)),
    CONSTRAINT "incident_postmortems_root_cause_present" CHECK (("length"(TRIM(BOTH FROM "root_cause")) > 0))
);


ALTER TABLE "public"."incident_postmortems" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incident_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "severity" "text" NOT NULL,
    "category" "text" NOT NULL,
    "initial_status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "created_by_admin_id" "uuid" NOT NULL,
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_ref_id" "text",
    "source_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "incident_records_category_valid" CHECK (("category" = ANY (ARRAY['INFRASTRUCTURE'::"text", 'PAYMENTS'::"text", 'TRUST'::"text", 'GOVERNANCE'::"text", 'NOTIFICATIONS'::"text", 'REALTIME'::"text", 'DATABASE'::"text", 'SECURITY'::"text", 'COMPLIANCE'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "incident_records_initial_status_valid" CHECK (("initial_status" = 'OPEN'::"text")),
    CONSTRAINT "incident_records_severity_valid" CHECK (("severity" = ANY (ARRAY['SEV1'::"text", 'SEV2'::"text", 'SEV3'::"text", 'SEV4'::"text"]))),
    CONSTRAINT "incident_records_source_type_valid" CHECK (("source_type" = ANY (ARRAY['manual'::"text", 'operational_monitoring'::"text", 'operational_alert'::"text", 'queue_diagnostic'::"text", 'trust_diagnostic'::"text", 'financial_diagnostic'::"text"]))),
    CONSTRAINT "incident_records_title_present" CHECK (("length"(TRIM(BOTH FROM "title")) > 0))
);


ALTER TABLE "public"."incident_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."listing_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "image_url" "text" NOT NULL,
    "public_id" "text" NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."listing_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_appeal_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appeal_id" "uuid" NOT NULL,
    "uploader_user_id" "uuid" NOT NULL,
    "file_url" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size_bytes" integer NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "retention_policy_key" "text" DEFAULT 'evidence_records'::"text" NOT NULL,
    "archive_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "archived_at" timestamp without time zone,
    "archived_by_admin_id" "uuid",
    "archive_reference" "text",
    "archive_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "retained_until" timestamp without time zone
);


ALTER TABLE "public"."moderation_appeal_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_appeal_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appeal_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "event_type" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "note" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."moderation_appeal_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_appeals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'SUBMITTED'::"text" NOT NULL,
    "appeal_text" "text" NOT NULL,
    "decision_note" "text",
    "reviewed_by_admin" "uuid",
    "submitted_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp without time zone,
    "withdrawn_at" timestamp without time zone,
    "withdrawn_by_user_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "moderation_appeals_status_check" CHECK (("status" = ANY (ARRAY['SUBMITTED'::"text", 'UNDER_REVIEW'::"text", 'ACCEPTED'::"text", 'REJECTED'::"text", 'WITHDRAWN'::"text"])))
);


ALTER TABLE "public"."moderation_appeals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_case_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "event_type" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "note" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."moderation_case_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_type" "text" DEFAULT 'provider_report'::"text" NOT NULL,
    "subject_type" "text" DEFAULT 'provider'::"text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "opened_by_user_id" "uuid",
    "assigned_admin_id" "uuid",
    "source_report_id" "uuid",
    "reason" "text",
    "summary" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp without time zone,
    CONSTRAINT "moderation_cases_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'UNDER_REVIEW'::"text", 'AWAITING_RESPONSE'::"text", 'VALIDATED'::"text", 'DISMISSED'::"text", 'ESCALATED'::"text"])))
);


ALTER TABLE "public"."moderation_cases" OWNER TO "postgres";


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
    "listing_id" "uuid",
    "retention_policy_key" "text" DEFAULT 'notifications'::"text" NOT NULL,
    "archive_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "archived_at" timestamp without time zone,
    "archived_by_admin_id" "uuid",
    "archive_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "retained_until" timestamp without time zone,
    "idempotency_key" "text"
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
    "recovered_at" timestamp without time zone
);


ALTER TABLE "public"."payment_order_attempts" OWNER TO "postgres";


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
    CONSTRAINT "payment_ownership_currency_present" CHECK (("length"(TRIM(BOTH FROM "currency")) > 0)),
    CONSTRAINT "payment_ownership_version_positive" CHECK (("ownership_version" > 0))
);


ALTER TABLE "public"."payment_ownership" OWNER TO "postgres";


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
    "commission_percent" numeric(6,3),
    "commission_amount" numeric(12,2),
    "provider_amount" numeric(12,2),
    "food_amount_snapshot" numeric(12,2),
    "platform_amount" numeric(12,2),
    CONSTRAINT "payments_financial_terms_nonnegative" CHECK (((("commission_percent" IS NULL) OR ("commission_percent" >= (0)::numeric)) AND (("commission_amount" IS NULL) OR ("commission_amount" >= (0)::numeric)) AND (("provider_amount" IS NULL) OR ("provider_amount" >= (0)::numeric)) AND (("food_amount_snapshot" IS NULL) OR ("food_amount_snapshot" >= (0)::numeric)) AND (("platform_amount" IS NULL) OR ("platform_amount" >= (0)::numeric)))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['created'::"text", 'pending'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text", 'expired'::"text", 'refund_pending'::"text", 'refund_failed'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."penalties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "ngo_id" "uuid",
    "reservation_id" "uuid",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."penalties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_case_response_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "response_id" "uuid" NOT NULL,
    "file_url" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size_bytes" integer NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provider_case_response_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_case_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "response_text" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provider_case_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_report_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "uploader_user_id" "uuid" NOT NULL,
    "file_url" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size_bytes" integer NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "retention_policy_key" "text" DEFAULT 'evidence_records'::"text" NOT NULL,
    "archive_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "archived_at" timestamp without time zone,
    "archived_by_admin_id" "uuid",
    "archive_reference" "text",
    "archive_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "retained_until" timestamp without time zone
);


ALTER TABLE "public"."provider_report_attachments" OWNER TO "postgres";


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
    "reviewed_by_admin" "uuid",
    "moderation_case_id" "uuid"
);


ALTER TABLE "public"."provider_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "payment_id" "uuid",
    "payment_session_id" "text" NOT NULL,
    "settlement_allocation_id" "uuid" NOT NULL,
    "settlement_batch_id" "uuid",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "commission_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "status" "text" DEFAULT 'allocated'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provider_settlements" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."retention_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "policy_key" "text" NOT NULL,
    "category" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "retention_duration_days" integer,
    "archive_after_days" integer,
    "delete_after_days" integer,
    "deletion_eligible" boolean DEFAULT false NOT NULL,
    "deletion_mode" "text" DEFAULT 'never_delete'::"text" NOT NULL,
    "archive_mode" "text" DEFAULT 'none'::"text" NOT NULL,
    "legal_basis" "text" DEFAULT 'platform_integrity'::"text" NOT NULL,
    "immutable_source" boolean DEFAULT false NOT NULL,
    "searchable_when_archived" boolean DEFAULT true NOT NULL,
    "protects_financial_integrity" boolean DEFAULT false NOT NULL,
    "protects_trust_replay" boolean DEFAULT false NOT NULL,
    "protects_investigations" boolean DEFAULT false NOT NULL,
    "default_policy" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "retention_policies_archive_mode_valid" CHECK (("archive_mode" = ANY (ARRAY['none'::"text", 'searchable_hot'::"text", 'searchable_archive'::"text", 'cloudinary_preserve'::"text", 'summarize_then_archive'::"text"]))),
    CONSTRAINT "retention_policies_archive_positive" CHECK ((("archive_after_days" IS NULL) OR ("archive_after_days" > 0))),
    CONSTRAINT "retention_policies_category_present" CHECK (("length"(TRIM(BOTH FROM "category")) > 0)),
    CONSTRAINT "retention_policies_delete_positive" CHECK ((("delete_after_days" IS NULL) OR ("delete_after_days" > 0))),
    CONSTRAINT "retention_policies_deletion_mode_valid" CHECK (("deletion_mode" = ANY (ARRAY['never_delete'::"text", 'anonymize_only'::"text", 'controlled_delete'::"text", 'archive_then_controlled_delete'::"text"]))),
    CONSTRAINT "retention_policies_display_present" CHECK (("length"(TRIM(BOTH FROM "display_name")) > 0)),
    CONSTRAINT "retention_policies_key_present" CHECK (("length"(TRIM(BOTH FROM "policy_key")) > 0)),
    CONSTRAINT "retention_policies_retention_positive" CHECK ((("retention_duration_days" IS NULL) OR ("retention_duration_days" > 0)))
);


ALTER TABLE "public"."retention_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlement_allocation_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "payment_id" "uuid",
    "payment_session_id" "text" NOT NULL,
    "payment_ownership_id" "uuid" NOT NULL,
    "commission_percent" numeric(6,3) DEFAULT 0 NOT NULL,
    "commission_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "provider_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "platform_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "deposit_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "food_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "settlement_version" integer DEFAULT 1 NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."settlement_allocation_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlement_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_reference" "text" NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "provider_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "commission_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."settlement_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trust_event_effects" (
    "event_id" "uuid" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "effect_hash" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trust_event_effects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trust_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_key" "text" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "text" NOT NULL,
    "reservation_id" "uuid",
    "payment_id" "uuid",
    "event_type" "text" NOT NULL,
    "event_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "processing_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "processed_at" timestamp without time zone,
    "last_error" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trust_events_processing_status_check" CHECK (("processing_status" = ANY (ARRAY['pending'::"text", 'retry'::"text", 'processing'::"text", 'processed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."trust_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trust_restrictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restriction_type" "text" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "active_until" timestamp without time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trust_restrictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trust_scores" (
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "trust_score" numeric DEFAULT 100 NOT NULL,
    "penalty_level" integer DEFAULT 0 NOT NULL,
    "deposit_multiplier" numeric DEFAULT 1 NOT NULL,
    "cooldown_until" timestamp without time zone,
    "restriction_level" integer DEFAULT 0 NOT NULL,
    "last_event_at" timestamp without time zone,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "cancellation_count" integer DEFAULT 0 NOT NULL,
    "completion_count" integer DEFAULT 0 NOT NULL,
    "timeout_count" integer DEFAULT 0 NOT NULL,
    "fulfillment_count" integer DEFAULT 0 NOT NULL,
    "refund_count" integer DEFAULT 0 NOT NULL,
    "projected_restriction_level" integer DEFAULT 0 NOT NULL,
    "projected_cooldown_until" timestamp without time zone,
    "projected_deposit_multiplier" numeric DEFAULT 1 NOT NULL,
    "recovery_progress" numeric DEFAULT 100 NOT NULL,
    "risk_category" "text" DEFAULT 'normal'::"text" NOT NULL,
    "success_streak" integer DEFAULT 0 NOT NULL,
    "failure_streak" integer DEFAULT 0 NOT NULL,
    "last_success_at" timestamp without time zone,
    "last_failure_at" timestamp without time zone,
    "last_decay_at" timestamp without time zone,
    "score_breakdown" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "projected_actions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "recovery_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "decay_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "risk_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "trust_scores_deposit_multiplier_minimum" CHECK (("deposit_multiplier" >= (1)::numeric)),
    CONSTRAINT "trust_scores_penalty_level_nonnegative" CHECK (("penalty_level" >= 0)),
    CONSTRAINT "trust_scores_restriction_level_nonnegative" CHECK (("restriction_level" >= 0)),
    CONSTRAINT "trust_scores_trust_score_bounds" CHECK ((("trust_score" >= (0)::numeric) AND ("trust_score" <= (100)::numeric)))
);


ALTER TABLE "public"."trust_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100),
    "phone" character varying(15),
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
    "auth_session_version" integer DEFAULT 0 NOT NULL,
    "google_id" "text",
    "email_verified" boolean DEFAULT false NOT NULL,
    "auth_provider" "text" DEFAULT 'otp'::"text" NOT NULL,
    "phone_verified_at" timestamp without time zone,
    "profile_image_url" "text",
    "profile_image_public_id" "text",
    CONSTRAINT "users_auth_provider_check" CHECK (("auth_provider" = ANY (ARRAY['otp'::"text", 'google'::"text"]))),
    CONSTRAINT "users_profile_image_public_id_nonempty" CHECK ((("profile_image_public_id" IS NULL) OR ("length"(TRIM(BOTH FROM "profile_image_public_id")) > 0))),
    CONSTRAINT "users_profile_image_url_nonempty" CHECK ((("profile_image_url" IS NULL) OR ("length"(TRIM(BOTH FROM "profile_image_url")) > 0))),
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


ALTER TABLE ONLY "public"."admin_trust_actions"
    ADD CONSTRAINT "admin_trust_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_trust_actions"
    ADD CONSTRAINT "admin_trust_actions_trust_event_key_key" UNIQUE ("trust_event_key");



ALTER TABLE ONLY "public"."cashfree_webhook_audit_log"
    ADD CONSTRAINT "cashfree_webhook_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cashfree_webhook_events"
    ADD CONSTRAINT "cashfree_webhook_events_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."cashfree_webhook_events"
    ADD CONSTRAINT "cashfree_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_events"
    ADD CONSTRAINT "compliance_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_archive_records"
    ADD CONSTRAINT "data_archive_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_refund_terminal_records"
    ADD CONSTRAINT "financial_refund_terminal_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_state_transitions"
    ADD CONSTRAINT "financial_state_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."food_listings"
    ADD CONSTRAINT "food_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."food_listings"
    ADD CONSTRAINT "food_listings_remaining_quantity_nonnegative" CHECK (("remaining_quantity" >= 0)) NOT VALID;



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_notes"
    ADD CONSTRAINT "incident_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_postmortems"
    ADD CONSTRAINT "incident_postmortems_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_postmortems"
    ADD CONSTRAINT "incident_postmortems_unique_incident" UNIQUE ("incident_id");



ALTER TABLE ONLY "public"."incident_records"
    ADD CONSTRAINT "incident_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."listing_images"
    ADD CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."moderation_appeal_attachments"
    ADD CONSTRAINT "moderation_appeal_attachments_archive_status_valid" CHECK (("archive_status" = ANY (ARRAY['active'::"text", 'candidate'::"text", 'archived'::"text", 'legal_hold'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."moderation_appeal_attachments"
    ADD CONSTRAINT "moderation_appeal_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_appeal_events"
    ADD CONSTRAINT "moderation_appeal_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_case_events"
    ADD CONSTRAINT "moderation_case_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ngo_requests"
    ADD CONSTRAINT "ngo_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ngos"
    ADD CONSTRAINT "ngos_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."notifications"
    ADD CONSTRAINT "notifications_archive_status_valid" CHECK (("archive_status" = ANY (ARRAY['active'::"text", 'candidate'::"text", 'archived'::"text", 'legal_hold'::"text"]))) NOT VALID;



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



ALTER TABLE ONLY "public"."payment_ownership"
    ADD CONSTRAINT "payment_ownership_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_case_response_attachments"
    ADD CONSTRAINT "provider_case_response_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_case_responses"
    ADD CONSTRAINT "provider_case_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."provider_report_attachments"
    ADD CONSTRAINT "provider_report_attachments_archive_status_valid" CHECK (("archive_status" = ANY (ARRAY['active'::"text", 'candidate'::"text", 'archived'::"text", 'legal_hold'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."provider_report_attachments"
    ADD CONSTRAINT "provider_report_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_settlements"
    ADD CONSTRAINT "provider_settlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_policy_key_key" UNIQUE ("policy_key");



ALTER TABLE ONLY "public"."settlement_allocation_snapshots"
    ADD CONSTRAINT "settlement_allocation_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlement_batches"
    ADD CONSTRAINT "settlement_batches_batch_reference_key" UNIQUE ("batch_reference");



ALTER TABLE ONLY "public"."settlement_batches"
    ADD CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trust_event_effects"
    ADD CONSTRAINT "trust_event_effects_pkey" PRIMARY KEY ("event_id", "subject_type", "subject_id");



ALTER TABLE ONLY "public"."trust_events"
    ADD CONSTRAINT "trust_events_event_key_key" UNIQUE ("event_key");



ALTER TABLE ONLY "public"."trust_events"
    ADD CONSTRAINT "trust_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trust_restrictions"
    ADD CONSTRAINT "trust_restrictions_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_cancellation_count_nonnegative" CHECK (("cancellation_count" >= 0)) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_completion_count_nonnegative" CHECK (("completion_count" >= 0)) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_failure_count_nonnegative" CHECK (("failure_count" >= 0)) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_fulfillment_count_nonnegative" CHECK (("fulfillment_count" >= 0)) NOT VALID;



ALTER TABLE ONLY "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_pkey" PRIMARY KEY ("subject_type", "subject_id");



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_projected_deposit_multiplier_minimum" CHECK (("projected_deposit_multiplier" >= (1)::numeric)) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_projected_restriction_level_bounds" CHECK ((("projected_restriction_level" >= 0) AND ("projected_restriction_level" <= 5))) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_recovery_progress_bounds" CHECK ((("recovery_progress" >= (0)::numeric) AND ("recovery_progress" <= (100)::numeric))) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_refund_count_nonnegative" CHECK (("refund_count" >= 0)) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_risk_category_check" CHECK (("risk_category" = ANY (ARRAY['normal'::"text", 'watch'::"text", 'elevated'::"text", 'high'::"text", 'severe'::"text", 'critical'::"text"]))) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_streaks_nonnegative" CHECK ((("success_streak" >= 0) AND ("failure_streak" >= 0))) NOT VALID;



ALTER TABLE "public"."trust_scores"
    ADD CONSTRAINT "trust_scores_timeout_count_nonnegative" CHECK (("timeout_count" >= 0)) NOT VALID;



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



CREATE INDEX "idx_admin_trust_actions_admin_created" ON "public"."admin_trust_actions" USING "btree" ("admin_user_id", "created_at" DESC) WHERE ("admin_user_id" IS NOT NULL);



CREATE INDEX "idx_admin_trust_actions_created" ON "public"."admin_trust_actions" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "idx_admin_trust_actions_idempotency" ON "public"."admin_trust_actions" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "idx_admin_trust_actions_subject_created" ON "public"."admin_trust_actions" USING "btree" ("subject_type", "subject_id", "created_at" DESC);



CREATE INDEX "idx_admin_trust_actions_type_created" ON "public"."admin_trust_actions" USING "btree" ("action_type", "created_at" DESC);



CREATE INDEX "idx_business_metrics_food_listings_created" ON "public"."food_listings" USING "btree" ("created_at" DESC, "id" DESC) WHERE (COALESCE("is_deleted", false) = false);



CREATE INDEX "idx_business_metrics_food_listings_provider_created" ON "public"."food_listings" USING "btree" ("provider_id", "created_at" DESC) WHERE (("provider_id" IS NOT NULL) AND (COALESCE("is_deleted", false) = false));



CREATE INDEX "idx_business_metrics_moderation_appeals_submitted" ON "public"."moderation_appeals" USING "btree" ("submitted_at" DESC, "id" DESC);



CREATE INDEX "idx_business_metrics_provider_reports_created" ON "public"."provider_reports" USING "btree" ("created_at" DESC, "id" DESC);



CREATE INDEX "idx_business_metrics_provider_reports_status_resolved" ON "public"."provider_reports" USING "btree" ("status", "resolved_at" DESC, "created_at" DESC);



CREATE INDEX "idx_business_metrics_provider_settlements_created" ON "public"."provider_settlements" USING "btree" ("created_at" DESC, "id" DESC);



CREATE INDEX "idx_business_metrics_provider_settlements_status_updated" ON "public"."provider_settlements" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "idx_business_metrics_refund_terminal_created" ON "public"."financial_refund_terminal_records" USING "btree" ("terminal_status", "created_at" DESC);



CREATE INDEX "idx_business_metrics_reservations_completed" ON "public"."reservations" USING "btree" ("completed_at" DESC, "id" DESC) WHERE ("completed_at" IS NOT NULL);



CREATE INDEX "idx_business_metrics_reservations_picked_up" ON "public"."reservations" USING "btree" ("picked_up_at" DESC, "id" DESC) WHERE ("picked_up_at" IS NOT NULL);



CREATE INDEX "idx_business_metrics_reservations_reserved" ON "public"."reservations" USING "btree" ("reserved_at" DESC, "id" DESC);



CREATE INDEX "idx_business_metrics_reservations_volunteer" ON "public"."reservations" USING "btree" ("assigned_volunteer_id", "completed_at" DESC) WHERE ("assigned_volunteer_id" IS NOT NULL);



CREATE INDEX "idx_cashfree_webhook_audit_order" ON "public"."cashfree_webhook_audit_log" USING "btree" ("order_id", "received_at" DESC) WHERE ("order_id" IS NOT NULL);



CREATE INDEX "idx_cashfree_webhook_audit_refund" ON "public"."cashfree_webhook_audit_log" USING "btree" ("refund_id", "received_at" DESC) WHERE ("refund_id" IS NOT NULL);



CREATE INDEX "idx_cashfree_webhook_audit_status" ON "public"."cashfree_webhook_audit_log" USING "btree" ("processing_status", "received_at" DESC);



CREATE INDEX "idx_cashfree_webhook_events_order" ON "public"."cashfree_webhook_events" USING "btree" ("order_id", "received_at" DESC);



CREATE INDEX "idx_cashfree_webhook_events_order_recent" ON "public"."cashfree_webhook_events" USING "btree" ("order_id", "received_at" DESC, "status") WHERE ("order_id" IS NOT NULL);



CREATE INDEX "idx_cashfree_webhook_events_status" ON "public"."cashfree_webhook_events" USING "btree" ("status", "received_at" DESC);



CREATE INDEX "idx_compliance_events_created" ON "public"."compliance_events" USING "btree" ("created_at" DESC, "id" DESC);



CREATE INDEX "idx_compliance_events_request" ON "public"."compliance_events" USING "btree" ("deletion_request_id", "created_at") WHERE ("deletion_request_id" IS NOT NULL);



CREATE INDEX "idx_compliance_events_target" ON "public"."compliance_events" USING "btree" ("target_type", "target_id", "created_at" DESC);



CREATE INDEX "idx_data_archive_records_policy_status" ON "public"."data_archive_records" USING "btree" ("policy_key", "archive_status", "created_at" DESC);



CREATE UNIQUE INDEX "idx_data_archive_records_source" ON "public"."data_archive_records" USING "btree" ("source_table", "source_record_id");



CREATE INDEX "idx_data_deletion_requests_status_requested" ON "public"."data_deletion_requests" USING "btree" ("status", "requested_at" DESC, "id" DESC);



CREATE INDEX "idx_data_deletion_requests_subject" ON "public"."data_deletion_requests" USING "btree" ("subject_type", "subject_id", "requested_at" DESC);



CREATE INDEX "idx_data_deletion_requests_target_user" ON "public"."data_deletion_requests" USING "btree" ("target_user_id", "requested_at" DESC) WHERE ("target_user_id" IS NOT NULL);



CREATE INDEX "idx_financial_ledger_entries_event_type" ON "public"."financial_ledger_entries" USING "btree" ("event_type", "created_at" DESC);



CREATE UNIQUE INDEX "idx_financial_ledger_entries_idempotency_key" ON "public"."financial_ledger_entries" USING "btree" ("idempotency_key");



CREATE INDEX "idx_financial_ledger_entries_payment_session" ON "public"."financial_ledger_entries" USING "btree" ("payment_session_id", "created_at" DESC);



CREATE INDEX "idx_financial_ledger_entries_refund" ON "public"."financial_ledger_entries" USING "btree" ("refund_id", "created_at" DESC) WHERE ("refund_id" IS NOT NULL);



CREATE INDEX "idx_financial_ledger_entries_reservation" ON "public"."financial_ledger_entries" USING "btree" ("reservation_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_financial_operations_idempotency_key" ON "public"."financial_operations" USING "btree" ("idempotency_key");



CREATE INDEX "idx_financial_operations_operation_source" ON "public"."financial_operations" USING "btree" ("operation_source", "created_at" DESC);



CREATE INDEX "idx_financial_operations_payment_ownership" ON "public"."financial_operations" USING "btree" ("payment_ownership_id", "created_at" DESC) WHERE ("payment_ownership_id" IS NOT NULL);



CREATE INDEX "idx_financial_operations_payment_session" ON "public"."financial_operations" USING "btree" ("payment_session_id", "created_at" DESC) WHERE ("payment_session_id" IS NOT NULL);



CREATE INDEX "idx_financial_operations_reservation" ON "public"."financial_operations" USING "btree" ("reservation_id", "created_at" DESC) WHERE ("reservation_id" IS NOT NULL);



CREATE INDEX "idx_financial_operations_status" ON "public"."financial_operations" USING "btree" ("status", "updated_at" DESC);



CREATE UNIQUE INDEX "idx_financial_refund_terminal_idempotency_key" ON "public"."financial_refund_terminal_records" USING "btree" ("idempotency_key");



CREATE UNIQUE INDEX "idx_financial_refund_terminal_once" ON "public"."financial_refund_terminal_records" USING "btree" ("reservation_id", "refund_type") WHERE ("terminal_status" = ANY (ARRAY['refunded'::"text", 'retained'::"text"]));



CREATE INDEX "idx_financial_refund_terminal_refund" ON "public"."financial_refund_terminal_records" USING "btree" ("refund_id") WHERE ("refund_id" IS NOT NULL);



CREATE INDEX "idx_financial_state_transitions_payment" ON "public"."financial_state_transitions" USING "btree" ("payment_id", "created_at" DESC);



CREATE INDEX "idx_financial_state_transitions_reservation" ON "public"."financial_state_transitions" USING "btree" ("reservation_id", "created_at" DESC) WHERE ("reservation_id" IS NOT NULL);



CREATE INDEX "idx_food_listings_active_scan" ON "public"."food_listings" USING "btree" ("pickup_end_time", "remaining_quantity", "created_at" DESC) WHERE ((("status")::"text" = 'active'::"text") AND ("is_deleted" = false));



CREATE INDEX "idx_food_listings_category" ON "public"."food_listings" USING "btree" ("category");



CREATE INDEX "idx_food_listings_dietary_tags" ON "public"."food_listings" USING "gin" ("dietary_tags");



CREATE INDEX "idx_food_listings_location_gist" ON "public"."food_listings" USING "gist" ("location");



CREATE INDEX "idx_food_listings_provider_status" ON "public"."food_listings" USING "btree" ("provider_id", "status", "pickup_end_time" DESC);



CREATE INDEX "idx_food_listings_visibility" ON "public"."food_listings" USING "btree" ("status", "is_deleted", "pickup_end_time");



CREATE INDEX "idx_food_location" ON "public"."food_listings" USING "btree" ("latitude", "longitude");



CREATE INDEX "idx_food_ngo" ON "public"."food_listings" USING "btree" ("ngo_id");



CREATE INDEX "idx_food_remaining" ON "public"."food_listings" USING "btree" ("remaining_quantity");



CREATE INDEX "idx_food_status" ON "public"."food_listings" USING "btree" ("status");



CREATE INDEX "idx_incident_events_actor_created" ON "public"."incident_events" USING "btree" ("actor_user_id", "created_at" DESC);



CREATE INDEX "idx_incident_events_assignment" ON "public"."incident_events" USING "btree" ("incident_id", "created_at" DESC, "id" DESC) WHERE ("event_type" = ANY (ARRAY['INCIDENT_CREATED'::"text", 'INCIDENT_ASSIGNED'::"text"]));



CREATE INDEX "idx_incident_events_incident_created" ON "public"."incident_events" USING "btree" ("incident_id", "created_at", "id");



CREATE INDEX "idx_incident_events_status" ON "public"."incident_events" USING "btree" ("incident_id", "created_at" DESC, "id" DESC) WHERE ("to_status" IS NOT NULL);



CREATE INDEX "idx_incident_events_timeline" ON "public"."incident_events" USING "btree" ("created_at" DESC, "id" DESC);



CREATE INDEX "idx_incident_notes_incident_created" ON "public"."incident_notes" USING "btree" ("incident_id", "created_at", "id");



CREATE INDEX "idx_incident_postmortems_incident" ON "public"."incident_postmortems" USING "btree" ("incident_id", "created_at" DESC);



CREATE INDEX "idx_incident_records_created" ON "public"."incident_records" USING "btree" ("created_at" DESC, "id" DESC);



CREATE INDEX "idx_incident_records_created_by" ON "public"."incident_records" USING "btree" ("created_by_admin_id", "created_at" DESC);



CREATE INDEX "idx_incident_records_severity_category" ON "public"."incident_records" USING "btree" ("severity", "category", "created_at" DESC);



CREATE INDEX "idx_incident_records_source_ref" ON "public"."incident_records" USING "btree" ("source_type", "source_ref_id") WHERE ("source_ref_id" IS NOT NULL);



CREATE INDEX "idx_listing_images_listing_order" ON "public"."listing_images" USING "btree" ("listing_id", "display_order", "id");



CREATE UNIQUE INDEX "idx_listing_images_public_id" ON "public"."listing_images" USING "btree" ("public_id");



CREATE INDEX "idx_moderation_appeal_attachments_appeal" ON "public"."moderation_appeal_attachments" USING "btree" ("appeal_id", "created_at");



CREATE INDEX "idx_moderation_appeal_attachments_archive" ON "public"."moderation_appeal_attachments" USING "btree" ("archive_status", "created_at" DESC, "id" DESC);



CREATE INDEX "idx_moderation_appeal_attachments_uploader_created" ON "public"."moderation_appeal_attachments" USING "btree" ("uploader_user_id", "created_at" DESC);



CREATE INDEX "idx_moderation_appeal_events_actor_created" ON "public"."moderation_appeal_events" USING "btree" ("actor_user_id", "created_at" DESC) WHERE ("actor_user_id" IS NOT NULL);



CREATE INDEX "idx_moderation_appeal_events_appeal_created" ON "public"."moderation_appeal_events" USING "btree" ("appeal_id", "created_at");



CREATE INDEX "idx_moderation_appeal_events_case_created" ON "public"."moderation_appeal_events" USING "btree" ("case_id", "created_at");



CREATE UNIQUE INDEX "idx_moderation_appeals_case_provider" ON "public"."moderation_appeals" USING "btree" ("case_id", "provider_id");



CREATE INDEX "idx_moderation_appeals_case_status_created" ON "public"."moderation_appeals" USING "btree" ("case_id", "status", "created_at" DESC);



CREATE INDEX "idx_moderation_appeals_provider_status_created" ON "public"."moderation_appeals" USING "btree" ("provider_id", "status", "created_at" DESC);



CREATE INDEX "idx_moderation_appeals_provider_updated" ON "public"."moderation_appeals" USING "btree" ("provider_id", "updated_at" DESC);



CREATE INDEX "idx_moderation_appeals_status_submitted" ON "public"."moderation_appeals" USING "btree" ("status", "submitted_at" DESC, "updated_at" DESC);



CREATE INDEX "idx_moderation_appeals_status_updated" ON "public"."moderation_appeals" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "idx_moderation_case_events_actor_created" ON "public"."moderation_case_events" USING "btree" ("actor_user_id", "created_at" DESC) WHERE ("actor_user_id" IS NOT NULL);



CREATE INDEX "idx_moderation_case_events_case_created" ON "public"."moderation_case_events" USING "btree" ("case_id", "created_at");



CREATE INDEX "idx_moderation_case_events_type_status_created" ON "public"."moderation_case_events" USING "btree" ("event_type", "to_status", "created_at" DESC);



CREATE UNIQUE INDEX "idx_moderation_cases_source_report" ON "public"."moderation_cases" USING "btree" ("source_report_id") WHERE ("source_report_id" IS NOT NULL);



CREATE INDEX "idx_moderation_cases_status_created" ON "public"."moderation_cases" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_moderation_cases_status_updated" ON "public"."moderation_cases" USING "btree" ("status", "updated_at" DESC, "created_at" DESC);



CREATE INDEX "idx_moderation_cases_subject_created" ON "public"."moderation_cases" USING "btree" ("subject_type", "subject_id", "created_at" DESC);



CREATE INDEX "idx_moderation_cases_subject_status" ON "public"."moderation_cases" USING "btree" ("subject_type", "subject_id", "status", "created_at" DESC);



CREATE INDEX "idx_ngo_requests_pending_listing" ON "public"."ngo_requests" USING "btree" ("listing_id", "status", "id") WHERE (("status")::"text" = 'pending'::"text");



CREATE INDEX "idx_ngos_location" ON "public"."ngos" USING "gist" ("location");



CREATE INDEX "idx_ngos_user_verified_lookup" ON "public"."ngos" USING "btree" ("user_id", "is_verified" DESC, "id" DESC);



CREATE INDEX "idx_ngos_verification" ON "public"."ngos" USING "btree" ("is_verified", "created_at" DESC);



CREATE INDEX "idx_notifications_archive_status_created" ON "public"."notifications" USING "btree" ("archive_status", "created_at" DESC, "id" DESC);



CREATE UNIQUE INDEX "idx_notifications_idempotency_key" ON "public"."notifications" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "idx_notifications_type_created" ON "public"."notifications" USING "btree" ("type", "created_at" DESC);



CREATE INDEX "idx_notifications_user_active_archive" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC, "id" DESC) WHERE ("archive_status" <> 'archived'::"text");



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC, "id" DESC);



CREATE INDEX "idx_notifications_user_read" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE UNIQUE INDEX "idx_operational_alerts_open_key" ON "public"."operational_alerts" USING "btree" ("alert_key") WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_operational_events_category" ON "public"."operational_events" USING "btree" ("category", "severity", "created_at" DESC);



CREATE INDEX "idx_operational_events_correlation" ON "public"."operational_events" USING "btree" ("correlation_id", "created_at" DESC) WHERE ("correlation_id" IS NOT NULL);



CREATE INDEX "idx_operational_events_created" ON "public"."operational_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_payment_order_attempts_payer" ON "public"."payment_order_attempts" USING "btree" ("payer_user_id", "created_at" DESC) WHERE ("payer_user_id" IS NOT NULL);



CREATE INDEX "idx_payment_order_attempts_status_updated" ON "public"."payment_order_attempts" USING "btree" ("status", "updated_at");



CREATE INDEX "idx_payment_ownership_payer" ON "public"."payment_ownership" USING "btree" ("payer_user_id", "payer_role", "created_at" DESC);



CREATE INDEX "idx_payment_ownership_payment_session" ON "public"."payment_ownership" USING "btree" ("payment_session_id", "created_at" DESC);



CREATE INDEX "idx_payment_ownership_provider" ON "public"."payment_ownership" USING "btree" ("provider_id", "created_at" DESC) WHERE ("provider_id" IS NOT NULL);



CREATE INDEX "idx_payment_ownership_refund_target" ON "public"."payment_ownership" USING "btree" ("refund_target_user_id", "refund_target_role", "created_at" DESC) WHERE ("refund_target_user_id" IS NOT NULL);



CREATE INDEX "idx_payment_ownership_reservation" ON "public"."payment_ownership" USING "btree" ("reservation_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_payment_ownership_reservation_session_version" ON "public"."payment_ownership" USING "btree" ("reservation_id", "payment_session_id", "ownership_version");



CREATE UNIQUE INDEX "idx_payments_deposit_refund_id_unique" ON "public"."payments" USING "btree" ("reliability_deposit_refund_id") WHERE ("reliability_deposit_refund_id" IS NOT NULL);



CREATE INDEX "idx_payments_legacy_commission_snapshot" ON "public"."payments" USING "btree" ("status", "created_at" DESC, "id") WHERE (("status" = 'paid'::"text") AND ("commission_percent" IS NULL));



CREATE INDEX "idx_payments_order" ON "public"."payments" USING "btree" ("order_id");



CREATE INDEX "idx_payments_order_reservation_lock" ON "public"."payments" USING "btree" ("order_id", "reservation_id", "id");



CREATE INDEX "idx_payments_order_status" ON "public"."payments" USING "btree" ("order_id", "status");



CREATE INDEX "idx_payments_paid_financial_reconciliation" ON "public"."payments" USING "btree" ("status", "updated_at" DESC, "id") WHERE ("status" = 'paid'::"text");



CREATE INDEX "idx_payments_reconciliation" ON "public"."payments" USING "btree" ("status", "reconciliation_status", "last_reconciled_at");



CREATE UNIQUE INDEX "idx_payments_refund_id_unique" ON "public"."payments" USING "btree" ("refund_id") WHERE ("refund_id" IS NOT NULL);



CREATE INDEX "idx_payments_refund_pending" ON "public"."payments" USING "btree" ("reservation_id", "status", "refund_status", "updated_at" DESC) WHERE ("status" = ANY (ARRAY['refund_pending'::"text", 'refund_failed'::"text", 'paid'::"text", 'success'::"text"]));



CREATE INDEX "idx_payments_reservation" ON "public"."payments" USING "btree" ("reservation_id");



CREATE INDEX "idx_payments_reservation_status_updated" ON "public"."payments" USING "btree" ("reservation_id", "status", "updated_at" DESC);



CREATE UNIQUE INDEX "idx_payments_transaction_id_unique" ON "public"."payments" USING "btree" ("transaction_id") WHERE ("transaction_id" IS NOT NULL);



CREATE INDEX "idx_provider_case_response_attachments_response" ON "public"."provider_case_response_attachments" USING "btree" ("response_id", "created_at");



CREATE UNIQUE INDEX "idx_provider_case_responses_case_provider" ON "public"."provider_case_responses" USING "btree" ("case_id", "provider_id");



CREATE INDEX "idx_provider_case_responses_provider_updated" ON "public"."provider_case_responses" USING "btree" ("provider_id", "updated_at" DESC);



CREATE INDEX "idx_provider_report_attachments_archive" ON "public"."provider_report_attachments" USING "btree" ("archive_status", "created_at" DESC, "id" DESC);



CREATE INDEX "idx_provider_report_attachments_report" ON "public"."provider_report_attachments" USING "btree" ("report_id", "created_at");



CREATE INDEX "idx_provider_report_attachments_uploader_created" ON "public"."provider_report_attachments" USING "btree" ("uploader_user_id", "created_at" DESC);



CREATE INDEX "idx_provider_reports_provider_status" ON "public"."provider_reports" USING "btree" ("provider_id", "status", "created_at" DESC);



CREATE INDEX "idx_provider_reports_reporter_provider_created" ON "public"."provider_reports" USING "btree" ("reported_by", "provider_id", "created_at" DESC);



CREATE INDEX "idx_provider_reports_reporter_status_created" ON "public"."provider_reports" USING "btree" ("reported_by", "status", "created_at" DESC);



CREATE UNIQUE INDEX "idx_provider_reports_unique_pending" ON "public"."provider_reports" USING "btree" ("provider_id", "reported_by", "reservation_id") WHERE (("status" = 'pending'::"text") AND ("reservation_id" IS NOT NULL));



CREATE INDEX "idx_provider_settlements_batch" ON "public"."provider_settlements" USING "btree" ("settlement_batch_id", "status") WHERE ("settlement_batch_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_provider_settlements_idempotency_key" ON "public"."provider_settlements" USING "btree" ("idempotency_key");



CREATE INDEX "idx_provider_settlements_provider_status" ON "public"."provider_settlements" USING "btree" ("provider_id", "status", "created_at" DESC);



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



CREATE INDEX "idx_reservations_user_abandoned_hold_patterns" ON "public"."reservations" USING "btree" ("user_id", "reserved_at" DESC, "status", "payment_status") WHERE (("status" = ANY (ARRAY['abandoned_payment'::"text", 'cancelled_before_confirmation'::"text", 'expired_payment'::"text", 'payment_failed'::"text"])) OR ("payment_status" = ANY (ARRAY['abandoned'::"text", 'cancelled'::"text", 'expired'::"text", 'failed'::"text"])));



CREATE INDEX "idx_reservations_user_active_unpaid_holds" ON "public"."reservations" USING "btree" ("user_id", "status", "payment_status", "payment_expires_at", "reserved_at" DESC);



CREATE INDEX "idx_reservations_user_lifecycle" ON "public"."reservations" USING "btree" ("user_id", "pickup_type", "task_status", "reserved_at" DESC);



CREATE INDEX "idx_reservations_user_status" ON "public"."reservations" USING "btree" ("user_id", "status", "reserved_at" DESC);



CREATE INDEX "idx_reservations_volunteer_tasks" ON "public"."reservations" USING "btree" ("assigned_volunteer_id", "task_status", "assigned_at" DESC) WHERE ("assigned_volunteer_id" IS NOT NULL);



CREATE INDEX "idx_restaurants_user_verified_lookup" ON "public"."restaurants" USING "btree" ("user_id", "is_verified" DESC, "id" DESC);



CREATE INDEX "idx_restaurants_verification" ON "public"."restaurants" USING "btree" ("is_verified", "created_at" DESC);



CREATE UNIQUE INDEX "idx_settlement_allocation_idempotency_key" ON "public"."settlement_allocation_snapshots" USING "btree" ("idempotency_key");



CREATE INDEX "idx_settlement_allocation_provider" ON "public"."settlement_allocation_snapshots" USING "btree" ("payment_ownership_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_settlement_allocation_reservation_session_version" ON "public"."settlement_allocation_snapshots" USING "btree" ("reservation_id", "payment_session_id", "settlement_version");



CREATE INDEX "idx_trust_event_effects_subject" ON "public"."trust_event_effects" USING "btree" ("subject_type", "subject_id", "created_at" DESC);



CREATE INDEX "idx_trust_events_payment" ON "public"."trust_events" USING "btree" ("payment_id", "created_at" DESC) WHERE ("payment_id" IS NOT NULL);



CREATE INDEX "idx_trust_events_processing" ON "public"."trust_events" USING "btree" ("processing_status", "created_at", "id") WHERE ("processing_status" = ANY (ARRAY['pending'::"text", 'retry'::"text"]));



CREATE INDEX "idx_trust_events_provider_pairings" ON "public"."trust_events" USING "btree" ("subject_type", "subject_id", ((("event_payload" -> 'metadata'::"text") ->> 'provider_id'::"text")), "created_at" DESC) WHERE ((("event_payload" -> 'metadata'::"text") ->> 'provider_id'::"text") IS NOT NULL);



CREATE INDEX "idx_trust_events_reservation" ON "public"."trust_events" USING "btree" ("reservation_id", "created_at" DESC) WHERE ("reservation_id" IS NOT NULL);



CREATE INDEX "idx_trust_events_source" ON "public"."trust_events" USING "btree" ("source_type", "source_id", "event_type");



CREATE INDEX "idx_trust_events_subject_daily_gain" ON "public"."trust_events" USING "btree" ("subject_type", "subject_id", "created_at" DESC, "event_type");



CREATE INDEX "idx_trust_events_subject_history" ON "public"."trust_events" USING "btree" ("subject_type", "subject_id", "created_at" DESC, "id" DESC);



CREATE INDEX "idx_trust_events_type_created" ON "public"."trust_events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_trust_restrictions_subject" ON "public"."trust_restrictions" USING "btree" ("subject_type", "subject_id", "active_until" DESC);



CREATE UNIQUE INDEX "idx_trust_restrictions_subject_type" ON "public"."trust_restrictions" USING "btree" ("restriction_type", "subject_type", "subject_id");



CREATE INDEX "idx_trust_scores_operational_risk" ON "public"."trust_scores" USING "btree" ("risk_category", "projected_restriction_level", "updated_at" DESC);



CREATE INDEX "idx_trust_scores_projected_cooldown" ON "public"."trust_scores" USING "btree" ("projected_cooldown_until") WHERE ("projected_cooldown_until" IS NOT NULL);



CREATE INDEX "idx_users_location" ON "public"."users" USING "gist" ("location");



CREATE INDEX "idx_volunteer_requests_lookup" ON "public"."volunteer_requests" USING "btree" ("ngo_id", "volunteer_id", "request_type", "status");



CREATE INDEX "idx_volunteers_ngo" ON "public"."volunteers" USING "btree" ("ngo_id");



CREATE INDEX "idx_volunteers_status" ON "public"."volunteers" USING "btree" ("status");



CREATE INDEX "idx_volunteers_user" ON "public"."volunteers" USING "btree" ("user_id");



CREATE INDEX "listing_images_listing_id_order_idx" ON "public"."listing_images" USING "btree" ("listing_id", "display_order");



CREATE UNIQUE INDEX "listing_images_listing_order_unique" ON "public"."listing_images" USING "btree" ("listing_id", "display_order");



CREATE UNIQUE INDEX "listing_images_public_id_unique" ON "public"."listing_images" USING "btree" ("public_id");



CREATE UNIQUE INDEX "unique_active_reservation" ON "public"."reservations" USING "btree" ("user_id", "listing_id") WHERE ((("status" = ANY (ARRAY['reserved'::"text", 'pending'::"text", 'volunteer_started'::"text", 'picked_from_provider'::"text", 'delivered'::"text", 'picked_up'::"text", 'completed'::"text"])) OR ("task_status" = ANY (ARRAY['self_pickup'::"text", 'pending'::"text", 'assigned'::"text", 'in_progress'::"text", 'volunteer_started'::"text", 'picked_from_provider'::"text", 'delivered'::"text"]))) AND (NOT (("status" = 'payment_pending'::"text") AND ("payment_status" = 'pending'::"text"))) AND (COALESCE("status", ''::"text") <> ALL (ARRAY['cancelled'::"text", 'expired'::"text", 'failed'::"text", 'payment_failed'::"text", 'abandoned_payment'::"text", 'expired_payment'::"text", 'cancelled_before_confirmation'::"text"])) AND (COALESCE("payment_status", ''::"text") <> ALL (ARRAY['failed'::"text", 'expired'::"text", 'abandoned'::"text", 'cancelled'::"text"])));



CREATE UNIQUE INDEX "unique_pending_payment_reservation" ON "public"."reservations" USING "btree" ("user_id", "listing_id") WHERE (("status" = 'payment_pending'::"text") AND ("payment_status" = 'pending'::"text"));



CREATE UNIQUE INDEX "unique_volunteer_active_task" ON "public"."reservations" USING "btree" ("assigned_volunteer_id") WHERE (("assigned_volunteer_id" IS NOT NULL) AND ("task_status" = ANY (ARRAY[('in_progress'::character varying)::"text", ('picked_from_provider'::character varying)::"text"])));



CREATE UNIQUE INDEX "users_email_unique_idx" ON "public"."users" USING "btree" ("lower"(TRIM(BOTH FROM "email"))) WHERE (("email" IS NOT NULL) AND (TRIM(BOTH FROM "email") <> ''::"text"));



CREATE UNIQUE INDEX "users_google_id_unique_idx" ON "public"."users" USING "btree" ("google_id") WHERE (("google_id" IS NOT NULL) AND (TRIM(BOTH FROM "google_id") <> ''::"text"));



CREATE UNIQUE INDEX "users_phone_unique_idx" ON "public"."users" USING "btree" (TRIM(BOTH FROM "phone")) WHERE (("phone" IS NOT NULL) AND (TRIM(BOTH FROM "phone") <> ''::"text"));



CREATE UNIQUE INDEX "users_profile_image_public_id_unique" ON "public"."users" USING "btree" ("profile_image_public_id") WHERE ("profile_image_public_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_admin_trust_actions_immutable" BEFORE DELETE OR UPDATE ON "public"."admin_trust_actions" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_admin_trust_action_mutation"();



CREATE OR REPLACE TRIGGER "trg_cashfree_webhook_audit_immutable" BEFORE DELETE OR UPDATE ON "public"."cashfree_webhook_audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"();



CREATE OR REPLACE TRIGGER "trg_compliance_events_immutable" BEFORE DELETE OR UPDATE ON "public"."compliance_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_compliance_event_mutation"();



CREATE OR REPLACE TRIGGER "trg_financial_ledger_entries_immutable" BEFORE DELETE OR UPDATE ON "public"."financial_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_ledger_mutation"();



CREATE OR REPLACE TRIGGER "trg_financial_refund_terminal_immutable" BEFORE DELETE OR UPDATE ON "public"."financial_refund_terminal_records" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_ledger_mutation"();



CREATE OR REPLACE TRIGGER "trg_financial_state_transitions_immutable" BEFORE DELETE OR UPDATE ON "public"."financial_state_transitions" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_state_transition_mutation"();



CREATE OR REPLACE TRIGGER "trg_incident_events_immutable" BEFORE DELETE OR UPDATE ON "public"."incident_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_incident_management_mutation"();



CREATE OR REPLACE TRIGGER "trg_incident_notes_immutable" BEFORE DELETE OR UPDATE ON "public"."incident_notes" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_incident_management_mutation"();



CREATE OR REPLACE TRIGGER "trg_incident_postmortems_immutable" BEFORE DELETE OR UPDATE ON "public"."incident_postmortems" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_incident_management_mutation"();



CREATE OR REPLACE TRIGGER "trg_incident_records_immutable" BEFORE DELETE OR UPDATE ON "public"."incident_records" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_incident_management_mutation"();



CREATE OR REPLACE TRIGGER "trg_payment_ownership_immutable" BEFORE DELETE OR UPDATE ON "public"."payment_ownership" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_payment_ownership_mutation"();



CREATE OR REPLACE TRIGGER "trg_payments_financial_state_guard" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."guard_payment_financial_state_transition"();



CREATE OR REPLACE TRIGGER "trg_payments_financial_state_transition_log" AFTER UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."log_payment_financial_state_transition"();



CREATE OR REPLACE TRIGGER "trg_settlement_allocation_immutable" BEFORE DELETE OR UPDATE ON "public"."settlement_allocation_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_financial_ledger_mutation"();



ALTER TABLE ONLY "public"."admin_trust_actions"
    ADD CONSTRAINT "admin_trust_actions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_events"
    ADD CONSTRAINT "compliance_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_events"
    ADD CONSTRAINT "compliance_events_deletion_request_id_fkey" FOREIGN KEY ("deletion_request_id") REFERENCES "public"."data_deletion_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_events"
    ADD CONSTRAINT "compliance_events_policy_key_fkey" FOREIGN KEY ("policy_key") REFERENCES "public"."retention_policies"("policy_key");



ALTER TABLE ONLY "public"."data_archive_records"
    ADD CONSTRAINT "data_archive_records_archived_by_admin_id_fkey" FOREIGN KEY ("archived_by_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."data_archive_records"
    ADD CONSTRAINT "data_archive_records_policy_key_fkey" FOREIGN KEY ("policy_key") REFERENCES "public"."retention_policies"("policy_key");



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_approved_by_admin_id_fkey" FOREIGN KEY ("approved_by_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_executed_by_admin_id_fkey" FOREIGN KEY ("executed_by_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_policy_key_fkey" FOREIGN KEY ("policy_key") REFERENCES "public"."retention_policies"("policy_key");



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_counterparty_user_id_fkey" FOREIGN KEY ("counterparty_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_payment_ownership_id_fkey" FOREIGN KEY ("payment_ownership_id") REFERENCES "public"."payment_ownership"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_provider_settlement_id_fkey" FOREIGN KEY ("provider_settlement_id") REFERENCES "public"."provider_settlements"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_settlement_allocation_id_fkey" FOREIGN KEY ("settlement_allocation_id") REFERENCES "public"."settlement_allocation_snapshots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_ledger_entries"
    ADD CONSTRAINT "financial_ledger_entries_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "public"."settlement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_payment_ownership_id_fkey" FOREIGN KEY ("payment_ownership_id") REFERENCES "public"."payment_ownership"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_operations"
    ADD CONSTRAINT "financial_operations_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_refund_terminal_records"
    ADD CONSTRAINT "financial_refund_terminal_records_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_refund_terminal_records"
    ADD CONSTRAINT "financial_refund_terminal_records_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_state_transitions"
    ADD CONSTRAINT "financial_state_transitions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."financial_state_transitions"
    ADD CONSTRAINT "financial_state_transitions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;



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



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_from_assigned_admin_id_fkey" FOREIGN KEY ("from_assigned_admin_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."incident_records"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."incident_notes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_postmortem_id_fkey" FOREIGN KEY ("postmortem_id") REFERENCES "public"."incident_postmortems"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_to_assigned_admin_id_fkey" FOREIGN KEY ("to_assigned_admin_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."incident_notes"
    ADD CONSTRAINT "incident_notes_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."incident_notes"
    ADD CONSTRAINT "incident_notes_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."incident_records"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."incident_postmortems"
    ADD CONSTRAINT "incident_postmortems_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."incident_postmortems"
    ADD CONSTRAINT "incident_postmortems_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."incident_records"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."incident_records"
    ADD CONSTRAINT "incident_records_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."listing_images"
    ADD CONSTRAINT "listing_images_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."food_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_appeal_attachments"
    ADD CONSTRAINT "moderation_appeal_attachments_appeal_id_fkey" FOREIGN KEY ("appeal_id") REFERENCES "public"."moderation_appeals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_appeal_attachments"
    ADD CONSTRAINT "moderation_appeal_attachments_archived_by_admin_id_fkey" FOREIGN KEY ("archived_by_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_appeal_attachments"
    ADD CONSTRAINT "moderation_appeal_attachments_retention_policy_key_fkey" FOREIGN KEY ("retention_policy_key") REFERENCES "public"."retention_policies"("policy_key");



ALTER TABLE ONLY "public"."moderation_appeal_attachments"
    ADD CONSTRAINT "moderation_appeal_attachments_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_appeal_events"
    ADD CONSTRAINT "moderation_appeal_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_appeal_events"
    ADD CONSTRAINT "moderation_appeal_events_appeal_id_fkey" FOREIGN KEY ("appeal_id") REFERENCES "public"."moderation_appeals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_appeal_events"
    ADD CONSTRAINT "moderation_appeal_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_reviewed_by_admin_fkey" FOREIGN KEY ("reviewed_by_admin") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_appeals"
    ADD CONSTRAINT "moderation_appeals_withdrawn_by_user_id_fkey" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_case_events"
    ADD CONSTRAINT "moderation_case_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_case_events"
    ADD CONSTRAINT "moderation_case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_source_report_id_fkey" FOREIGN KEY ("source_report_id") REFERENCES "public"."provider_reports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."moderation_cases"
    ADD CONSTRAINT "moderation_cases_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ngo_requests"
    ADD CONSTRAINT "ngo_requests_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."food_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ngo_requests"
    ADD CONSTRAINT "ngo_requests_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "public"."ngos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ngos"
    ADD CONSTRAINT "ngos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_archived_by_admin_id_fkey" FOREIGN KEY ("archived_by_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_retention_policy_key_fkey" FOREIGN KEY ("retention_policy_key") REFERENCES "public"."retention_policies"("policy_key");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_ngo_id_fkey" FOREIGN KEY ("ngo_id") REFERENCES "public"."ngos"("id");



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id");



ALTER TABLE ONLY "public"."penalties"
    ADD CONSTRAINT "penalties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."provider_case_response_attachments"
    ADD CONSTRAINT "provider_case_response_attachments_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."provider_case_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_case_responses"
    ADD CONSTRAINT "provider_case_responses_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_case_responses"
    ADD CONSTRAINT "provider_case_responses_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_report_attachments"
    ADD CONSTRAINT "provider_report_attachments_archived_by_admin_id_fkey" FOREIGN KEY ("archived_by_admin_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."provider_report_attachments"
    ADD CONSTRAINT "provider_report_attachments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."provider_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_report_attachments"
    ADD CONSTRAINT "provider_report_attachments_retention_policy_key_fkey" FOREIGN KEY ("retention_policy_key") REFERENCES "public"."retention_policies"("policy_key");



ALTER TABLE ONLY "public"."provider_report_attachments"
    ADD CONSTRAINT "provider_report_attachments_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_moderation_case_id_fkey" FOREIGN KEY ("moderation_case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."provider_reports"
    ADD CONSTRAINT "provider_reports_reviewed_by_admin_fkey" FOREIGN KEY ("reviewed_by_admin") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."provider_settlements"
    ADD CONSTRAINT "provider_settlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."provider_settlements"
    ADD CONSTRAINT "provider_settlements_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."provider_settlements"
    ADD CONSTRAINT "provider_settlements_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."provider_settlements"
    ADD CONSTRAINT "provider_settlements_settlement_allocation_id_fkey" FOREIGN KEY ("settlement_allocation_id") REFERENCES "public"."settlement_allocation_snapshots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."provider_settlements"
    ADD CONSTRAINT "provider_settlements_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "public"."settlement_batches"("id") ON DELETE RESTRICT;



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



ALTER TABLE ONLY "public"."settlement_allocation_snapshots"
    ADD CONSTRAINT "settlement_allocation_snapshots_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."settlement_allocation_snapshots"
    ADD CONSTRAINT "settlement_allocation_snapshots_payment_ownership_id_fkey" FOREIGN KEY ("payment_ownership_id") REFERENCES "public"."payment_ownership"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."settlement_allocation_snapshots"
    ADD CONSTRAINT "settlement_allocation_snapshots_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."trust_event_effects"
    ADD CONSTRAINT "trust_event_effects_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."trust_events"("id") ON DELETE CASCADE;



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



GRANT ALL ON FUNCTION "public"."guard_payment_financial_state_transition"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_payment_financial_state_transition"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_payment_financial_state_transition"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_payment_financial_state_transition"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_payment_financial_state_transition"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_payment_financial_state_transition"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_admin_trust_action_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_admin_trust_action_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_admin_trust_action_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_cashfree_webhook_audit_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_compliance_event_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_compliance_event_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_compliance_event_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_financial_ledger_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_financial_ledger_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_financial_ledger_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_financial_state_transition_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_financial_state_transition_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_financial_state_transition_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_incident_management_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_incident_management_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_incident_management_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_payment_ownership_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_payment_ownership_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_payment_ownership_mutation"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_trust_actions" TO "anon";
GRANT ALL ON TABLE "public"."admin_trust_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_trust_actions" TO "service_role";



GRANT ALL ON TABLE "public"."cashfree_webhook_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."cashfree_webhook_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."cashfree_webhook_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."cashfree_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."cashfree_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."cashfree_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."compliance_events" TO "anon";
GRANT ALL ON TABLE "public"."compliance_events" TO "authenticated";
GRANT ALL ON TABLE "public"."compliance_events" TO "service_role";



GRANT ALL ON TABLE "public"."data_archive_records" TO "anon";
GRANT ALL ON TABLE "public"."data_archive_records" TO "authenticated";
GRANT ALL ON TABLE "public"."data_archive_records" TO "service_role";



GRANT ALL ON TABLE "public"."data_deletion_requests" TO "anon";
GRANT ALL ON TABLE "public"."data_deletion_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."data_deletion_requests" TO "service_role";



GRANT ALL ON TABLE "public"."financial_ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."financial_ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_ledger_entries" TO "service_role";



GRANT ALL ON TABLE "public"."financial_operations" TO "anon";
GRANT ALL ON TABLE "public"."financial_operations" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_operations" TO "service_role";



GRANT ALL ON TABLE "public"."financial_refund_terminal_records" TO "anon";
GRANT ALL ON TABLE "public"."financial_refund_terminal_records" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_refund_terminal_records" TO "service_role";



GRANT ALL ON TABLE "public"."financial_state_transitions" TO "anon";
GRANT ALL ON TABLE "public"."financial_state_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_state_transitions" TO "service_role";



GRANT ALL ON TABLE "public"."food_listings" TO "anon";
GRANT ALL ON TABLE "public"."food_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."food_listings" TO "service_role";



GRANT ALL ON TABLE "public"."incident_events" TO "anon";
GRANT ALL ON TABLE "public"."incident_events" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_events" TO "service_role";



GRANT ALL ON TABLE "public"."incident_notes" TO "anon";
GRANT ALL ON TABLE "public"."incident_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_notes" TO "service_role";



GRANT ALL ON TABLE "public"."incident_postmortems" TO "anon";
GRANT ALL ON TABLE "public"."incident_postmortems" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_postmortems" TO "service_role";



GRANT ALL ON TABLE "public"."incident_records" TO "anon";
GRANT ALL ON TABLE "public"."incident_records" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_records" TO "service_role";



GRANT ALL ON TABLE "public"."listing_images" TO "anon";
GRANT ALL ON TABLE "public"."listing_images" TO "authenticated";
GRANT ALL ON TABLE "public"."listing_images" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_appeal_attachments" TO "anon";
GRANT ALL ON TABLE "public"."moderation_appeal_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_appeal_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_appeal_events" TO "anon";
GRANT ALL ON TABLE "public"."moderation_appeal_events" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_appeal_events" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_appeals" TO "anon";
GRANT ALL ON TABLE "public"."moderation_appeals" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_appeals" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_case_events" TO "anon";
GRANT ALL ON TABLE "public"."moderation_case_events" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_case_events" TO "service_role";



GRANT ALL ON TABLE "public"."moderation_cases" TO "anon";
GRANT ALL ON TABLE "public"."moderation_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."moderation_cases" TO "service_role";



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



GRANT ALL ON TABLE "public"."payment_ownership" TO "anon";
GRANT ALL ON TABLE "public"."payment_ownership" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_ownership" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."penalties" TO "anon";
GRANT ALL ON TABLE "public"."penalties" TO "authenticated";
GRANT ALL ON TABLE "public"."penalties" TO "service_role";



GRANT ALL ON TABLE "public"."provider_case_response_attachments" TO "anon";
GRANT ALL ON TABLE "public"."provider_case_response_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_case_response_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."provider_case_responses" TO "anon";
GRANT ALL ON TABLE "public"."provider_case_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_case_responses" TO "service_role";



GRANT ALL ON TABLE "public"."provider_report_attachments" TO "anon";
GRANT ALL ON TABLE "public"."provider_report_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_report_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."provider_reports" TO "anon";
GRANT ALL ON TABLE "public"."provider_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_reports" TO "service_role";



GRANT ALL ON TABLE "public"."provider_settlements" TO "anon";
GRANT ALL ON TABLE "public"."provider_settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_settlements" TO "service_role";



GRANT ALL ON TABLE "public"."ratings" TO "anon";
GRANT ALL ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";



GRANT ALL ON TABLE "public"."reservations" TO "anon";
GRANT ALL ON TABLE "public"."reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."reservations" TO "service_role";



GRANT ALL ON TABLE "public"."restaurants" TO "anon";
GRANT ALL ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON TABLE "public"."retention_policies" TO "anon";
GRANT ALL ON TABLE "public"."retention_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."retention_policies" TO "service_role";



GRANT ALL ON TABLE "public"."settlement_allocation_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."settlement_allocation_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."settlement_allocation_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."settlement_batches" TO "anon";
GRANT ALL ON TABLE "public"."settlement_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."settlement_batches" TO "service_role";



GRANT ALL ON TABLE "public"."trust_event_effects" TO "anon";
GRANT ALL ON TABLE "public"."trust_event_effects" TO "authenticated";
GRANT ALL ON TABLE "public"."trust_event_effects" TO "service_role";



GRANT ALL ON TABLE "public"."trust_events" TO "anon";
GRANT ALL ON TABLE "public"."trust_events" TO "authenticated";
GRANT ALL ON TABLE "public"."trust_events" TO "service_role";



GRANT ALL ON TABLE "public"."trust_restrictions" TO "anon";
GRANT ALL ON TABLE "public"."trust_restrictions" TO "authenticated";
GRANT ALL ON TABLE "public"."trust_restrictions" TO "service_role";



GRANT ALL ON TABLE "public"."trust_scores" TO "anon";
GRANT ALL ON TABLE "public"."trust_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."trust_scores" TO "service_role";



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







