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
      ) : (
        <AdminStateBlock title="Operational metrics are unavailable." />
      )}
    </AdminShell>
  );
}
