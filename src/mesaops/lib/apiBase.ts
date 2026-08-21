/** Canonical MesaOps HTTP prefix (appended after `/api` by apiClient). */
export const MESAOPS_API_BASE = '/mesaops/v1';

export function mesaOpsPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${MESAOPS_API_BASE}${normalized}`;
}
