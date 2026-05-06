"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import VolunteerShell from "@/components/volunteer/VolunteerShell";
import VolunteerStateBlock from "@/components/volunteer/VolunteerStateBlock";
import VolunteerSummaryCard from "@/components/volunteer/VolunteerSummaryCard";
import VolunteerTaskCard from "@/components/volunteer/VolunteerTaskCard";
import { volunteerService } from "@/services/volunteer.service";
import type { VolunteerDashboardData } from "@backend/contracts/api-contracts";

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function formatSeconds(value: unknown) {
  const seconds = toCount(value);
  if (seconds <= 0) return "0 min";
  return `${Math.round(seconds / 60)} min`;
}

export default function VolunteerDashboardPage() {
  const [dashboard, setDashboard] = useState<VolunteerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    volunteerService
      .getDashboard()
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((err) => {
        if (active) setError(volunteerService.getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <VolunteerShell
      title="Volunteer Dashboard"
      description="Track your NGO membership, active rescue task, and pending NGO requests."
    >
      {error && <VolunteerStateBlock title={error} tone="error" />}

      {loading ? (
        <VolunteerStateBlock title="Loading volunteer operations..." />
      ) : dashboard ? (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <VolunteerSummaryCard
              label="Active NGO"
              value={dashboard.active_ngo?.organization_name ?? "None"}
              detail={
                dashboard.active_ngo
                  ? `${dashboard.active_ngo.active_listings} active listings`
                  : "Join an NGO to receive tasks"
              }
            />
            <VolunteerSummaryCard
              label="Current Task"
              value={dashboard.current_task ? dashboard.current_task.task_status : "None"}
              detail="One active task is allowed at a time"
            />
            <VolunteerSummaryCard
              label="Completed"
              value={toCount(dashboard.stats.total_completed)}
              detail={`Average: ${formatSeconds(dashboard.stats.avg_completion_time)}`}
            />
            <VolunteerSummaryCard
              label="Pending Requests"
              value={dashboard.pending_requests.length}
              detail="NGO invitations awaiting response"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Current Active Task
              </h2>
              {dashboard.current_task ? (
                <VolunteerTaskCard
                  task={dashboard.current_task}
                  active
                  action={
                    <Link
                      href="/volunteer/tasks"
                      className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                    >
                      Continue Task
                    </Link>
                  }
                />
              ) : (
                <VolunteerStateBlock
                  title="No active task."
                  description="Start a nearby pending rescue when your NGO has available reservations."
                />
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                Pending NGO Requests
              </h2>
              {dashboard.pending_requests.length === 0 ? (
                <VolunteerStateBlock title="No pending requests." />
              ) : (
                <div className="space-y-3">
                  {dashboard.pending_requests.slice(0, 3).map((request) => (
                    <article
                      key={String(request.id)}
                      className="rounded-lg border border-zinc-200 bg-white p-4 text-sm shadow-sm"
                    >
                      <p className="font-medium text-zinc-950">
                        {request.organization_name}
                      </p>
                      <p className="mt-1 text-zinc-600">
                        Status: {request.status ?? "pending"}
                      </p>
                    </article>
                  ))}
                  <Link
                    href="/volunteer/requests"
                    className="inline-flex rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
                  >
                    Review Requests
                  </Link>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <VolunteerStateBlock title="Volunteer dashboard is unavailable." />
      )}
    </VolunteerShell>
  );
}
