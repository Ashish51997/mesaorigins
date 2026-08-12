import type { RequestHandler } from 'express';
import { basePrisma } from '../db';
import { ApiError } from './error';

/**
 * Returns whether an organization may currently use a MesaDesk service.
 *
 * Service access is deliberately checked against all three control planes:
 * the global service switch, the organization's assignment, and the
 * organization's own lifecycle status. Missing rows fail closed.
 */
export async function hasActiveServiceEntitlement(organizationId: string, serviceId: string): Promise<boolean> {
  const assignment = await basePrisma.organizationService.findUnique({
    where: { organizationId_serviceId: { organizationId, serviceId } },
    select: {
      status: true,
      organization: { select: { status: true } },
      service: { select: { status: true } },
    },
  });

  return Boolean(
    assignment
      && assignment.status === 'active'
      && assignment.organization.status !== 'suspended'
      && assignment.service.status === 'active',
  );
}

/**
 * Gates an authenticated, tenant-resolved route on a service entitlement.
 * Mount this after `authenticate` and `resolveTenant`.
 */
export function requireService(serviceId: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        throw new ApiError(401, 'unauthenticated', 'Sign-in required.');
      }
      if (!(await hasActiveServiceEntitlement(organizationId, serviceId))) {
        throw new ApiError(403, 'service_not_enabled', `${serviceId} is not active for this organization.`);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
