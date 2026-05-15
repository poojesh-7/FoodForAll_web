type NGOShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export default function NGOShell({
  title,
  description,
  children,
}: NGOShellProps) {
  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-zinc-600">{description}</p>
            )}
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}
