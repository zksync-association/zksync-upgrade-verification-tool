import Logo from "@/components/logo";

/** A real pending state: no contract roles or signature results are shown until verified. */
export function AppLoading() {
  return (
    <div className="min-h-screen" aria-busy="true">
      <header className="border-slate-300 border-b bg-white">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
          <Logo className="h-6 w-auto" />
          <span className="font-medium text-slate-950">Governance</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] space-y-4 px-4 py-8 sm:px-6" role="status">
        <h1 className="text-2xl">Reading governance data…</h1>
        <p className="text-slate-700">Checking your RPC, contract roles, and network status.</p>
        <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
          <div className="h-4 w-48 rounded bg-slate-200" />
          <div className="h-4 w-80 max-w-full rounded bg-slate-200" />
        </div>
      </main>
    </div>
  );
}
