"use client";

import { useEffect, useMemo, useState } from "react";
import VolunteerShell from "@/components/volunteer/VolunteerShell";
import VolunteerStateBlock from "@/components/volunteer/VolunteerStateBlock";
import VolunteerTaskCard from "@/components/volunteer/VolunteerTaskCard";
import {
  volunteerService,
  type VolunteerCurrentTask,
} from "@/services/volunteer.service";
import type { DbId, ReservationRow, VolunteerTask } from "@backend/contracts/api-contracts";

type LocationForm = {
  lat: string;
  lng: string;
  radius: string;
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

function getReservationId(reservation: ReservationRow): DbId | undefined {
  return reservation.id;
}

function mergeStartedTask(
  task: VolunteerTask,
  reservation: ReservationRow
): VolunteerCurrentTask {
  return {
    ...task,
    reservation_id: getReservationId(reservation) ?? task.reservation_id,
    quantity_reserved: reservation.quantity_reserved ?? task.quantity_reserved,
    pickup_type: reservation.pickup_type ?? task.pickup_type,
    status: reservation.status ?? task.status,
    task_status: String(reservation.task_status ?? "in_progress"),
    pickup_code: String(reservation.pickup_code ?? ""),
    receive_code: String(reservation.receive_code ?? ""),
    assigned_at:
      typeof reservation.assigned_at === "string" ? reservation.assigned_at : null,
    picked_up_at:
      typeof reservation.picked_up_at === "string" ? reservation.picked_up_at : null,
    completed_at:
      typeof reservation.completed_at === "string" ? reservation.completed_at : null,
  };
}

export default function VolunteerTasksPage() {
  const [form, setForm] = useState<LocationForm>({
    lat: "",
    lng: "",
    radius: "5",
  });
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [activeTask, setActiveTask] = useState<VolunteerCurrentTask | null>(null);
  const [receiveCode, setReceiveCode] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    volunteerService
      .getDashboard()
      .then((dashboard) => {
        if (active) setActiveTask(dashboard.current_task);
      })
      .catch(() => {
        if (active) setActiveTask(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const availableTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          !activeTask ||
          String(task.reservation_id) !== String(activeTask.reservation_id)
      ),
    [activeTask, tasks]
  );

  const search = async (nextForm = form) => {
    if (!nextForm.lat || !nextForm.lng) {
      setError("Latitude and longitude are required.");
      return;
    }

    try {
      setLoading(true);
      setSearched(true);
      setError("");
      setSuccess("");
      const result = await volunteerService.getTasks({
        lat: nextForm.lat,
        lng: nextForm.lng,
        radius: nextForm.radius,
      });
      setTasks(result);
    } catch (err) {
      setError(volunteerService.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const useCurrentLocation = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      const position = await getCurrentPosition();
      const nextForm = {
        ...form,
        lat: String(position.coords.latitude),
        lng: String(position.coords.longitude),
      };
      setForm(nextForm);
      await search(nextForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please allow location access.");
    } finally {
      setLoading(false);
    }
  };

  const startTask = async (task: VolunteerTask) => {
    if (activeTask) {
      setError("Finish your current active task before starting another.");
      return;
    }

    try {
      setStartingId(String(task.reservation_id));
      setError("");
      setSuccess("");
      const reservation = await volunteerService.startTask(task.reservation_id);
      setActiveTask(mergeStartedTask(task, reservation));
      setTasks((current) =>
        current.filter(
          (item) => String(item.reservation_id) !== String(task.reservation_id)
        )
      );
      setSuccess("Task started. Share the pickup code with the provider.");
    } catch (err) {
      setError(volunteerService.getErrorMessage(err));
    } finally {
      setStartingId(null);
    }
  };

  const completeTask = async () => {
    if (!activeTask) return;

    if (!receiveCode.trim()) {
      setError("Receive code is required.");
      return;
    }

    try {
      setCompleting(true);
      setError("");
      setSuccess("");
      await volunteerService.completeTask(activeTask.reservation_id, {
        receive_code: receiveCode.trim(),
      });
      setActiveTask({
        ...activeTask,
        task_status: "delivered",
        status: "picked_up",
        completed_at: new Date().toISOString(),
      });
      setReceiveCode("");
      setSuccess("Delivery completed successfully.");
    } catch (err) {
      setError(volunteerService.getErrorMessage(err));
    } finally {
      setCompleting(false);
    }
  };

  return (
    <VolunteerShell
      title="Volunteer Tasks"
      description="Find nearby NGO rescue tasks, start one task at a time, and complete delivery with receive-code verification."
    >
      {error && <VolunteerStateBlock title={error} tone="error" />}
      {success && <VolunteerStateBlock title={success} tone="success" />}

      {activeTask && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-zinc-950">Active Task</h2>
          <VolunteerTaskCard
            task={activeTask}
            active
            action={
              activeTask.task_status === "picked_from_provider" ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={receiveCode}
                    placeholder="Receive code"
                    className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                    onChange={(event) => setReceiveCode(event.target.value)}
                  />
                  <button
                    onClick={completeTask}
                    disabled={completing}
                    className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {completing ? "Completing..." : "Complete Delivery"}
                  </button>
                </div>
              ) : activeTask.task_status === "in_progress" ? (
                <p className="text-sm text-zinc-600">
                  Waiting for the provider to confirm pickup with your pickup code.
                </p>
              ) : (
                <p className="text-sm text-zinc-600">
                  Task status: {activeTask.task_status}
                </p>
              )
            }
          />
        </section>
      )}

      <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
        <input
          value={form.lat}
          inputMode="decimal"
          placeholder="Latitude"
          className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => setForm({ ...form, lat: event.target.value })}
        />
        <input
          value={form.lng}
          inputMode="decimal"
          placeholder="Longitude"
          className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => setForm({ ...form, lng: event.target.value })}
        />
        <input
          value={form.radius}
          inputMode="decimal"
          placeholder="Radius km"
          className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => setForm({ ...form, radius: event.target.value })}
        />
        <button
          onClick={() => search()}
          disabled={loading}
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Search
        </button>
        <button
          onClick={useCurrentLocation}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
        >
          Current
        </button>
      </section>

      {loading ? (
        <VolunteerStateBlock title="Loading nearby rescue tasks..." />
      ) : searched && availableTasks.length === 0 ? (
        <VolunteerStateBlock
          title="No nearby rescue tasks found."
          description="Tasks appear when your active NGO has reserved food waiting for volunteer pickup."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {availableTasks.map((task) => (
            <VolunteerTaskCard
              key={String(task.reservation_id)}
              task={task}
              action={
                <button
                  onClick={() => startTask(task)}
                  disabled={Boolean(activeTask) || startingId === String(task.reservation_id)}
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {startingId === String(task.reservation_id)
                    ? "Starting..."
                    : "Start Task"}
                </button>
              }
            />
          ))}
        </div>
      )}
    </VolunteerShell>
  );
}
