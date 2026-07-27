# Spec: Mass Polymer ERP click-dummy — Foundation + Managing Director

Status: agreed via grill-with-docs (2026-07-24). Source: PROMPT 00 (Foundation) +
PROMPT 01 (Managing Director). Roles 02–08 follow later.

## 0. Approach & scope (decided)
- **Extend the existing app** (not greenfield). Keep domain modules, mock data, D3
  charts, and the QR/MFG/013 logbook. Add the Foundation as a new cohesive layer,
  restyle role-by-role starting with MD.
- **This build = full Foundation (PROMPT 00) + MD (PROMPT 01), then PAUSE** for
  review before roles 02–08.
- **TS strictness:** write all NEW code strict-clean (as if `--strict` +
  `noUncheckedIndexedAccess`); keep global tsconfig lenient for now (no mass
  retrofit of the existing ~11k LOC); optional strict flip as a final pass.
- Continue in worktree `logbook-qrmfg013` (same app).
- **UI style guideline → see [UI_STYLE_GUIDE.md](UI_STYLE_GUIDE.md)** (updated
  2026-07-24). Clean modern SaaS: airy/light, radial electric-blue glow, floating
  pill nav, metric cards with icon tiles + delta chips, soft shadows, round
  everything. Fonts → **Poppins** SemiBold (headings, metrics) / **Inter** Regular
  (body) / **Roboto Mono** (lot ids, readings, all traceability — never truncated).
  Primary #4438E0. Tokens live in `src/index.css`.

## 1. Roles (8), switcher, themes, demo users
Rename `Management`→**Managing Director**, `Production Operator`→**Operator**; keep
Sales Executive, Production Planner, Quality Inspector, Store Manager, Dispatch
Executive; **add Maintenance Head**. Align ACL matrix + per-role menus to these 8.

- **Floating role-switcher drawer** (replaces the "View Mode" dropdown): lists all
  8; switching hot-swaps **theme + sidebar + home** with **no reload and no loss of
  in-memory state** (cross-role live effects must work: QA-pass → Store Manager
  sees the pallet arrive).
- **Theme by role:** dark = Managing Director, Sales Executive, Production Planner.
  High-contrast light (7:1 on data) = Operator, Quality Inspector, Store Manager,
  Dispatch Executive, Maintenance Head.
- **Maintenance Head** gets its own workspace (Prompt 08): Breakdowns · Preventive
  Schedule · Downtime Analytics · Machine History · Calibration Register · Trace.
  Move the maintenance register OUT of the Manufacturing module into this role
  (keep the data).
- **Seed one demo user per role** (Indian name + shift) — header always shows
  name + role + shift.
