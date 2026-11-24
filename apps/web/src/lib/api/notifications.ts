export interface UserNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items: UserNotification[];
  unreadCount: number;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    credentials: 'same-origin'
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'Unable to complete the notification request.';
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export async function listNotifications(limit = 25): Promise<NotificationsResponse> {
  const response = await request<{ success: boolean; data: NotificationsResponse }>(
    `/notifications?limit=${encodeURIComponent(String(limit))}`
  );
  return response.data;
}

function dispatchNotificationsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('nysc:notifications-changed'));
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
  dispatchNotificationsChanged();
}

export async function markAllNotificationsRead(): Promise<void> {
  await request('/notifications/read-all', { method: 'POST' });
  dispatchNotificationsChanged();
}
