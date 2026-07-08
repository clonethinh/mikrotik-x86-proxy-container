// Auth routes
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth/AuthService';
import { audit } from '../services/audit';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 },
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = await authService.login(username, password);
    if (!user) {
      await audit({ username, action: 'login', ip: req.ip, details: { ok: false } });
      return reply.code(401).send({ error: 'Sai username hoặc password' });
    }
    const token = app.jwt.sign({ uid: user.id, username: user.username, role: user.role });
    await audit({ username, action: 'login', ip: req.ip, details: { ok: true } });
    return reply.send({ token, user });
  });

  app.post('/api/auth/logout', { preHandler: [app.authenticate] }, async (req) => {
    const u = req.user as any;
    await audit({ username: u.username, action: 'logout', ip: req.ip });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return req.user;
  });

  app.post('/api/auth/change-password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    const { oldPassword, newPassword } = req.body as any;
    if (!oldPassword || !newPassword || newPassword.length < 6) {
      return reply.code(400).send({ error: 'Mật khẩu mới phải ≥ 6 ký tự' });
    }
    const ok = await authService.changePassword(u.uid, oldPassword, newPassword);
    if (!ok) return reply.code(400).send({ error: 'Mật khẩu cũ sai' });
    await audit({ userId: u.uid, username: u.username, action: 'change-password', ip: req.ip });
    return { ok: true };
  });

  // Refresh token - issue new JWT if current still valid
  app.post('/api/auth/refresh', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const u = req.user as any;
      const token = app.jwt.sign({ uid: u.uid, username: u.username, role: u.role }, { expiresIn: '7d' });
      return { token };
    } catch (e: any) {
      return reply.code(401).send({ error: 'Token không hợp lệ' });
    }
  });
}