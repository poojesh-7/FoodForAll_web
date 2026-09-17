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
    <main className="min-h-screen bg-[var(--background)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <div>
            <h1 className="text-3xl font-semibold text-[var(--text-primary)]">{title}</h1>
            {description && (
              <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">{description}</p>
            )}
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}
