import type { ServiceDetails } from '@/features/requests/types';
import { OTHER_OCCASION_CODE } from '@/features/requests/types';

export interface DetailRow {
  /** مفتاح ثابت لاختيار الأيقونة في العرض. */
  key: string;
  label: string;
  value: string;
}

const yesNo = (v: boolean) => (v ? 'نعم' : 'لا');

/**
 * صفوف «نوع المستفيد وبيانات المكان» للعرض — ما ينطبق على الطلب فقط. أسماء
 * الأكواد تُمرَّر من القوائم المرجعية (الإعدادات) ليبقى العرض مطابقًا لما يضبطه الإداري.
 */
export function serviceDetailRows(
  details: ServiceDetails,
  names: { beneficiary: (code: string) => string; occasion: (code: string) => string },
): DetailRow[] {
  const rows: DetailRow[] = [];
  if (!details.beneficiaryType) return rows;
  rows.push({
    key: 'beneficiary',
    label: 'نوع المستفيد',
    value: names.beneficiary(details.beneficiaryType),
  });
  if (details.occasionType) {
    rows.push({
      key: 'occasion',
      label: 'نوع المناسبة',
      value:
        details.occasionType === OTHER_OCCASION_CODE && details.customOccasionType
          ? details.customOccasionType
          : names.occasion(details.occasionType),
    });
  }

  const loc = details.locationDetails;
  switch (loc?.kind) {
    case 'home':
      rows.push({ key: 'floors', label: 'عدد الأدوار', value: String(loc.floors) });
      rows.push({ key: 'rooms', label: 'عدد الغرف', value: String(loc.rooms) });
      rows.push({ key: 'children', label: 'يوجد أطفال', value: yesNo(loc.hasChildren) });
      if (loc.hasChildren && loc.childrenCount !== null) {
        rows.push({ key: 'children', label: 'عدد الأطفال', value: String(loc.childrenCount) });
      }
      rows.push({ key: 'elderly', label: 'يوجد كبار سن', value: yesNo(loc.hasElderly) });
      if (loc.hasElderly && loc.elderlyNeedCare !== null) {
        rows.push({ key: 'care', label: 'يحتاجون إلى رعاية', value: yesNo(loc.elderlyNeedCare) });
      }
      break;
    case 'facility':
      rows.push({ key: 'type', label: 'نوع المنشأة', value: loc.facilityType });
      rows.push({ key: 'sections', label: 'عدد الأقسام', value: String(loc.sectionsCount) });
      rows.push({
        key: 'people',
        label: 'عدد المستفيدين / الموظفين',
        value: String(loc.beneficiariesCount),
      });
      break;
    case 'commercial':
      rows.push({ key: 'type', label: 'نوع النشاط', value: loc.businessType });
      rows.push({ key: 'sections', label: 'عدد الفروع', value: String(loc.branchesCount) });
      rows.push({
        key: 'people',
        label: 'عدد الأشخاص المطلوب خدمتهم',
        value: String(loc.servedPeople),
      });
      break;
    case 'occasion':
      if (loc.eventDate) rows.push({ key: 'date', label: 'تاريخ المناسبة', value: loc.eventDate });
      rows.push({ key: 'people', label: 'عدد الحضور التقريبي', value: String(loc.attendees) });
      break;
    default:
      break;
  }
  return rows;
}
