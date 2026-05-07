"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import AdminStateBlock from "@/components/admin/AdminStateBlock";
import ModerationActions from "@/components/admin/ModerationActions";
import { useAdminStore } from "@/store/adminStore";
import type { AdminNGO } from "@/services/admin.service";

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export default function AdminNGOModerationPage() {
  const [selected, setSelected] = useState<AdminNGO | null>(null);
  const ngos = useAdminStore((state) => state.ngos);
  const loading = useAdminStore((state) => state.loading);
  const actionLoading = useAdminStore((state) => state.actionLoading);
  const error = useAdminStore((state) => state.error);
  const loadModeration = useAdminStore((state) => state.loadModeration);
  const approveNGO = useAdminStore((state) => state.approveNGO);
  const rejectNGO = useAdminStore((state) => state.rejectNGO);

  useEffect(() => {
    void loadModeration();
  }, [loadModeration]);

  const closeModal = () => setSelected(null);

  return (
    <AdminShell
      title="NGO Moderation"
      description="Review pending NGO registrations and document rejection context."
    >
      {error && <AdminStateBlock title={error} tone="error" />}

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">Pending NGOs</h2>
          <p className="mt-1 text-sm text-zinc-600">{ngos.length} profiles awaiting review</p>
        </div>

        {loading && ngos.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="Loading pending NGOs..." />
          </div>
        ) : ngos.length === 0 ? (
          <div className="p-4">
            <AdminStateBlock title="No pending NGOs." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Registration</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Radius</th>
                  <th className="px-4 py-3">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {ngos.map((ngo) => (
                  <tr key={String(ngo.id)} className="text-zinc-700">
                    <td className="px-4 py-3 font-medium text-zinc-950">
                      {display(ngo.organization_name)}
                      {ngo.rejection_reason && (
                        <p className="mt-1 text-xs text-red-700">
                          Last rejection: {ngo.rejection_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">{display(ngo.registration_number)}</td>
                    <td className="px-4 py-3">{display(ngo.phone)}</td>
                    <td className="px-4 py-3">{display(ngo.service_radius_km)} km</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(ngo)}
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
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  {display(selected.organization_name)}
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Registration: {display(selected.registration_number)}
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

            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
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

            {selected.rejection_reason && (
              <AdminStateBlock
                title="Previous rejection reason"
                description={selected.rejection_reason}
                tone="error"
              />
            )}

            <div className="mt-5">
              <ModerationActions
                disabled={actionLoading}
                onApprove={async () => {
                  if (!selected.id) return;
                  await approveNGO(selected.id);
                  closeModal();
                }}
                onReject={async (reason) => {
                  if (!selected.id) return;
                  await rejectNGO(selected.id, reason);
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
