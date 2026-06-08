"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSearch,
  Flag,
  History,
  Plus,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import { adminService } from "@/services/admin.service";
import type {
  AdminTrustActionType,
  TrustExplainability,
  TrustExplanationSection,
  TrustSubjectType,
} from "@shared/contracts/api-contracts";

const SUBJECT_TYPES: TrustSubjectType[] = ["provider", "user", "ngo", "volunteer"];

const ACTION_OPTIONS: Array<{
  value: AdminTrustActionType;
  label: string;
  detail: string;
}> = [
  {
    value: "TRUST_REVIEW_FLAG",
    label: "Trust Review Flag",
    detail: "Audit-only flag for admin follow-up.",
  },
  {
    value: "VERIFIED_GOOD_BEHAVIOR",
    label: "Verified Good Behavior",
    detail: "Adds a verified recovery event.",
  },
  {
    value: "MANUAL_RECOVERY_CREDIT",
    label: "Manual Recovery Credit",
    detail: "Adds an admin recovery credit event.",
  },
  {
    value: "MANUAL_RESTRICTION",
    label: "Manual Restriction",
    detail: "Applies an explicit restriction floor.",
  },
  {
    value: "MANUAL_COOLDOWN",
    label: "Manual Cooldown",
    detail: "Applies a cooldown through a trust event.",
  },
];

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatMetric(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return displayValue(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function label(value: unknown) {
  return displayValue(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actionTone(type: unknown) {
  const value = String(type || "");
  if (value.includes("RECOVERY") || value.includes("GOOD")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (value.includes("RESTRICTION") || value.includes("COOLDOWN")) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ||
    `admin-trust-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function trustIncidentHref(explanation: TrustExplainability) {
  const params = new URLSearchParams({
    source_type: "trust_diagnostic",
    source_ref_id: String(explanation.subject.subjectId),
    title: `Trust diagnostic for ${explanation.subject.subjectType} ${String(
      explanation.subject.subjectId
    )}`,
    severity: explanation.projectionDiagnostics?.replayConsistent ? "SEV4" : "SEV3",
    category: "TRUST",
    source_subject_type: String(explanation.subject.subjectType),
    source_subject_id: String(explanation.subject.subjectId),
    source_replay_consistent: String(
      Boolean(explanation.projectionDiagnostics?.replayConsistent)
    ),
  });
  return `/admin/incidents?${params.toString()}`;
}

function ExplanationBlock({
  title,
  section,
  icon: Icon,
}: {
  title: string;
  section: TrustExplanationSection;
  icon: typeof ShieldAlert;
}) {
  const sources = Array.isArray(section.sourceEvents) ? section.sourceEvents : [];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-50 text-zinc-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-950">{title}</p>
          <p className="mt-1 text-sm text-zinc-700">{section.reason}</p>
          {section.current !== undefined && (
            <p className="mt-2 text-xs font-medium uppercase text-zinc-500">
              Current: {displayValue(section.current)}
            </p>
          )}
        </div>
      </div>

      {sources.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-zinc-100 pt-3">
          {sources.map((event, index) => (
            <li key={`${event.eventType}-${event.timestamp || index}`} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-zinc-950">{event.title}</p>
                <span className="text-xs text-zinc-500">
                  {formatGovernanceDate(event.timestamp)}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                {event.impact.join(" | ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminTrustPage() {
  const searchParams = useSearchParams();
  const querySubjectType = searchParams.get("subjectType") || searchParams.get("subject_type");
  const querySubjectId = searchParams.get("subjectId") || searchParams.get("subject_id") || "";
  const initialSubjectType = SUBJECT_TYPES.includes(querySubjectType as TrustSubjectType)
    ? (querySubjectType as TrustSubjectType)
    : "provider";
  const [subjectType, setSubjectType] = useState<TrustSubjectType>(initialSubjectType);
  const [subjectId, setSubjectId] = useState(querySubjectId);
  const [explanation, setExplanation] = useState<TrustExplainability | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionType, setActionType] =
    useState<AdminTrustActionType>("TRUST_REVIEW_FLAG");
  const [reason, setReason] = useState("");
  const [restrictionLevel, setRestrictionLevel] = useState("1");
  const [cooldownUntil, setCooldownUntil] = useState("");
  const [cooldownLevel, setCooldownLevel] = useState("3");

  const selectedAction = useMemo(
    () => ACTION_OPTIONS.find((option) => option.value === actionType),
    [actionType]
  );

  const loadSubjectExplanation = useCallback(async (
    nextSubjectType: TrustSubjectType,
    nextSubjectId: string
  ) => {
    const trimmedId = nextSubjectId.trim();
    if (!trimmedId) {
      setError("Subject id is required.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setSuccess("");
      const result = await adminService.getTrustExplainability(
        nextSubjectType,
        trimmedId
      );
      setExplanation(result);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExplanation = useCallback(async () => {
    await loadSubjectExplanation(subjectType, subjectId);
  }, [loadSubjectExplanation, subjectId, subjectType]);

  useEffect(() => {
    const nextSubjectType = SUBJECT_TYPES.includes(querySubjectType as TrustSubjectType)
      ? (querySubjectType as TrustSubjectType)
      : "provider";
    const nextSubjectId = querySubjectId.trim();

    if (!nextSubjectId) return;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSubjectType(nextSubjectType);
      setSubjectId(nextSubjectId);
      void loadSubjectExplanation(nextSubjectType, nextSubjectId);
    });

    return () => {
      active = false;
    };
  }, [loadSubjectExplanation, querySubjectId, querySubjectType]);

  const submitAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!explanation) return;

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("Action reason is required.");
      return;
    }

    const details: Record<string, unknown> = {};
    if (actionType === "MANUAL_RESTRICTION") {
      details.restriction_level = Number(restrictionLevel);
    }
    if (actionType === "MANUAL_COOLDOWN") {
      if (!cooldownUntil) {
        setError("Cooldown timestamp is required.");
        return;
      }
      details.cooldown_until = new Date(cooldownUntil).toISOString();
      details.restriction_level = Number(cooldownLevel);
    }

    try {
      setSubmitting(true);
      setError("");
      setSuccess("");
      const result = await adminService.recordAdminTrustAction(
        explanation.subject.subjectType,
        explanation.subject.subjectId,
        {
          actionType,
          reason: trimmedReason,
          details,
          idempotencyKey: idempotencyKey(),
        }
      );
      setSuccess(
        result.duplicate
          ? "Trust action was already recorded."
          : "Trust action recorded."
      );
      setReason("");
      await loadExplanation();
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const state = explanation?.currentState;
  const diagnostics = explanation?.projectionDiagnostics;
  const auditHref = subjectId.trim()
    ? `/admin/audit-center?domains=trust&actorType=${encodeURIComponent(subjectType)}&actorId=${encodeURIComponent(subjectId.trim())}`
    : "/admin/audit-center?domains=trust";

  return (
    <AdminShell
      title="Trust Explainability"
      description="Review trust state, event history, projection diagnostics, and audited admin actions."
    >
      {error && <AdminStateBlock title={error} tone="error" />}
      {success && <AdminStateBlock title={success} />}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <form
          className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void loadExplanation();
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Actor type</span>
            <select
              value={subjectType}
              onChange={(event) => setSubjectType(event.target.value as TrustSubjectType)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            >
              {SUBJECT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {label(type)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Actor id</span>
            <input
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              placeholder="UUID"
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            <FileSearch className="h-4 w-4" aria-hidden="true" />
            {loading ? "Loading..." : "Load"}
          </button>
        </form>
        <div className="mt-3 flex justify-end">
          <Link
            href={auditHref}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Audit Trail
          </Link>
        </div>
      </section>

      {explanation && state && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <AdminMetricCard
              label="Trust Score"
              value={formatMetric(state.trustScore)}
              detail={label(state.riskCategory)}
            />
            <AdminMetricCard
              label="Penalty"
              value={formatMetric(state.penaltyLevel)}
              detail="Current penalty level"
            />
            <AdminMetricCard
              label="Restriction"
              value={formatMetric(state.restrictionLevel)}
              detail="Projected level"
            />
            <AdminMetricCard
              label="Cooldown"
              value={state.cooldownUntil ? "Active" : "None"}
              detail={formatGovernanceDate(state.cooldownUntil)}
            />
            <AdminMetricCard
              label="Deposit"
              value={`${formatMetric(state.depositMultiplier)}x`}
              detail="Projected multiplier"
            />
            <AdminMetricCard
              label="Recovery"
              value={`${formatMetric(state.recoveryProgress)}%`}
              detail={`${formatMetric(state.successStreak)} success streak`}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ExplanationBlock
              title="Restriction Reason"
              section={explanation.explanations.restriction}
              icon={ShieldAlert}
            />
            <ExplanationBlock
              title="Cooldown Reason"
              section={explanation.explanations.cooldown}
              icon={Clock3}
            />
            <ExplanationBlock
              title="Deposit Multiplier Reason"
              section={explanation.explanations.deposit}
              icon={AlertTriangle}
            />
            <ExplanationBlock
              title="Trust Score Change"
              section={explanation.explanations.scoreChange}
              icon={Sparkles}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Trust Timeline
                </h2>
              </div>
              {explanation.timeline.length === 0 ? (
                <div className="p-4">
                  <AdminStateBlock title="No trust events found." />
                </div>
              ) : (
                <ol className="divide-y divide-zinc-100">
                  {explanation.timeline.map((event) => (
                    <li key={String(event.id || event.eventKey)} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-950">
                            {event.title}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {event.eventType} | {displayValue(event.processingStatus)}
                          </p>
                        </div>
                        <span className="text-xs text-zinc-500">
                          {formatGovernanceDate(event.timestamp)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-zinc-700">
                        {event.impact.join(" | ")}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <form
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              onSubmit={submitAction}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-50 text-zinc-700">
                  <Flag className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">
                    Admin Trust Action
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {selectedAction?.detail}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="font-medium text-zinc-700">Action</span>
                  <select
                    value={actionType}
                    onChange={(event) =>
                      setActionType(event.target.value as AdminTrustActionType)
                    }
                    className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  >
                    {ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {actionType === "MANUAL_RESTRICTION" && (
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">
                      Restriction level
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={restrictionLevel}
                      onChange={(event) => setRestrictionLevel(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    />
                  </label>
                )}

                {actionType === "MANUAL_COOLDOWN" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="font-medium text-zinc-700">Cooldown until</span>
                      <input
                        type="datetime-local"
                        value={cooldownUntil}
                        onChange={(event) => setCooldownUntil(event.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="font-medium text-zinc-700">
                        Restriction level
                      </span>
                      <input
                        type="number"
                        min={3}
                        max={5}
                        value={cooldownLevel}
                        onChange={(event) => setCooldownLevel(event.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                      />
                    </label>
                  </div>
                )}

                <label className="block text-sm">
                  <span className="font-medium text-zinc-700">Reason</span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-1 min-h-28 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {submitting ? "Recording..." : "Record action"}
                </button>
              </div>
            </form>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold text-zinc-950">
                  Projection Diagnostics
                </h2>
                <Link
                  href={trustIncidentHref(explanation)}
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Incident
                </Link>
              </div>
              <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Replay
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {diagnostics?.replayConsistent ? "Consistent" : "Needs Review"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Events
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatMetric(diagnostics?.generatedFromEventCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    First Event
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatGovernanceDate(diagnostics?.firstEventAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Last Event
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {formatGovernanceDate(diagnostics?.lastEventAt)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
                <History className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-950">
                  Admin Audit History
                </h2>
              </div>
              {explanation.auditHistory.length === 0 ? (
                <div className="p-4">
                  <AdminStateBlock title="No admin trust actions recorded." />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {explanation.auditHistory.map((action) => (
                    <li key={String(action.id)} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span
                            className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${actionTone(
                              action.action_type
                            )}`}
                          >
                            {action.action_label || label(action.action_type)}
                          </span>
                          <p className="mt-2 text-sm text-zinc-700">
                            {action.reason}
                          </p>
                        </div>
                        <span className="text-xs text-zinc-500">
                          {formatGovernanceDate(action.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">
                        {displayValue(action.admin_name || action.admin_user_id)} |{" "}
                        {displayValue(action.processing_status)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}
