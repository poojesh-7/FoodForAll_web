"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import ModerationActions from "@/components/admin/ModerationActions";
import { adminService, type AdminRestaurant } from "@/services/admin.service";
import { useAdminStore } from "@/store/adminStore";

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export default function AdminRestaurantModerationPage() {
  const [selected, setSelected] = useState<AdminRestaurant | null>(null);
  const restaurants = useAdminStore((state) => state.restaurants);
  const loading = useAdminStore((state) => state.loading);
  const actionLoading = useAdminStore((state) => state.actionLoading);
  const error = useAdminStore((state) => state.error);
  const loadModeration = useAdminStore((state) => state.loadModeration);
  const approveRestaurant = useAdminStore((state) => state.approveRestaurant);
  const rejectRestaurant = useAdminStore((state) => state.rejectRestaurant);

  useEffect(() => {
    void loadModeration();
  }, [loadModeration]);

  const closeModal = () => setSelected(null);
  const certificateUrl = adminService.getAssetUrl(selected?.fssai_certificate_url);

  return (
    <AdminShell
      title="Restaurant Moderation"
      description="Verify pending provider registrations and review FSSAI documents."
    >
      {error && <AdminStateBlock title={error} tone="error" />}

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">
            Pending Restaurants
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {restaurants.length} profiles awaiting review
          </p>
        </div>

        {loading && restaurants.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="Loading pending restaurants..." />
          </div>
        ) : restaurants.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="No pending restaurants." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">FSSAI</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Radius</th>
                  <th className="px-4 py-3">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {restaurants.map((restaurant) => (
                  <tr key={String(restaurant.id)} className="text-zinc-700">
                    <td className="px-4 py-3 font-medium text-zinc-950">
                      {display(restaurant.restaurant_name)}
                      {restaurant.rejection_reason && (
                        <p className="mt-1 text-xs text-red-700">
                          Last rejection: {restaurant.rejection_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">{display(restaurant.fssai_number)}</td>
                    <td className="px-4 py-3">{display(restaurant.phone)}</td>
                    <td className="px-4 py-3">{display(restaurant.service_radius_km)} km</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(restaurant)}
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-50"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  {display(selected.restaurant_name)}
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  FSSAI: {display(selected.fssai_number)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <dt className="text-xs font-semibold uppercase text-zinc-500">Phone</dt>
                  <dd className="mt-1 text-sm text-zinc-950">{display(selected.phone)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-zinc-500">Service Radius</dt>
                  <dd className="mt-1 text-sm text-zinc-950">{display(selected.service_radius_km)} km</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-zinc-500">Latitude</dt>
                  <dd className="mt-1 text-sm text-zinc-950">{display(selected.latitude)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-zinc-500">Longitude</dt>
                  <dd className="mt-1 text-sm text-zinc-950">{display(selected.longitude)}</dd>
                </div>
              </dl>

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="mb-3 text-sm font-semibold text-zinc-950">
                  FSSAI Document Preview
                </p>
                {certificateUrl ? (
                  <a href={certificateUrl} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={certificateUrl}
                      alt="FSSAI certificate"
                      className="max-h-96 w-full rounded-md object-contain"
                    />
                  </a>
                ) : (
                  <AdminStateBlock title="No FSSAI document path available." />
                )}
              </div>
            </div>

            {selected.rejection_reason && (
              <div className="mt-5">
                <AdminStateBlock
                  title="Previous rejection reason"
                  description={selected.rejection_reason}
                  tone="error"
                />
              </div>
            )}

            <div className="mt-5">
              <ModerationActions
                disabled={actionLoading}
                onApprove={async () => {
                  if (!selected.id) return;
                  await approveRestaurant(selected.id);
                  closeModal();
                }}
                onReject={async (reason) => {
                  if (!selected.id) return;
                  await rejectRestaurant(selected.id, reason);
                  closeModal();
                }}
              />
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}
