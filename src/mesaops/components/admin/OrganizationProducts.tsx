import { useQuery } from '@tanstack/react-query';
import { Boxes, Sparkles } from 'lucide-react';
import { api } from '@shared/lib/apiClient';
import { StatusBadge } from '@shared/components/ui/StatusBadge';

type OrganizationProductsResponse = {
  active: Array<{ id: string; name: string; description: string; group: string }>;
  available: Array<{ id: string; name: string; description: string; group: string }>;
};

export function OrganizationProducts() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['organization', 'products'],
    queryFn: () => api.get<OrganizationProductsResponse>('/command/organization-products'),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Organization Control</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Active and available products</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Active modules are entitled for this organization. Available modules require MesaWorks to enable.
          </p>
        </div>
        <Sparkles className="h-5 w-5 shrink-0 text-blue-700" aria-hidden />
      </div>

      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading products…</p>}
      {isError && (
        <p role="alert" className="mt-4 text-sm text-rose-700">Products could not be loaded.</p>
      )}

      {data && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Active</h3>
            <ul className="mt-2 space-y-2">
              {data.active.length === 0 && (
                <li className="text-sm text-slate-500">No modules are active yet.</li>
              )}
              {data.active.map((module) => (
                <li key={module.id} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-emerald-700" aria-hidden />
                    <span className="text-sm font-bold text-slate-900">{module.name}</span>
                    <StatusBadge tone="success">Active</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{module.description}</p>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Available to add</h3>
            <ul className="mt-2 space-y-2">
              {data.available.length === 0 && (
                <li className="text-sm text-slate-500">All catalog modules are already active.</li>
              )}
              {data.available.map((module) => (
                <li key={module.id} className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-slate-400" aria-hidden />
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{module.name}</span>
                    <StatusBadge tone="neutral">Available</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{module.description}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
