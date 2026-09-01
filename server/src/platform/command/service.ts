import { managementOverview } from '../../mesaops/dashboard/service';
import { ApiError } from '../../middleware/error';

export type CommandException = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  module: 'MesaPlant';
  href?: string;
};

export async function listCommandExceptions(organizationId: string): Promise<{
  organizationId: string;
  asOf: string;
  exceptions: CommandException[];
}> {
  const entitled = await import('../../db').then(({ basePrisma }) =>
    basePrisma.organizationService.findFirst({
      where: { organizationId, serviceId: 'mesaops', status: 'active' },
    }),
  );
  if (!entitled) {
    throw new ApiError(403, 'service_required', 'MesaPlant is required for Command.');
  }

  const overview = await managementOverview();
  const exceptions: CommandException[] = (overview.alerts ?? []).map((alert) => ({
    id: alert.id,
    severity: alert.severity,
    message: alert.message,
    module: 'MesaPlant' as const,
    href: alert.href ? `/mesaops?module=${encodeURIComponent(alert.href)}` : '/mesaops',
  }));

  for (const msg of overview.queues?.dispatch?.alerts ?? []) {
    exceptions.push({
      id: `dispatch-${msg.slice(0, 24)}`,
      severity: 'warning',
      message: msg,
      module: 'MesaPlant',
      href: '/mesaops?module=ready',
    });
  }

  return {
    organizationId,
    asOf: overview.context?.asOf ?? new Date().toISOString().slice(0, 10),
    exceptions: exceptions.slice(0, 12),
  };
}
