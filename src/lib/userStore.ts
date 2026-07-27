/**
 * userStore.ts — the Employee Directory the Administrator manages. Each employee holds
 * identity + posting (department, shift, line) + a status, and exactly one role (which
 * seeds their default access). CRUD + role assignment persist to localStorage. Shared via
 * useSyncExternalStore so every screen updates live.
 *
 * Status vs access: `active` = normal; `on_leave` = keeps access, just flagged;
 * `inactive` = sign-in suspended. Only `inactive` blocks login.
 */

import { useSyncExternalStore } from 'react';
import { pushToast } from '../components/Notify';
import { ROLES, RoleName, roleInfo } from './roles';

export type EmpStatus = 'active' | 'on_leave' | 'inactive';
export type Department =
  | 'Management' | 'Administration' | 'Sales' | 'Production'
  | 'Quality' | 'Stores' | 'Dispatch' | 'Maintenance';

export interface Employee {
  id: string;
  employeeCode: string;   // EMP-0xx
  name: string;
  email: string;
  phone: string;
  department: Department;
  role: RoleName;
  shift: 'D' | 'N';
  line: string;           // machine e.g. 'M08', or '—'
  status: EmpStatus;
  joinDate: string;       // 'YYYY-MM'
  location: string;
  lastSeen: string;
}
// Back-compat alias.
export type DirUser = Employee;

export const DEPARTMENT_FOR_ROLE: Record<string, Department> = {
  'Owner': 'Management',
  'Managing Director': 'Management',
  'Administrator': 'Administration',
  'Sales Executive': 'Sales',
  'Production Planner': 'Production',
  'Operator': 'Production',
  'Quality Inspector': 'Quality',
  'Store Manager': 'Stores',
  'Dispatch Executive': 'Dispatch',
  'Maintenance Head': 'Maintenance'
};

