"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Bell,
  CreditCard,
  ExternalLink,
  GitBranch,
  HeartPulse,
  Plus,
  RefreshCw,
  Scale,
  Server,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import { adminService } from "@/services/admin.service";
import type {
  AdminOperationalAlert,
  AdminQueueHealth,
  OperationalMonitoringData,
  OperationalMonitoringDerivedAlert,
  OperationalMonitoringHealthCard,
} from "@shared/contracts/api-contracts";

const WINDOW_OPTIONS = [
  { key: "1h", label: "Last Hour" },
  { key: "24h", label: "24 Hours" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
];

const STATUS_STYLES: Record<string, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-red-200 bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
};

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function statusClass(status: unknown) {
  return (
    STATUS_STYLES[String(status || "").toLowerCase()] ||
    "border-zinc-200 bg-zinc-50 text-zinc-700"
  );
}

function statusLabel(status: unknown) {
  const normalized = String(status || "").toLowerCase();
  return STATUS_LABELS[normalized] || display(status);
}

function incidentCategoryForAlert(category: unknown) {
  const normalized = String(category || "").toLowerCase();
  if (normalized.includes("payment") || normalized.includes("financial")) return "PAYMENTS";
  if (normalized.includes("trust")) return "TRUST";
  if (normalized.includes("notification")) return "NOTIFICATIONS";
  if (normalized.includes("queue") || normalized.includes("worker")) return "INFRASTRUCTURE";
  if (normalized.includes("governance")) return "GOVERNANCE";
  return "OTHER";
}

function incidentSeverityForAlert(severity: unknown) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "critical" || normalized === "error") return "SEV1";
  if (normalized === "warning") return "SEV2";
  return "SEV4";
}

function incidentHrefForAlert(alert: {
  id?: unknown;
  alert_key?: unknown;
  category?: unknown;
  severity?: unknown;
  message?: unknown;
  sourceLabel?: string;
}) {
  const sourceType =
    alert.sourceLabel === "Open Alert" ? "operational_alert" : "operational_monitoring";
  const sourceRefId = display(alert.alert_key || alert.id);
  const params = new URLSearchParams({
    source_type: sourceType,
    source_ref_id: sourceRefId,
    title: display(alert.message),
    severity: incidentSeverityForAlert(alert.severity),
    category: incidentCategoryForAlert(alert.category),
    source_category: display(alert.category),
    source_severity: display(alert.severity),
  });
  return `/admin/incidents?${params.toString()}`;
}

function incidentHrefForPaymentSnapshot(
  payment: OperationalMonitoringData["payments"],
  windowLabel: string
) {
  const params = new URLSearchParams({
    source_type: "financial_diagnostic",
    source_ref_id: `payment-monitoring-${windowLabel.toLowerCase().replace(/\s+/g, "-")}`,
    title: "Payment monitoring issue",
    severity: payment.status === "critical" ? "SEV1" : "SEV2",
    category: "PAYMENTS",
    source_payment_status: String(payment.status),
    source_webhook_failures: String(payment.webhook_failures),
    source_failed_settlements: String(payment.failed_settlements),
    source_payment_errors: String(payment.payment_errors),
  });
  return `/admin/incidents?${params.toString()}`;
}

function StatusBadge({ status }: { status: unknown }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2.5 text-xs font-semibold ${statusClass(
        status
      )}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function HealthCard({ item }: { item: OperationalMonitoringHealthCard }) {
  const iconMap: Record<string, ReactNode> = {
    api: <Server className="h-4 w-4" aria-hidden="true" />,
    database: <GitBranch className="h-4 w-4" aria-hidden="true" />,
    redis: <Activity className="h-4 w-4" aria-hidden="true" />,
    worker: <HeartPulse className="h-4 w-4" aria-hidden="true" />,
    socket: <Wifi className="h-4 w-4" aria-hidden="true" />,
  };

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-zinc-600">{iconMap[item.id] || iconMap.api}</span>
          <p className="truncate text-sm font-semibold text-zinc-950">{item.label}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <p className="mt-3 text-xs text-zinc-500">{item.detail}</p>
      {item.metric && (
        <p className="mt-2 truncate text-xs font-medium text-zinc-700">
          {Object.entries(item.metric)
            .slice(0, 2)
            .map(([key, value]) => `${key.replaceAll("_", " ")}: ${display(value)}`)
            .join(" | ")}
        </p>
      )}
    </article>
  );
}

