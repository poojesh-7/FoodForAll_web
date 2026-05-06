"use client";

import { useEffect, useState } from "react";
import NGOReservationCard from "@/components/ngo/NGOReservationCard";
import NGOShell from "@/components/ngo/NGOShell";
import NGOStateBlock from "@/components/ngo/NGOStateBlock";
import { isPendingVerificationError, pendingVerificationRoute } from "@/lib/onboarding";
import {
  ngoService,
  type NGOReservationHistoryRow,
} from "@/services/ngo.service";
import { useRouter } from "next/navigation";

export default function NGOReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<NGOReservationHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    ngoService
      .getReservations()
      .then((result) => {
        if (active) setReservations(result);
      })
      .catch((err) => {
        if (!active) return;
        const message = ngoService.getErrorMessage(err);
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

  return (
    <NGOShell
      title="Reservation History"
      description="Review NGO reservations, provider details, and pickup workflow codes."
    >
      {error && <NGOStateBlock title={error} tone="error" />}

      {loading ? (
        <NGOStateBlock title="Loading reservations..." />
      ) : reservations.length === 0 ? (
        <NGOStateBlock
          title="No NGO reservations yet."
          description="Reservations created from nearby listings or accepted provider requests will appear here."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {reservations.map((reservation) => (
            <NGOReservationCard
              key={String(reservation.id)}
              reservation={reservation}
            />
          ))}
        </div>
      )}
    </NGOShell>
  );
}
