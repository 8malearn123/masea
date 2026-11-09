/** بيانات الشركة المُدارة (company_profile، 0086) — الحقل الفارغ لا يُعرض في الموقع. */
export interface CompanyProfile {
  display_name: string | null;
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
  founded_year: number | null;
  phone: string | null;
  /** بالصيغة الدولية 9665xxxxxxxx */
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  working_hours: string | null;
  maps_url: string | null;
  instagram_url: string | null;
  x_url: string | null;
  snapchat_url: string | null;
  tiktok_url: string | null;
  linkedin_url: string | null;
  hero_image_url: string | null;
  experience_image_url: string | null;
  privacy_url: string | null;
  terms_url: string | null;
}

export const EMPTY_COMPANY: CompanyProfile = {
  display_name: null,
  legal_name: null,
  cr_number: null,
  vat_number: null,
  founded_year: null,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  working_hours: null,
  maps_url: null,
  instagram_url: null,
  x_url: null,
  snapchat_url: null,
  tiktok_url: null,
  linkedin_url: null,
  hero_image_url: null,
  experience_image_url: null,
  privacy_url: null,
  terms_url: null,
};

/** ما تعرضه صفحة الهبوط — بيانات حقيقية فقط (public_site_info، 0086). */
export interface PublicSiteInfo {
  company: CompanyProfile;
  branches: string[];
  services: { code: string; name: string }[];
  nationalities: number;
  hourly_min_hours: number | null;
  hourly_max_hours: number | null;
  replacement_guarantee_days: number | null;
}

export interface WebLeadInput {
  full_name: string;
  phone: string;
  service_code: string;
  city: string;
  notes: string;
  /** حقل فخّ مخفي للروبوتات — يبقى فارغًا عند الإنسان */
  website: string;
}
