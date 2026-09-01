/**
 * AdminScreens.tsx — Administrator's People & Roles (employee directory) and
 * Roles & Access (custom roles + per-employee overrides). Fully API-backed
 * (src/mesaops/lib/queries/admin.ts); access is enforced server-side from these rows.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Users, Plus, ShieldAlert, Trash2, KeyRound, Pencil, Factory, Ban } from 'lucide-react';
import { pushToast } from '@shared/components/Notify';
import { EmptyState } from '@shared/components/EmptyState';
import { DataTable } from '@shared/components/DataTable';
import ResponsiveOverlay from '@shared/components/ui/ResponsiveOverlay';
import { StatusBadge } from '@shared/components/ui/StatusBadge';
import { ApiError } from '@shared/lib/apiClient';
import {
  useEmployees, useRoles, useCreateEmployee, useUpdateEmployee, useCreateRole, useUpdateRole,
  useDeleteRole, useScreenCatalog, useEmployeeGrants, useSetGrants, useMesaOpsRoleAssignments,
  useCreateMesaOpsRoleAssignment, useRevokeMesaOpsRoleAssignment,
  type ApiEmployee, type ApiRole, type ApiMesaOpsRoleAssignment,
} from '@mesaops/lib/queries/admin';

const SCREEN_LABEL: Record<string, string> = {
  dashboard: 'Dashboard', enquiry_desk: 'Enquiry Desk', inquiries: 'Inquiries', quotations: 'Quotations', orders: 'Orders',
  sales_customers: 'Customers', sales_complaints: 'Complaints & CAPA', orders_to_plan: 'Orders to Plan',
  plan_board: 'Production Plan', formulations: 'Formulations (BOM)', logbooks: 'Log Book (via Machine Tasks)',
  machine_tasks: 'Machine Tasks', logbook_templates: 'Logbook Templates', logbook_ledger: 'Logbook Ledger',
  roll_queue: 'Roll Inspection', holds: 'Quality Holds', receive: 'Receive Material', issue_lot: 'Issue Lot',
  rm_stock: 'RM Stock', ready: 'Ready to Dispatch', dispatch_history: 'Dispatch History',
  machines: 'Machines', preventive: 'Preventive Maintenance', users: 'People & Roles', acl: 'Roles & Access',
};
const label = (s: string) => SCREEN_LABEL[s] ?? s;
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
const STATUSES = ['active', 'on_leave', 'inactive'];
const MESAOPS_PLANT_ACCESS_ROLE_NAME = 'MesaOps Plant Access';

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</div>{right}</div>
      {children}
    </div>
  );
}
const inCls = 'w-full min-h-[40px] px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200';
const roleBadge = (r: string, admin?: boolean) => (
  <StatusBadge tone={admin ? 'info' : 'neutral'}>{r}</StatusBadge>
);
const btn = 'inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shrink-0';

/* ============================================================ Employee Directory */