function SectionHeader({
  icon,
  title,
  status,
  href,
}: {
  icon: ReactNode;
  title: string;
  status?: unknown;
  href?: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-zinc-600">{icon}</span>
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        {status !== undefined && status !== null && <StatusBadge status={status} />}
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open
        </Link>
      )}
    </div>
  );
}

function QueueTable({ queues }: { queues: AdminQueueHealth[] }) {
  if (queues.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No monitored queues reported." />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
          <tr>
            <th className="px-4 py-3">Queue</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Waiting</th>
            <th className="px-4 py-3">Active</th>
            <th className="px-4 py-3">Completed</th>
            <th className="px-4 py-3">Failed</th>
            <th className="px-4 py-3">Worker</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {queues.map((queue) => (
            <tr key={queue.name} className="text-zinc-700">
              <td className="px-4 py-3 font-semibold text-zinc-950">{queue.name}</td>
              <td className="px-4 py-3">{display(queue.category)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={queue.status} />
              </td>
              <td className="px-4 py-3">
                {toCount(queue.counts.waiting) + toCount(queue.counts.delayed)}
              </td>
              <td className="px-4 py-3">{toCount(queue.counts.active)}</td>
              <td className="px-4 py-3">{toCount(queue.counts.completed)}</td>
              <td className="px-4 py-3">{toCount(queue.counts.failed)}</td>
              <td className="px-4 py-3">{display(queue.worker_heartbeat_status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertList({
  persisted,
  derived,
}: {
  persisted: AdminOperationalAlert[];
  derived: OperationalMonitoringDerivedAlert[];
}) {
  const items = [
    ...derived.map((item) => ({ ...item, id: item.alert_key, sourceLabel: "Derived" })),
    ...persisted.map((item) => ({
      ...item,
      id: item.id,
      sourceLabel: "Open Alert",
      drilldown_href: "/admin/audit-center",
    })),
  ];

  if (items.length === 0) {
    return (
      <div className="p-4">
        <AdminStateBlock title="No operational alerts in this view." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {items.slice(0, 12).map((alert) => (
        <li key={String(alert.id)} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-950">{alert.message}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {alert.category} | {alert.sourceLabel}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={alert.severity === "error" ? "critical" : alert.severity} />
              {alert.drilldown_href && (
                <Link
                  href={String(alert.drilldown_href)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100"
                  title="Open drilldown"
                  aria-label="Open drilldown"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
              <Link
                href={incidentHrefForAlert(alert)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100"
                title="Create incident"
                aria-label="Create incident from alert"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function OperationalMonitoringPage() {
  const [windowKey, setWindowKey] = useState("24h");
  const [monitoring, setMonitoring] = useState<OperationalMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadMonitoring = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await adminService.getOperationalMonitoring({ window: windowKey });
      setMonitoring(data);
    } catch (err) {
      setError(adminService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [windowKey]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadMonitoring();
    });
    return () => {
      active = false;
    };
  }, [loadMonitoring]);

  const queueTotals = monitoring?.queues.totals || {};
  const generatedAt = monitoring?.generated_at
    ? formatGovernanceDate(monitoring.generated_at)
    : null;

  return (
    <AdminShell
      title="Operational Monitoring"
      description="Read-only health, queues, payments, notifications, sockets, trust processing, governance, and alerts."
    >
      {error && <AdminStateBlock title={error} tone="error" />}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setWindowKey(option.key)}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                  windowKey === option.key
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {monitoring && <StatusBadge status={monitoring.status} />}
            {generatedAt && (
              <span className="text-xs font-medium text-zinc-500">
                Updated {generatedAt}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadMonitoring()}
              disabled={loading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
              title="Refresh"
              aria-label="Refresh monitoring snapshot"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {loading && !monitoring ? (
        <AdminStateBlock title="Loading operational monitoring..." />
      ) : monitoring ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {monitoring.health.map((item) => (
              <HealthCard key={item.id} item={item} />
            ))}
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminMetricCard
              label="Queue Backlog"
              value={toCount(queueTotals.waiting)}
              detail="Waiting and delayed jobs"
            />
            <AdminMetricCard
              label="Failed Jobs"
              value={toCount(queueTotals.failed)}
              detail="All monitored queues"
            />
            <AdminMetricCard
              label="Webhook Failures"
              value={monitoring.payments.webhook_failures}
              detail={monitoring.window.label}
            />
            <AdminMetricCard
              label="Trust Failures"
              value={monitoring.trust.projection_failures}
              detail="Failed trust events"
            />
          </section>

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <SectionHeader
              icon={<Activity className="h-4 w-4" aria-hidden="true" />}
              title="Queue Monitoring"
              status={monitoring.queues.status}
              href="/admin/queues"
            />
            <QueueTable queues={monitoring.queues.queues} />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <SectionHeader
                icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
                title="Payment Monitoring"
                status={monitoring.payments.status}
                href="/admin/audit-center?domains=financial"
              />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <AdminMetricCard
                  label="Pending Settlements"
                  value={monitoring.payments.pending_settlements}
                  detail="Allocated or batched"
                />
                <AdminMetricCard
                  label="Failed Settlements"
                  value={monitoring.payments.failed_settlements}
                  detail="Cancelled settlement rows"
                />
                <AdminMetricCard
                  label="Reconciliation Runs"
                  value={monitoring.payments.recent_reconciliation_runs}
                  detail={monitoring.window.label}
                />
                <AdminMetricCard
                  label="Payment Errors"
                  value={monitoring.payments.payment_errors}
                  detail="Failed, expired, or abandoned"
                />
                {monitoring.payments.status !== "healthy" && (
                  <Link
                    href={incidentHrefForPaymentSnapshot(
                      monitoring.payments,
                      monitoring.window.label
                    )}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 sm:col-span-2"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Incident
                  </Link>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <SectionHeader
                icon={<Bell className="h-4 w-4" aria-hidden="true" />}
                title="Notification Monitoring"
                status={monitoring.notifications.status}
                href="/admin/audit-center?domains=notifications"
              />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <AdminMetricCard
                  label="Sent"
                  value={monitoring.notifications.notifications_sent}
                  detail={monitoring.window.label}
                />
                <AdminMetricCard
                  label="Failed"
                  value={monitoring.notifications.notifications_failed}
                  detail="Notification queue failures"
                />
                <AdminMetricCard
                  label="Backlog"
                  value={monitoring.notifications.notification_backlog}
                  detail="Waiting and delayed jobs"
                />
                <AdminMetricCard
                  label="Realtime Delivery"
                  value={statusLabel(monitoring.notifications.realtime_delivery_status)}
                  detail="Socket and Redis bridge"
                />
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <SectionHeader
                icon={<Wifi className="h-4 w-4" aria-hidden="true" />}
                title="Socket Monitoring"
                status={monitoring.sockets.status}
              />
              <div className="grid gap-3 p-4">
                <AdminMetricCard
                  label="Connected Clients"
                  value={monitoring.sockets.connected_clients}
                  detail="Live Socket.IO count"
                />
                <AdminMetricCard
                  label="Recent Disconnects"
                  value={display(monitoring.sockets.recent_disconnects)}
                  detail="Not persisted"
                />
                <AdminMetricCard
                  label="Socket Errors"
                  value={display(monitoring.sockets.socket_errors)}
                  detail="Not persisted"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <SectionHeader
                icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
                title="Trust Processing"
                status={monitoring.trust.status}
                href="/admin/trust"
              />
              <div className="grid gap-3 p-4">
                <AdminMetricCard
                  label="Events Waiting"
                  value={monitoring.trust.trust_events_waiting}
                  detail="Pending and retry"
                />
                <AdminMetricCard
                  label="Events Processed"
                  value={monitoring.trust.trust_events_processed}
                  detail={monitoring.window.label}
                />
                <AdminMetricCard
                  label="Replay Activity"
                  value={monitoring.trust.recent_replay_activity}
                  detail="Operational replay events"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <SectionHeader
                icon={<Scale className="h-4 w-4" aria-hidden="true" />}
                title="Governance Operations"
                status={monitoring.governance.status}
                href="/admin/governance-dashboard"
              />
              <div className="grid gap-3 p-4">
                <AdminMetricCard
                  label="Open Cases"
                  value={monitoring.governance.open_moderation_cases}
                  detail="Active moderation statuses"
                />
                <AdminMetricCard
                  label="Appeals Pending"
                  value={monitoring.governance.appeals_pending_review}
                  detail="Submitted appeals"
                />
                <AdminMetricCard
                  label="Escalations"
                  value={monitoring.governance.escalations_pending}
                  detail="Escalated cases"
                />
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <SectionHeader
                icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
                title="Alerts"
              />
              <AlertList
                persisted={monitoring.alerts.open}
                derived={monitoring.alerts.derived}
              />
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <SectionHeader
                icon={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
                title="Drilldowns"
              />
              <div className="grid gap-2 p-4">
                {monitoring.drilldowns.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="inline-flex min-h-10 items-center justify-between gap-3 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
                  >
                    {item.label}
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : (
        <AdminStateBlock title="Operational monitoring is unavailable." />
      )}
    </AdminShell>
  );
}
