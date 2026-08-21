/**
 * Central role model for the click-dummy (docs/specs/spec-erp-clickdummy.md).
 * 8 roles, each with a demo user + shift, a default theme (office = dark,
 * shop-floor = light), and a home module. The role-switcher drawer and the
 * header read from here so name + role + shift always show.
 */

export type RoleName =
  | 'Owner'
  | 'Administrator'
  | 'Managing Director'
  | 'Sales Executive'
  | 'Production Planner'
  | 'Operator'
  | 'Quality Inspector'
  | 'Store Manager'
  | 'Dispatch Executive'
  | 'Maintenance Head';

export interface RoleInfo {
  role: RoleName;
  group: 'office' | 'shop-floor';
  theme: 'dark' | 'light';
  user: string;      // seeded demo user (Indian name)
  shift: 'D' | 'N';  // Day / Night
  home: string;      // default module id when switching to this role
  blurb: string;     // one line for the switcher drawer
}

export const ROLES: RoleInfo[] = [
  { role: 'Owner', group: 'office', theme: 'dark', user: 'Vikram Malhotra', shift: 'D', home: 'dashboard', blurb: 'Full access — every screen and every action across the whole app.' },
  { role: 'Administrator', group: 'office', theme: 'dark', user: 'Deepak Bansal', shift: 'D', home: 'dashboard', blurb: 'Assigns people to roles and sets who can open what.' },
  { role: 'Managing Director', group: 'office', theme: 'dark', user: 'Madan Lal', shift: 'D', home: 'dashboard', blurb: 'Reads the whole plant — no data entry.' },
  { role: 'Sales Executive', group: 'office', theme: 'dark', user: 'Amit Verma', shift: 'D', home: 'dashboard', blurb: 'Enquiries, quotations and orders.' },
  { role: 'Production Planner', group: 'office', theme: 'dark', user: 'Sneha Rao', shift: 'D', home: 'dashboard', blurb: 'Machine and shift allocation.' },
  { role: 'Operator', group: 'shop-floor', theme: 'light', user: 'Nandlal', shift: 'N', home: 'dashboard', blurb: 'Machine log book, live readings.' },
  { role: 'Quality Inspector', group: 'shop-floor', theme: 'light', user: 'Nitesh Kumar', shift: 'D', home: 'dashboard', blurb: 'In-line checks, roll verdicts, packing.' },
  { role: 'Store Manager', group: 'shop-floor', theme: 'light', user: 'Ravi Shankar', shift: 'D', home: 'dashboard', blurb: 'Incoming, stock bins, put-away.' },
  { role: 'Dispatch Executive', group: 'shop-floor', theme: 'light', user: 'Pankaj Singh', shift: 'D', home: 'dashboard', blurb: 'Invoices, vehicles, gate passes.' },
  { role: 'Maintenance Head', group: 'shop-floor', theme: 'light', user: 'Suresh Kumar', shift: 'D', home: 'dashboard', blurb: 'Breakdowns, preventive schedule, calibration.' }
];

// Map legacy role labels (from older sessions / login) to the canonical 8.
const ALIASES: Record<string, RoleName> = {
  Management: 'Managing Director',
  'Management / Executive': 'Managing Director',
  'Production Operator': 'Operator',
  Admin: 'Administrator',
  'System Administrator': 'Administrator'
};

export function normalizeRole(role: string | undefined | null): RoleName {
  if (!role) return 'Managing Director';
  const alias = ALIASES[role];
  if (alias) return alias;
  const hit = ROLES.find((r) => r.role === role);
  return hit ? hit.role : 'Managing Director';
}

export function roleInfo(role: string): RoleInfo {
  const norm = normalizeRole(role);
  const hit = ROLES.find((r) => r.role === norm);
  return hit ?? ROLES[0];
}

export const themeForRole = (role: string): 'dark' | 'light' => roleInfo(role).theme;
export const homeForRole = (role: string): string => roleInfo(role).home;
