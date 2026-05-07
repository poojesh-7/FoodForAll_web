"use client";

import { useEffect } from "react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { adminService } from "@/services/admin.service";
import { useAdminStore } from "@/store/adminStore";

function queueTotal(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export default function AdminQueuesPage() {
  const queues = useAdminStore((state) => state.queues);
  const loading = useAdminStore((state) => state.loading);
  const error = useAdminStore((state) => state.error);
  const loadQueues = useAdminStore((state) => state.loadQueues);

  useEffect(() => {
    void loadQueues();
  }, [loadQueues]);

  const active = queues.reduce((sum, queue) => sum + queueTotal(queue.counts.active), 0);
  const failed = queues.reduce((sum, queue) => sum + queueTotal(queue.counts.failed), 0);
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

      <section className="grid gap-3 sm:grid-cols-3">
        <AdminMetricCard label="Active Jobs" value={active} detail="Currently processing" />
        <AdminMetricCard label="Failed Jobs" value={failed} detail="Needs operational review" />
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
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Waiting</th>
                  <th className="px-4 py-3">Delayed</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {queues.map((queue) => (
                  <tr key={queue.name} className="text-zinc-700">
                    <td className="px-4 py-3 font-medium text-zinc-950">{queue.name}</td>
                    <td className="px-4 py-3">
                      {queue.is_paused ? (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                          Paused
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Running
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.active)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.waiting)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.delayed)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.failed)}</td>
                    <td className="px-4 py-3">{queueTotal(queue.counts.completed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
