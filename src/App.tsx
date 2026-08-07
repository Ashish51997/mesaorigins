/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Package2,
  Truck,
  ShieldAlert,
  BarChart3,
  Clock,
  Settings,
  HelpCircle,
  Menu,
  X,
  Gauge,
  LogOut,
  Search,
  ChevronDown,
  ChevronsLeft,
  Compass,
  LockKeyhole,
  Cpu,
  BookOpen
} from 'lucide-react';

import {
  Customer,
  Inquiry,
  SalesOrder,
  ProductionPlan,
  MachineLogbook,
  QualityInspection,
  PackingRecord,
  InventoryTransaction,
  DispatchRecord,
  CustomerComplaint,
  CAPARecord,
  LogbookTemplate
} from './types';

import {
  initialCustomers,
  initialInquiries,
  initialSalesOrders,
  initialProductionPlans,
  initialMachineLogbooks,
  initialQualityInspections,
  initialPackingRecords,
  initialInventoryTransactions,
  initialDispatchRecords,
  initialCustomerComplaints,
  initialCapaRecords,
  initialLogbookTemplates
} from './mockData';

// Component imports — only real, API-backed screens survive.
import LoginScreen from './components/LoginScreen';
import Logo from './components/Logo';
import MobileBottomNav from './components/MobileBottomNav';
import { setCurrentEmployee, useRoleRules, useGrants, useDelegations, checkFor, can, grantState } from './lib/accessStore';
import { employeeForRole } from './lib/userStore';
import { setDevUser } from './lib/apiIdentity';
import { api } from './lib/apiClient';
import { groupNav } from './lib/navGroups';
import { roleInfo, homeForRole, normalizeRole } from './lib/roles';
import { ToastHost, pushToast } from './components/Notify';
import { RoleSwitcher } from './components/RoleSwitcher';
import { OfflineBanner, PracticeBanner } from './components/Banners';
import { startSimulation } from './lib/simulation';
import { useQueue } from './lib/offline';
import { OrdersToPlan, PlanBoardScreen, Formulations, PlannerData } from './components/planner/PlannerScreens';
import { RollInspectionQueue, Holds, QualityData } from './components/quality/QualityScreens';
import { ReceiveMaterial, IssueLot, RMStockBoard, StoreData } from './components/store/StoreScreens';
import { Orders, SalesCustomers, SalesComplaints, SalesData, EnquiryDesk } from './components/sales/SalesScreens';
import { ReadyToDispatch, DispatchHistory, DispatchData } from './components/dispatch/DispatchScreens';
import { PreventiveSchedule, MachinesBoard, MaintData } from './components/maintenance/MaintenanceScreens';
import RoleDashboard from './components/RoleDashboard';
import ManagementDashboard from './components/ManagementDashboard';
import MachineTasks from './components/MachineTasks';
import { clearMachineQueryFromUrl, readMachineCodeFromLocation } from './lib/machineQr';
import LogbookLedger from './components/LogbookLedger';
import TemplateBuilder from './components/TemplateBuilder';
import { EmployeeDirectory, RolesAccess } from './components/admin/AdminScreens';
import OnboardingPage from './components/OnboardingPage';
import InstallAppButton from './components/InstallAppButton';
import { useMyPermissions } from './lib/queries/admin';
import { useT } from './lib/i18n';

type ModuleType =
  | 'dashboard'
  | 'logbooks'
  | 'orders_to_plan'
  | 'plan_board'
  | 'formulations'
  | 'machine_tasks'
  | 'logbook_templates'
  | 'logbook_ledger'
  | 'roll_queue'
  | 'holds'
  | 'receive'
  | 'issue_lot'
  | 'rm_stock'
  | 'enquiry_desk'
  | 'inquiries'
  | 'quotations'
  | 'orders'
  | 'sales_customers'
  | 'sales_complaints'
  | 'ready'
  | 'dispatch_history'
  | 'preventive'
  | 'machines'
  | 'acl'
  | 'users';

