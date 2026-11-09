export const COURSE_DISCIPLINE_CATEGORIES = [
  { code: 'AGRICULTURE', label: 'Agriculture & Agricultural Sciences' },
  { code: 'ARTS_HUMANITIES', label: 'Arts & Humanities' },
  { code: 'BUILT_ENVIRONMENT', label: 'Architecture & Built Environment' },
  { code: 'EDUCATION', label: 'Education' },
  { code: 'ENGINEERING', label: 'Engineering & Technology' },
  { code: 'ENVIRONMENTAL_SCIENCES', label: 'Environmental Sciences' },
  { code: 'HEALTH', label: 'Health & Medical Sciences' },
  { code: 'ICT', label: 'ICT & Computing' },
  { code: 'LEGAL', label: 'Law & Legal Studies' },
  { code: 'MANAGEMENT_SCIENCES', label: 'Management Sciences' },
  { code: 'NATURAL_SCIENCES', label: 'Natural & Physical Sciences' },
  { code: 'PHARMACEUTICAL_SCIENCES', label: 'Pharmaceutical Sciences' },
  { code: 'SOCIAL_SCIENCES', label: 'Social Sciences' },
  { code: 'VETERINARY_MEDICINE', label: 'Veterinary Medicine' },
  { code: 'UNCLASSIFIED', label: 'Unclassified / Other' }
] as const;

export const COURSE_CATEGORY_CODES = COURSE_DISCIPLINE_CATEGORIES.map(
  (category) => category.code
) as [string, ...string[]];

export function getCourseCategoryLabel(code: string): string {
  return COURSE_DISCIPLINE_CATEGORIES.find(
    (category) => category.code === code
  )?.label ?? code;
}
