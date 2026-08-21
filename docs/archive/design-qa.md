# MesaOrigins landing and organization access — design QA

Source visual truth: `/tmp/mesaorigins-admin-login-reference.jpg` (the existing MesaOrigins admin login and its established visual language)

Rendered implementation evidence:

- `/tmp/mesaorigins-landing-entry.jpg`
- `/tmp/mesaorigins-landing-organization-form.jpg`
- `/tmp/mesaorigins-landing-chooser.jpg`
- `/tmp/mesaorigins-landing-phone.jpg`
- `/tmp/mesaorigins-design-qa-full.jpg` (normalized source and implementation comparison)
- `/tmp/mesaorigins-design-qa-form-region.jpg` (focused form-region comparison)

## Capture normalization

- Source capture: 1280 x 720 pixels, 1280 x 720 CSS viewport, device scale factor 1.
- Desktop implementation captures: 1440 x 900 pixels, 1440 x 900 CSS viewport, device scale factor 1.
- Responsive capture: 390 x 844 pixels, 390 x 844 CSS viewport, device scale factor 1.
- For the combined comparison, the implementation was normalized to 1280 x 800 and center-cropped to 1280 x 720 so it could be judged alongside the 1280 x 720 source without a density mismatch. The products intentionally use different content heights: the new service chooser needs more vertical capacity than the single admin form.
- State: light theme; source is the admin login; implementation comparisons cover landing entry, organization login, authenticated two-service chooser, and phone entry.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- Fonts and typography: both screens use the established MesaOrigins sans-serif stack, weight hierarchy, compact uppercase eyebrow, and readable small-copy treatment. Heading wraps are controlled on desktop and phone.
- Spacing and layout rhythm: the implementation preserves the source's centered split card, navy/white balance, 12 px radii, restrained borders, generous gutters, and consistent field/button rhythm. The wider desktop frame is intentional so two service cards fit without crowding.
- Colors and visual tokens: navy, blue action color, slate borders/backgrounds, and semantic green status accents align with the source. Text and control contrast remain clear.
- Image quality and asset fidelity: the existing vector `Logo` component is reused; interface symbols use the project's Lucide icon system. No placeholder, emoji, raster substitute, or custom-drawn visible asset was introduced.
- Copy and content: the administrator and organization paths are distinct, service assignment behavior is explained before login, and the chooser names each active service with a short purpose statement.
- Responsiveness: at 390 x 844 the decorative desktop panel is removed, brand context stays visible, controls remain full-width, and no content or persistent action is cropped.
- Accessibility/interaction: entry choices, back actions, form fields, organization cards, and service actions have accessible names; focus treatment is visible; error and no-service states use alert/status semantics.

## Full-view comparison evidence

`/tmp/mesaorigins-design-qa-full.jpg` places the existing admin visual language and the organization-login implementation in one normalized comparison. The brand lockup, split composition, palette, heading hierarchy, form proportions, button treatment, border language, and vertical rhythm remain visibly consistent. Content differences are task-specific rather than design drift.

## Focused region comparison evidence

`/tmp/mesaorigins-design-qa-form-region.jpg` compares the two form panels at readable scale. Label sizing, input height, focus treatment, icon container, primary button, and heading/body spacing are consistent. The organization form adds a back action because it is one level below the new landing entry; the admin trust footer remains specific to temporary local admin access.

## Comparison history

1. Initial desktop check found a P1 layout issue: the arbitrary responsive grid track compiled without usable columns, stacking the navy and white regions. It also found a P1 legibility issue where the global heading rule overrode the navy-panel heading to dark text.
2. Fixes: replaced the fragile track with the project's stable two-column breakpoint and explicitly preserved the white hero heading token on the navy panel. The same fixes were applied to the matching admin login shell.
3. Post-fix evidence: `/tmp/mesaorigins-landing-entry.jpg`, `/tmp/mesaorigins-landing-organization-form.jpg`, and `/tmp/mesaorigins-design-qa-full.jpg` show a balanced desktop split with correct heading contrast. `/tmp/mesaorigins-landing-phone.jpg` confirms the mobile collapse.

## Primary interactions verified

- Open the organization login from the landing page.
- Submit the seeded organization credentials.
- Resolve the authenticated organization's active services.
- Present MesaOps and MesaLeads when both are assigned.
- Preserve direct routing for a single assigned service (automated coverage).
- Restore an existing session, choose among multiple organizations, sign out, and fail closed for expired/unassigned access (automated coverage).
- Browser console checked after the final landing render: no error-level entries.

## Implementation checklist

- [x] Match the existing MesaOrigins admin visual system.
- [x] Keep Admin and Organization entry paths distinct.
- [x] Render the organization credential form and service chooser.
- [x] Verify desktop and phone layouts.
- [x] Verify session, entitlement, and error-state behavior.
- [x] Re-run visual comparison after fixing the desktop grid and hero contrast.

## Follow-up polish

- P3: the admin source has subtle decorative corner rings on the navy panel. The landing intentionally leaves that area quieter; the same motif could be added later if tighter one-to-one ornamentation is preferred.

final result: passed
