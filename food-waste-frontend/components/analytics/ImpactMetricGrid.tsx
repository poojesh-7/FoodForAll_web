import { formatMetric } from "@/services/impact.service";

type ImpactMetric = {
  label: string;
  value: unknown;
  detail?: string;
  fractionDigits?: number;
};

type ImpactMetricGridProps = {
  metrics: ImpactMetric[];
  columns?: "three" | "four";
};

export default function ImpactMetricGrid({
  metrics,
  columns = "three",
}: ImpactMetricGridProps) {
  const gridClass =
    columns === "four" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";

  return (
    <section className={`grid gap-3 ${gridClass}`}>
      {metrics.map((metric) => (
        <article
          key={metric.label}
          className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <p className="text-sm font-medium text-zinc-600">{metric.label}</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {formatMetric(metric.value, metric.fractionDigits)}
          </p>
          {metric.detail && (
            <p className="mt-1 text-sm text-zinc-500">{metric.detail}</p>
          )}
        </article>
      ))}
    </section>
  );
}
