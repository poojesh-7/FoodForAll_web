"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReservationCard from "@/components/reservations/ReservationCard";
import ReservationTimeline from "@/components/reservations/ReservationTimeline";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import { reservationService } from "@/services/reservation.service";
import type { DbId, ProviderReservationRow } from "@backend/contracts/api-contracts";
import { useRouter } from "next/navigation";

function canConfirmPickup(reservation: ProviderReservationRow) {
  if (reservation.status !== "reserved") return false;
  if (reservation.pickup_type === "ngo") {
    return reservation.task_status === "in_progress";
  }
  return !["picked_up", "picked_from_provider", "delivered"].includes(
    String(reservation.task_status ?? "")
  );
}

export default function ProviderReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<ProviderReservationRow[]>([]);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    reservationService
      .getProviderReservations()
      .then((result) => {
        if (active) setReservations(result);
      })
      .catch((err) => {
        if (!active) return;
        const message = reservationService.getErrorMessage(err);
        if (isPendingVerificationError(message)) {
          router.push(pendingVerificationRoute);
          return;
        }
        setError(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  const grouped = useMemo(
    () => ({
      ngo: reservations.filter((reservation) => reservation.pickup_type === "ngo"),
      user: reservations.filter((reservation) => reservation.pickup_type !== "ngo"),
    }),
    [reservations]
  );

  const confirmPickup = async (reservation: ProviderReservationRow) => {
    if (!reservation.id) return;
    const reservationId = String(reservation.id);
    const pickupCode = pickupCodes[reservationId]?.trim();

    if (!pickupCode) {
      setError("Pickup code is required.");
      return;
    }

    try {
      setProcessingId(reservationId);
      setError("");
      setSuccess("");
      await reservationService.confirmPickup(reservation.id, {
        pickup_code: pickupCode,
      });
      setReservations((current) =>
        current.map((item) =>
          String(item.id) === reservationId
            ? {
                ...item,
                task_status:
                  reservation.pickup_type === "ngo"
                    ? "picked_from_provider"
                    : "picked_up",
                status:
                  reservation.pickup_type === "ngo" ? item.status : "picked_up",
                picked_up_at: new Date().toISOString(),
                completed_at:
                  reservation.pickup_type === "ngo"
                    ? item.completed_at
                    : new Date().toISOString(),
              }
            : item
        )
      );
      setPickupCodes((current) => ({ ...current, [reservationId]: "" }));
      setSuccess("Pickup confirmed.");
    } catch (err) {
      setError(reservationService.getErrorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  const renderReservation = (reservation: ProviderReservationRow) => {
    const reservationId: DbId | undefined = reservation.id;
    const id = String(reservationId ?? "");
    if (!id) return null;

    const confirmable = canConfirmPickup(reservation);

    return (
      <div key={id} className="space-y-3">
        <ReservationTimeline reservation={reservation} />
        <ReservationCard
          reservation={reservation}
          providerView
          actions={
            confirmable ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={pickupCodes[id] ?? ""}
                  placeholder="Pickup code"
                  className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
                  onChange={(event) =>
                    setPickupCodes((current) => ({
                      ...current,
                      [id]: event.target.value,
                    }))
                  }
                />
                <button
                  onClick={() => confirmPickup(reservation)}
                  disabled={processingId === id}
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {processingId === id ? "Confirming..." : "Confirm Pickup"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">
                Pickup confirmation is available only while reserved and, for NGO reservations, after a volunteer starts the task.
              </p>
            )
          }
        />
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">
              Provider Reservations
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Confirm pickups, track requester type, and monitor volunteer assignment.
            </p>
          </div>
          <Link
            href="/provider/listings"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Listings
          </Link>
        </header>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading provider reservations...
          </div>
        ) : reservations.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            No reservations found for your listings.
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                NGO Reservations
              </h2>
              {grouped.ngo.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
                  No NGO reservations.
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {grouped.ngo.map(renderReservation)}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-semibold text-zinc-950">
                User Reservations
              </h2>
              {grouped.user.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
                  No user reservations.
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {grouped.user.map(renderReservation)}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
