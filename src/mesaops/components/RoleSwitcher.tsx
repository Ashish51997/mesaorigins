/**
 * RoleSwitcher.tsx — floating drawer to sign in AS any employee in the tenant.
 * The list comes from the API (/directory); picking a person drives the dev
 * identity by their email, so the server resolves their real role + access.
 */
import { useState } from 'react';
import { Users2, Check } from 'lucide-react';
import { useDirectory } from '@mesaops/lib/queries/admin';
import ResponsiveOverlay from '@shared/components/ui/ResponsiveOverlay';

export function RoleSwitcher({ current, currentEmail, onSelectEmployee }: {
  current: string; currentEmail: string; onSelectEmployee: (email: string, role: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dir = (useDirectory(open).data ?? []).slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 lg:bottom-5 lg:right-5 z-50 inline-flex items-center gap-2 px-4 h-12 min-h-11 rounded-lg bg-sky-600 text-white font-medium text-xs hover:bg-sky-500 no-print"
        title="Switch employee"
      >
        <Users2 className="w-4 h-4" /> {current}
      </button>

      <ResponsiveOverlay open={open} onClose={() => setOpen(false)} title="Sign in as…" variant="drawer-right" panelClassName="!max-w-[360px]">
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
          {dir.length === 0 ? <div className="text-center text-[12px] text-slate-400 py-6">Loading team…</div> : dir.map((e) => {
            const activeE = e.email.toLowerCase() === (currentEmail || '').toLowerCase();
            return (
              <button
                key={e.id}
                onClick={() => { onSelectEmployee(e.email, e.role, e.name); setOpen(false); }}
                className={`w-full text-left rounded-lg border p-2.5 transition-colors ${activeE ? 'border-sky-600 bg-sky-50' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[13px] text-slate-800 dark:text-slate-100">{e.name}</span>
                  {activeE && <Check className="w-4 h-4 text-sky-600" />}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{e.role} · {e.employeeCode} · {e.department}</div>
              </button>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 shrink-0">
          Picking a person resolves their real role &amp; access from the server — created employees appear here.
        </div>
      </ResponsiveOverlay>
    </>
  );
}