export function EmployeeDirectory() {
  const empQ = useEmployees();
  const rolesQ = useRoles();
  const employees = empQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const employeeRoles = roles.filter((role) => role.name !== MESAOPS_PLANT_ACCESS_ROLE_NAME);
  const update = useUpdateEmployee();
  const [showAdd, setShowAdd] = useState(false);
  const [access, setAccess] = useState<ApiEmployee | null>(null);

  const patch = (e: ApiEmployee, p: Record<string, string>) =>
    update.mutate({ id: e.id, patch: p }, { onError: (err) => pushToast(errMsg(err)) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">People &amp; Roles</h2>
        <button onClick={() => setShowAdd(true)} className={btn}><Plus className="w-4 h-4" /> Add employee</button>
      </div>
      <DataTable
        title={`${employees.length} employees`}
        loading={empQ.isLoading}
        rows={employees}
        rowKey={(e) => e.id}
        empty={<EmptyState icon={<Users className="w-8 h-8" />} title="No employees yet." />}
        dense
        columns={[
          { key: 'emp', header: 'Employee', cell: (e) => (
            <div><div className="font-bold">{e.user.name}</div><div className="text-[11px] text-slate-500">{e.user.email} · {e.department}</div></div>
          ) },
          { key: 'code', header: 'Code', className: 'font-mono text-[11px] text-slate-500', cell: (e) => e.employeeCode },
          { key: 'role', header: 'Role', cell: (e) => (
            <select value={e.roleId ?? ''} onChange={(ev) => patch(e, { roleId: ev.target.value })} className="text-[12px] bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1">
              {employeeRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          ) },
          { key: 'status', header: 'Status', cell: (e) => (
            <select value={e.status} onChange={(ev) => patch(e, { status: ev.target.value })} className="text-[12px] bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1">
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          ) },
          { key: 'access', header: 'Access', align: 'right', cell: (e) => (
            <button onClick={() => setAccess(e)} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs font-bold"><KeyRound className="w-3.5 h-3.5" /> Access</button>
          ) },
        ]}
      />
      {showAdd && <AddEmployeeModal roles={employeeRoles} onClose={() => setShowAdd(false)} />}
      {access && <AccessModal employee={access} roles={employeeRoles} onClose={() => setAccess(null)} />}
    </div>
  );
}

function AddEmployeeModal({ roles, onClose }: { roles: ApiRole[]; onClose: () => void }) {
  const create = useCreateEmployee();
  const [f, setF] = useState({ name: '', email: '', department: '', roleId: roles[0]?.id ?? '', shift: 'D' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.name.trim() && /.+@.+/.test(f.email) && f.roleId;
  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate({ name: f.name.trim(), email: f.email.trim(), roleId: f.roleId, department: f.department.trim() || undefined, shift: f.shift },
      { onSuccess: (e) => { pushToast(`${e.user.name} added as ${e.role} (${e.employeeCode}).`); onClose(); }, onError: (e) => pushToast(errMsg(e)) });
  };
  return (
    <Modal title="Add an employee" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Full name"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Anita Sharma" className={inCls} /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="name@company.com" className={inCls} /></Field>
        <Field label="Role"><select value={f.roleId} onChange={(e) => set('roleId', e.target.value)} className={inCls}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Department"><input value={f.department} onChange={(e) => set('department', e.target.value)} placeholder="(defaults to role)" className={inCls} /></Field>
        <Field label="Shift"><select value={f.shift} onChange={(e) => set('shift', e.target.value)} className={inCls}><option value="D">Day</option><option value="N">Night</option></select></Field>
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} disabled={!valid || create.isPending} label="Add employee" />
    </Modal>
  );
}

function AccessModal({ employee, roles, onClose }: { employee: ApiEmployee; roles: ApiRole[]; onClose: () => void }) {
  const catalogQ = useScreenCatalog();
  const grantsQ = useEmployeeGrants(employee.id);
  const setGrants = useSetGrants();
  const role = roles.find((r) => r.id === employee.roleId);
  const base = new Set(role?.screens ?? []);
  const screens = catalogQ.data ?? [];
  // per-screen override state: 'inherit' | 'on' | 'off' (seeded from saved grants)
  const [ov, setOv] = useState<Record<string, 'inherit' | 'on' | 'off'>>({});
  const grants = grantsQ.data ?? [];
  const stateOf = (s: string): 'inherit' | 'on' | 'off' => ov[s] ?? (grants.find((g) => g.screen === s)?.state ?? 'inherit');
  const effective = (s: string) => { const st = stateOf(s); return st === 'on' ? true : st === 'off' ? false : base.has(s); };

  const save = () => {
    const merged: Record<string, 'inherit' | 'on' | 'off'> = {};
    for (const s of screens) merged[s] = stateOf(s);
    const payload = screens.filter((s) => merged[s] !== 'inherit').map((s) => ({ screen: s, state: merged[s] as 'on' | 'off' }));
    setGrants.mutate({ id: employee.id, grants: payload }, { onSuccess: () => { pushToast(`Access updated for ${employee.user.name}.`); onClose(); }, onError: (e) => pushToast(errMsg(e)) });
  };

  return (
    <Modal title={`Access · ${employee.user.name}`} onClose={onClose} wide>
      <p className="text-[12px] text-slate-500 -mt-1">Role <b>{role?.name ?? employee.role}</b> sets the baseline; override any screen for just this person.</p>
      {role?.isAdmin ? (
        <div className="text-[12px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mt-2">This role has full access to every screen — per-screen overrides don't apply.</div>
      ) : (
        <div className="mt-2 max-h-[55vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {screens.map((s) => {
            const st = stateOf(s); const on = effective(s);
            return (
              <div key={s} className="flex items-center gap-2 py-1.5">
                <div className="flex-1 min-w-0"><span className={`text-[13px] font-semibold ${on ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>{label(s)}</span> {base.has(s) && <span className="text-[9px] text-slate-400">· in role</span>}</div>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-bold">
                  {(['inherit', 'on', 'off'] as const).map((opt) => (
                    <button key={opt} onClick={() => setOv((p) => ({ ...p, [s]: opt }))}
                      className={`px-2 py-1 rounded-md ${st === opt ? (opt === 'on' ? 'bg-emerald-600 text-white' : opt === 'off' ? 'bg-rose-600 text-white' : 'bg-slate-600 text-white') : 'text-slate-400'}`}>
                      {opt === 'inherit' ? 'Inherit' : opt === 'on' ? 'Grant' : 'Deny'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!role?.isAdmin && <ModalActions onClose={onClose} onSubmit={save} disabled={setGrants.isPending} label="Save access" />}
    </Modal>
  );
}

/* ============================================================ Roles & Access */

export function RolesAccess() {
  const rolesQ = useRoles();
  const employeesQ = useEmployees();
  const assignmentsQ = useMesaOpsRoleAssignments();
  const roles = rolesQ.data ?? [];
  const employees = employeesQ.data ?? [];
  const assignments = assignmentsQ.data ?? [];
  const del = useDeleteRole();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ApiRole | null>(null);
  const [showPlantAssignment, setShowPlantAssignment] = useState(false);
  const [revoking, setRevoking] = useState<ApiMesaOpsRoleAssignment | null>(null);

  const remove = (r: ApiRole) => {
    if (!window.confirm(`Delete the "${r.name}" role?`)) return;
    del.mutate(r.id, { onSuccess: () => pushToast(`Role "${r.name}" deleted.`), onError: (e) => pushToast(errMsg(e)) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Roles &amp; Access</h2>
        <button onClick={() => setShowAdd(true)} className={btn}><Plus className="w-4 h-4" /> Add role</button>
      </div>
      <DataTable
        title={`${roles.length} roles`}
        loading={rolesQ.isLoading}
        rows={roles}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={<ShieldAlert className="w-8 h-8" />} title="No roles yet." />}
        columns={[
          { key: 'name', header: 'Role', cell: (r) => (
            <div className="flex items-center gap-2">{roleBadge(r.name, r.isAdmin)} {r.isSystem && <span className="text-[9px] font-bold text-slate-400 uppercase">built-in</span>}</div>
          ) },
          { key: 'access', header: 'Access', cell: (r) => r.isAdmin ? 'Full access' : `${r.screens.length} screen(s)` },
          { key: 'members', header: 'Employees', align: 'right', cell: (r) => r._count?.memberships ?? 0 },
          { key: 'act', header: '', align: 'right', className: 'whitespace-nowrap', cell: (r) => (
            <div className="inline-flex items-center gap-1.5">
              {r.name !== MESAOPS_PLANT_ACCESS_ROLE_NAME && <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 text-xs font-bold"><Pencil className="w-3.5 h-3.5" /> Edit</button>}
              {!r.isSystem && <button onClick={() => remove(r)} className="text-slate-400 hover:text-rose-600 p-1" title="Delete role"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ) },
        ]}
      />
      <Card
        title="MesaPlant plant scope"
        right={<button type="button" onClick={() => setShowPlantAssignment(true)} disabled={!employees.length || !roles.length} className={btn}><Plus className="w-4 h-4" /> Assign plant access</button>}
      >
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">
          Machine plans, logbooks, QA, stores and dispatch stay inside MesaPlant. Plant access is explicit and default-deny: assign one or more plant codes, or deliberately leave the plant blank to grant all plants.
        </div>
        {assignmentsQ.isLoading ? <p className="py-6 text-center text-sm text-slate-500">Loading plant assignments…</p> : assignments.length ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="min-w-[780px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-950"><tr><th className="px-3 py-2.5">Employee</th><th className="px-3 py-2.5">Role</th><th className="px-3 py-2.5">Plant scope</th><th className="px-3 py-2.5">Validity</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{assignments.map((assignment) => <tr key={assignment.id} className="align-top"><td className="px-3 py-3"><p className="font-bold text-slate-900 dark:text-white">{assignment.membership.user.name}</p><p className="mt-0.5 text-[11px] text-slate-500">{assignment.membership.user.email}</p></td><td className="px-3 py-3">{assignment.role.name}</td><td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-indigo-700"><Factory className="h-3.5 w-3.5" />{assignment.plantCode ?? 'ALL PLANTS'}</span></td><td className="px-3 py-3 text-xs text-slate-500">{assignment.validFrom ? new Date(assignment.validFrom).toLocaleString() : 'Immediate'}<br />to {assignment.validTo ? new Date(assignment.validTo).toLocaleString() : 'open-ended'}</td><td className="px-3 py-3"><StatusBadge tone={assignment.status === 'active' ? 'success' : 'neutral'}>{assignment.status}</StatusBadge>{assignment.revocationReason && <p className="mt-1 max-w-48 text-[10px] text-slate-500">{assignment.revocationReason}</p>}</td><td className="px-3 py-3 text-right">{assignment.status === 'active' && <button type="button" onClick={() => setRevoking(assignment)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-rose-200 px-2.5 text-xs font-bold text-rose-700 hover:bg-rose-50"><Ban className="h-3.5 w-3.5" /> Revoke</button>}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <EmptyState icon={<Factory className="w-8 h-8" />} title="No plant assignments." hint="MesaPlant workflows remain unavailable until an administrator assigns a plant or explicit all-plants access." />}
      </Card>
      {showAdd && <RoleModal onClose={() => setShowAdd(false)} />}
      {editing && <RoleModal role={editing} onClose={() => setEditing(null)} />}
      {showPlantAssignment && <PlantAssignmentModal employees={employees} roles={roles} onClose={() => setShowPlantAssignment(false)} />}
      {revoking && <RevokePlantAssignmentModal assignment={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}

function PlantAssignmentModal({ employees, roles, onClose }: { employees: ApiEmployee[]; roles: ApiRole[]; onClose: () => void }) {
  const create = useCreateMesaOpsRoleAssignment();
  const [requestKey] = useState(() => `mesaops-plant-assignment:${crypto.randomUUID()}`);
  const [form, setForm] = useState({ membershipId: employees[0]?.id ?? '', roleId: roles[0]?.id ?? '', plantCode: '', validFrom: '', validTo: '' });
  const validWindow = !form.validFrom || !form.validTo || form.validTo >= form.validFrom;
  const submit = () => {
    if (!form.membershipId || !form.roleId || !validWindow || create.isPending) return;
    create.mutate({
      requestKey,
      input: {
        membershipId: form.membershipId,
        roleId: form.roleId,
        plantCode: form.plantCode.trim() ? form.plantCode.trim().toUpperCase() : null,
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
        validTo: form.validTo ? new Date(form.validTo).toISOString() : null,
      },
    }, { onSuccess: () => { pushToast('MesaPlant plant access assigned.'); onClose(); }, onError: (error) => pushToast(errMsg(error)) });
  };
  return <Modal title="Assign MesaPlant plant access" onClose={onClose} wide>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Employee"><select aria-label="Plant assignment employee" className={inCls} value={form.membershipId} onChange={(event) => setForm({ ...form, membershipId: event.target.value })}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.user.name} · {employee.employeeCode}</option>)}</select></Field>
      <Field label="Operational role"><select aria-label="Plant assignment role" className={inCls} value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>
      <Field label="Plant code"><input aria-label="Plant code" className={inCls} value={form.plantCode} onChange={(event) => setForm({ ...form, plantCode: event.target.value })} placeholder="Blank means all plants" /></Field>
      <div className="hidden sm:block" />
      <Field label="Valid from (optional)"><input aria-label="Plant access valid from" type="datetime-local" className={inCls} value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} /></Field>
      <Field label="Valid to (optional)"><input aria-label="Plant access valid to" type="datetime-local" className={inCls} value={form.validTo} onChange={(event) => setForm({ ...form, validTo: event.target.value })} /></Field>
    </div>
    {!validWindow && <p role="alert" className="text-xs font-semibold text-rose-700">Valid to must be on or after valid from.</p>}
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"><strong>Scope change.</strong> This creates an explicit MesaPlant assignment. For this employee, unlisted plants will be denied unless an all-plants assignment is also active.</div>
    <ModalActions onClose={onClose} onSubmit={submit} disabled={!form.membershipId || !form.roleId || !validWindow || create.isPending} label="Assign access" />
  </Modal>;
}

function RevokePlantAssignmentModal({ assignment, onClose }: { assignment: ApiMesaOpsRoleAssignment; onClose: () => void }) {
  const revoke = useRevokeMesaOpsRoleAssignment();
  const [requestKey] = useState(() => `mesaops-plant-revoke:${crypto.randomUUID()}`);
  const [reason, setReason] = useState('');
  const submit = () => {
    if (reason.trim().length < 3 || revoke.isPending) return;
    revoke.mutate({ assignmentId: assignment.id, expectedVersion: assignment.rowVersion, reason: reason.trim(), requestKey }, {
      onSuccess: () => { pushToast('MesaPlant plant access revoked.'); onClose(); },
      onError: (error) => pushToast(errMsg(error)),
    });
  };
  return <Modal title={`Revoke plant access · ${assignment.membership.user.name}`} onClose={onClose}>
    <p className="text-sm leading-6 text-slate-600">Remove <strong>{assignment.role.name}</strong> access for <strong>{assignment.plantCode ?? 'all plants'}</strong>. Existing audit and production evidence remains unchanged.</p>
    <Field label="Revocation reason"><textarea aria-label="Plant access revocation reason" className={`${inCls} min-h-24 resize-y`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this scope is ending" /></Field>
    <ModalActions onClose={onClose} onSubmit={submit} disabled={reason.trim().length < 3 || revoke.isPending} label="Revoke access" />
  </Modal>;
}

function RoleModal({ role, onClose }: { role?: ApiRole; onClose: () => void }) {
  const catalogQ = useScreenCatalog();
  const create = useCreateRole();
  const update = useUpdateRole();
  const screens = catalogQ.data ?? [];
  const [name, setName] = useState(role?.name ?? '');
  const [sel, setSel] = useState<Set<string>>(new Set(role?.screens ?? []));
  const toggle = (s: string) => setSel((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const valid = name.trim() !== '';

  const submit = () => {
    const list = [...sel];
    if (role) {
      update.mutate({ id: role.id, patch: { name: name.trim(), screens: list } },
        { onSuccess: () => { pushToast(`Role "${name.trim()}" saved.`); onClose(); }, onError: (e) => pushToast(errMsg(e)) });
    } else {
      create.mutate({ name: name.trim(), screens: list },
        { onSuccess: () => { pushToast(`Role "${name.trim()}" created.`); onClose(); }, onError: (e) => pushToast(errMsg(e)) });
    }
  };

  return (
    <Modal title={role ? `Edit role · ${role.name}` : 'Add a role'} onClose={onClose} wide>
      <Field label="Role name"><input value={name} onChange={(e) => setName(e.target.value)} disabled={role?.isSystem} placeholder="e.g. Night QA Lead" className={inCls} /></Field>
      {role?.isAdmin ? (
        <div className="text-[12px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mt-3">This is a full-access role — it can open every screen.</div>
      ) : (
        <div className="mt-3">
          <div className="text-[11px] font-bold text-slate-500 mb-1">Screens this role can open</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-[50vh] overflow-y-auto">
            {screens.filter((s) => s !== 'dashboard').map((s) => (
              <label key={s} className={`flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-lg border cursor-pointer ${sel.has(s) ? 'border-indigo-400 bg-indigo-50/60 text-indigo-800' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                <input type="checkbox" checked={sel.has(s)} onChange={() => toggle(s)} /> {label(s)}
              </label>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Dashboard is always available. Actions inherit from their screen.</p>
        </div>
      )}
      <ModalActions onClose={onClose} onSubmit={submit} disabled={!valid || create.isPending || update.isPending} label={role ? 'Save role' : 'Create role'} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ shared modal bits */

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <ResponsiveOverlay open onClose={onClose} title={title} wide={wide}>
      <div className="space-y-3">{children}</div>
    </ResponsiveOverlay>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="block text-[11px] font-bold text-slate-500 mb-1">{label}</span>{children}</label>;
}
function ModalActions({ onClose, onSubmit, disabled, label }: { onClose: () => void; onSubmit: () => void; disabled: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onClose} className="min-h-[42px] px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300">Cancel</button>
      <button onClick={onSubmit} disabled={disabled} className="min-h-[42px] px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold inline-flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" /> {label}</button>
    </div>
  );
}
