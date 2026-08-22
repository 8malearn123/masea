/** Contract number format — mirror of the DB `generate_contract_no` output. */
export function formatContractNo(year: number, seq: number): string {
  return `MAS-${year}-${String(seq).padStart(5, '0')}`;
}

const RE = /^MAS-(\d{4})-(\d{5})$/;

export function parseContractNo(no: string): { year: number; seq: number } | null {
  const m = RE.exec(no);
  if (!m) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
}