- **Interim (until prompts 02–08):** switching to a non-MD role shows that role's
  EXISTING screens re-mounted under the new shell + role theme (nothing "coming
  soon"); they get their spec treatment when their prompt lands.

## 2. Data spine (canonical)

### Machine registry M01–M09
| ID | Line | Product family | Logbook format | Seed status |
|----|------|----------------|----------------|-------------|
| M01 | LDPE / co-extrusion coil | LDPE film/coil | QR/MFG/012 | running |
| M02 | LDPE coil | LDPE coil | QR/MFG/012 | running |
| M03 | LDPE coil | LDPE coil | QR/MFG/012 | attention (zone temp near limit) |
| M04 | LDPE coil | LDPE coil (real seed example) | QR/MFG/012 | running |
| M05 | LDPE coil | LDPE coil | QR/MFG/012 | stopped (power failure – demo) |
| M06 | PVC/SPVC profile & beading | PVC profile | QR/MFG/013 | running |
| M07 | PVC profile | PVC profile | QR/MFG/013 | running |
| M08 | PVC/SPVC beading | RPVC (real seed example) | QR/MFG/013 | running |
| M09 | PVC/SPVC beading | SPVC (real seed example) | QR/MFG/013 | running |

- M08 product `007 SM RPVC010.C 11MM 1180MM 178G N/V White T.D`, formula **RF03**.
- M09 product `090 SM SPVC042 Z 150M 7.8K M/V Black`, formula **SF13**.
- Migrate every `Extruder-0x` reference across the app to `Mxx`.

### Lot format & shift
- Format everywhere: **`DDMMYY·D/N·Mxx·Bnn`**, Roboto Mono, never truncated.
- **Shift token is `D` (Day) or `N` (Night)** — two shifts only. **Sweep the whole
  app to replace Shift A/B/C → D/N** (logbook rows + template.shifts, plan board,
  header shift display, seeds).
- Fix seed `01·0726` → `010726`.

### Suppliers / materials / formulas (invented, realistic Indian; not real firms)
- Suppliers: e.g. Sri Venkatesh Polymers (RPVC resin), Deccan Granules (LDPE
  granules), Kaveri Minerals (CaCO3 filler), Ashirwad Additives (stabilizer),
  **Deccan Reprocessors (REPROCESS LDPE)**.
- Materials: RPVC resin, LDPE granules, CaCO3 filler, stabilizer, reprocess LDPE.
- Formulas: RF03, SF13. Products as above.

### Two seeded lineages (for Batch Passport forward/backward trace)
**CLEAN — `190726·D·M08·B01`:** supplier RPVC lot → incoming inspection ACCEPTED →
store issue to M08 → formula RF03 → production shift 19/07 Day M08 (batch B01) →
all rolls PASS → pallet → dispatched (invoice + vehicle).

**FAIL + COMPLAINT — `180726·N·M08·B03`:** REPROCESS LDPE lot accepted **without a
trial result** (flagged) → store issue to M08 → production shift 18/07 Night M08
(batch B03) → one roll **FAILS QA (Weight issue)** → **regrind lot** created with a
parent link to the failed roll → remaining rolls dispatched → **customer complaint**
(pin holes / weight variation, severity High, respond within 3 days) logged against
the invoice. Backward trace lands on the reprocess RM lot; forward trace flags the
sibling lots.

## 3. Foundation components (PROMPT 00 — build once, reused)
1. **Global shell / header** on every screen: app name · **Trace search** (lot/roll/
   pallet/invoice/complaint → opens Batch Passport) · name+role+shift · EN/ಕನ್ನಡ/हिंदी
   toggle (EN complete; ~10 labels stubbed in KN+HI to prove the pattern) · bell with
   acknowledged-alerts history · role-switcher drawer · Practice-mode toggle.
2. **Batch Passport:** chronological timeline (supplier lot → incoming → store issue →
   formulation → shift → QA verdicts → pallet → dispatch → complaint); each card
   styled after its paper format; Print; both lineages above seeded.
3. **Nudge bar:** slides below header on any data change; icon + one-sentence message
   + "View" deep-link + dismiss; green/amber auto-dismiss 6s, **red requires
   acknowledgement (stored name+time)**; max 2 stacked, rest queue; pulse-highlight the
   changed value if it's on the current screen; fires on the user's own cross-screen
   effects.
4. **Simulation engine:** in-memory event bus + ticker. ~8–15s temp drift (occasionally
   crosses limit → amber); ~30s reading arrives / roll completes / occasional QA fail;
   ~60s truck status / complaint countdown / breakdown open-close. Freshness chips
   ("updated 12s ago"); >5min → amber stale chip.
5. **Demo Control Panel** (gear drawer): speed pause/1×/5×; force buttons — Fail next
   roll, Trigger temperature alert, Truck arrives, Raise complaint, Go offline/online.
6. **Empty-state library:** teaching empties (empty queue, first-run, trace-not-found,
   filter-empty) — never a blank panel.
7. **Offline library:** grey banner "No network — saved on this tablet, will send
   automatically"; entry screens keep working → visible local queue + header badge "N
   waiting to send"; reconnect → sync animation + green nudge; live widgets show
   "showing saved data — last updated 4:12pm"; network-only actions disable with a
   worded reason. Plus loading skeletons, error+retry, scanner-fail fallback,
   session-timeout to user-tile login without losing a queued entry.
8. **Consequence toasts:** every submission ends with one plain sentence.
9. **Status discipline:** green/amber/red only, always color + icon + words; holds show
   reason; zero user-facing system words ("draft/pending/SLA/8D" banned).

## 4. Managing Director role (PROMPT 01 — read-only; NO entry fields)
Sidebar: Home · Plant Overview (9-stage color map, read-only) · Quality Memory ·
Stock & Inventory · Complaints & CAPA Register · Management Review · Reports · Trace.

- **Home:** headline strip (finished stock by grade in t; raw stock t + days cover;
  open complaints + worst countdown; open corrective actions + oldest age + owner);
  "Needs your attention" (≤5: overdue CAPAs w/ owner, complaints near deadline, lines
  stopped >1h); this-month-vs-last (production kg, internal rejection kg + top reason
  in words, dispatches, new orders ₹); live line glance M01–M09 three-state tiles +
  freshness; Quality Memory mini-Pareto preview.
- **Quality Memory:** full rejection **Pareto** (new D3 component) with machine/shift/
  product cuts + month trend; complaint list with plain countdowns; **CAPA register**
  (action · responsibility · target date · status) — needs new fields: countdown/SLA,
  5-Why capture, effectiveness verification; supplier quality scores; downtime by
  category; calibration due. Every chart drills to records → Batch Passport.
- **Management Review:** monthly agenda screen assembled from system data (format
  QR/MGT/021) with Export minutes (dummy) + **Print**.
- **9-stage Plant Overview** replaces the 8-step pipeline: 01 Inquiry · 02 Orders · 03
  Planning · 04 Extrusion · 05 QA · 06 Packing · 07 Warehouse · 08 Dispatch · 09
  Complaints (stage colors per style guide).
- MD real-time: red nudge "Machine 05 stopped — power failure" (ack required); amber
  complaint-deadline; green rejection-below-last-month. Empty/offline states per spec.

## 5. Impact / key files
- New: theme/role provider, RoleSwitcher drawer, Header/Shell, NudgeBar, SimulationEngine
  (event bus + hook), DemoControlPanel, BatchPassport, EmptyStates, OfflineProvider+queue,
  PracticeMode, ConsequenceToast, LanguageToggle, D3 Pareto, machine registry, lineage seed.
- Rework: App.tsx (shell/provider wiring, role theme, switcher), Dashboard→MD home,
  CapaComplaints (countdowns/5-Why/effectiveness), Reports/QualityMemory (Pareto),
  ManufacturingStandards (move maintenance out), types.ts + mockData.ts (machines, lots,
  shift D/N, suppliers, lineages), a global Shift A/B/C→D/N sweep.
- Replace native `alert()` with consequence toasts on submit paths (progressively).

## 6. Milestones
1. Data spine (registry, lots, shift D/N sweep, suppliers, 2 lineages) — **show output**.
2. Shell + role/theme provider + switcher drawer + Roboto + nudge bar + toasts.
3. Simulation engine + demo control panel + freshness.
4. Batch Passport (both lineages) + Trace search.
5. Offline + empty-state libraries + practice mode.
6. MD role screens (home, plant overview, quality memory + Pareto, complaints+CAPA
   upgrades, management review, stock, reports, trace) — read-only.
7. Verify (tsc, tests, live), then PAUSE for review.

## 7. Assumptions (correct if wrong)
- Non-MD roles keep their current screens (re-themed) until their prompt.
- Percentages show no decimals; kg/rolls/tonnes/°C/bar lead.
- Simulation mutates the shared in-memory seed; the whole demo is client-side.
