"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { userService } from "@/services/user";
import { useAuthStore } from "@/store/authStore";
import type { UserHistoryItem } from "@backend/contracts/api-contracts";

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function getHistoryTitle(item: UserHistoryItem) {
  if ("title" in item && item.title) return String(item.title);
  if ("id" in item && item.id) return `Record ${String(item.id)}`;
  return "History record";
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
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">History</h1>
            <p className="text-sm text-zinc-600">
              Your recent profile activity and food records.
            </p>
          </div>
          <Link
            href="/profile"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Back
          </Link>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading...
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
                className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <h2 className="text-base font-semibold text-zinc-950">
                  {getHistoryTitle(item)}
                </h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(item)
                    .filter(([key]) => !["title"].includes(key))
                    .slice(0, 8)
                    .map(([key, value]) => (
                      <div key={key}>
                        <p className="text-xs font-medium uppercase text-zinc-500">
                          {key.replace(/_/g, " ")}
                        </p>
                        <p className="break-words text-sm text-zinc-950">
                          {displayValue(value)}
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
