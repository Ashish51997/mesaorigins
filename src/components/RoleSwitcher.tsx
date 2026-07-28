/**
 * RoleSwitcher.tsx — drawer to sign in AS any employee in the tenant.
 * The list comes from the API (/directory); picking a person drives the dev
 * identity by their email, so the server resolves their real role + access.
 *
 * The floating pill that used to open this is gone: it sat over the bottom-right
 * of every screen restating the role the sidebar user card already shows. The
 * drawer is now opened from that card, which is where a person looks to check
 * who they are signed in as.
 */
import { Check } from 'lucide-react';
import { useDirectory } from '../lib/queries/admin';
import ResponsiveOverlay from './ui/ResponsiveOverlay';

export function RoleSwitcher({ currentEmail, open, onClose, onSelectEmployee }: {
  currentEmail: string;
  open: boolean;
  onClose: () => void;
  onSelectEmployee: (email: string, role: string, name: string) => void;
}) {
  const dir = (useDirectory(open).data ?? []).slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  const setOpen = (v: boolean): void => { if (!v) onClose(); };
  return (
    <>
      <ResponsiveOverlay open={open} onClose={onClose} title="Sign in as…" variant="drawer-right" panelClassName="!max-w-[360px]">
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
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
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 shrink-0">
          Picking a person resolves their real role &amp; access from the server — created employees appear here.
        </div>
      </ResponsiveOverlay>
    </>
  );
}
