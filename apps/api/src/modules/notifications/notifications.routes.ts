import { Hono } from 'hono';
import { z } from 'zod';

import {
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead
} from './notifications.service';
import { requireAuth, type AuthEnv } from '../auth/middleware/auth.middleware';

const notificationIdSchema = z.string().uuid();

export const notificationRoutes = new Hono<AuthEnv>();
notificationRoutes.use('*', requireAuth);

notificationRoutes.get('/', async (c) => {
  const parsedLimit = z.coerce.number().int().min(1).max(50).safeParse(c.req.query('limit') ?? '25');
  if (!parsedLimit.success) {
    return c.json({ success: false, message: 'Notification limit must be between 1 and 50.' }, 400);
  }

  try {
    const data = await listUserNotifications(c.get('authUser').id, parsedLimit.data);
    return c.json({ success: true, data });
  } catch (error) {
    console.error('Unable to load notifications:', error);
    return c.json({ success: false, message: 'Unable to load notifications.' }, 500);
  }
});

notificationRoutes.post('/read-all', async (c) => {
  try {
    const data = await markAllUserNotificationsRead(c.get('authUser').id);
    return c.json({ success: true, data });
  } catch (error) {
    console.error('Unable to mark notifications as read:', error);
    return c.json({ success: false, message: 'Unable to update notifications.' }, 500);
  }
});

notificationRoutes.post('/:notificationId/read', async (c) => {
  const parsedId = notificationIdSchema.safeParse(c.req.param('notificationId'));
  if (!parsedId.success) {
    return c.json({ success: false, message: 'Invalid notification ID.' }, 400);
  }

  try {
    const data = await markUserNotificationRead(c.get('authUser').id, parsedId.data);
    return c.json({ success: true, data });
  } catch (error) {
    console.error('Unable to mark notification as read:', error);
    return c.json({ success: false, message: 'Unable to update this notification.' }, 500);
  }
});
