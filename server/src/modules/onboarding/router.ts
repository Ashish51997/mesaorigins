import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { authSecretConfigured } from '../../auth/config';
import { ApiError } from '../../middleware/error';
import { bootstrapOrganization, listOrganizations, listServiceCatalog, setOrganizationServices, setServiceStatus } from './service';
import { bootstrapOrgSchema, organizationServicesSchema, serviceStatusSchema } from './schemas';
import { allowedOnboardingEmails, canAccessOnboarding } from './service';

export const onboardingRouter = Router();

function requireOnboardingAccess(req: import('express').Request): void {
  if (!authSecretConfigured()) throw new ApiError(503, 'auth_not_configured', 'AUTH_SECRET is not set (min 32 characters).');
  if (!canAccessOnboarding(req.user?.email, Boolean(req.user?.isAdmin))) {
    throw new ApiError(403, 'forbidden', 'You are not allowed to onboard organizations.');
  }
}

onboardingRouter.get('/onboarding/access', async (req, res, next) => {
  try {
    requireOnboardingAccess(req);
    res.json({ allowed: true, allowedEmails: allowedOnboardingEmails(), user: req.user });
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
