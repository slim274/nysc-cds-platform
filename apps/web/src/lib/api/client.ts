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
  email: string | null;
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
  identifier: string,
  password: string
): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password })
  });
}

export interface CorpsMemberIdentityInput {
  stateCode: string;
  dateOfBirth: string;
  callUpNumber: string;
}

export async function verifyCorpsMemberIdentity(
  input: CorpsMemberIdentityInput
): Promise<{ challengeToken: string; expiresInSeconds: number }> {
  const response = await request<{
    success: boolean;
    data: { challengeToken: string; expiresInSeconds: number };
  }>('/auth/verify-corps-member', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function sendCorpsMemberOtp(
  challengeToken: string,
  channel: 'email' | 'sms'
): Promise<void> {
  await request('/auth/send-corps-member-otp', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, channel })
  });
}

export async function verifyCorpsMemberOtp(
  challengeToken: string,
  code: string
): Promise<void> {
  await request('/auth/verify-corps-member-otp', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, code })
  });
}

export async function registerCorpsMember(
  challengeToken: string,
  password: string
): Promise<{ id: string; email: string | null }> {
  const response = await request<{
    success: boolean;
    user: { id: string; email: string | null };
  }>('/auth/register-corps-member', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, password })
  });
  return response.user;
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

export interface CdsGroupDecline {
  membershipId: string;
  memberId: string;
  stateCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  courseName: string | null;
  groupId: string;
  groupCode: string;
  groupName: string;
  reason: 'schedule_conflict' | 'accessibility' | 'location' | 'personal' | 'other' | null;
  notes: string | null;
  declinedAt: string | null;
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

export interface CdsGroupCourseMappingImpact {
  groupName: string;
  removedCourses: Array<{
    id: string;
    name: string;
    assignedMemberCount: number;
  }>;
  affectedMemberCount: number;
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

export async function listCdsGroupDeclines(filters: {
  lgaId?: string;
} = {}): Promise<CdsGroupDecline[]> {
  const query = new URLSearchParams();
  if (filters.lgaId) query.set('lgaId', filters.lgaId);
  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await request<{
    success: boolean;
    data: CdsGroupDecline[];
  }>(`/lgi/cds-groups/declines${suffix}`);
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

export async function previewCdsGroupCourseMappingImpact(
  groupId: string,
  courseIds: string[]
): Promise<CdsGroupCourseMappingImpact> {
  const response = await request<{
    success: boolean;
    data: CdsGroupCourseMappingImpact;
  }>(`/lgi/cds-groups/${encodeURIComponent(groupId)}/course-mapping-impact`, {
    method: 'POST',
    body: JSON.stringify({ courseIds })
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

export interface CdsGroupMember {
  membershipId: string;
  memberId: string;
  stateCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  courseName: string | null;
  profileStatus: string;
  assignedAt: string;
  courseMappingOverride: boolean;
  courseMappingOverrideReason: string | null;
}

export interface CdsGroupEligibleMember {
  id: string;
  stateCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  courseName: string | null;
  profileStatus: string;
  previousDecline: {
    groupName: string;
    reason: string | null;
    notes: string | null;
    declinedAt: string | null;
  } | null;
}

export interface CdsGroupRoster {
  group: CdsGroupSummary;
  members: CdsGroupMember[];
  eligibleMembers: CdsGroupEligibleMember[];
  manualOverrideMembers: CdsGroupEligibleMember[];
}

export async function getCdsGroupRoster(
  groupId: string,
  search?: string
): Promise<CdsGroupRoster> {
  const query = new URLSearchParams();
  if (search?.trim()) query.set('search', search.trim());
  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await request<{
    success: boolean;
    data: CdsGroupRoster;
  }>(`/lgi/cds-groups/${encodeURIComponent(groupId)}/members${suffix}`);
  return response.data;
}

export async function assignCdsGroupMember(
  groupId: string,
  memberId: string,
  options: { overrideCourseMapping?: boolean; overrideReason?: string } = {}
): Promise<void> {
  await request(`/lgi/cds-groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ memberId, ...options })
  });
}

export async function endCdsGroupMemberMembership(
  groupId: string,
  memberId: string
): Promise<void> {
  await request(
    `/lgi/cds-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'DELETE' }
  );
}

export interface CorpsMemberPortalData {
  member: {
    id: string;
    stateCode: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    lgaName: string | null;
    courseName: string | null;
  };
  cdsGroup: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    whatsappGroupLink: string | null;
    source: 'automatic' | 'manual';
    assignedAt: string;
  } | null;
  coordinator: {
    userId: string;
    email: string | null;
  } | null;
  president: {
    userId: string;
    email: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string;
    stateCode: string;
  } | null;
}

export async function getCorpsMemberPortal(): Promise<CorpsMemberPortalData> {
  const response = await request<{
    success: boolean;
    data: CorpsMemberPortalData;
  }>('/corps-member/portal');
  return response.data;
}

export async function declineAssignedCdsGroup(input: {
  reason: 'schedule_conflict' | 'accessibility' | 'location' | 'personal' | 'other';
  notes?: string;
}): Promise<void> {
  await request('/corps-member/cds-group/decline', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export type DocumentVerificationStatus =
  | 'pending_verification'
  | 'verified'
  | 'needs_resubmission'
  | 'manual_review';

export interface CorpsMemberDocumentSubmission {
  id: string;
  originalFileName: string;
  status: DocumentVerificationStatus;
  verificationConfidence: number | null;
  verificationReason: string | null;
  submittedAt: string;
  verifiedAt: string | null;
}

export interface CorpsMemberDocumentRequirement {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  allowedMimeTypes: string;
  maxFileSizeBytes: number;
  submission: CorpsMemberDocumentSubmission | null;
  canResubmit: boolean;
}

export interface CorpsMemberDocumentDashboard {
  profileStatus: string;
  requirements: CorpsMemberDocumentRequirement[];
  requiredDocumentsVerified: boolean;
  message: string;
}

export async function getCorpsMemberDocuments(): Promise<CorpsMemberDocumentDashboard> {
  const response = await request<{
    success: boolean;
    data: CorpsMemberDocumentDashboard;
  }>('/corps-member/documents');
  return response.data;
}

export async function uploadCorpsMemberDocument(
  requirementId: string,
  file: File
): Promise<{
  submissionId: string;
  status: DocumentVerificationStatus;
  verificationConfidence: number | null;
  verificationReason: string;
  matching: {
    assigned: boolean;
    groupId?: string;
    groupCode?: string;
    groupName?: string;
    reason?: string;
  } | null;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(
    `/api/corps-member/documents/${encodeURIComponent(requirementId)}`,
    {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    }
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'Unable to upload this document.';
    throw new ApiError(message, response.status);
  }
  return data.data;
}

export interface CoordinatorDocumentChecklist {
  groups: Array<{
    groupId: string;
    groupCode: string;
    groupName: string;
    lgaId: string;
    lgaName: string;
    stateName: string;
  }>;
  requirements: Array<{
    id: string;
    lgaId: string;
    lgaName: string;
    stateName: string;
    code: string;
    name: string;
    description: string | null;
    isRequired: boolean;
    isActive: boolean;
    allowedMimeTypes: string;
    maxFileSizeBytes: number;
    hasReferenceSample: string | null;
  }>;
  members: Array<{
    groupId: string;
    memberId: string;
    stateCode: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
  }>;
  memberSubmissions: Array<{
    groupId: string;
    groupCode: string;
    groupName: string;
    memberId: string;
    stateCode: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    requirementId: string;
    requirementName: string;
    isRequired: boolean;
    fileName: string | null;
    status: DocumentVerificationStatus | null;
    confidence: number | null;
    reason: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
  }>;
}

export async function getMyCoordinatorDocuments(): Promise<CoordinatorDocumentChecklist> {
  const response = await request<{
    success: boolean;
    data: CoordinatorDocumentChecklist;
  }>('/coordinator/documents');
  return response.data;
}

export interface DocumentVerificationMode {
  mode: 'manual' | 'ai';
  aiConfigured: boolean;
}

export async function getDocumentVerificationMode(): Promise<DocumentVerificationMode> {
  const response = await request<{
    success: boolean;
    data: DocumentVerificationMode;
  }>('/lgi/document-verification-mode');
  return response.data;
}

export type DocumentRequirementVerificationMode = 'manual' | 'ai_auto' | 'ai_assisted';

export interface LgiDocumentRequirement {
  id: string;
  lgaId: string;
  lgaName: string;
  stateName: string;
  code: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  verificationMode: DocumentRequirementVerificationMode;
  allowedMimeTypes: string;
  maxFileSizeBytes: number;
  hasReferenceSample: string | null;
  referenceFileName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LgiDocumentSubmission {
  id: string;
  requirementId: string;
  requirementName: string;
  verificationMode: DocumentRequirementVerificationMode;
  memberId: string;
  stateCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fileName: string;
  mimeType: string;
  status: DocumentVerificationStatus;
  confidence: number | null;
  reason: string | null;
  submittedAt: string;
}

export async function listLgiDocumentRequirements(): Promise<LgiDocumentRequirement[]> {
  const response = await request<{ success: boolean; data: LgiDocumentRequirement[] }>('/lgi/document-requirements');
  return response.data;
}

export async function createLgiDocumentRequirement(input: {
  lgaId: string;
  code: string;
  name: string;
  description?: string | null;
  isRequired: boolean;
  verificationMode: DocumentRequirementVerificationMode;
  allowedMimeTypes: string[];
  maxFileSizeBytes: number;
  isActive?: boolean;
}): Promise<void> {
  await request('/lgi/document-requirements', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function updateLgiDocumentRequirement(
  requirementId: string,
  input: Partial<{
    code: string;
    name: string;
    description: string | null;
    isRequired: boolean;
    verificationMode: DocumentRequirementVerificationMode;
    allowedMimeTypes: string[];
    maxFileSizeBytes: number;
    isActive: boolean;
  }>
): Promise<{ id: string; isActive: boolean; verificationMode: DocumentRequirementVerificationMode }> {
  const response = await request<{
    success: boolean;
    data: { id: string; isActive: boolean; verificationMode: DocumentRequirementVerificationMode };
  }>(`/lgi/document-requirements/${encodeURIComponent(requirementId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function removeLgiDocumentRequirement(
  requirementId: string
): Promise<{ deleted: boolean; archived: boolean }> {
  const response = await request<{
    success: boolean;
    data: { deleted: boolean; archived: boolean };
  }>(`/lgi/document-requirements/${encodeURIComponent(requirementId)}`, {
    method: 'DELETE'
  });
  return response.data;
}

export async function uploadDocumentReferenceSample(
  requirementId: string,
  file: File
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(
    `/api/lgi/document-requirements/${encodeURIComponent(requirementId)}/reference-sample`,
    {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    }
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'Unable to upload the reference sample.';
    throw new ApiError(message, response.status);
  }
}

export async function listLgiDocumentSubmissions(
  status?: DocumentVerificationStatus
): Promise<LgiDocumentSubmission[]> {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await request<{ success: boolean; data: LgiDocumentSubmission[] }>(
    `/lgi/document-submissions${suffix}`
  );
  return response.data;
}

export async function decideLgiDocumentManualReview(
  submissionId: string,
  decision: 'verified' | 'needs_resubmission',
  reason: string
): Promise<void> {
  await request(`/lgi/document-submissions/${encodeURIComponent(submissionId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason })
  });
}

export async function downloadLgiDocumentSubmission(submissionId: string): Promise<Blob> {
  const response = await fetch(
    `/api/lgi/document-submissions/${encodeURIComponent(submissionId)}/file`,
    { credentials: 'same-origin' }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'Unable to download the document.';
    throw new ApiError(message, response.status);
  }
  return response.blob();
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
  query.set('status', 'active');
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

export interface CoordinatorAssignment {
  assignmentId: string;
  groupId: string | null;
  lgaId: string | null;
  groupCode: string | null;
  groupName: string | null;
  isActive: boolean;
}

export interface CoordinatorRecord {
  userId: string;
  email: string | null;
  accountStatus: 'pending_activation' | 'active' | 'suspended' | 'disabled' | string;
  assignments: CoordinatorAssignment[];
}

export async function listCoordinators(): Promise<CoordinatorRecord[]> {
  const response = await request<{
    success: boolean;
    data: CoordinatorRecord[];
  }>('/lgi/coordinators');
  return response.data;
}

export async function createCoordinator(input: {
  email: string;
  groupIds: string[];
  lgaId?: string;
}): Promise<{
  userId: string;
  email: string | null;
  accountStatus: string;
  created: boolean;
  activationToken: string | null;
}> {
  const response = await request<{
    success: boolean;
    data: {
      userId: string;
      email: string | null;
      accountStatus: string;
      created: boolean;
      activationToken: string | null;
    };
  }>('/lgi/coordinators', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function updateCoordinator(
  coordinatorId: string,
  input: { groupIds?: string[]; isEnabled?: boolean }
): Promise<{
  userId: string;
  email: string | null;
  accountStatus: string;
}> {
  const response = await request<{
    success: boolean;
    data: {
      userId: string;
      email: string | null;
      accountStatus: string;
    };
  }>(`/lgi/coordinators/${encodeURIComponent(coordinatorId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
  return response.data;
}


export interface CoordinatorGroupMember {
  groupId: string;
  memberId: string;
  stateCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  courseName: string | null;
  userId: string | null;
}
export interface CoordinatorWorkspaceGroup {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  maxCapacity: number;
  lgaId: string;
  lgaName: string;
  stateName: string;
  currentMemberCount: number;
  availableCapacity: number;
  president: { memberId: string; name: string; status: string } | null;
  whatsappGroupLink: string | null;
  whatsappAssistantMemberId: string | null;
  members: CoordinatorGroupMember[];
}
export interface CdsPresidentDesignation {
  id: string;
  groupId: string;
  memberId: string;
  stateCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  memberEmail: string | null;
  accountUserId: string | null;
  status: 'pending_activation' | 'active' | 'ended' | string;
  assignedAt: string;
  endedAt: string | null;
  endedByUserId: string | null;
  endedByEmail: string | null;
  endedReason: string | null;
  assignedByUserId: string | null;
  assignedByEmail: string | null;
}
export interface PresidentWorkspaceGroup {
  id: string;
  code: string;
  name: string;
  description: string | null;
  lgaName: string;
  stateName: string;
  maxCapacity: number;
  presidentAssignmentId: string;
  members: Array<{
    groupId: string;
    memberId: string;
    stateCode: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    courseName: string | null;
  }>;
}

export async function getMyCoordinatorGroups(): Promise<CoordinatorWorkspaceGroup[]> {
  const response = await request<{ success: boolean; data: CoordinatorWorkspaceGroup[] }>('/coordinator/groups');
  return response.data;
}

export async function saveMyCoordinatorWhatsAppGroup(
  groupId: string,
  input: { inviteLink: string | null; assistantMemberId: string | null }
): Promise<void> {
  await request(`/coordinator/groups/${encodeURIComponent(groupId)}/whatsapp-group`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function listMyCoordinatorPresidents(): Promise<CdsPresidentDesignation[]> {
  const response = await request<{ success: boolean; data: CdsPresidentDesignation[] }>('/coordinator/presidents');
  return response.data;
}

export async function designateCdsPresident(
  groupId: string,
  memberId: string,
  replaceExisting = false,
  replacementReason?: string
): Promise<{ id: string; groupId: string; groupName: string; memberId: string; memberName: string; stateCode: string; status: string }> {
  const response = await request<{
    success: boolean;
    data: { id: string; groupId: string; groupName: string; memberId: string; memberName: string; stateCode: string; status: string };
  }>(`/coordinator/groups/${encodeURIComponent(groupId)}/president`, {
    method: 'POST',
    body: JSON.stringify({ memberId, replaceExisting, replacementReason })
  });
  return response.data;
}

export async function getMyPresidentGroups(): Promise<PresidentWorkspaceGroup[]> {
  const response = await request<{ success: boolean; data: PresidentWorkspaceGroup[] }>('/cds-president/groups');
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


export interface CoordinatorHandover {
  id: string;
  groupId: string;
  groupCode: string;
  groupName: string;
  outgoingCoordinatorId?: string;
  outgoingCoordinatorEmail: string | null;
  incomingCoordinatorId?: string;
  incomingCoordinatorEmail: string;
  status: 'pending_acceptance' | 'accepted' | 'cancelled' | string;
  reason: string;
  handoverNotes: string;
  pendingActivities: string[];
  upcomingEvents: string[];
  outstandingTasks: string[];
  acceptanceNotes: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export type CoordinatorHandoverReason =
  | 'resignation'
  | 'transfer'
  | 'temporary_replacement'
  | 'other';

export async function listCoordinatorHandovers(): Promise<CoordinatorHandover[]> {
  const response = await request<{
    success: boolean;
    data: CoordinatorHandover[];
  }>('/lgi/coordinators/handovers');
  return response.data;
}

export async function createCoordinatorHandover(input: {
  groupId: string;
  outgoingCoordinatorId: string;
  incomingCoordinatorId: string;
  reason: CoordinatorHandoverReason;
  handoverNotes: string;
  pendingActivities: string[];
  upcomingEvents: string[];
  outstandingTasks: string[];
}): Promise<Pick<CoordinatorHandover, 'id' | 'status' | 'groupCode' | 'groupName' | 'outgoingCoordinatorEmail' | 'incomingCoordinatorEmail'>> {
  const response = await request<{
    success: boolean;
    data: Pick<CoordinatorHandover, 'id' | 'status' | 'groupCode' | 'groupName' | 'outgoingCoordinatorEmail' | 'incomingCoordinatorEmail'>;
  }>('/lgi/coordinators/handovers', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return response.data;
}

export interface CoordinatorCourseMappingGroup {
  id: string;
  code: string;
  name: string;
  lgaName: string;
  stateName: string;
  isActive: boolean;
  maxCapacity: number;
  courses: CdsGroupCourse[];
}

export interface CoordinatorCourseMappingData {
  groups: CoordinatorCourseMappingGroup[];
  courses: CdsGroupCourse[];
}

export async function getMyCoordinatorCourseMappings(): Promise<CoordinatorCourseMappingData> {
  const response = await request<{
    success: boolean;
    data: CoordinatorCourseMappingData;
  }>('/coordinator/course-mappings');
  return response.data;
}

export async function updateMyCoordinatorCourseMapping(
  groupId: string,
  courseIds: string[]
): Promise<void> {
  await request(`/coordinator/course-mappings/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ courseIds })
  });
}

export async function listMyCoordinatorHandovers(): Promise<CoordinatorHandover[]> {
  const response = await request<{
    success: boolean;
    data: CoordinatorHandover[];
  }>('/coordinator/handovers');
  return response.data;
}

export async function acceptMyCoordinatorHandover(
  handoverId: string,
  acceptanceNotes: string
): Promise<void> {
  await request('/coordinator/handovers/' + encodeURIComponent(handoverId) + '/accept', {
    method: 'POST',
    body: JSON.stringify({ acceptanceNotes })
  });
}


export async function cancelCoordinatorHandover(handoverId: string): Promise<void> {
  await request('/lgi/coordinators/handovers/' + encodeURIComponent(handoverId) + '/cancel', {
    method: 'POST'
  });
}

export type CorpsProfileStatus = 'preloaded' | 'draft' | 'submitted' | 'approved' | 'rejected';

export interface CorpsMemberRecord {
  id: string;
  stateCode: string;
  callUpNumber: string | null;
  email: string | null;
  phone: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string | null;
  dateOfBirth: string | null;
  qualification: string | null;
  graduationYear: number | null;
  lgaId: string;
  lgaName: string;
  lgaState: string;
  streamId: string;
  streamName: string;
  streamCode: string;
  batchName: string;
  batchCode: string;
  serviceYear: number;
  institutionName: string | null;
  courseName: string | null;
  profileStatus: CorpsProfileStatus;
  hasPassportPhoto: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CorpsMemberDetail {
  id: string;
  userId: string | null;
  stateCode: string;
  callUpNumber: string | null;
  email: string | null;
  phone: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  lgaId: string;
  streamId: string;
  institutionId: string | null;
  courseId: string | null;
  qualification: string | null;
  graduationYear: number | null;
  profileStatus: CorpsProfileStatus;
  hasPassportPhoto: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NyscStreamRecord {
  id: string; batchId: string; code: string; name: string; isActive: boolean; memberCount: number;
}
export interface NyscBatchRecord {
  id: string; serviceYearId: string; code: string; name: string; isActive: boolean; memberCount: number; streams: NyscStreamRecord[];
}
export interface NyscServiceYearRecord {
  id: string; year: number; startDate: string | null; endDate: string | null; isActive: boolean; memberCount: number; batches: NyscBatchRecord[];
}

export async function listNyscCohorts(): Promise<NyscServiceYearRecord[]> {
  const response = await request<{ success: boolean; data: NyscServiceYearRecord[] }>('/lgi/batches-streams');
  return response.data;
}

export async function createServiceYear(input: { year: number; startDate?: string | null; endDate?: string | null; isActive?: boolean }): Promise<void> {
  await request('/lgi/service-years', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateServiceYear(id: string, input: { year?: number; startDate?: string | null; endDate?: string | null; isActive?: boolean }): Promise<void> {
  await request(`/lgi/service-years/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function createNyscBatch(serviceYearId: string, input: { code: string; name: string; isActive?: boolean }): Promise<void> {
  await request(`/lgi/service-years/${encodeURIComponent(serviceYearId)}/batches`, { method: 'POST', body: JSON.stringify(input) });
}

export async function updateNyscBatch(id: string, input: { code?: string; name?: string; isActive?: boolean }): Promise<void> {
  await request(`/lgi/batches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function createNyscStream(batchId: string, input: { code: string; name: string; isActive?: boolean }): Promise<void> {
  await request(`/lgi/batches/${encodeURIComponent(batchId)}/streams`, { method: 'POST', body: JSON.stringify(input) });
}

export async function updateNyscStream(id: string, input: { code?: string; name?: string; isActive?: boolean }): Promise<void> {
  await request(`/lgi/streams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export interface CorpsMemberReferenceData {
  lgas: Array<{ id: string; name: string; stateName: string }>;
  streams: Array<{
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    batchId: string;
    batchCode: string;
    batchName: string;
    batchIsActive: boolean;
    serviceYearId: string;
    serviceYear: number;
    serviceYearIsActive: boolean;
  }>;
  institutions: Array<{ id: string; name: string; abbreviation: string | null }>;
  courses: Array<{ id: string; name: string; disciplineCategory: string }>;
}

export interface CorpsMemberInput {
  stateCode: string;
  callUpNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  lgaId: string;
  streamId: string;
  institutionId?: string | null;
  courseId?: string | null;
  qualification?: string | null;
  graduationYear?: number | null;
  profileStatus?: CorpsProfileStatus;
}

export async function getCorpsMemberReferenceData(): Promise<CorpsMemberReferenceData> {
  const response = await request<{ success: boolean; data: CorpsMemberReferenceData }>('/lgi/corps-members/reference-data');
  return response.data;
}

export async function listCorpsMembers(filters: {
  search?: string;
  lgaId?: string;
  streamId?: string;
  batchId?: string;
  serviceYear?: number;
  profileStatus?: CorpsProfileStatus;
  page?: number;
  pageSize?: number;
} = {}): Promise<{
  data: CorpsMemberRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.lgaId) query.set('lgaId', filters.lgaId);
  if (filters.streamId) query.set('streamId', filters.streamId);
  if (filters.batchId) query.set('batchId', filters.batchId);
  if (filters.serviceYear !== undefined) query.set('serviceYear', String(filters.serviceYear));
  if (filters.profileStatus) query.set('profileStatus', filters.profileStatus);
  query.set('page', String(filters.page ?? 1));
  query.set('pageSize', String(filters.pageSize ?? 20));
  const response = await request<{
    success: boolean;
    data: CorpsMemberRecord[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`/lgi/corps-members?${query.toString()}`);
  return { data: response.data, pagination: response.pagination };
}

export async function createCorpsMember(input: CorpsMemberInput): Promise<CorpsMemberDetail> {
  const response = await request<{ success: boolean; data: CorpsMemberDetail }>('/lgi/corps-members', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function updateCorpsMember(memberId: string, input: Partial<CorpsMemberInput>): Promise<CorpsMemberDetail> {
  const response = await request<{ success: boolean; data: CorpsMemberDetail }>(`/lgi/corps-members/${encodeURIComponent(memberId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
  return response.data;
}
export async function getCorpsMember(memberId: string): Promise<CorpsMemberDetail> {
  const response = await request<{ success: boolean; data: CorpsMemberDetail }>(`/lgi/corps-members/${encodeURIComponent(memberId)}`);
  return response.data;
}

export async function importCorpsMemberCsv(csv: string): Promise<{
  created: number;
  updated: number;
  totalProcessed: number;
}> {
  const response = await request<{
    success: boolean;
    data: { created: number; updated: number; totalProcessed: number };
  }>('/lgi/corps-members/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv
  });
  return response.data;
}

export async function downloadCorpsMembersCsv(filters: {
  search?: string;
  lgaId?: string;
  streamId?: string;
  batchId?: string;
  serviceYear?: number;
  profileStatus?: CorpsProfileStatus;
} = {}): Promise<Blob> {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.lgaId) query.set('lgaId', filters.lgaId);
  if (filters.streamId) query.set('streamId', filters.streamId);
  if (filters.batchId) query.set('batchId', filters.batchId);
  if (filters.serviceYear !== undefined) query.set('serviceYear', String(filters.serviceYear));
  if (filters.profileStatus) query.set('profileStatus', filters.profileStatus);

  const response = await fetch(`/api/lgi/corps-members/export?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'text/csv' },
    credentials: 'same-origin'
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'Unable to export corps member records.';
    throw new ApiError(message, response.status);
  }
  return response.blob();
}

export async function uploadCorpsMemberPhoto(memberId: string, photo: File): Promise<void> {
  const formData = new FormData();
  formData.append('photo', photo);
  const response = await fetch(`/api/lgi/corps-members/${encodeURIComponent(memberId)}/photo`, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'Unable to upload the profile photo.';
    throw new ApiError(message, response.status);
  }
}



export type CdsAttendanceStatus = 'not_marked' | 'present' | 'absent' | 'late' | 'excused';
export type CdsMeetingStatus = 'scheduled' | 'attendance_open' | 'submitted' | 'reviewed' | 'cancelled';

export interface CdsMeetingAttendanceRecord {
  id: string;
  memberId: string;
  stateCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  status: CdsAttendanceStatus;
  notes: string | null;
  markedAt: string | null;
  markedByUserId: string | null;
}

export interface CdsMeetingSummary {
  id: string;
  groupId: string;
  groupCode: string;
  groupName: string;
  lgaId: string;
  lgaName: string;
  stateName: string;
  title: string;
  description: string | null;
  venue: string | null;
  startsAt: string;
  endsAt: string;
  status: CdsMeetingStatus;
  createdByUserId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewDecision: 'approved' | 'returned' | null;
  reviewNotes: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  attendanceSummary: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    unmarked: number;
    total: number;
  };
}

export interface CdsMeetingDetails extends CdsMeetingSummary {
  attendance: CdsMeetingAttendanceRecord[];
  audit?: Array<{
    id: string;
    eventType: string;
    details: Record<string, unknown>;
    actorUserId: string | null;
    createdAt: string;
  }>;
}

export async function listCoordinatorAttendanceMeetings(): Promise<CdsMeetingSummary[]> {
  const response = await request<{ success: boolean; data: CdsMeetingSummary[] }>('/coordinator/attendance/meetings');
  return response.data;
}

export async function createCdsMeeting(input: {
  groupId: string;
  title: string;
  description?: string;
  venue?: string;
  startsAt: string;
  endsAt: string;
}): Promise<CdsMeetingDetails> {
  const response = await request<{ success: boolean; data: CdsMeetingDetails }>('/coordinator/attendance/meetings', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function getCoordinatorAttendanceMeeting(meetingId: string): Promise<CdsMeetingDetails> {
  const response = await request<{ success: boolean; data: CdsMeetingDetails }>(
    `/coordinator/attendance/meetings/${encodeURIComponent(meetingId)}`
  );
  return response.data;
}

export async function reviewCdsMeetingAttendance(
  meetingId: string,
  decision: 'approved' | 'returned',
  notes?: string
): Promise<void> {
  await request(`/coordinator/attendance/meetings/${encodeURIComponent(meetingId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes })
  });
}

export async function cancelCdsMeeting(meetingId: string): Promise<void> {
  await request(`/coordinator/attendance/meetings/${encodeURIComponent(meetingId)}/cancel`, {
    method: 'POST'
  });
}

export async function listPresidentAttendanceMeetings(): Promise<CdsMeetingSummary[]> {
  const response = await request<{ success: boolean; data: CdsMeetingSummary[] }>('/cds-president/attendance/meetings');
  return response.data;
}

export async function getPresidentAttendanceMeeting(meetingId: string): Promise<CdsMeetingDetails> {
  const response = await request<{ success: boolean; data: CdsMeetingDetails }>(
    `/cds-president/attendance/meetings/${encodeURIComponent(meetingId)}`
  );
  return response.data;
}

export async function openCdsMeetingAttendance(meetingId: string): Promise<void> {
  await request(`/cds-president/attendance/meetings/${encodeURIComponent(meetingId)}/open`, {
    method: 'POST'
  });
}

export async function markCdsMeetingAttendance(
  meetingId: string,
  memberId: string,
  status: Exclude<CdsAttendanceStatus, 'not_marked'>,
  notes?: string
): Promise<void> {
  await request(
    `/cds-president/attendance/meetings/${encodeURIComponent(meetingId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'PATCH', body: JSON.stringify({ status, notes }) }
  );
}

export async function submitCdsMeetingAttendance(meetingId: string): Promise<void> {
  await request(`/cds-president/attendance/meetings/${encodeURIComponent(meetingId)}/submit`, {
    method: 'POST'
  });
}

export async function listLgiAttendanceMeetings(): Promise<CdsMeetingSummary[]> {
  const response = await request<{ success: boolean; data: CdsMeetingSummary[] }>('/lgi/attendance/meetings');
  return response.data;
}

export async function getLgiAttendanceMeeting(meetingId: string): Promise<CdsMeetingDetails> {
  const response = await request<{ success: boolean; data: CdsMeetingDetails }>(
    `/lgi/attendance/meetings/${encodeURIComponent(meetingId)}`
  );
  return response.data;
}


export interface CorpsMemberApprovedAttendance {
  attendanceId: string;
  meetingId: string;
  groupCode: string;
  groupName: string;
  meetingTitle: string;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  attendanceStatus: Exclude<CdsAttendanceStatus, 'not_marked'>;
  notes: string | null;
  reviewedAt: string | null;
}

export async function listMyApprovedAttendance(): Promise<CorpsMemberApprovedAttendance[]> {
  const response = await request<{ success: boolean; data: CorpsMemberApprovedAttendance[] }>('/corps-member/attendance');
  return response.data;
}
