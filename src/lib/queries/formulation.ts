import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ApiFormulaComponent { name: string; pct: number; lotId: string; }
export interface ApiFormula {
  id: string; code: string; rev: number; product: string; active: boolean;
  locked: boolean; lockReason: string; capaId: string | null; components: ApiFormulaComponent[];
}

const keys = { formulations: ['formulations'] as const };

export function useFormulations() {
  return useQuery({ queryKey: keys.formulations, queryFn: () => api.get<ApiFormula[]>('/formulations') });
}

export function useCreateFormulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { code: string; product: string; components: ApiFormulaComponent[] }) =>
      api.post<ApiFormula>('/formulations', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.formulations }),
  });
}

export function useUpdateFormulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ApiFormula, 'product' | 'active' | 'components'>> }) =>
      api.patch<ApiFormula>(`/formulations/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.formulations }),
  });
}
