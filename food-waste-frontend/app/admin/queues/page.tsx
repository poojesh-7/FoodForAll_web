"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { formatGovernanceDate } from "@/lib/governanceFormatting";
import { adminService } from "@/services/admin.service";
import { useAdminStore } from "@/store/adminStore";
import type { AdminQueueJob } from "@shared/contracts/api-contracts";

function queueTotal(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function queueIncidentHref(queueName: string, context: Record<string, unknown> = {}) {
  const params = new URLSearchParams({
    source_type: "queue_diagnostic",
    source_ref_id: String(context.jobId || queueName),
    title: context.jobId
      ? `${queueName} failed job ${String(context.jobId)}`
      : `${queueName} queue degradation`,
    severity: "SEV2",
    category: "INFRASTRUCTURE",
    source_queue: queueName,
  });

  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(`source_${key}`, String(value));
    }
  }

  return `/admin/incidents?${params.toString()}`;
}

function delayedBadgeClass(classification?: string) {
  if (classification === "valid") return "bg-emerald-50 text-emerald-700";
  if (classification === "retry_pending") return "bg-blue-50 text-blue-700";
  if (classification === "cleanup_candidate") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function formatDelayedLabel(value?: string) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ");
}

export default function AdminQueuesPage() {
  const queues = useAdminStore((state) => state.queues);
  const loading = useAdminStore((state) => state.loading);
  const error = useAdminStore((state) => state.error);
  const loadQueues = useAdminStore((state) => state.loadQueues);
  const [retryingJob, setRetryingJob] = useState<string | null>(null);

  useEffect(() => {
    void loadQueues();
  }, [loadQueues]);

  async function retryJob(queueName: string, jobId: string | number | undefined) {
    if (jobId === undefined) return;
    const retryKey = `${queueName}:${String(jobId)}`;
    try {
      setRetryingJob(retryKey);
      await adminService.retryFailedQueueJob(queueName, jobId);
      await loadQueues();
    } finally {
      setRetryingJob(null);
    }
  }

  const active = queues.reduce((sum, queue) => sum + queueTotal(queue.counts.active), 0);
  const failed = queues.reduce((sum, queue) => sum + queueTotal(queue.counts.failed), 0);
  const delayed = queues.reduce((sum, queue) => sum + queueTotal(queue.counts.delayed), 0);
  const overdueDelayed = queues.reduce(
    (sum, queue) => sum + queueTotal(queue.overdue_delayed_count),
    0
  );
  const retryExhausted = queues.reduce(
    (sum, queue) => sum + queueTotal(queue.retry_exhausted_count),
    0
  );
  const stuck = queues.reduce(
    (sum, queue) => sum + queueTotal(queue.stuck_active_count),
    0
  );
  const completed = queues.reduce(
    (sum, queue) => sum + queueTotal(queue.counts.completed),
    0
  );

  return (
    <AdminShell
      title="Queue Monitoring"
      description="Inspect background job health and jump into Bull Board when deeper triage is needed."
    >
      {error && <AdminStateBlock title={error} tone="error" />}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <AdminMetricCard label="Active Jobs" value={active} detail="Currently processing" />
        <AdminMetricCard label="Failed Jobs" value={failed} detail="Needs operational review" />
        <AdminMetricCard label="Delayed Jobs" value={delayed} detail={`${overdueDelayed} overdue`} />
        <AdminMetricCard label="Retry Exhausted" value={retryExhausted} detail="Dead-letter candidates" />
        <AdminMetricCard label="Stuck Jobs" value={stuck} detail="Active longer than 15 minutes" />
        <AdminMetricCard label="Completed Jobs" value={completed} detail="Completed job history" />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">
              Bull Board Dashboard
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Opens the protected Bull Board route on the backend.
            </p>
          </div>
          <a
            href={adminService.getBullBoardUrl()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          >
            Open Bull Board
          </a>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">Queue Health</h2>
        </div>

        {loading && queues.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="Loading queues..." />
          </div>
        ) : queues.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="No queues reported by the backend." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Queue</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Waiting</th>
                  <th className="px-4 py-3">Delayed</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Retry Exhausted</th>
                  <th className="px-4 py-3">Stuck</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Incident</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {queues.map((queue) => (
                  <tr key={queue.name} className="text-zinc-700">
                    <td className="px-4 py-3 font-medium text-zinc-950">{queue.name}</td>
                    <td className="px-4 py-3">
                      {queue.is_paused || queue.status === "degraded" ? (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                          {queue.is_paused ? "Paused" : "Degraded"}
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Running
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {queue.worker?.status ? (
                        <span className="text-xs text-zinc-600">
                          {queue.worker.status}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">No heartbeat</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.active)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.waiting)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.delayed)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.failed)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.retry_exhausted_count)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.stuck_active_count)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.completed)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={queueIncidentHref(queue.name, {
                          status: queue.status,
                          failed: queue.counts.failed,
                          waiting: queue.counts.waiting,
                          delayed: queue.counts.delayed,
                          worker: queue.worker_heartbeat_status,
                        })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100"
                        title="Create incident"
                        aria-label={`Create incident for ${queue.name}`}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {queues
          .filter((queue) => queue.delayed_jobs?.length)
          .map((queue) => (
            <div
              key={`${queue.name}-delayed`}
              className="rounded-lg border border-zinc-200 bg-white shadow-sm"
            >
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Delayed Jobs: {queue.name}
                </h2>
              </div>
              <ul className="divide-y divide-zinc-100 text-sm">
                {queue.delayed_jobs?.slice(0, 5).map((job: AdminQueueJob) => (
                  <li key={String(job.id)} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-950">
                          {job.name || "job"} #{String(job.id)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Due {formatGovernanceDate(job.dueAt)} | {job.delayed_reason || "Delayed job"}
                        </p>
                        {job.recovery_hint && (
                          <p className="mt-1 text-xs text-zinc-500">
                            {job.recovery_hint}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${delayedBadgeClass(
                            job.delayed_classification
                          )}`}
                        >
                          {formatDelayedLabel(job.delayed_classification)}
                        </span>
                        <Link
                          href={queueIncidentHref(queue.name, {
                            jobId: job.id,
                            jobName: job.name,
                            dueAt: job.dueAt,
                            classification: job.delayed_classification,
                            overdueMs: job.overdue_ms,
                          })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100"
                          title="Create incident"
                          aria-label={`Create incident for delayed job ${String(job.id)}`}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        {queues
          .filter((queue) => queue.failed_jobs?.length)
          .map((queue) => (
            <div
              key={`${queue.name}-failed`}
              className="rounded-lg border border-zinc-200 bg-white shadow-sm"
            >
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">
                  Failed Jobs: {queue.name}
                </h2>
              </div>
              <ul className="divide-y divide-zinc-100 text-sm">
                {queue.failed_jobs?.slice(0, 5).map((job: AdminQueueJob) => (
                  <li key={String(job.id)} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-zinc-950">
                        {job.name || "job"} #{String(job.id)}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                          {queueTotal(job.attemptsMade)}/{queueTotal(job.attempts)}
                        </span>
                        <button
                          type="button"
                          onClick={() => retryJob(queue.name, job.id)}
                          disabled={retryingJob === `${queue.name}:${String(job.id)}`}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-950 disabled:opacity-50"
                        >
                          {retryingJob === `${queue.name}:${String(job.id)}`
                            ? "Retrying"
                            : "Retry"}
                        </button>
                        <Link
                          href={queueIncidentHref(queue.name, {
                            jobId: job.id,
                            jobName: job.name,
                            attemptsMade: job.attemptsMade,
                            attempts: job.attempts,
                            failedReason: job.failedReason,
                          })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100"
                          title="Create incident"
                          aria-label={`Create incident for failed job ${String(job.id)}`}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                    {job.failedReason && (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                        {job.failedReason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>
    </AdminShell>
  );
}
