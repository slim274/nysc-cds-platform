export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthRole {
  code: string;
  name: string;
  lgaId: string | null;
  cdsGroupId: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  user: AuthUser;
  expiresAt: string;
}

export interface CurrentUserResponse {
  success: boolean;
  user: AuthUser;
  roles: AuthRole[];
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set('Accept', 'application/json');

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin'
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : 'An unexpected API error occurred.';

    throw new ApiError(message, response.status);
  }

  return data as T;
}

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  return request<CurrentUserResponse>('/auth/me', {
    method: 'GET'
  });
}

export async function logout(): Promise<void> {
  await request('/auth/logout', {
    method: 'POST'
  });
}

export interface CdsGroupSummary {
  id: string;
  lgaId: string;
  lgaName: string;
  stateName: string;
  code: string;
  name: string;
  description: string | null;
  maxCapacity: number;
  isActive: boolean;
  currentMemberCount: number;
  availableCapacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface CdsGroupCourse {
  id: string;
  name: string;
  disciplineCategory: string;
  aliases?: string[];
}

export interface CdsGroupDetail extends CdsGroupSummary {
  courses: CdsGroupCourse[];
  coordinatorAssignments: Array<{
    userId: string;
    email: string | null;
    status: string;
  }>;
}

export interface CdsGroupReferenceData {
  lgas: Array<{
    id: string;
    name: string;
    stateName: string;
  }>;
  courses: CdsGroupCourse[];
}

export interface CreateCdsGroupInput {
  lgaId: string;
  code: string;
  name: string;
  description?: string | null;
  maxCapacity: number;
  courseIds: string[];
}

export type UpdateCdsGroupInput = Partial<
  Omit<CreateCdsGroupInput, 'lgaId'>
> & {
  isActive?: boolean;
};

export async function getCdsGroupReferenceData(): Promise<CdsGroupReferenceData> {
  const response = await request<{
    success: boolean;
    data: CdsGroupReferenceData;
  }>('/lgi/cds-groups/reference-data');

  return response.data;
}

export async function listCdsGroups(filters: {
  lgaId?: string;
  search?: string;
  active?: boolean;
} = {}): Promise<CdsGroupSummary[]> {
  const query = new URLSearchParams();

  if (filters.lgaId) query.set('lgaId', filters.lgaId);
  if (filters.search) query.set('search', filters.search);
  if (filters.active !== undefined) {
    query.set('active', String(filters.active));
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await request<{
    success: boolean;
    data: CdsGroupSummary[];
  }>(`/lgi/cds-groups${suffix}`);

  return response.data;
}

export async function getCdsGroup(groupId: string): Promise<CdsGroupDetail> {
  const response = await request<{
    success: boolean;
    data: CdsGroupDetail;
  }>(`/lgi/cds-groups/${encodeURIComponent(groupId)}`);

  return response.data;
}

export async function createCdsGroup(
  input: CreateCdsGroupInput
): Promise<CdsGroupDetail> {
  const response = await request<{
    success: boolean;
    message: string;
    data: CdsGroupDetail;
  }>('/lgi/cds-groups', {
    method: 'POST',
    body: JSON.stringify(input)
  });

  return response.data;
}

export async function updateCdsGroup(
  groupId: string,
  input: UpdateCdsGroupInput
): Promise<CdsGroupDetail> {
  const response = await request<{
    success: boolean;
    message: string;
    data: CdsGroupDetail;
  }>(`/lgi/cds-groups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });

  return response.data;
}

export interface CourseCategory {
  code: string;
  label: string;
}

export interface CourseCatalogueItem {
  id: string;
  name: string;
  normalizedName: string;
  disciplineCategory: string;
  isActive: boolean;
  createdAt: string;
  aliases: Array<{ id: string; name: string }>;
}

export interface CourseInput {
  name: string;
  disciplineCategory: string;
  aliases: string[];
}

export async function listLgiAdminCourses(filters: {
  q?: string;
  category?: string;
  status?: 'active' | 'inactive' | 'all';
} = {}): Promise<CourseCatalogueItem[]> {
  const query = new URLSearchParams();
  if (filters.q) query.set('q', filters.q);
  if (filters.category) query.set('category', filters.category);
  if (filters.status) query.set('status', filters.status);
  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await request<{
    success: boolean;
    data: CourseCatalogueItem[];
  }>(`/lgi/course-catalogue${suffix}`);
  return response.data;
}

export async function listLgiCourses(filters: {
  q?: string;
  category?: string;
} = {}): Promise<CourseCatalogueItem[]> {
  const query = new URLSearchParams();
  if (filters.q) query.set('q', filters.q);
  if (filters.category) query.set('category', filters.category);
  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await request<{
    success: boolean;
    data: CourseCatalogueItem[];
  }>(`/lgi/course-catalogue${suffix}`);
  return response.data;
}

export async function getCourseCategories(): Promise<CourseCategory[]> {
  const response = await request<{
    success: boolean;
    data: CourseCategory[];
  }>('/lgi/course-catalogue/categories');
  return response.data;
}

export async function createCatalogueCourse(input: CourseInput): Promise<CourseCatalogueItem> {
  const response = await request<{
    success: boolean;
    data: CourseCatalogueItem;
  }>('/lgi/course-catalogue', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function updateCatalogueCourse(
  courseId: string,
  input: Partial<CourseInput> & { isActive?: boolean }
): Promise<CourseCatalogueItem> {
  const response = await request<{
    success: boolean;
    data: CourseCatalogueItem;
  }>(`/lgi/course-catalogue/${encodeURIComponent(courseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function importCourseCsv(csv: string): Promise<{
  inserted: number;
  updated: number;
  aliasesAdded: number;
  totalProcessed: number;
}> {
  const response = await request<{
    success: boolean;
    data: {
      inserted: number;
      updated: number;
      aliasesAdded: number;
      totalProcessed: number;
    };
  }>('/lgi/course-catalogue/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv
  });
  return response.data;
}

export function getCourseDisciplineLabel(code: string): string {
  const labels: Record<string, string> = {
    AGRICULTURE: 'Agriculture & Agricultural Sciences',
    ARTS_HUMANITIES: 'Arts & Humanities',
    BUILT_ENVIRONMENT: 'Architecture & Built Environment',
    EDUCATION: 'Education',
    ENGINEERING: 'Engineering & Technology',
    ENVIRONMENTAL_SCIENCES: 'Environmental Sciences',
    HEALTH: 'Health & Medical Sciences',
    ICT: 'ICT & Computing',
    LEGAL: 'Law & Legal Studies',
    MANAGEMENT_SCIENCES: 'Management Sciences',
    NATURAL_SCIENCES: 'Natural & Physical Sciences',
    PHARMACEUTICAL_SCIENCES: 'Pharmaceutical Sciences',
    SOCIAL_SCIENCES: 'Social Sciences',
    VETERINARY_MEDICINE: 'Veterinary Medicine',
    UNCLASSIFIED: 'Unclassified / Other'
  };
  return labels[code] ?? code;
}
