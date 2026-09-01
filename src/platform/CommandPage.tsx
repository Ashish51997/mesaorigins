import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Building2, Factory, Loader2, LogOut } from 'lucide-react';
import Logo from '@shared/components/Logo';
import { api } from '@shared/lib/apiClient';
import { StatusBadge } from '@shared/components/ui/StatusBadge';

type CommandException = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  module: string;
  href?: string;
};

type CommandExceptionsResponse = {
  organizationId: string;
  asOf: string;
  exceptions: CommandException[];
};

function severityTone(severity: CommandException['severity']) {
  if (severity === 'critical') return 'error' as const;
  if (severity === 'warning') return 'warn' as const;
  return 'neutral' as const;
}

export default function CommandPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['command', 'exceptions'],
    queryFn: () => api.get<CommandExceptionsResponse>('/command/exceptions'),
  });

  const exceptions = data?.exceptions ?? [];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-700">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-9 w-auto shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">Command</p>
              <h1 className="truncate text-lg font-extrabold text-slate-900">What needs attention</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="/mesaops?module=management_dashboard"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <Factory className="h-4 w-4 text-blue-700" aria-hidden />
              MesaPlant
            </a>
            <a
              href="/mesaops?module=admin"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <Building2 className="h-4 w-4 text-blue-700" aria-hidden />
              Organization Control
            </a>
            <a
              href="/login"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {data?.asOf && (
          <p className="text-xs text-slate-500">
            As of {data.asOf}
          </p>
        )}

        {isLoading && (
          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-blue-700" aria-hidden />
            Loading exceptions…
          </div>
        )}

        {isError && (
          <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {(error as Error)?.message || 'Command could not load exceptions.'}
          </div>
        )}

        {!isLoading && !isError && exceptions.length === 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <AlertTriangle className="h-6 w-6" aria-hidden />
            </div>
            <h2 className="mt-4 text-lg font-extrabold text-slate-900">No exceptions right now</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Plant operations look clear. Open MesaPlant for live production detail.
            </p>
            <a
              href="/mesaops"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800"
            >
              Open MesaPlant
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        )}

        {!isLoading && !isError && exceptions.length > 0 && (
          <section className="mt-6 space-y-3" aria-label="Plant exceptions">
            {exceptions.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={severityTone(item.severity)}>
                        {item.severity}
                      </StatusBadge>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {item.module}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.message}</p>
                  </div>
                  {item.href && (
                    <a
                      href={item.href}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800"
                    >
                      Review
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
