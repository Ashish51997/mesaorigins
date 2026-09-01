import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { authSecretConfigured } from '../../auth/config';
import { ApiError } from '../../middleware/error';
import { bootstrapOrganization, listOrganizations, listProductCatalogPublic, listServiceCatalog, setOrganizationServices, setServiceStatus } from './service';
import { bootstrapOrgSchema, organizationServicesSchema, serviceStatusSchema } from './schemas';
import { allowedPlatformAdminEmails, canAccessPlatformAdmin } from '../../lib/platformAdmin';

export const onboardingRouter = Router();

function requireOnboardingAccess(req: import('express').Request): void {
  if (!authSecretConfigured()) throw new ApiError(503, 'auth_not_configured', 'AUTH_SECRET is not set (min 32 characters).');
  // Platform administration is an identity-level entitlement. A person may
  // belong to several tenants, so authorize when any active membership is an
  // administrator instead of trusting whichever tenant the UI last selected.
  const hasAdminMembership = req.user?.organizations.some((organization) => (
    organization.membershipStatus === 'active' && organization.isAdmin
  )) ?? false;
  if (!canAccessPlatformAdmin(req.user?.email, hasAdminMembership)) {
    throw new ApiError(403, 'forbidden', 'You are not allowed to onboard organizations.');
  }
}

/** Public product IA (names, packages, manuals path) — no secrets. */
onboardingRouter.get('/product-catalog', (_req, res) => {
  res.json(listProductCatalogPublic());
});

onboardingRouter.get('/onboarding/access', async (req, res, next) => {
  try {
    requireOnboardingAccess(req);
    res.json({ allowed: true, allowedEmails: allowedPlatformAdminEmails(), user: req.user });
  } catch (err) {
    next(err);
  }
});

onboardingRouter.get('/onboarding/organizations', async (req, res, next) => {
  try {
    requireOnboardingAccess(req);
    res.json({ organizations: await listOrganizations() });
  } catch (err) {
    next(err);
  }
});

onboardingRouter.get('/onboarding/services', async (req, res, next) => {
  try {
    requireOnboardingAccess(req);
    res.json({ services: await listServiceCatalog() });
  } catch (err) {
    next(err);
  }
});

onboardingRouter.put('/onboarding/services/:id/status', validateBody(serviceStatusSchema), async (req, res, next) => {
  try {
    requireOnboardingAccess(req);
    res.json(await setServiceStatus(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

onboardingRouter.post('/onboarding/bootstrap', validateBody(bootstrapOrgSchema), async (req, res, next) => {
  try {
    requireOnboardingAccess(req);
    const created = await bootstrapOrganization(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

onboardingRouter.put('/onboarding/organizations/:id/services', validateBody(organizationServicesSchema), async (req, res, next) => {
  try {
    requireOnboardingAccess(req);
    res.json(await setOrganizationServices(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});
