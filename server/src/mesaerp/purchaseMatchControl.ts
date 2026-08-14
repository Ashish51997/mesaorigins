import { type Prisma } from '@prisma/client';
import { basePrisma } from '../db';
import { ApiError } from '../middleware/error';

type Db = typeof basePrisma;

export const SUPPLIER_INVOICE_RELEASE_MATCH_STATUSES = ['matched', 'approved'] as const;

export function supplierInvoiceMatchAllowsFinancialRelease(status: string): boolean {
  return SUPPLIER_INVOICE_RELEASE_MATCH_STATUSES.includes(
    status as (typeof SUPPLIER_INVOICE_RELEASE_MATCH_STATUSES)[number],
  );
}

/**
 * A zero-variance match is immediately `matched`; any variance, including a
 * partial receipt, must first receive an independent checker approval. This
 * keeps the current single-GRN V1 model conservative without widening schema.
 */
export async function requireSupplierInvoiceReleaseMatch(
  db: Db,
  input: {
    organizationId: string;
    legalEntityId: string;
    supplierInvoiceId: string;
    vendorId: string | null;
  },
): Promise<Prisma.ErpMatchCaseGetPayload<Record<string, never>>> {
  if (!input.vendorId) {
    throw new ApiError(422, 'supplier_invoice_vendor_required', 'Supplier invoice requires a vendor before financial release.');
  }

  const match = await db.erpMatchCase.findFirst({
    where: {
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId,
      supplierInvoiceId: input.supplierInvoiceId,
      vendorId: input.vendorId,
    },
  });
  if (!match || !supplierInvoiceMatchAllowsFinancialRelease(match.status)) {
    throw new ApiError(
      409,
      'supplier_invoice_match_required',
      'Supplier invoice requires a matched three-way comparison or checker-approved variance before financial release.',
    );
  }
  return match;
}
