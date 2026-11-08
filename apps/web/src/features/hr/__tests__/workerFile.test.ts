/** ملف العاملة الكامل (مرآة 0078 واختبار 99g). */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { listHouseWorkers } from '@/features/hr/api/hr.api';
import { listHrDocuments } from '@/features/hr/api/documents.api';
import { listHrLookups, saveHrLookup } from '@/features/hr/api/lookups.api';
import { saveWorkerFile } from '@/features/hr/api/workerFile.api';
import { resolveWorkerByBarcode } from '@/features/housing/api/housing.api';
import {
  ageFrom,
  cleanIban,
  validatePhoto,
  workerErrors,
} from '@/features/hr/lib/workerValidation';
import type { HouseWorker } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
function worker(p: Partial<HouseWorker> = {}): HouseWorker {
  return {
    id: `w-test-${Math.random().toString(36).slice(2, 8)}`,
    full_name: 'جوي ماري ديلا كروز',
    photo_url: null,
    nationality: 'الفلبين',
    profession: 'عاملة منزلية',
    age: 30,
    experience_years: 4,
    monthly_salary: 1500,
    languages: ['العربية'],
    skills: ['التنظيف'],
    status: 'available',
    branch: 'نجران',
    bio: '',
    passport_no: 'P8812345',
    iqama_no: '2490011223',
    border_no: '3012345678',
    birth_date: '1994-05-10',
    arrival_date: iso(-60),
    phone: '0551234567',
    dorm: 'سكن نجران - ب',
    barcode: '',
    bank_name: 'مصرف الراجحي',
    iban: 'SA0380000000608010167519',
    account_holder: 'JOY MARIE DELA CRUZ',
    payment_method: 'bank',
    ...p,
  };
}

describe('worker file rules (same as worker_details checks)', () => {
  it('validates phone, iqama, border no., IBAN, dates and bank', () => {
    expect(workerErrors(worker())).toEqual({});
    expect(workerErrors(worker({ phone: '12345' })).phone).toContain('05');
    expect(workerErrors(worker({ iqama_no: '1234567890' })).iqama_no).toContain('2');
    expect(workerErrors(worker({ border_no: '12' })).border_no).toContain('10');
    expect(workerErrors(worker({ iban: 'SA12' })).iban).toContain('SA');
    expect(workerErrors(worker({ bank_name: '' })).bank_name).toBe('اختر البنك للآيبان');
    expect(workerErrors(worker({ payment_method: 'cash', bank_name: '', iban: '' }))).toEqual({});
    expect(workerErrors(worker({ birth_date: iso(5) })).birth_date).toContain('الماضي');
    expect(workerErrors(worker({ arrival_date: iso(5) })).arrival_date).toContain('المستقبل');
    expect(workerErrors(worker({ full_name: ' ' })).full_name).toBe('اسم العاملة مطلوب');
    expect(workerErrors(worker({ age: 15 })).age).toContain('18');
  });

  it('helpers: IBAN clean-up, age from birth date, photo limits', () => {
    expect(cleanIban('sa03 8000 0000 6080 1016 7519')).toBe('SA0380000000608010167519');
    expect(ageFrom('1994-05-10', '2026-11-08')).toBe(32);
    expect(ageFrom('1994-12-10', '2026-11-08')).toBe(31);
    expect(ageFrom('')).toBeNull();
    expect(validatePhoto({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validatePhoto({ type: 'application/pdf', size: 1000 })).toContain('JPG');
    expect(validatePhoto({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toContain('5');
  });
});

describe('demo: one save for the whole file', () => {
  it('HR adds a worker with photo, bank data and documents; she gets a scannable barcode', async () => {
    loginAs('hr');
    const photo = {
      name: 'joy.png',
      type: 'image/png',
      size: 2048,
      blob: new Blob(['x'], { type: 'image/png' }),
    };
    const { worker: saved, failedDocs } = await saveWorkerFile({
      worker: worker(),
      isNew: true,
      photo,
      docs: [
        {
          key: '1',
          draft: {
            type: 'iqama',
            number: '2490011223',
            issue_date: iso(-30),
            expiry_date: iso(335),
            renewal_cost: 650,
            notes: '',
          },
          file: null,
        },
        {
          key: '2',
          draft: {
            type: 'passport',
            number: 'P8812345',
            issue_date: iso(-400),
            expiry_date: iso(3000),
            renewal_cost: 0,
            notes: '',
          },
          file: null,
        },
      ],
    });
    expect(failedDocs).toEqual([]);
    expect(saved.barcode).toMatch(/^MAS-W-\d+$/);
    expect(saved.age).toBe(ageFrom('1994-05-10')); // from the birth date
    expect(saved.photo_url).toBeTruthy();
    const back = (await listHouseWorkers()).find((w) => w.id === saved.id)!;
    expect(back).toMatchObject({
      phone: '0551234567',
      iban: 'SA0380000000608010167519',
      dorm: 'سكن نجران - ب',
      border_no: '3012345678',
    });
    const docs = (await listHrDocuments()).filter(
      (d) => d.owner_kind === 'worker' && d.owner_id === saved.id,
    );
    expect(docs.map((d) => d.type).sort()).toEqual(['iqama', 'passport']);
    expect(resolveWorkerByBarcode(saved.barcode)?.dorm).toBe('سكن نجران - ب');
  });

  it('bank data needs hr.manage; the branch manager edits the rest', async () => {
    loginAs('hr');
    const { worker: saved } = await saveWorkerFile({
      worker: worker({ branch: 'جازان', dorm: 'سكن جازان' }),
      isNew: true,
      photo: null,
      docs: [],
    });
    loginAs('branch_manager');
    await expect(
      saveWorkerFile({
        worker: { ...saved, iban: 'SA4420000001234567891234' },
        isNew: false,
        photo: null,
        docs: [],
      }),
    ).rejects.toThrow('البنكية');
    const ok = await saveWorkerFile({
      worker: { ...saved, phone: '0559999999' },
      isNew: false,
      photo: null,
      docs: [],
    });
    expect(ok.worker.phone).toBe('0559999999');
    expect(ok.worker.barcode).toBe(saved.barcode); // barcode never changes
  });

  it('banks are a managed list; a rename flows into worker files', async () => {
    loginAs('hr');
    const all = await listHrLookups();
    const rajhi = all.find((l) => l.kind === 'bank' && l.name_ar === 'مصرف الراجحي')!;
    expect(rajhi).toBeTruthy();
    await saveHrLookup({ ...rajhi, name_ar: 'مصرف الراجحي (Al Rajhi)' }, false);
    const w1 = (await listHouseWorkers()).find((w) => w.id === 'w1')!;
    expect(w1.bank_name).toBe('مصرف الراجحي (Al Rajhi)');
    await saveHrLookup({ ...rajhi }, false);
  });
});
