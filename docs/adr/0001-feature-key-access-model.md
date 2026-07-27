# 1. Unified feature-key access model (screens + actions), default-allow, per-employee override

Date: 2026-07-25
Status: accepted

## Context
The app already has a role×module permission matrix (`PermissionRule`), a temporary
delegation flow (`ACLRequest`), and `checkPermission(role, moduleId, …)`. The new
requirement is action-level control ("enable/disable any feature for any employee") while
explicitly **not rewriting** the existing system. Naive action-level control means a
permission check behind every button across ~40 screens — a de facto rewrite — and a
secure-by-default (deny) posture would require enumerating every action×role up front.

## Decision
- Model every capability as a **feature key**: `screen:<moduleId>` or `action:<verb>`, in
  one catalog. Generalise `checkPermission`'s `moduleId` parameter to `featureKey`; the
  existing 3-tier resolution (delegation → role matrix → role preset) is unchanged.
- Add exactly **one** new layer — a per-employee **grant** (`on`/`off`) — between
  delegation and the role matrix. This yields "role default + per-employee override."
- **Default-allow**: any feature with no rule and no preset restriction is permitted.
  Screens are opt-in per role (a role's nav set); actions are opt-out (allowed unless
  revoked). Enforcement of action features rolls out from ~15 high-stakes buttons.

## Consequences
- Reuses `PermissionRule`, the matrix UI, the delegation flow, and `checkPermission`
  almost verbatim; the new surface is one type (`EmployeeGrant`), one helper (`can()`),
  and one panel. No screen rewrites.
- Because unspecified actions are allowed, the system can ship incrementally without
  breaking existing flows — at the cost of not being secure-by-default (acceptable for a
  click-dummy; a real deployment would flip high-risk actions to default-deny).
- A single flat key space keeps the admin UI (matrix + per-employee panel) uniform for
  screens and actions.

## Alternatives considered
- **Full default-deny, wire every button now** — most complete/secure, rejected as the
  rewrite the brief forbids.
- **Catalog + admin UI but enforce only 2–3 actions** — cheapest, rejected because most
  toggles would be cosmetic and mislead the admin.
- **Pure per-role or pure per-employee** — rejected in grilling; the override model keeps
  roles meaningful while allowing per-person control.
