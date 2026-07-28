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
  FileSpreadsheet,
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
  Sun,
  Moon,
  Gauge,
  LogOut,
  Search,
  Globe,
  ChevronDown,
  ArrowRight,
  ChevronsLeft
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
import LogbookModule from './components/LogbookModule';
import LoginScreen from './components/LoginScreen';
import Logo from './components/Logo';
import { setCurrentEmployee, useRoleRules, useGrants, useDelegations, checkFor, can, grantState } from './lib/accessStore';
import { employeeForRole, employeeForEmail } from './lib/userStore';
import { setDevUser } from './lib/apiIdentity';
import { api, ApiError } from './lib/apiClient';
import { FEATURES, ROLE_DEFAULT_SCREENS, stripScreen } from './lib/accessCatalog';
import { groupNav, relatedOf } from './lib/navGroups';
import { roleInfo, themeForRole, homeForRole, normalizeRole } from './lib/roles';
import { ToastHost, pushToast } from './components/Notify';
import { RoleSwitcher } from './components/RoleSwitcher';
import { OfflineBanner, PracticeBanner } from './components/Banners';
import { startSimulation } from './lib/simulation';
import { useQueue } from './lib/offline';
import { OrdersToPlan, PlanBoardScreen, Formulations, PlannerData } from './components/planner/PlannerScreens';
import { RollInspectionQueue, Holds, QualityData } from './components/quality/QualityScreens';
import { ReceiveMaterial, IssueLot, RMStockBoard, StoreData } from './components/store/StoreScreens';
import { Inquiries, Quotations, Orders, SalesCustomers, SalesComplaints, SalesData } from './components/sales/SalesScreens';
import { ReadyToDispatch, DispatchHistory, DispatchData } from './components/dispatch/DispatchScreens';
import { PreventiveSchedule, MaintData } from './components/maintenance/MaintenanceScreens';
import RoleDashboard from './components/RoleDashboard';
import MachineTasks from './components/MachineTasks';
import TemplateBuilder from './components/TemplateBuilder';
import { EmployeeDirectory, RolesAccess } from './components/admin/AdminScreens';
import { useMyPermissions } from './lib/queries/admin';
import { useLang, setLang, useT } from './lib/i18n';

// Firebase imports
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signOut } from './firebase';
import { clearSessionToken } from './lib/apiIdentity';
import { fetchFromFirestore, saveToFirestore } from './lib/firebaseSync';

