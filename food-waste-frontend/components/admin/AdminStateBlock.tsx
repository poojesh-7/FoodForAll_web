type AdminStateBlockProps = {
  title: string;
  description?: string;
  tone?: "neutral" | "error";
};

export default function AdminStateBlock({
  title,
  description,
  tone = "neutral",
}: AdminStateBlockProps) {
  return (
    <div
      className={`rounded-lg border p-4 text-sm shadow-sm ${
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-zinc-200 bg-white text-zinc-700"
      }`}
    >
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-sm opacity-80">{description}</p>}
    </div>
  );
}
