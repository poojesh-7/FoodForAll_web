"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Store } from "lucide-react";
import VolunteerShell from "@/components/volunteer/VolunteerShell";
import VolunteerStateBlock from "@/components/volunteer/VolunteerStateBlock";
import VolunteerSummaryCard from "@/components/volunteer/VolunteerSummaryCard";
import { volunteerService } from "@/services/volunteer.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  VolunteerCurrentTask,
  VolunteerDashboardData,
} from "@shared/contracts/api-contracts";

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function formatSeconds(value: unknown) {
  const seconds = toCount(value);
  if (seconds <= 0) return "0 min";
  return `${Math.round(seconds / 60)} min`;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getReservationDisplayId(id: unknown) {
  const raw = String(id ?? "").replace(/-/g, "");
  return `RES-${(raw.slice(-4) || "----").toUpperCase()}`;
}

function getProviderDisplayName(task: VolunteerCurrentTask) {
  return displayValue(task.restaurant_name) !== "-"
    ? displayValue(task.restaurant_name)
    : displayValue(task.provider_name);
}

function getTaskStatusLabel(status: unknown) {
  return displayValue(status).replace(/_/g, " ");
}

function normalizeCurrentTask(task: VolunteerCurrentTask | null) {
  if (!task) return null;

  const status = String(task.status ?? "").toLowerCase();
  const taskStatus = String(task.task_status ?? "").toLowerCase();
  if (
    taskStatus === "completed" ||
    taskStatus === "delivered" ||
    taskStatus === "failed" ||
    taskStatus === "expired" ||
    taskStatus === "cancelled" ||
    status === "completed" ||
    status === "picked_up" ||
    status === "failed" ||
    status === "expired" ||
    status === "cancelled" ||
    Boolean(task.completed_at)
  ) {
    return null;
  }

  return task;
}

function ActiveTaskSummary({ task }: { task: VolunteerCurrentTask }) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
              {getReservationDisplayId(task.reservation_id)}
            </span>
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold capitalize text-emerald-700">
              {getTaskStatusLabel(task.task_status)}
            </span>
          </div>
          <h2 className="mt-3 text-lg font-semibold text-zinc-950">
            {displayValue(task.title)}
          </h2>
          <div className="mt-3 grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
            <p className="flex items-center gap-2">
              <Store className="h-4 w-4 text-zinc-500" aria-hidden="true" />
              {getProviderDisplayName(task)}
            </p>
            <p>NGO: {displayValue(task.ngo_name)}</p>
          </div>
        </div>
        <Link
          href="/volunteer/tasks"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
        >
          Continue Task
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

export default function VolunteerDashboardPage() {
  const [dashboard, setDashboard] = useState<VolunteerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reservationVersion = useRealtimeStore((state) => state.reservationVersion);
  const reservationsById = useRealtimeStore((state) => state.reservations);

  useEffect(() => {
    let active = true;

    volunteerService
      .getDashboard()
      .then((result) => {
        if (active) {
          setDashboard({
            ...result,
            current_task: normalizeCurrentTask(result.current_task),
          });
        }
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

  useEffect(() => {
    if (!reservationVersion) return;
    queueMicrotask(() =>
      setDashboard((current) => {
        if (!current?.current_task) return current;
        const update = reservationsById[String(current.current_task.reservation_id)];
        return update
          ? {
              ...current,
              current_task: normalizeCurrentTask({
                ...current.current_task,
                ...update,
              }),
            }
          : current;
      })
    );
  }, [reservationVersion, reservationsById]);

  return (
    <VolunteerShell
      title="Volunteer Dashboard"
      description="Track your NGO membership, current rescue, and completion stats."
    >
      {error && <VolunteerStateBlock title={error} tone="error" />}

      {loading ? (
        <VolunteerStateBlock title="Loading volunteer operations..." />
      ) : dashboard ? (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-3">
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
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-950">
              Current Active Task
            </h2>
            {dashboard.current_task ? (
              <ActiveTaskSummary task={dashboard.current_task} />
            ) : (
              <VolunteerStateBlock
                title="No active task."
                description="Start a nearby pending rescue when your NGO has available reservations."
              />
            )}
          </section>
        </div>
      ) : (
        <VolunteerStateBlock title="Volunteer dashboard is unavailable." />
      )}
    </VolunteerShell>
  );
}
