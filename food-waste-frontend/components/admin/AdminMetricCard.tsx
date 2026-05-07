type AdminMetricCardProps = {
  label: string;
  value: string | number;
  detail?: string;
};

export default function AdminMetricCard({
  label,
  value,
  detail,
}: AdminMetricCardProps) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-zinc-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
    </article>
  );
}
