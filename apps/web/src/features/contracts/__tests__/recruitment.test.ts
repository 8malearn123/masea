import { describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import {
  addDocument,
  advanceStage,
  getDocuments,
  getFollowups,
  listExternalOffices,
  listRecruitmentStages,
  setTravel,
} from '@/features/contracts/api/recruitment.api';
import { getContract, listContracts } from '@/features/contracts/api/contracts.api';
import type { UserProfile } from '@masiat/shared';

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

function loginAs(role: UserProfile['role'], id: string) {
  useAuth.setState({
    profile: { id, full_name: 'اختبار', role, branch_id: null, is_active: true, created_at: '' },
  });
}

describe('external office recruitment workflow', () => {
  it('exposes the managed Saudi recruitment stages (office_contract → handover)', async () => {
    const stages = await listRecruitmentStages();
    expect(stages.length).toBeGreaterThanOrEqual(8);
    expect(stages[0]?.code).toBe('office_contract');
    expect(stages.some((s) => s.code === 'handover')).toBe(true);
  });

  it('lists external-office accounts to assign a recruitment contract to', async () => {
    const offices = await listExternalOffices();
    expect(offices.some((o) => o.id === 'demo-external_office')).toBe(true);
  });

  it('advancing a stage logs a follow-up note and records the new stage', async () => {
    const before = (await getFollowups('00007')).length;
    await advanceStage('00007', 'visa_stamping', 'تم تصديق الأوراق وإصدار تأشيرة الخروج');
    const after = await getFollowups('00007');
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]?.stage_code).toBe('visa_stamping');
    expect(after[after.length - 1]?.note).toContain('تصديق');
  });

  it('scopes the contract list so the external office sees ONLY its assigned requests', async () => {
    loginAs('external_office', 'demo-external_office');
    const mine = await listContracts(ALL);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.assigned_office_id === 'demo-external_office')).toBe(true);

    // a cross-branch role (operations manager) sees the full book, not just assigned
    loginAs('operations_manager', 'demo-operations_manager');
    const all = await listContracts(ALL);
    expect(all.length).toBeGreaterThan(mine.length);

    useAuth.setState({ profile: null });
  });

  it('attaches a stage document and lists it (newest first)', async () => {
    const before = (await getDocuments('00007')).length;
    await addDocument('00007', {
      doc_type: 'medical',
      file_name: 'نتيجة-الفحص-الطبي.pdf',
      storage_path: null,
      stage: 'medical_exam',
    });
    const after = await getDocuments('00007');
    expect(after.length).toBe(before + 1);
    expect(after[0]?.doc_type).toBe('medical');
    expect(after[0]?.file_name).toContain('الفحص');
  });

  it('saves visa/travel data onto the contract', async () => {
    await setTravel('00007', {
      visa_number: '4099887766',
      expected_arrival_date: '2026-04-01',
      flight_no: 'SV-553',
    });
    const c = await getContract('00007');
    expect(c?.visa_number).toBe('4099887766');
    expect(c?.expected_arrival_date).toBe('2026-04-01');
    expect(c?.flight_no).toBe('SV-553');
  });
});
