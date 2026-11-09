/**
 * Worker file (0078) — one save for the whole file: photo → catalog profile +
 * private details → official documents → housing (barcode/dorm).
 * Live: Storage «worker-photos» (public, catalog photos) + worker_profiles +
 * worker_details (the database syncs the operational record). Demo: same
 * rules over the in-memory stores.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { persistHouseWorker } from '@/features/hr/api/hr.api';
import { createHrDocument } from '@/features/hr/api/documents.api';
import {
  listDorms,
  upsertResidentFromWorker,
  workerDormError,
} from '@/features/housing/api/housing.api';
import { ageFrom, validatePhoto, workerErrors } from '@/features/hr/lib/workerValidation';
import type { DocFile, DocumentDraft, HouseWorker } from '@/features/hr/types';

export const WORKER_PHOTOS_BUCKET = 'worker-photos';

/** A document entered in the add form, saved once the worker exists. */
export interface PendingDoc {
  key: string;
  draft: Omit<DocumentDraft, 'owner_kind' | 'owner_id'>;
  file: DocFile | null;
}

export interface DormOption {
  name: string;
  branch: string;
  capacity: number | null;
  occupied: number;
}

/** المساكن النشطة لاختيار سكن العاملة (الإشغال محسوب في الخادم — 0081). */
export async function listDormOptions(): Promise<DormOption[]> {
  return (await listDorms())
    .filter((d) => d.is_active)
    .map((d) => ({ name: d.name, branch: d.branch, capacity: d.capacity, occupied: d.occupied }));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    r.readAsDataURL(blob);
  });
}

/** Upload the photo and return its public URL (demo: an inline data URL). */
export async function uploadWorkerPhoto(file: DocFile): Promise<string> {
  const err = validatePhoto(file);
  if (err) throw new Error(err);
  if (!isDemoMode()) {
    const ext =
      (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from(WORKER_PHOTOS_BUCKET)
      .upload(path, file.blob, { contentType: file.type, upsert: false });
    if (error) throw new Error(`تعذّر رفع الصورة: ${error.message}`);
    return supabase.storage.from(WORKER_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  return typeof FileReader === 'undefined' ? `demo://${file.name}` : readAsDataUrl(file.blob);
}

export interface SaveWorkerResult {
  worker: HouseWorker;
  /** documents that could not be saved (the worker itself was saved) */
  failedDocs: string[];
}

export async function saveWorkerFile(input: {
  worker: HouseWorker;
  isNew: boolean;
  photo: DocFile | null;
  docs: PendingDoc[];
}): Promise<SaveWorkerResult> {
  const w = { ...input.worker };
  const age = ageFrom(w.birth_date);
  if (age !== null) w.age = age; // birth date wins over a typed age
  const errs = workerErrors(w);
  const first = Object.values(errs)[0];
  if (first) throw new Error(first);
  // مرآة guard_worker_dorm (0081): سكن نشط، من فرع العاملة، وغير ممتلئ
  if (isDemoMode()) {
    const dormErr = workerDormError(w.dorm, w.branch, w.barcode);
    if (dormErr) throw new Error(dormErr);
  }
  if (input.photo) w.photo_url = await uploadWorkerPhoto(input.photo);

  const saved = await persistHouseWorker(w, input.isNew);

  const failedDocs: string[] = [];
  for (const d of input.docs) {
    try {
      await createHrDocument({ ...d.draft, owner_kind: 'worker', owner_id: saved.id }, d.file);
    } catch (e) {
      failedDocs.push(`${d.draft.number}: ${(e as Error).message}`);
    }
  }
  if (isDemoMode()) upsertResidentFromWorker(saved);
  return { worker: saved, failedDocs };
}