const seed: Employee[] = [
  { id: 'u1', employeeCode: 'EMP-001', name: 'Madan Lal', email: 'madan.lal@masspolymer.in', phone: '+91 98860 10001', department: 'Management', role: 'Managing Director', shift: 'D', line: '—', status: 'active', joinDate: '2016-04', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u2', employeeCode: 'EMP-002', name: 'Deepak Bansal', email: 'deepak.bansal@masspolymer.in', phone: '+91 98860 10002', department: 'Administration', role: 'Administrator', shift: 'D', line: '—', status: 'active', joinDate: '2018-07', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u19', employeeCode: 'EMP-019', name: 'Vikram Malhotra', email: 'vikram.malhotra@masspolymer.in', phone: '+91 98860 10019', department: 'Management', role: 'Owner', shift: 'D', line: '—', status: 'active', joinDate: '2015-01', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u3', employeeCode: 'EMP-003', name: 'Amit Verma', email: 'amit.verma@masspolymer.in', phone: '+91 98860 10003', department: 'Sales', role: 'Sales Executive', shift: 'D', line: '—', status: 'active', joinDate: '2019-02', location: 'Bengaluru', lastSeen: 'today, 10:20' },
  { id: 'u4', employeeCode: 'EMP-004', name: 'Kavya Reddy', email: 'kavya.reddy@masspolymer.in', phone: '+91 98860 10004', department: 'Sales', role: 'Sales Executive', shift: 'D', line: '—', status: 'active', joinDate: '2021-09', location: 'Bengaluru', lastSeen: 'today, 09:40' },
  { id: 'u5', employeeCode: 'EMP-005', name: 'Sneha Rao', email: 'sneha.rao@masspolymer.in', phone: '+91 98860 10005', department: 'Production', role: 'Production Planner', shift: 'D', line: '—', status: 'active', joinDate: '2017-11', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u6', employeeCode: 'EMP-006', name: 'Latha Menon', email: 'latha.menon@masspolymer.in', phone: '+91 98860 10006', department: 'Production', role: 'Production Planner', shift: 'D', line: '—', status: 'on_leave', joinDate: '2020-03', location: 'Bengaluru', lastSeen: '6 days ago' },
  { id: 'u7', employeeCode: 'EMP-007', name: 'Nandlal', email: 'nandlal@masspolymer.in', phone: '+91 98860 10007', department: 'Production', role: 'Operator', shift: 'N', line: 'M08', status: 'active', joinDate: '2019-06', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u8', employeeCode: 'EMP-008', name: 'Ganesh Pai', email: 'ganesh.pai@masspolymer.in', phone: '+91 98860 10008', department: 'Production', role: 'Operator', shift: 'N', line: 'M05', status: 'active', joinDate: '2022-01', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u9', employeeCode: 'EMP-009', name: 'Rohit Yadav', email: 'rohit.yadav@masspolymer.in', phone: '+91 98860 10009', department: 'Production', role: 'Operator', shift: 'D', line: 'M03', status: 'inactive', joinDate: '2018-08', location: 'Bengaluru', lastSeen: 'left the company' },
  { id: 'u10', employeeCode: 'EMP-010', name: 'Nitesh Kumar', email: 'nitesh.kumar@masspolymer.in', phone: '+91 98860 10010', department: 'Quality', role: 'Quality Inspector', shift: 'D', line: '—', status: 'active', joinDate: '2019-05', location: 'Bengaluru', lastSeen: 'today, 09:05' },
  { id: 'u11', employeeCode: 'EMP-011', name: 'Priya Nair', email: 'priya.nair@masspolymer.in', phone: '+91 98860 10011', department: 'Quality', role: 'Quality Inspector', shift: 'D', line: '—', status: 'active', joinDate: '2021-04', location: 'Bengaluru', lastSeen: 'today, 07:55' },
  { id: 'u12', employeeCode: 'EMP-012', name: 'Farhan Ali', email: 'farhan.ali@masspolymer.in', phone: '+91 98860 10012', department: 'Quality', role: 'Quality Inspector', shift: 'N', line: '—', status: 'on_leave', joinDate: '2020-10', location: 'Bengaluru', lastSeen: '2 days ago' },
  { id: 'u13', employeeCode: 'EMP-013', name: 'Ravi Shankar', email: 'ravi.shankar@masspolymer.in', phone: '+91 98860 10013', department: 'Stores', role: 'Store Manager', shift: 'D', line: '—', status: 'active', joinDate: '2017-02', location: 'Bengaluru', lastSeen: 'today, 08:40' },
  { id: 'u14', employeeCode: 'EMP-014', name: 'Meena Kulkarni', email: 'meena.kulkarni@masspolymer.in', phone: '+91 98860 10014', department: 'Stores', role: 'Store Manager', shift: 'D', line: '—', status: 'active', joinDate: '2022-06', location: 'Bengaluru', lastSeen: 'yesterday' },
  { id: 'u15', employeeCode: 'EMP-015', name: 'Pankaj Singh', email: 'pankaj.singh@masspolymer.in', phone: '+91 98860 10015', department: 'Dispatch', role: 'Dispatch Executive', shift: 'D', line: '—', status: 'active', joinDate: '2019-12', location: 'Bengaluru', lastSeen: 'yesterday' },
  { id: 'u16', employeeCode: 'EMP-016', name: 'Salim Shaikh', email: 'salim.shaikh@masspolymer.in', phone: '+91 98860 10016', department: 'Dispatch', role: 'Dispatch Executive', shift: 'N', line: '—', status: 'active', joinDate: '2021-07', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u17', employeeCode: 'EMP-017', name: 'Suresh Kumar', email: 'suresh.kumar@masspolymer.in', phone: '+91 98860 10017', department: 'Maintenance', role: 'Maintenance Head', shift: 'D', line: '—', status: 'active', joinDate: '2016-09', location: 'Bengaluru', lastSeen: 'on shift now' },
  { id: 'u18', employeeCode: 'EMP-018', name: 'Anil Kapoor', email: 'anil.kapoor@masspolymer.in', phone: '+91 98860 10018', department: 'Maintenance', role: 'Maintenance Head', shift: 'N', line: '—', status: 'active', joinDate: '2020-05', location: 'Bengaluru', lastSeen: 'on shift now' }
];

const LS = 'mp_employees';
function load(): Employee[] {
  try { const raw = localStorage.getItem(LS); return raw ? (JSON.parse(raw) as Employee[]) : seed; } catch { return seed; }
}
function persist(): void { try { localStorage.setItem(LS, JSON.stringify(users)); } catch { /* ignore */ } }

let users: Employee[] = load();
let nextId = users.length + 1;

const subs = new Set<() => void>();
const emit = (): void => subs.forEach((s) => s());
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const snap = (): Employee[] => users;

export function useUsers(): Employee[] { return useSyncExternalStore(subscribe, snap, snap); }
export function getEmployees(): Employee[] { return users; }
export function getEmployee(id: string): Employee | undefined { return users.find((u) => u.id === id); }

export const ASSIGNABLE_ROLES: RoleName[] = ROLES.map((r) => r.role);
export const canSignIn = (e: Employee): boolean => e.status !== 'inactive';

// The seeded employee currently standing in for a role (binds the session to a person).
export function employeeForRole(role: string): Employee | undefined {
  return users.find((u) => u.role === role && canSignIn(u)) ?? users.find((u) => u.role === role);
}

// Resolve the directory employee for a signed-in email. Used to bind a federated
// (Google) identity to a real directory role instead of trusting a hardcoded one.
// Returns undefined for unknown or deactivated accounts.
export function employeeForEmail(email: string): Employee | undefined {
  const e = (email || '').trim().toLowerCase();
  if (!e) return undefined;
  return users.find((u) => u.email.toLowerCase() === e && canSignIn(u));
}

export function roleCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  users.forEach((u) => { if (u.status !== 'inactive') out[u.role] = (out[u.role] ?? 0) + 1; });
  return out;
}

export function assignRole(id: string, role: RoleName): void {
  const u = users.find((x) => x.id === id);
  if (!u || u.role === role) return;
  const from = u.role;
  users = users.map((x) => (x.id === id ? { ...x, role, department: DEPARTMENT_FOR_ROLE[role] ?? x.department } : x));
  persist();
  pushToast(`${u.name} moved from ${from} to ${role}. They get ${role} access on next sign-in.`);
  emit();
}

export function setStatus(id: string, status: EmpStatus): void {
  const u = users.find((x) => x.id === id);
  if (!u) return;
  users = users.map((x) => (x.id === id ? { ...x, status } : x));
  persist();
  const msg = status === 'active' ? 'is active again' : status === 'on_leave' ? 'is marked on leave (access kept)' : 'is deactivated — sign-in suspended';
  pushToast(`${u.name} ${msg}.`);
  emit();
}

export function updateEmployee(id: string, patch: Partial<Employee>): void {
  users = users.map((x) => (x.id === id ? { ...x, ...patch } : x));
  persist();
  emit();
}

export function addEmployee(input: Omit<Employee, 'id' | 'employeeCode' | 'lastSeen' | 'department'> & { department?: Department }): Employee {
  const id = `u${nextId++}`;
  const code = `EMP-${String(users.length + 1).padStart(3, '0')}`;
  const emp: Employee = {
    ...input,
    id,
    employeeCode: code,
    department: input.department ?? DEPARTMENT_FOR_ROLE[input.role] ?? 'Production',
    lastSeen: 'not signed in yet'
  };
  users = [...users, emp];
  persist();
  pushToast(`${emp.name} added as ${emp.role}. ${emp.role} access provisioned.`);
  emit();
  return emp;
}

// Reset the directory to seed (used by demo controls if needed).
export function resetEmployees(): void { users = seed.map((e) => ({ ...e })); persist(); emit(); }
