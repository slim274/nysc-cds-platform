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
