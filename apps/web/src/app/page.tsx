export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <main className="flex w-full max-w-xl flex-col items-start gap-4 rounded-lg border border-zinc-200 p-8 dark:border-zinc-800">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          School Transport Platform
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Foundation scaffold. Application screens for school staff, drivers,
          attendants, and parents are built out starting in Phase 1 — see{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-900">
            docs/roadmap.md
          </code>{" "}
          in the repository.
        </p>
      </main>
    </div>
  );
}
