/**
 * RoleSwitcher.tsx — floating drawer to sign in AS any employee in the tenant.
 * The list comes from the API (/directory); picking a person drives the dev
 * identity by their email, so the server resolves their real role + access.
 */
import { useState } from 'react';
import { Users2, X, Check } from 'lucide-react';
import { useDirectory } from '../lib/queries/admin';

export function RoleSwitcher({ current, currentEmail, onSelectEmployee }: {
  current: string; currentEmail: string; onSelectEmployee: (email: string, role: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dir = (useDirectory(open).data ?? []).slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 px-4 h-12 rounded-full bg-indigo-600 text-white font-bold text-xs shadow-lg hover:bg-indigo-700 no-print"
        title="Switch employee"
      >
        <Users2 className="w-4 h-4" /> {current}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-[360px] max-w-full h-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-sm text-slate-800 dark:text-slate-100">Sign in as…</span>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {dir.length === 0 ? <div className="text-center text-[12px] text-slate-400 py-6">Loading team…</div> : dir.map((e) => {
                const activeE = e.email.toLowerCase() === (currentEmail || '').toLowerCase();
                return (
                  <button
                    key={e.id}
                    onClick={() => { onSelectEmployee(e.email, e.role, e.name); setOpen(false); }}
                    className={`w-full text-left rounded-lg border p-2.5 transition-all ${activeE ? 'border-indigo-500 ring-1 ring-indigo-300 bg-indigo-50/40' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[13px] text-slate-800 dark:text-slate-100">{e.name}</span>
                      {activeE && <Check className="w-4 h-4 text-indigo-600" />}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{e.role} · {e.employeeCode} · {e.department}</div>
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-400">
              Picking a person resolves their real role &amp; access from the server — created employees appear here.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
