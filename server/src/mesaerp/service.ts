import { tenantContext } from '../lib/tenantContext';
import { ApiError } from '../middleware/error';
import type { LegalEntityCreate, VoucherCreate, VoucherPost, VoucherReversalCreate, VoucherTransition, VoucherUpdate } from './schemas';
import { hashCanonical, type MesaErpRepository } from './repository';

function actor() {
  const context = tenantContext.getStore();
  if (!context) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return context;
}

function mutation(idempotencyKey: string, request: unknown) {
  return { idempotencyKey, requestHash: hashCanonical(request) };
}

export function listLegalEntities(repository: MesaErpRepository) {
  return repository.listLegalEntities(actor().organizationId);
}

export function createLegalEntity(repository: MesaErpRepository, input: LegalEntityCreate, idempotencyKey: string) {
  const context = actor();
  return repository.createLegalEntity({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    input,
    ...mutation(idempotencyKey, input),
  });
}

export function listAccounts(repository: MesaErpRepository, legalEntityId: string) {
  return repository.listAccounts(actor().organizationId, legalEntityId);
}

export function listVouchers(repository: MesaErpRepository, legalEntityId: string) {
  return repository.listVouchers(actor().organizationId, legalEntityId);
}

export async function getVoucher(repository: MesaErpRepository, legalEntityId: string, voucherId: string) {
  const voucher = await repository.getVoucher(actor().organizationId, legalEntityId, voucherId);
  if (!voucher) throw new ApiError(404, 'voucher_not_found', 'Voucher not found.');
  return voucher;
}

export function createVoucher(repository: MesaErpRepository, legalEntityId: string, input: VoucherCreate, idempotencyKey: string) {
  const context = actor();
  if (['depreciation', 'intercompany', 'consolidation_elimination'].includes(input.voucherType)) {
    throw new ApiError(422, 'controlled_voucher_type', 'This voucher family can only be created by its dedicated finance-control workflow.');
  }
  return repository.createVoucher({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    legalEntityId,
    input,
    ...mutation(idempotencyKey, { legalEntityId, input }),
  });
}

export function updateVoucher(repository: MesaErpRepository, legalEntityId: string, voucherId: string, input: VoucherUpdate, idempotencyKey: string) {
  const context = actor();
  return repository.updateVoucher({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    legalEntityId,
    voucherId,
    input,
    ...mutation(idempotencyKey, { legalEntityId, voucherId, input }),
  });
}

export function postVoucher(repository: MesaErpRepository, legalEntityId: string, voucherId: string, input: VoucherPost, idempotencyKey: string) {
  const context = actor();
  return repository.postVoucher({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    legalEntityId,
    voucherId,
    expectedVersion: input.expectedVersion,
    ...mutation(idempotencyKey, { legalEntityId, voucherId, input }),
  });
}

export function submitVoucher(repository: MesaErpRepository, legalEntityId: string, voucherId: string, input: VoucherTransition, idempotencyKey: string) {
  const context = actor();
  return repository.submitVoucher({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    legalEntityId,
    voucherId,
    expectedVersion: input.expectedVersion,
    ...mutation(idempotencyKey, { legalEntityId, voucherId, input }),
  });
}

export function approveVoucher(repository: MesaErpRepository, legalEntityId: string, voucherId: string, input: VoucherTransition, idempotencyKey: string) {
  const context = actor();
  return repository.approveVoucher({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    legalEntityId,
    voucherId,
    expectedVersion: input.expectedVersion,
    ...mutation(idempotencyKey, { legalEntityId, voucherId, input }),
  });
}

export function createVoucherReversal(repository: MesaErpRepository, legalEntityId: string, voucherId: string, input: VoucherReversalCreate, idempotencyKey: string) {
  const context = actor();
  return repository.createVoucherReversal({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    legalEntityId,
    voucherId,
    input,
    ...mutation(idempotencyKey, { legalEntityId, voucherId, input }),
  });
}

export async function getJournalForVoucher(repository: MesaErpRepository, legalEntityId: string, voucherId: string) {
  const voucher = await getVoucher(repository, legalEntityId, voucherId);
  if (!voucher.journalEntryId) throw new ApiError(409, 'voucher_not_posted', 'This voucher has not been posted.');
  const journal = await repository.getJournalEntry(actor().organizationId, legalEntityId, voucher.journalEntryId);
  if (!journal) throw new ApiError(500, 'journal_missing', 'Posted voucher is missing its journal entry.');
  return journal;
}