export default function App() {
  const onboardingRoute = typeof window !== 'undefined' && (
    window.location.pathname === '/onboarding' ||
    window.location.hash === '#/onboarding' ||
    new URLSearchParams(window.location.search).get('screen') === 'onboarding'
  );
  const [activeModule, setActiveModule] = useState<ModuleType>('dashboard');
  const [pendingMachineCode, setPendingMachineCode] = useState<string | null>(() => readMachineCodeFromLocation());
  const [logEntryImmersive, setLogEntryImmersive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true,
  );
  const [currentRole, setCurrentRole] = useState<string>(() => {
    const saved = localStorage.getItem('erp_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.role) return normalizeRole(parsed.role);
      } catch (e) {}
    }
    return 'Managing Director';
  });
  // Light theme only — strip any leftover dark class / preference.
  React.useEffect(() => {
    window.document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }, []);

  // Keep desktop sidebar expanded when entering lg+ viewports.
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (mq.matches) setSidebarOpen(true);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Leaving Machine Tasks clears immersive log-entry chrome.
  React.useEffect(() => {
    if (activeModule !== 'machine_tasks') setLogEntryImmersive(false);
  }, [activeModule]);

  const openModule = (id: ModuleType) => {
    setActiveModule(id);
  };

  // Shell state: trace search + Batch Passport, menu filter.
  const [traceQuery, setTraceQuery] = useState('');
  const [menuQuery, setMenuQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => setCollapsedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [passportQuery, setPassportQuery] = useState<string | null>(null);
  const queued = useQueue();
  const t = useT();

  // Start the live simulation ticker once.
  React.useEffect(() => { startSimulation(); }, []);

  // Global lifted state
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [inquiries, setInquiries] = useState<Inquiry[]>(initialInquiries);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>(initialSalesOrders);
  const [productionPlans, setProductionPlans] = useState<ProductionPlan[]>(initialProductionPlans);
  const [templates, setTemplates] = useState<LogbookTemplate[]>(initialLogbookTemplates);
  const [machineLogbooks, setMachineLogbooks] = useState<MachineLogbook[]>(initialMachineLogbooks);
  const [inspections, setInspections] = useState<QualityInspection[]>(initialQualityInspections);
  const [packingRecords, setPackingRecords] = useState<PackingRecord[]>(initialPackingRecords);
  const [inventory, setInventory] = useState<InventoryTransaction[]>(initialInventoryTransactions);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>(initialDispatchRecords);
  const [complaints, setComplaints] = useState<CustomerComplaint[]>(initialCustomerComplaints);
  const [capas, setCapas] = useState<CAPARecord[]>(initialCapaRecords);

  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<{
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    isFirebase?: boolean;
    role?: string;
  } | null>(null); // Always start on the login page — pick a role to begin the flow.

  const lastSavedState = React.useRef<any>(null);

  // Access state lives in accessStore; subscribe so the shell re-renders when the admin
  // changes anything. Bind the signed-in session to its directory employee so a
  // per-employee grant applies to the live session.
  useRoleRules();
  useGrants();
  useDelegations();
  const sessionEmp = employeeForRole(currentRole);
  // When you sign in / switch AS a specific DB employee, their email drives the
  // dev identity (so the server resolves their membership → role → access);
  // otherwise fall back to the role's seeded stand-in.
  const [identityEmail, setIdentityEmail] = useState<string>('');
  const devEmail = identityEmail || sessionEmp?.email || user?.email || '';
  React.useEffect(() => {
    setCurrentEmployee({ employeeId: sessionEmp?.id ?? `role:${currentRole}`, role: currentRole, email: devEmail });
    // Tell the API client who we are (dev identity → the API resolves the
    // matching membership/org/role). Phase 2 replaces this with a Firebase token.
    setDevUser(devEmail);
  }, [currentRole, sessionEmp?.id, user?.email, devEmail]);

  // Floor QR deep-link: keep ?machine= across login, then open Machine Tasks.
  React.useEffect(() => {
    const sync = () => {
      const code = readMachineCodeFromLocation();
      if (code) setPendingMachineCode(code);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const consumeMachineCode = React.useCallback(() => {
    setPendingMachineCode(null);
    clearMachineQueryFromUrl();
  }, []);

  // Log books open from Machine Tasks only — fold any legacy deep-link.
  React.useEffect(() => {
    if (activeModule === 'logbooks') setActiveModule('machine_tasks');
  }, [activeModule]);

  React.useEffect(() => {
    if (!user || !pendingMachineCode) return;
    setActiveModule('machine_tasks');
  }, [user, pendingMachineCode]);

  const getPermissionStatus = (role: string, moduleId: string): boolean => {
    const key = moduleId.includes(':') ? moduleId : `screen:${moduleId}`;
    const emp = role === currentRole ? sessionEmp : undefined;
    return checkFor(role, emp?.email ?? '', emp?.id, key);
  };

  const handleCustomLogin = (session: { uid: string; email: string; displayName: string; role: string; isFirebase: boolean }) => {
    // Signing in AS a specific DB employee (uid emp-…): keep their real role name
    // (may be a custom role) and drive identity by their email. Role tiles keep
    // the legacy normalize + seeded stand-in.
    const isEmp = session.uid.startsWith('emp-');
    const role = isEmp ? session.role : normalizeRole(session.role);
    const normalized = { ...session, role };
    setUser(normalized);
    localStorage.setItem('erp_session', JSON.stringify(normalized));
    setIdentityEmail(isEmp ? session.email : '');
    setCurrentRole(role);
    // Floor QR survives login: land on Machine Tasks instead of the role home.
    const qrMachine = readMachineCodeFromLocation() || pendingMachineCode;
    if (qrMachine) {
      setPendingMachineCode(qrMachine.trim().toUpperCase());
      setActiveModule('machine_tasks');
    } else {
      setActiveModule(homeForRole(role) as ModuleType);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      const csrfRes = await fetch('/auth/csrf', { credentials: 'include' });
      if (csrfRes.ok) {
        const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
        if (csrfToken) {
          await fetch('/auth/signout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ csrfToken, callbackUrl: '/' }),
          });
        }
      }
    } catch (err) {
      console.error('Error signing out:', err);
    }
    setDevUser('');
    setIdentityEmail('');
    setUser(null);
    localStorage.removeItem('erp_session');
  };

  // Restore any Auth.js cookie session on boot.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get<{ user: { userId: string; role: string; email: string; name: string } }>('/me');
        if (cancelled || !me.user) return;
        const session = {
          uid: me.user.userId,
          email: me.user.email,
          displayName: me.user.name,
          isFirebase: false,
          role: me.user.role,
        };
        setUser(session);
        localStorage.setItem('erp_session', JSON.stringify(session));
        setIdentityEmail(me.user.email);
        setDevUser(me.user.email);
        setCurrentRole(me.user.role);
        const qrMachine = readMachineCodeFromLocation();
        if (qrMachine) {
          setPendingMachineCode(qrMachine);
          setActiveModule('machine_tasks');
        } else {
          setActiveModule(homeForRole(me.user.role) as ModuleType);
        }
      } catch {
        // No cookie session — LoginScreen.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch ERP state from the API once signed in (Postgres / legacy blob).
  React.useEffect(() => {
    if (!user) {
      // Allow LoginScreen to render — do not stay on the splash forever.
      setIsLoaded(true);
      return;
    }

    let cancelled = false;
    setIsLoaded(false);
    fetch('/api/data', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /api/data → ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data) {
          if (data.customers) setCustomers(data.customers);
          if (data.inquiries) setInquiries(data.inquiries);
          if (data.salesOrders) setSalesOrders(data.salesOrders);
          if (data.productionPlans) setProductionPlans(data.productionPlans);
          if (data.templates) setTemplates(data.templates);
          if (data.machineLogbooks) setMachineLogbooks(data.machineLogbooks);
          if (data.inspections) setInspections(data.inspections);
          if (data.packingRecords) setPackingRecords(data.packingRecords);
          if (data.inventory) setInventory(data.inventory);
          if (data.dispatches) setDispatches(data.dispatches);
          if (data.complaints) setComplaints(data.complaints);
          if (data.capas) setCapas(data.capas);
          lastSavedState.current = data;
        }
        setIsLoaded(true);
      })
      .catch((err) => {
        console.error('Error fetching backend ERP state, using mock fallback:', err);
        if (!cancelled) setIsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Backend auto-save for legacy /api/data collections still on the blob store.
  React.useEffect(() => {
    if (!isLoaded || !user) return;

    const currentState = {
      customers, inquiries, salesOrders, productionPlans, templates,
      machineLogbooks, inspections, packingRecords, inventory, dispatches,
      complaints, capas,
    };

    const changed: Record<string, unknown> = {};
    if (lastSavedState.current) {
      (Object.keys(currentState) as (keyof typeof currentState)[]).forEach((key) => {
        if (JSON.stringify(currentState[key]) !== JSON.stringify(lastSavedState.current[key])) {
          changed[key] = currentState[key];
        }
      });
    } else {
      Object.assign(changed, currentState);
    }

    if (Object.keys(changed).length === 0) return;

    const saveState = async () => {
      try {
        await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(changed),
        });
        lastSavedState.current = currentState;
      } catch (err) {
        console.error('Failed to sync ERP state to backend:', err);
      }
    };

    const timer = setTimeout(saveState, 1000);
    return () => clearTimeout(timer);
  }, [
    user?.uid,
    isLoaded,
    customers,
    inquiries,
    salesOrders,
    productionPlans,
    templates,
    machineLogbooks,
    inspections,
    packingRecords,
    inventory,
    dispatches,
    complaints,
    capas,
  ]);

  // Switch to a role's seeded stand-in (clears any specific-employee identity).
  const handleRoleSwitch = (role: string) => {
    setIdentityEmail('');
    setCurrentRole(role);
    setActiveModule(homeForRole(role) as ModuleType);
    pushToast(`Now viewing as ${roleInfo(role).user} — ${role}.`);
  };

  // Become a specific DB employee (identity by email → their DB role + access).
  const becomeEmployee = (email: string, role: string, name: string) => {
    setIdentityEmail(email);
    setUser((u) => (u ? { ...u, email, displayName: name, role } : u));
    setCurrentRole(role);
    setActiveModule(homeForRole(role) as ModuleType);
    pushToast(`Now viewing as ${name} — ${role}.`);
  };

  // Navigation schema
  // Full catalog — order matches navGroups NAV_ITEM_ORDER (value chain).
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'sales_customers', label: 'Customers', icon: Users, color: 'text-sky-600' },
    { id: 'enquiry_desk', label: 'Enquiry Desk', icon: Briefcase, color: 'text-emerald-600' },
    { id: 'orders', label: 'Orders', icon: CheckCircle2, color: 'text-blue-600' },
    { id: 'sales_complaints', label: 'Complaints & CAPA', icon: ShieldAlert, color: 'text-rose-600' },
    { id: 'orders_to_plan', label: 'Orders to Plan', icon: Briefcase, color: 'text-indigo-600' },
    { id: 'plan_board', label: 'Production Plan', icon: CalendarDays, color: 'text-teal-600' },
    { id: 'formulations', label: 'Formulations (BOM)', icon: Settings, color: 'text-indigo-600' },
    { id: 'logbook_templates', label: 'Logbook Templates', icon: Settings, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
    { id: 'logbook_ledger', label: 'Logbook Ledger', icon: BookOpen, color: 'text-teal-600' },
    { id: 'roll_queue', label: 'Roll Inspection', icon: CheckCircle2, color: 'text-rose-500' },
    { id: 'holds', label: 'Quality Holds', icon: ShieldAlert, color: 'text-amber-600' },
    { id: 'receive', label: 'Receive Material', icon: Package2, color: 'text-emerald-600' },
    { id: 'issue_lot', label: 'Issue Lot', icon: Gauge, color: 'text-indigo-600' },
    { id: 'rm_stock', label: 'RM Stock', icon: BarChart3, color: 'text-cyan-600' },
    { id: 'ready', label: 'Ready to Dispatch', icon: Truck, color: 'text-emerald-600' },
    { id: 'dispatch_history', label: 'Dispatch History', icon: Clock, color: 'text-slate-500' },
    { id: 'machines', label: 'Machines', icon: Cpu, color: 'text-indigo-600' },
    { id: 'preventive', label: 'Preventive Maintenance', icon: CalendarDays, color: 'text-rose-500' },
    { id: 'users', label: 'People & Roles', icon: Users, color: 'text-indigo-600' },
    { id: 'acl', label: 'Roles & Access', icon: ShieldAlert, color: 'text-rose-600' },
  ];

  // Managing Director — exec overview + read-only drill-downs for queue CTAs.
  const mdNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-sky-600' },
    { id: 'sales_complaints', label: 'Complaints', icon: ShieldAlert, color: 'text-rose-600' },
    { id: 'logbook_ledger', label: 'Logbook Ledger', icon: BookOpen, color: 'text-teal-600' },
    { id: 'roll_queue', label: 'QA Gate', icon: CheckCircle2, color: 'text-rose-500' },
    { id: 'rm_stock', label: 'Stock & Inventory', icon: Package2, color: 'text-cyan-600' },
    { id: 'ready', label: 'Ready to Dispatch', icon: Truck, color: 'text-emerald-600' },
    { id: 'dispatch_history', label: 'Dispatch History', icon: Truck, color: 'text-slate-500' },
  ];
  // Production Planner — planning + machine tasks (log books open from a task).
  const plannerNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'orders_to_plan', label: 'Orders to Plan', icon: Briefcase, color: 'text-indigo-600' },
    { id: 'plan_board', label: 'Production Plan', icon: CalendarDays, color: 'text-teal-600' },
    { id: 'formulations', label: 'Formulations (BOM)', icon: Settings, color: 'text-indigo-600' },
    { id: 'logbook_templates', label: 'Logbook Templates', icon: Settings, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
    { id: 'logbook_ledger', label: 'Logbook Ledger', icon: BookOpen, color: 'text-teal-600' },
  ];
  const operatorNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
    { id: 'logbook_ledger', label: 'Logbook Ledger', icon: BookOpen, color: 'text-teal-600' },
  ];
  const qualityNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'roll_queue', label: 'Roll Inspection Queue', icon: CheckCircle2, color: 'text-rose-500' },
    { id: 'holds', label: 'Holds', icon: ShieldAlert, color: 'text-amber-600' },
  ];
  const storeNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'receive', label: 'Receive Material', icon: Package2, color: 'text-emerald-600' },
    { id: 'issue_lot', label: 'Issue Lot to Machine', icon: Gauge, color: 'text-indigo-600' },
    { id: 'rm_stock', label: 'RM Stock Board', icon: BarChart3, color: 'text-cyan-600' },
  ];
  const salesNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'sales_customers', label: 'Customers', icon: Users, color: 'text-sky-600' },
    { id: 'enquiry_desk', label: 'Enquiry Desk', icon: Briefcase, color: 'text-emerald-600' },
    { id: 'orders', label: 'Orders', icon: CheckCircle2, color: 'text-blue-600' },
    { id: 'sales_complaints', label: 'Complaints', icon: ShieldAlert, color: 'text-rose-600' },
  ];
  const dispatchNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'ready', label: 'Ready to Dispatch', icon: CheckCircle2, color: 'text-emerald-600' },
    { id: 'dispatch_history', label: 'Dispatch History', icon: Clock, color: 'text-slate-500' },
  ];
  const maintNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'machines', label: 'Machines', icon: Cpu, color: 'text-indigo-600' },
    { id: 'preventive', label: 'Preventive Schedule', icon: CalendarDays, color: 'text-indigo-600' },
  ];
  const adminNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'logbook_templates', label: 'Logbook Templates', icon: Settings, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
    { id: 'logbook_ledger', label: 'Logbook Ledger', icon: BookOpen, color: 'text-teal-600' },
    { id: 'users', label: 'People & Roles', icon: Users, color: 'text-indigo-600' },
    { id: 'acl', label: 'Roles & Access', icon: ShieldAlert, color: 'text-rose-600' },
  ];

  const moduleLabel = (id: string): string => {
    const hit = [...navItems, ...mdNavItems, ...plannerNavItems, ...operatorNavItems, ...qualityNavItems, ...storeNavItems, ...salesNavItems, ...dispatchNavItems, ...maintNavItems, ...adminNavItems].find((n) => n.id === id);
    return hit ? hit.label : id;
  };
  const isMD = currentRole === 'Managing Director';
  const isPlanner = currentRole === 'Production Planner';
  const isOperator = currentRole === 'Operator';
  const isQA = currentRole === 'Quality Inspector';
  const isStore = currentRole === 'Store Manager';
  const isSales = currentRole === 'Sales Executive';
  const isDispatch = currentRole === 'Dispatch Executive';
  const isMaint = currentRole === 'Maintenance Head';
  const isAdmin = currentRole === 'Administrator';

  // Surviving screens read from the API via hooks; they only need navigation
  // callbacks, so the legacy data arrays are stubbed empty.
  const nav = (m: string) => setActiveModule(m as ModuleType);
  const noop = () => {};

  // The menu the current role naturally offers…
  // Effective access comes from the server (the actor's DB role ± per-employee
  // grants). The client menu gates on this; while it loads, fall back to the
  // static can() so the menu never flashes empty.
  const myPerms = useMyPermissions(devEmail || currentRole).data;
  const dbAllows = (id: string): boolean => {
    if (id === 'dashboard') return true;
    const has = (screen: string) => (!myPerms ? can(`screen:${screen}`) : myPerms.isAdmin || myPerms.screens.includes(screen));
    if (id === 'enquiry_desk') return has('enquiry_desk') || has('inquiries') || has('quotations');
    if (id === 'inquiries' || id === 'quotations') return has(id) || has('enquiry_desk');
    return has(id);
  };

  const roleNav = isMD ? mdNavItems : isPlanner ? plannerNavItems : isOperator ? operatorNavItems : isQA ? qualityNavItems : isStore ? storeNavItems : isSales ? salesNavItems : isDispatch ? dispatchNavItems : isMaint ? maintNavItems : isAdmin ? adminNavItems : navItems;
  // …kept only where access allows (a disabled screen simply vanishes; Home always stays).
  const visibleNav = roleNav.filter((item) => dbAllows(item.id));
  // …plus any screen granted beyond the role menu (per-employee grants + the re-added
  // modules that a role has by default but its curated menu doesn't list).
  const shownIds = new Set(visibleNav.map((i) => i.id));
  // …plus any DB-allowed renderable screen beyond the role's curated menu (e.g. a
  // per-employee grant), pulled from the full screen catalog for its label/icon.
  // Skip legacy inquiries/quotations — merged into Enquiry Desk.
  const extraNav = navItems.filter((item) =>
    !shownIds.has(item.id)
    && item.id !== 'inquiries'
    && item.id !== 'quotations'
    && dbAllows(item.id),
  );
  const currentNavItems = [...visibleNav, ...extraNav];
  const canViewActive = activeModule === 'dashboard'
    || activeModule === 'enquiry_desk'
    || activeModule === 'inquiries'
    || activeModule === 'quotations'
    || currentNavItems.some((n) => n.id === activeModule)
    || dbAllows(activeModule);
  const homeModule = homeForRole(currentRole) as ModuleType;
  const bestTraceTarget = (query: string): ModuleType => {
    const q = query.trim().toLowerCase();
    if (!q) return activeModule;
    if (q.startsWith('inq')) return 'enquiry_desk';
    if (q.startsWith('so')) return 'orders';
    if (q.startsWith('capa') || q.startsWith('compl') || q.startsWith('cmp')) return 'sales_complaints';
    if (q.startsWith('inv') || q.startsWith('gp')) return 'dispatch_history';
    if (q.startsWith('lot') || q.startsWith('roll') || q.startsWith('r-')) return 'roll_queue';
    if (q.startsWith('m0') || q.startsWith('mc') || q.includes('machine')) return 'machine_tasks';
    return activeModule;
  };
  const handleTraceOpen = (query: string) => {
    const clean = query.trim();
    if (!clean) return;
    setTraceQuery(clean);
    setPassportQuery(clean);
    const target = bestTraceTarget(clean);
    if (dbAllows(target)) {
      setActiveModule(target);
      return;
    }
    if (dbAllows(homeModule)) setActiveModule(homeModule);
  };
  const salesData: SalesData = { inquiries: [], setInquiries: noop, salesOrders: [], setSalesOrders: noop, complaints: [], setComplaints: noop, customers: [], setCustomers: noop, onOpen: nav, onTrace: handleTraceOpen };
  const plannerData: PlannerData = { salesOrders: [], setSalesOrders: noop, productionPlans: [], setProductionPlans: noop, customers: [], onOpen: nav, onTrace: handleTraceOpen };
  const qualityData: QualityData = { onOpen: nav, onTrace: handleTraceOpen };
  const storeData: StoreData = { onOpen: nav, onTrace: handleTraceOpen };
  const dispatchData: DispatchData = { onOpen: nav, onTrace: handleTraceOpen };
  const maintData: MaintData = { onOpen: nav, onTrace: handleTraceOpen, user: roleInfo(currentRole).user };

  // Onboarding is a separate portal: always show its own login/console, even if
  // another ERP session is already active in this browser.
  if (onboardingRoute) {
    return <OnboardingPage onLogin={handleCustomLogin} />;
  }

  // Prefer login over the splash when there is no session yet.
  if (!user) {
    return (
      <LoginScreen
        onLogin={handleCustomLogin}
      />
    );
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans gap-4" id="applet-loading">
        <Logo className="h-12 w-12" />
        <div className="space-y-1 text-center">
          <h3 className="font-extrabold text-slate-900 text-base">MesaDesk</h3>
          {/* <p className="text-xs text-slate-500 font-medium">One Platform. Every Operation.</p> */}
        </div>
      </div>
    );
  }

  const showSidebarLabels = sidebarOpen;

  return (
    <div className="h-screen overflow-hidden bg-slate-50 flex" id="applet-root">
      {/* SIDEBAR — lg+ desktop; mobile uses bottom nav + More sheet */}
      <aside
        data-md-sidebar
        className={`md-sidebar ${logEntryImmersive ? 'hidden' : 'hidden lg:flex'} bg-white text-slate-600 flex-col transition-all duration-300 shrink-0 ${
          sidebarOpen ? 'w-[260px]' : 'w-20'
        }`}
      >
        {/* Brand lockup */}
        <div className={`min-h-12 flex items-center gap-2.5 border-b border-slate-200 ${showSidebarLabels ? 'px-3' : 'justify-center px-0'}`}>
          <button
            onClick={() => { if (!sidebarOpen) setSidebarOpen(true); }}
            className={`shrink-0 ${showSidebarLabels ? 'cursor-default' : 'cursor-pointer hover:opacity-80 transition-opacity'}`}
            title={showSidebarLabels ? 'MesaDesk' : 'Expand menu'}
            aria-label={showSidebarLabels ? 'MesaDesk' : 'Expand menu'}
          >
            <Logo className="h-8 w-8" />
          </button>
          {showSidebarLabels && (
            <>
              <div className="min-w-0">
                <h1 className="font-extrabold text-slate-900 tracking-tight text-[15px] leading-none">MesaDesk</h1>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="ml-auto p-1.5 min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        <nav className="flex-1 py-2 px-2.5 overflow-y-auto">
          {showSidebarLabels && (
            <div className="relative mb-2">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={menuQuery}
                onChange={(e) => setMenuQuery(e.target.value)}
                placeholder="Search menu"
                className="w-full pl-8 pr-2.5 h-9 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-600"
              />
            </div>
          )}
          {(() => {
            const q = menuQuery.trim().toLowerCase();
            const filtered = q ? currentNavItems.filter((i) => i.label.toLowerCase().includes(q)) : currentNavItems;
            const groups = groupNav(filtered);
            if (groups.length === 0) {
              return showSidebarLabels ? <div className="px-3 py-4 text-xs text-slate-500">No menu item matches “{menuQuery}”.</div> : null;
            }
            return groups.map(({ step, items }, gi) => {
              const collapsed = showSidebarLabels && !q && collapsedGroups.has(step.key);
              return (
              <div key={step.key} className={gi > 0 ? (showSidebarLabels ? 'mt-2' : 'mt-1 pt-1 border-t border-slate-200') : ''}>
                {showSidebarLabels && (
                  <button onClick={() => toggleGroup(step.key)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 transition-colors" aria-expanded={!collapsed}>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                    <span className="flex-1 text-left truncate">{step.label}</span>
                    <span className="text-[10px] font-medium text-slate-400 tabular-nums">{items.length}</span>
                  </button>
                )}
                {!collapsed && (
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeModule === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => openModule(item.id as ModuleType)}
                        className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium tracking-wide transition-colors ${showSidebarLabels ? '' : 'justify-center'} ${
                          isActive
                            ? 'bg-sky-50 text-sky-700'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                        title={item.label}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {showSidebarLabels && <span className="truncate">{t(item.label)}</span>}
                      </button>
                    );
                  })}
                </div>
                )}
              </div>
              );
            })
          })()}
        </nav>

        <div className="p-2.5 border-t border-slate-200 text-xs">
          {user && (
            showSidebarLabels ? (
              <div className="flex items-center gap-2 rounded-xl p-1.5 bg-slate-50 border border-slate-200">
                <div className="h-8 w-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white text-[11px] shrink-0">
                  {(roleInfo(currentRole).user || 'U').split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 text-xs leading-tight truncate">{user?.displayName || roleInfo(currentRole).user}</p>
                  <span className="text-[10px] text-slate-500 truncate block">{currentRole} · Shift {roleInfo(currentRole).shift}</span>
                </div>
                <button onClick={handleSignOut} className="p-1.5 min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer" title="Sign out" aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-8 w-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white text-[11px]" title={`${roleInfo(currentRole).user} · ${currentRole}`}>
                  {(roleInfo(currentRole).user || 'U').split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                </div>
                <button onClick={handleSignOut} className="p-1.5 min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" title="Sign out" aria-label="Sign out">
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Flat top bar — hidden during immersive log entry */}
        {!logEntryImmersive && (
        <header className="min-h-12 bg-white border-b border-slate-200 px-3 lg:px-5 flex items-center justify-between shrink-0 gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:inline-flex p-1.5 min-h-9 min-w-9 items-center justify-center rounded-lg hover:bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-700 shrink-0"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
            <div className="lg:hidden shrink-0">
              <Logo className="h-8 w-8" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] sm:text-base font-bold text-slate-900 truncate leading-tight">
                {moduleLabel(activeModule)}
              </h2>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 text-xs font-medium shrink-0">
            <div className="hidden sm:flex flex-col items-end leading-tight pr-1">
              <span className="font-medium text-slate-800 text-[12px]">{user?.displayName || roleInfo(currentRole).user}</span>
              <span className="text-[10px] text-slate-500">{currentRole} · Shift {roleInfo(currentRole).shift}</span>
            </div>

            {queued.length > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium">
                <Clock className="h-3.5 w-3.5" /> {queued.length} waiting to send
              </span>
            )}

            <InstallAppButton compact />
          </div>
        </header>
        )}

        <OfflineBanner />
        <PracticeBanner />

        <main className={`flex-1 overflow-y-auto overflow-x-hidden ${
          logEntryImmersive
            ? 'p-0 lg:p-6'
            : 'p-4 lg:p-6 pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-6'
        }`}>
          {!canViewActive ? (
            <section
              id="acl-redirect"
              className="max-w-3xl mx-auto mt-8 rounded-xl border border-slate-200 bg-white overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-800 border border-amber-100">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-2xl font-bold text-slate-900">
                  {pendingMachineCode
                    ? `No access to log machine ${pendingMachineCode}`
                    : 'This page isn\'t available in your current access view'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {pendingMachineCode
                    ? 'Your role cannot open Machine Tasks. Ask an admin for access, or sign in as an operator.'
                    : 'Choose a destination below instead of being redirected automatically.'}
                </p>
              </div>
              <div className="px-6 py-5 space-y-5">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingMachineCode) consumeMachineCode();
                      setActiveModule(homeModule);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 min-h-11 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                  >
                    <Compass className="h-4 w-4" />
                    Go to {moduleLabel(homeModule)}
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Requested screen</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {pendingMachineCode ? `Machine QR · ${pendingMachineCode}` : moduleLabel(activeModule)}
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <>
              {activeModule === 'dashboard' && (
                isMD ? (
                  <ManagementDashboard
                    userName={user?.displayName || roleInfo(currentRole).user}
                    onOpen={(m) => setActiveModule(m as ModuleType)}
                    onTrace={handleTraceOpen}
                    passportQuery={passportQuery}
                  />
                ) : (
                  <RoleDashboard
                    role={currentRole}
                    userName={user?.displayName || roleInfo(currentRole).user}
                    canAccess={dbAllows}
                    onOpen={(m) => setActiveModule(m as ModuleType)}
                    onScanMachine={(code) => {
                      setPendingMachineCode(code.trim().toUpperCase());
                      setActiveModule('machine_tasks');
                    }}
                  />
                )
              )}

              {/* Planning & Production (API) */}
              {activeModule === 'orders_to_plan' && <OrdersToPlan {...plannerData} />}
              {activeModule === 'plan_board' && <PlanBoardScreen {...plannerData} />}
              {activeModule === 'formulations' && <Formulations {...plannerData} />}
              {activeModule === 'machine_tasks' && (
                <MachineTasks
                  initialMachineCode={pendingMachineCode}
                  onMachineCodeConsumed={consumeMachineCode}
                  onImmersiveChange={setLogEntryImmersive}
                />
              )}
              {activeModule === 'logbook_ledger' && <LogbookLedger />}
              {activeModule === 'logbook_templates' && <TemplateBuilder />}

              {/* Quality (API) */}
              {activeModule === 'roll_queue' && <RollInspectionQueue {...qualityData} />}
              {activeModule === 'holds' && <Holds {...qualityData} />}

              {/* Store / Inventory (API) */}
              {activeModule === 'receive' && <ReceiveMaterial {...storeData} />}
              {activeModule === 'issue_lot' && <IssueLot {...storeData} />}
              {activeModule === 'rm_stock' && <RMStockBoard {...storeData} />}

              {/* Sales (API) */}
              {activeModule === 'enquiry_desk' && <EnquiryDesk {...salesData} />}
              {activeModule === 'inquiries' && <EnquiryDesk {...salesData} initialTab="enquiries" />}
              {activeModule === 'quotations' && <EnquiryDesk {...salesData} initialTab="quotes" />}
              {activeModule === 'orders' && <Orders {...salesData} />}
              {activeModule === 'sales_customers' && <SalesCustomers {...salesData} />}
              {activeModule === 'sales_complaints' && <SalesComplaints {...salesData} />}

              {/* Dispatch (API) */}
              {activeModule === 'ready' && <ReadyToDispatch {...dispatchData} />}
              {activeModule === 'dispatch_history' && <DispatchHistory {...dispatchData} />}

              {/* Maintenance (API) */}
              {activeModule === 'machines' && <MachinesBoard {...maintData} />}
              {activeModule === 'preventive' && <PreventiveSchedule {...maintData} />}

              {/* Admin — People & Roles + Roles & Access (API) */}
              {activeModule === 'users' && <EmployeeDirectory />}
              {activeModule === 'acl' && <RolesAccess />}
            </>
          )}
        </main>

        {!logEntryImmersive && (
        <MobileBottomNav
          items={currentNavItems}
          activeModule={activeModule}
          onOpen={(id) => openModule(id as ModuleType)}
          userName={user?.displayName || roleInfo(currentRole).user}
          roleLabel={`${currentRole} · Shift ${roleInfo(currentRole).shift}`}
          onSignOut={handleSignOut}
        />
        )}

      </div>

      {/* Global shell overlays */}
      <ToastHost />
      {!logEntryImmersive && (
        <RoleSwitcher current={currentRole} currentEmail={devEmail} onSelectEmployee={becomeEmployee} />
      )}

    </div>
  );
}
