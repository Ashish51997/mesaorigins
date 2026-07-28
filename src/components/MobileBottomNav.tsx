/**
 * Mobile bottom navigation — Home + up to 3 value-chain groups + More sheet.
 */
import { useMemo, useState, type ComponentType } from 'react';
import {
  LayoutDashboard, Briefcase, CalendarDays, ShieldCheck, Package2, Truck, Wrench, Users,
  MoreHorizontal, LogOut, Search, Home,
} from 'lucide-react';
import { groupNav, stepOf } from '../lib/navGroups';
import BottomSheet from './ui/BottomSheet';

export type MobileNavItem = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const GROUP_ICON: Record<string, ComponentType<{ className?: string }>> = {
  overview: Home,
  sales: Briefcase,
  planning: CalendarDays,
  quality: ShieldCheck,
  stores: Package2,
  dispatch: Truck,
  maintenance: Wrench,
  admin: Users,
};

const GROUP_SHORT: Record<string, string> = {
  overview: 'Home',
  sales: 'Sales',
  planning: 'Plan',
  quality: 'QA',
  stores: 'Stores',
  dispatch: 'Ship',
  maintenance: 'Maint',
  admin: 'Admin',
};

function defaultForGroup(items: MobileNavItem[], stepKey: string): string {
  if (stepKey === 'planning') {
    const mt = items.find((i) => i.id === 'machine_tasks');
    if (mt) return mt.id;
  }
  if (stepKey === 'overview') {
    const dash = items.find((i) => i.id === 'dashboard');
    if (dash) return dash.id;
  }
  return items[0]?.id ?? 'dashboard';
}

export default function MobileBottomNav({
  items,
  activeModule,
  onOpen,
  userName,
  roleLabel,
  onSignOut,
}: {
  items: MobileNavItem[];
  activeModule: string;
  onOpen: (id: string) => void;
  userName?: string;
  roleLabel?: string;
  onSignOut?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => groupNav(items), [items]);
  const nonOverview = groups.filter((g) => g.step.key !== 'overview');
  const primaryGroups = nonOverview.slice(0, 3);
  const activeStep = stepOf(activeModule);

  const homeId = items.find((i) => i.id === 'dashboard')?.id ?? items[0]?.id ?? 'dashboard';
  const homeActive = activeModule === homeId || activeStep === 'overview';

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groupNav(items.filter((i) => i.label.toLowerCase().includes(q)));
  }, [groups, items, query]);

  const go = (id: string) => {
    onOpen(id);
    setMoreOpen(false);
    setQuery('');
  };

  return (
    <>
      <nav
        className="md:hidden shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <div className="flex items-stretch justify-around min-h-[56px] px-1">
          <TabButton
            label="Home"
            icon={LayoutDashboard}
            active={homeActive}
            onClick={() => go(homeId)}
          />
          {primaryGroups.map(({ step, items: gItems }) => {
            const Icon = GROUP_ICON[step.key] ?? MoreHorizontal;
            const active = activeStep === step.key;
            return (
              <TabButton
                key={step.key}
                label={GROUP_SHORT[step.key] ?? step.label}
                icon={Icon}
                active={active}
                onClick={() => go(defaultForGroup(gItems, step.key))}
              />
            );
          })}
          <TabButton
            label="More"
            icon={MoreHorizontal}
            active={moreOpen || (nonOverview.length > 3 && !primaryGroups.some((g) => g.step.key === activeStep) && activeStep !== 'overview')}
            onClick={() => setMoreOpen(true)}
          />
        </div>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => { setMoreOpen(false); setQuery(''); }} title="Menu">
        <div className="relative mb-3">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu"
            className="w-full pl-8 pr-3 h-10 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
          />
        </div>

        <div className="space-y-4 pb-2">
          {filteredGroups.map(({ step, items: gItems }) => (
            <section key={step.key}>
              <h3 className="px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {step.label}
              </h3>
              <div className="space-y-1">
                {gItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeModule === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-semibold transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0 text-slate-400" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {filteredGroups.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-6">No menu item matches.</p>
          )}
        </div>

        {(userName || onSignOut) && (
          <div className="mt-2 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              {userName && <p className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{userName}</p>}
              {roleLabel && <p className="text-[11px] text-slate-500 truncate">{roleLabel}</p>}
            </div>
            {onSignOut && (
              <button
                type="button"
                onClick={() => { setMoreOpen(false); onSignOut(); }}
                className="p-2.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                aria-label="Sign out"
              >
                <LogOut className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}

function TabButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-0 transition-colors ${
        active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600'
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="text-[10px] font-bold truncate max-w-full px-0.5">{label}</span>
    </button>
  );
}
