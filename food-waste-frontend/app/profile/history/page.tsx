"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, PackageCheck } from "lucide-react";
import OperationalFeedbackBlock from "@/components/OperationalFeedbackBlock";
import { formatDateTimeOrFallback } from "@/lib/dateTime";
import { formatQuantityWithUnit } from "@/lib/food";
import { userService } from "@/services/user";
import { useAuthStore } from "@/store/authStore";
import type { UserHistoryItem } from "@shared/contracts/api-contracts";

type HistoryDetail = {
  label: string;
  value: string;
};

const statusLabels: Record<string, string> = {
  abandoned_payment: "Payment abandoned",
  active: "Active",
  assigned: "Volunteer assigned",
  available: "Available",
  cancelled: "Cancelled",
  cancelled_before_confirmation: "Cancelled",
  completed: "Completed",
  delivered: "Delivered",
  expired: "Expired",
  expired_payment: "Payment expired",
  failed: "Failed",
  inactive: "Inactive",
  in_progress: "In progress",
  payment_expired: "Payment expired",
  payment_failed: "Payment failed",
  payment_pending: "Payment pending",
  pending: "Pending",
  picked_from_provider: "Picked up by volunteer",
  picked_up: "Picked up",
  ready_for_pickup: "Ready for pickup",
  reserved: "Reserved",
  self_pickup: "Ready for pickup",
  timeout_cancelled: "Cancelled",
  volunteer_started: "Volunteer on the way",
};

function getHistoryTitle(item: UserHistoryItem) {
  if ("title" in item && item.title) return String(item.title);
  return "History record";
}

function getText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function getStatusLabel(value: unknown) {
  const key = getText(value)?.trim().toLowerCase();
  if (!key) return null;

  return statusLabels[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isReservationHistory(item: UserHistoryItem) {
  return "quantity_reserved" in item || "reserved_at" in item;
}

function getProviderName(item: UserHistoryItem) {
  return getText("restaurant_name" in item ? item.restaurant_name : null)
    ?? getText("provider_name" in item ? item.provider_name : null);
}

function getReservationProgress(item: UserHistoryItem) {
  const status = getText("status" in item ? item.status : null)?.toLowerCase();
  const taskStatus = getText("task_status" in item ? item.task_status : null)?.toLowerCase();

  if (status === "cancelled" || status === "expired" || status === "failed") {
    return getStatusLabel(status);
  }

  return getStatusLabel(taskStatus) ?? getStatusLabel(status);
}

function compactDetails(details: Array<HistoryDetail | null>) {
  return details.filter((detail): detail is HistoryDetail => Boolean(detail?.value));
}

function getHistoryDetails(item: UserHistoryItem): HistoryDetail[] {
  if (isReservationHistory(item)) {
    const providerName = getProviderName(item);

    return compactDetails([
      {
        label: "Quantity",
        value: formatQuantityWithUnit(
          "quantity_reserved" in item ? item.quantity_reserved : null,
          item
        ),
      },
      {
        label: "Reserved on",
        value: formatDateTimeOrFallback(
          getText("reserved_at" in item ? item.reserved_at : null)
        ),
      },
      {
        label: "Pickup by",
        value: formatDateTimeOrFallback(
          getText("pickup_end_time" in item ? item.pickup_end_time : null)
        ),
      },
      providerName ? { label: "Provider", value: providerName } : null,
      {
        label: "Progress",
        value: getReservationProgress(item) ?? "Reservation recorded",
      },
    ]);
  }

  return compactDetails([
    {
      label: "Quantity",
      value: formatQuantityWithUnit("quantity" in item ? item.quantity : null, item),
    },
    {
      label: "Remaining",
      value: formatQuantityWithUnit(
        "remaining_quantity" in item ? item.remaining_quantity : null,
        item
      ),
    },
    {
      label: "Pickup by",
      value: formatDateTimeOrFallback(
        getText("pickup_end_time" in item ? item.pickup_end_time : null)
      ),
    },
    {
      label: "Status",
      value: getStatusLabel("status" in item ? item.status : null) ?? "Listed",
    },
  ]);
}

export default function UserHistoryPage() {
  const authUser = useAuthStore((state) => state.user);

  const [history, setHistory] = useState<UserHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authUser?.id) return;

    let active = true;

    userService
      .getUserHistory(authUser.id)
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((err) => {
        if (active) setError(userService.getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authUser?.id]);

  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="flex flex-col gap-4 rounded-lg border border-emerald-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase text-emerald-700">
              Profile activity
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-950">
              History
            </h1>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Recent reservations and food records.
            </p>
          </div>
          <Link
            href="/profile"
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Link>
        </div>

        {error && <OperationalFeedbackBlock title={error} tone="error" />}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading history...
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No history found.
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item, index) => (
              <article
                key={`${getHistoryTitle(item)}-${index}`}
                className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                    {isReservationHistory(item) ? (
                      <CalendarDays className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <PackageCheck className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-zinc-500">
                      {isReservationHistory(item) ? "Reservation" : "Food listing"}
                    </p>
                    <h2 className="mt-1 break-words text-base font-semibold text-zinc-950">
                      {getHistoryTitle(item)}
                    </h2>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {getHistoryDetails(item).map((detail) => (
                    <div
                      key={detail.label}
                      className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3"
                    >
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        {detail.label}
                      </p>
                      <p className="mt-1 break-words text-sm font-medium text-zinc-950">
                        {detail.value}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
