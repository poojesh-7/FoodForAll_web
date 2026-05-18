"use client";

import { useEffect } from "react";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import { useAdminStore } from "@/store/adminStore";

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export default function AdminOperationsPage() {
  const summary = useAdminStore((state) => state.summary);
  const payments = useAdminStore((state) => state.payments);
  const alerts = useAdminStore((state) => state.alerts);
  const securityEvents = useAdminStore((state) => state.securityEvents);
  const loading = useAdminStore((state) => state.loading);
  const error = useAdminStore((state) => state.error);
  const loadOperations = useAdminStore((state) => state.loadOperations);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  return (
    <AdminShell
      title="Operational Dashboard"
      description="Monitor platform-wide moderation and live reservation activity."
    >
      {error && <AdminStateBlock title={error} tone="error" />}

      {loading && !summary ? (
        <AdminStateBlock title="Loading operational metrics..." />
      ) : summary ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <AdminMetricCard
              label="Total NGOs"
              value={toCount(summary.total_ngos)}
              detail="Registered NGO profiles"
            />
            <AdminMetricCard
              label="Total Restaurants"
              value={toCount(summary.total_restaurants)}
              detail="Registered provider profiles"
            />
            <AdminMetricCard
              label="Active Reservations"
              value={toCount(summary.active_reservations)}
              detail="Reserved or picked up"
            />
            <AdminMetricCard
              label="Expired Reservations"
              value={toCount(summary.expired_reservations)}
              detail="Timed out reservation records"
            />
            <AdminMetricCard
              label="Active Volunteers"
              value={toCount(summary.active_volunteers)}
              detail="Active NGO memberships"
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminMetricCard
              label="Pending Payments"
              value={toCount(payments?.summary?.pending)}
              detail="Awaiting gateway terminal state"
            />
            <AdminMetricCard
              label="Stale Sessions"
              value={toCount(payments?.summary?.stale_sessions)}
              detail="Eligible for reconciliation"
            />
            <AdminMetricCard
              label="Webhook Failures"
              value={toCount(payments?.webhooks?.failed)}
              detail="Last 24 hours"
            />
            <AdminMetricCard
              label="Refund States"
              value={toCount(payments?.summary?.refunds)}
              detail="Pending, failed, or completed"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">Open Alerts</h2>
              </div>
              {alerts.length === 0 ? (
                <div className="p-4">
                  <AdminStateBlock title="No open operational alerts." />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 text-sm">
                  {alerts.slice(0, 8).map((alert) => (
                    <li key={String(alert.id)} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-zinc-950">{alert.message}</p>
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                          {alert.severity}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        {alert.category} | {toCount(alert.occurrences)} occurrences
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-base font-semibold text-zinc-950">Security Events</h2>
              </div>
              {securityEvents.length === 0 ? (
                <div className="p-4">
                  <AdminStateBlock title="No recent security events." />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 text-sm">
                  {securityEvents.slice(0, 10).map((event) => (
                    <li key={String(event.id)} className="px-4 py-3">
                      <p className="font-medium text-zinc-950">
                        {event.event_name.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {event.severity}
                        {event.role ? ` | ${event.role}` : ""}
                        {event.request_id ? ` | ${event.request_id}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      ) : (
        <AdminStateBlock title="Operational metrics are unavailable." />
      )}
    </AdminShell>
  );
}