type ModuleType =
  | 'dashboard'
  | 'customers'
  | 'sales'
  | 'planning'
  | 'manufacturing'
  | 'logbooks'
  | 'template_builder'
  | 'quality'
  | 'inventory'
  | 'dispatch'
  | 'capa'
  | 'reports'
  | 'migration'
  | 'orders_to_plan'
  | 'plan_board'
  | 'formulations'
  | 'machine_tasks'
  | 'logbook_templates'
  | 'machine_capacity'
  | 'material_availability'
  | 'hourly_grid'
  | 'raise_breakdown'
  | 'shift_summary'
  | 'incoming'
  | 'roll_queue'
  | 'holds'
  | 'disposal_regrind'
  | 'calibration'
  | 'receive'
  | 'issue_lot'
  | 'rm_stock'
  | 'fg_putaway'
  | 'regrind_lots'
  | 'inquiries'
  | 'quotations'
  | 'orders'
  | 'sales_customers'
  | 'sales_complaints'
  | 'ready'
  | 'gate_pass'
  | 'vehicles_today'
  | 'dispatch_history'
  | 'breakdowns'
  | 'preventive'
  | 'downtime'
  | 'machine_history'
  | 'calibration_reg'
  | 'plant_overview'
  | 'quality_memory'
  | 'management_review'
  | 'acl'
  | 'users';

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  // Theme is a global user preference now (top toggle), persisted and applied to
  // every screen. New light-first guideline is the default until the user chooses.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'light';
  });

  React.useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Shell state: trace search + Batch Passport, language, bell dropdown.
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
  const lang = useLang();
  const t = useT();

  // Theme no longer follows the role — the user's choice from the top toggle wins
  // globally and persists across roles and sessions (see the theme state above).

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
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');

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
    // Land each role on its own home (theme + menu follow via role state).
    setActiveModule(homeForRole(role) as ModuleType);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Error signing out:', err);
    }
    clearSessionToken();
    setUser(null);
    localStorage.removeItem('erp_session');
  };

  // Monitor Auth State
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Bind federated identity to a directory employee by email. Role comes
        // from the server membership when /api/me succeeds; client lookup is a
        // UX hint only until that resolves.
        const email = (u.email || '').toLowerCase();
        const emp = employeeForEmail(email);
        const resolvedRole = emp ? emp.role : 'Operator';
        const session = {
          uid: u.uid,
          email,
          displayName: u.displayName || emp?.name || 'Signed-in user',
          photoURL: u.photoURL || undefined,
          isFirebase: true,
          role: resolvedRole,
        };
        setUser(session);
        localStorage.setItem('erp_session', JSON.stringify(session));
        setIdentityEmail(email);
        setDevUser(email);
        setCurrentRole(resolvedRole);
        setActiveModule(homeForRole(resolvedRole) as ModuleType);

        // Prefer the server's membership role/screens once the Bearer token works.
        try {
          const me = await api.get<{ user: { role: string; email: string; name: string } }>('/me');
          if (me.user?.role) {
            setCurrentRole(me.user.role);
            setUser((prev) => prev ? { ...prev, role: me.user.role, displayName: me.user.name || prev.displayName } : prev);
            setActiveModule(homeForRole(me.user.role) as ModuleType);
          }
        } catch (err) {
          const code = err instanceof ApiError ? err.code : (err as { code?: string })?.code;
          if (code === 'no_membership' || code === 'inactive') {
            pushToast(`Signed in as ${email || 'this account'}, but there is no active People directory membership. Ask an administrator to add you.`);
          } else if (!emp) {
            pushToast(`Signed in as ${email || 'an unrecognized account'} — no directory match yet. An administrator can add you in People & Roles.`);
          }
        }
      } else {
        setUser(prev => {
          if (prev?.isFirebase) {
            localStorage.removeItem('erp_session');
            setIdentityEmail('');
            setDevUser('');
            return null;
          }
          return prev;
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch initial ERP state (Firestore if authenticated, fallback JSON database if not)
  React.useEffect(() => {
    if (!user || !user.isFirebase) {
      setIsLoaded(false);
      fetch('/api/data')
        .then(res => res.json())
        .then(data => {
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
          }
          setIsLoaded(true);
        })
        .catch(err => {
          console.error('Error fetching backend ERP state, using mock fallback:', err);
          setIsLoaded(true);
        });
      return;
    }

    setIsLoaded(false);
    setSyncStatus('syncing');
    fetchFromFirestore()
      .then(({ data, hasData }) => {
        if (hasData) {
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
          setSyncStatus('success');
        } else {
          console.log('[Firestore] Empty DB. Initializing cloud storage with current local state...');
          const currentState = {
            customers, inquiries, salesOrders, productionPlans, templates,
            machineLogbooks, inspections, packingRecords, inventory, dispatches,
            complaints, capas
          };
          saveToFirestore(currentState, Object.keys(currentState))
            .then(() => {
              lastSavedState.current = currentState;
              setSyncStatus('success');
            })
            .catch(err => {
              console.error('[Firestore] Error initializing cloud storage:', err);
              setSyncStatus('error');
            });
        }
        setIsLoaded(true);
      })
      .catch(err => {
        console.error('Error fetching from Firestore:', err);
        setSyncStatus('error');
        setIsLoaded(true);
      });
  }, [user?.uid, user?.isFirebase]);

  // Client-side Firestore auto-save (Only when signed in)
  React.useEffect(() => {
    if (!isLoaded || !user || !user.isFirebase) return;

    const currentState = {
      customers, inquiries, salesOrders, productionPlans, templates,
      machineLogbooks, inspections, packingRecords, inventory, dispatches,
      complaints, capas
    };

    const changed: string[] = [];
    if (lastSavedState.current) {
      Object.keys(currentState).forEach((key) => {
        if (JSON.stringify((currentState as any)[key]) !== JSON.stringify(lastSavedState.current[key])) {
          changed.push(key);
        }
      });
    } else {
      changed.push(...Object.keys(currentState));
    }

    if (changed.length === 0) return;

    const save = async () => {
      setSyncStatus('syncing');
      try {
        await saveToFirestore(currentState, changed);
        lastSavedState.current = currentState;
        setSyncStatus('success');
      } catch (err) {
        console.error('Error auto-saving to Firestore:', err);
        setSyncStatus('error');
      }
    };

    const timer = setTimeout(save, 1000);
    return () => clearTimeout(timer);
  }, [
    user?.uid, user?.isFirebase, isLoaded, customers, inquiries, salesOrders, productionPlans,
    templates, machineLogbooks, inspections, packingRecords, inventory,
    dispatches, complaints, capas
  ]);

  // Backend fallback auto-save (Only when NOT signed in via Google)
  React.useEffect(() => {
    if (!isLoaded || (user && user.isFirebase)) return;

    const currentState = {
      customers, inquiries, salesOrders, productionPlans, templates,
      machineLogbooks, inspections, packingRecords, inventory, dispatches,
      complaints, capas,
    };

    // Send ONLY the collections that changed since the last successful save.
    // The server merges incoming keys onto a fresh read of the store, so a
    // client that hasn't touched (say) `customers` no longer overwrites another
    // client's concurrent customer edits — this closes the cross-user clobber.
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
    user?.isFirebase,
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
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'inquiries', label: 'Inquiries', icon: Briefcase, color: 'text-emerald-600' },
    { id: 'quotations', label: 'Quotations', icon: FileSpreadsheet, color: 'text-indigo-600' },
    { id: 'orders', label: 'Orders', icon: CheckCircle2, color: 'text-blue-600' },
    { id: 'sales_customers', label: 'Customers', icon: Users, color: 'text-sky-600' },
    { id: 'sales_complaints', label: 'Complaints & CAPA', icon: ShieldAlert, color: 'text-rose-600' },
    { id: 'orders_to_plan', label: 'Orders to Plan', icon: Briefcase, color: 'text-indigo-600' },
    { id: 'plan_board', label: 'Production Plan', icon: CalendarDays, color: 'text-teal-600' },
    { id: 'formulations', label: 'Formulations (BOM)', icon: Settings, color: 'text-indigo-600' },
    { id: 'logbook_templates', label: 'Logbook Templates', icon: Settings, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
    { id: 'logbooks', label: 'Production (LOG BOOK)', icon: FileSpreadsheet, color: 'text-amber-600' },
    { id: 'roll_queue', label: 'Roll Inspection', icon: CheckCircle2, color: 'text-rose-500' },
    { id: 'holds', label: 'Quality Holds', icon: ShieldAlert, color: 'text-amber-600' },
    { id: 'receive', label: 'Receive Material', icon: Package2, color: 'text-emerald-600' },
    { id: 'issue_lot', label: 'Issue Lot', icon: Gauge, color: 'text-indigo-600' },
    { id: 'rm_stock', label: 'RM Stock', icon: BarChart3, color: 'text-cyan-600' },
    { id: 'ready', label: 'Ready to Dispatch', icon: Truck, color: 'text-emerald-600' },
    { id: 'dispatch_history', label: 'Dispatch History', icon: Clock, color: 'text-slate-500' },
    { id: 'preventive', label: 'Preventive Maintenance', icon: CalendarDays, color: 'text-rose-500' },
    { id: 'users', label: 'People & Roles', icon: Users, color: 'text-indigo-600' },
    { id: 'acl', label: 'Roles & Access', icon: ShieldAlert, color: 'text-rose-600' },
  ];

  // Managing Director — real read-only exec: dashboard KPIs + read-only boards.
  const mdNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'rm_stock', label: 'Stock & Inventory', icon: Package2, color: 'text-cyan-600' },
    { id: 'dispatch_history', label: 'Dispatch History', icon: Truck, color: 'text-slate-500' },
  ];
  // Production Planner — Planning (incl. logbook templates) + Production (incl. machine tasks / log books).
  const plannerNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'orders_to_plan', label: 'Orders to Plan', icon: Briefcase, color: 'text-indigo-600' },
    { id: 'plan_board', label: 'Production Plan', icon: CalendarDays, color: 'text-teal-600' },
    { id: 'formulations', label: 'Formulations (BOM)', icon: Settings, color: 'text-indigo-600' },
    { id: 'logbook_templates', label: 'Logbook Templates', icon: Settings, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
    { id: 'logbooks', label: 'Production (LOG BOOK)', icon: FileSpreadsheet, color: 'text-amber-600' },
  ];
  const operatorNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
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
    { id: 'inquiries', label: 'Inquiries', icon: Briefcase, color: 'text-emerald-600' },
    { id: 'quotations', label: 'Quotations', icon: FileSpreadsheet, color: 'text-indigo-600' },
    { id: 'orders', label: 'Orders', icon: CheckCircle2, color: 'text-blue-600' },
    { id: 'sales_customers', label: 'Customers', icon: Users, color: 'text-sky-600' },
    { id: 'sales_complaints', label: 'Complaints', icon: ShieldAlert, color: 'text-rose-600' },
  ];
  const dispatchNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'ready', label: 'Ready to Dispatch', icon: CheckCircle2, color: 'text-emerald-600' },
    { id: 'dispatch_history', label: 'Dispatch History', icon: Clock, color: 'text-slate-500' },
  ];
  const maintNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'preventive', label: 'Preventive Schedule', icon: CalendarDays, color: 'text-indigo-600' },
  ];
  const adminNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600' },
    { id: 'users', label: 'People & Roles', icon: Users, color: 'text-indigo-600' },
    { id: 'acl', label: 'Roles & Access', icon: ShieldAlert, color: 'text-rose-600' },
    { id: 'logbook_templates', label: 'Logbook Templates', icon: Settings, color: 'text-indigo-600' },
    { id: 'machine_tasks', label: 'Machine Tasks', icon: Gauge, color: 'text-amber-600' },
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
  const salesData: SalesData = { inquiries: [], setInquiries: noop, salesOrders: [], setSalesOrders: noop, complaints: [], setComplaints: noop, customers: [], setCustomers: noop, onOpen: nav, onTrace: noop };
  const plannerData: PlannerData = { salesOrders: [], setSalesOrders: noop, productionPlans: [], setProductionPlans: noop, customers: [], onOpen: nav, onTrace: noop };
  const qualityData: QualityData = { onOpen: nav, onTrace: noop };
  const storeData: StoreData = { onOpen: nav, onTrace: noop };
  const dispatchData: DispatchData = { onOpen: nav, onTrace: noop };
  const maintData: MaintData = { onOpen: nav, onTrace: noop, user: roleInfo(currentRole).user };

  // The menu the current role naturally offers…
  // Effective access comes from the server (the actor's DB role ± per-employee
  // grants). The client menu gates on this; while it loads, fall back to the
  // static can() so the menu never flashes empty.
  const myPerms = useMyPermissions(devEmail || currentRole).data;
  const dbAllows = (id: string): boolean => {
    if (id === 'dashboard') return true;
    if (!myPerms) return can(`screen:${id}`);
    return myPerms.isAdmin || myPerms.screens.includes(id);
  };

  const roleNav = isMD ? mdNavItems : isPlanner ? plannerNavItems : isOperator ? operatorNavItems : isQA ? qualityNavItems : isStore ? storeNavItems : isSales ? salesNavItems : isDispatch ? dispatchNavItems : isMaint ? maintNavItems : isAdmin ? adminNavItems : navItems;
  // …kept only where access allows (a disabled screen simply vanishes; Home always stays).
  const visibleNav = roleNav.filter((item) => dbAllows(item.id));
  // …plus any screen granted beyond the role menu (per-employee grants + the re-added
  // modules that a role has by default but its curated menu doesn't list).
  const shownIds = new Set(visibleNav.map((i) => i.id));
  // …plus any DB-allowed renderable screen beyond the role's curated menu (e.g. a
  // per-employee grant), pulled from the full screen catalog for its label/icon.
  const extraNav = navItems.filter((item) => !shownIds.has(item.id) && dbAllows(item.id));
  const currentNavItems = [...visibleNav, ...extraNav];
  const canViewActive = activeModule === 'dashboard' || currentNavItems.some((n) => n.id === activeModule) || dbAllows(activeModule);

  // Landing on a screen you can't open falls back Home — no restricted wall (Q6).
  React.useEffect(() => {
    if (!canViewActive) setActiveModule('dashboard');
  }, [canViewActive]);

  const handleActiveTabFromDashboard = (tab: string) => {
    const t = tab.toLowerCase();
    if (t.includes('crm') || t.includes('cust')) {
      setActiveModule('customers');
    } else if (t.includes('sale') || t.includes('order')) {
      setActiveModule('sales');
    } else if (t.includes('plan') || t.includes('alloc')) {
      setActiveModule('planning');
    } else if (t.includes('bom') || t.includes('oee') || t.includes('recipe') || t.includes('standard')) {
      setActiveModule('manufacturing');
    } else if (t.includes('template') || t.includes('builder')) {
      setActiveModule('template_builder');
    } else if (t.includes('log') || t.includes('extru')) {
      setActiveModule('logbooks');
    } else if (t.includes('qual') || t.includes('pack')) {
      setActiveModule('quality');
    } else if (t.includes('inven') || t.includes('stock')) {
      setActiveModule('inventory');
    } else if (t.includes('disp') || t.includes('logis')) {
      setActiveModule('dispatch');
    } else if (t.includes('compl') || t.includes('capa')) {
      setActiveModule('capa');
    } else if (t.includes('rep') || t.includes('bi')) {
      setActiveModule('reports');
    } else if (t.includes('migr') || t.includes('excel')) {
      setActiveModule('migration');
    } else if (t.includes('acl') || t.includes('security') || t.includes('permission')) {
      setActiveModule('acl');
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans gap-4" id="applet-loading">
        <div className="animate-bounce">
          <Logo className="h-12 w-12 rounded-xl shadow-lg shadow-indigo-600/30" />
        </div>
        <div className="space-y-1 text-center">
          <h3 className="font-display font-extrabold text-white text-sm uppercase tracking-widest">MASS POLIMER</h3>
          <p className="text-xs text-slate-500 font-bold">Synchronizing Terminal Records...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLogin={handleCustomLogin}
        theme={theme}
        onSetTheme={setTheme}
      />
    );
  }

  return (
    <div className={`h-screen overflow-hidden bg-slate-50 flex ${theme === 'dark' ? 'dark' : ''}`} id="applet-root">
      
      {/* SIDEBAR NAVIGATION PANEL */}
      <aside 
        className={`bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 flex flex-col transition-all duration-300 border-r border-slate-200 dark:border-slate-800 shrink-0 ${
          sidebarOpen ? 'w-64' : 'w-20'
        }`}
      >
        {/* LOGO FRAME — logo + name + collapse toggle when open; only the logo when collapsed */}
        <div className={`h-16 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 ${sidebarOpen ? 'px-4' : 'justify-center px-0'}`}>
          <button
            onClick={() => { if (!sidebarOpen) setSidebarOpen(true); }}
            className={`shrink-0 rounded-lg ${sidebarOpen ? 'cursor-default' : 'cursor-pointer hover:opacity-80 transition-opacity'}`}
            title={sidebarOpen ? 'Mass Polimer' : 'Expand menu'}
            aria-label={sidebarOpen ? 'Mass Polimer' : 'Expand menu'}
          >
            <Logo className="h-9 w-9 rounded-lg shadow-xs" />
          </button>
          {sidebarOpen && (
            <>
              <div className="min-w-0">
                <h1 className="font-display font-bold text-slate-800 dark:text-white tracking-tight text-sm leading-none">Mass Polimer</h1>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold tracking-wider uppercase">ERP Suite</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors shrink-0"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* NAVIGATION SYSTEM */}
        <nav className="flex-1 py-3 px-3 overflow-y-auto">
          {sidebarOpen && (
            <div className="relative mb-2">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={menuQuery}
                onChange={(e) => setMenuQuery(e.target.value)}
                placeholder="Search menu"
                className="w-full pl-8 pr-3 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
              />
            </div>
          )}
          {(() => {
            const q = menuQuery.trim().toLowerCase();
            const filtered = q ? currentNavItems.filter((i) => i.label.toLowerCase().includes(q)) : currentNavItems;
            const groups = groupNav(filtered);
            if (groups.length === 0) {
              return sidebarOpen ? <div className="px-3 py-4 text-xs text-slate-400">No menu item matches “{menuQuery}”.</div> : null;
            }
            return groups.map(({ step, items }, gi) => {
              // Collapsible only when the sidebar is open and not searching (search shows all).
              const collapsed = sidebarOpen && !q && collapsedGroups.has(step.key);
              return (
              <div key={step.key} className={gi > 0 ? (sidebarOpen ? 'mt-2.5' : 'mt-1 pt-1 border-t border-slate-100 dark:border-slate-800') : ''}>
                {sidebarOpen && (
                  <button onClick={() => toggleGroup(step.key)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 transition-colors" aria-expanded={!collapsed}>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                    <span className="flex-1 text-left truncate">{step.label}</span>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tabular-nums">{items.length}</span>
                  </button>
                )}
                {!collapsed && (
                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeModule === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveModule(item.id as ModuleType)}
                        className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${sidebarOpen ? '' : 'justify-center'} ${
                          isActive
                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                            : 'text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                        title={item.label}
                      >
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-current" aria-hidden="true" />}
                        <Icon className={`h-4.5 w-4.5 shrink-0 transition-colors ${isActive ? '' : 'text-slate-500 dark:text-slate-400'}`} />
                        {sidebarOpen && <span className="truncate">{t(item.label)}</span>}
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

        {/* PROFILE BAR */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs">
          {user && (
            sidebarOpen ? (
              <div className="flex items-center gap-2.5 rounded-xl p-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-3xs">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center font-bold text-white text-[11px] shrink-0 shadow-sm">
                  {(roleInfo(currentRole).user || 'U').split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-xs leading-tight truncate">{user?.displayName || roleInfo(currentRole).user}</p>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block">{currentRole} · Shift {roleInfo(currentRole).shift}</span>
                </div>
                <button onClick={handleSignOut} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors shrink-0 cursor-pointer" title="Sign out" aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center font-bold text-white text-[11px] shadow-sm" title={`${roleInfo(currentRole).user} · ${currentRole}`}>
                  {(roleInfo(currentRole).user || 'U').split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                </div>
                <button onClick={handleSignOut} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer" title="Sign out" aria-label="Sign out">
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          )}
        </div>
      </aside>

      {/* CORE MODULE CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* HEADER BAR — floating pill */}
        <header className="h-16 bg-white border border-slate-200 px-4 sm:px-6 flex items-center justify-between shadow-md shrink-0 gap-3 m-3 sm:m-4 rounded-full">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-full hover:bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-700 shrink-0"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
            <div className="text-xs hidden lg:block truncate">
              <span className="text-slate-400 font-medium">Mass Polimer ERP</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="font-bold text-slate-800 uppercase tracking-wider">
                {moduleLabel(activeModule)}
              </span>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 text-xs font-semibold shrink-0">
            <div className="hidden sm:flex flex-col items-end leading-tight pr-1">
              <span className="font-bold text-slate-800 text-[12px]">{user?.displayName || roleInfo(currentRole).user}</span>
              <span className="text-[10px] text-slate-500">{currentRole} · Shift {roleInfo(currentRole).shift}</span>
            </div>

            <div className="hidden sm:flex items-center rounded-lg border border-slate-200 overflow-hidden">
              {(['EN', 'KN', 'HI'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-2 py-1.5 text-[10px] font-bold ${lang === l ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  {l}
                </button>
              ))}
            </div>

            {queued.length > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold">
                <Clock className="h-3.5 w-3.5" /> {queued.length} waiting to send
              </span>
            )}


            {/* Global light / dark switch — applies to every screen, persists */}
            <div
              className="flex items-center gap-0.5 p-0.5 rounded-full border border-slate-200 bg-slate-50 shrink-0"
              role="group"
              aria-label="Theme"
            >
              <button
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
                title="Light theme"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'bg-white text-indigo-600 shadow-sm border border-slate-200'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Sun className="h-3.5 w-3.5" /> <span className="hidden md:inline">Light</span>
              </button>
              <button
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
                title="Dark theme"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Moon className="h-3.5 w-3.5" /> <span className="hidden md:inline">Dark</span>
              </button>
            </div>
          </div>
        </header>

        <OfflineBanner />
        <PracticeBanner />

        {/* PRIMARY SCROLL VIEW */}
        <main className="flex-1 overflow-y-auto p-6">
          {!canViewActive ? (
            <div className="text-center text-sm text-slate-400 mt-16" id="acl-redirect">Taking you home…</div>
          ) : (
            <>
              {/* Quick links — suppressed on sales screens (they use an in-page pipeline tab bar). */}
              {(() => {
                const salesScreens = new Set(['inquiries', 'quotations', 'orders', 'sales_customers', 'sales_complaints']);
                if (salesScreens.has(activeModule)) return null;
                const rel = relatedOf(activeModule).filter((id) => id !== activeModule && getPermissionStatus(currentRole, id));
                if (rel.length === 0) return null;
                const labelOf = (id: string) => FEATURES.find((f) => f.key === `screen:${id}`)?.label ?? moduleLabel(id as ModuleType);
                return (
                  <div className="flex flex-wrap items-center gap-2 mb-4" id="related-links">
                    <span className="text-[11px] font-medium text-slate-400">Related</span>
                    {rel.map((id) => (
                      <button
                        key={id}
                        onClick={() => setActiveModule(id as ModuleType)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-slate-100 transition-all"
                      >
                        {labelOf(id)} <ArrowRight className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                );
              })()}

              {activeModule === 'dashboard' && (
                <RoleDashboard role={currentRole} onOpen={(m) => setActiveModule(m as ModuleType)} />
              )}

              {/* Manufacturing — Production LOG BOOK (API) */}
              {activeModule === 'logbooks' && (
                <LogbookModule
                  templates={[]}
                  setTemplates={() => {}}
                  machineLogbooks={[]}
                  setMachineLogbooks={() => {}}
                  productionPlans={[]}
                  salesOrders={[]}
                  initialTab="operator"
                />
              )}

              {/* Planning (API) */}
              {activeModule === 'orders_to_plan' && <OrdersToPlan {...plannerData} />}
              {activeModule === 'plan_board' && <PlanBoardScreen {...plannerData} />}
              {activeModule === 'formulations' && <Formulations {...plannerData} />}

              {/* Quality (API) */}
              {activeModule === 'roll_queue' && <RollInspectionQueue {...qualityData} />}
              {activeModule === 'holds' && <Holds {...qualityData} />}

              {/* Store / Inventory (API) */}
              {activeModule === 'receive' && <ReceiveMaterial {...storeData} />}
              {activeModule === 'issue_lot' && <IssueLot {...storeData} />}
              {activeModule === 'rm_stock' && <RMStockBoard {...storeData} />}

              {/* Sales (API) */}
              {activeModule === 'inquiries' && <Inquiries {...salesData} />}
              {activeModule === 'quotations' && <Quotations {...salesData} />}
              {activeModule === 'orders' && <Orders {...salesData} />}
              {activeModule === 'sales_customers' && <SalesCustomers {...salesData} />}
              {activeModule === 'sales_complaints' && <SalesComplaints {...salesData} />}

              {/* Dispatch (API) */}
              {activeModule === 'ready' && <ReadyToDispatch {...dispatchData} />}
              {activeModule === 'dispatch_history' && <DispatchHistory {...dispatchData} />}

              {/* Maintenance (API) */}
              {activeModule === 'preventive' && <PreventiveSchedule {...maintData} />}

              {/* Machine Tasks (operator logging entry) + Template builder (admin) */}
              {activeModule === 'machine_tasks' && <MachineTasks />}
              {activeModule === 'logbook_templates' && <TemplateBuilder />}

              {/* Admin — People & Roles + Roles & Access (API) */}
              {activeModule === 'users' && <EmployeeDirectory />}
              {activeModule === 'acl' && <RolesAccess />}
            </>
          )}
        </main>

      </div>

      {/* Global shell overlays */}
      <ToastHost />
      <RoleSwitcher current={currentRole} currentEmail={devEmail} onSelectEmployee={becomeEmployee} />

    </div>
  );
}
