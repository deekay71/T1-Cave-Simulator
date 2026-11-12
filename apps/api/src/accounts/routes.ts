/**
 * Tài khoản người chơi.
 *
 * - GET  /v1/auth/me         { account | null, google: clientId | null, inviteRequired }
 * - POST /v1/auth/signup     { username, password, name?, invite? }   tạo tài khoản + đăng nhập luôn
 * - POST /v1/auth/login      { username, password }
 * - POST /v1/auth/google     { credential, invite? }   ID token từ nút Google; lần đầu thì tạo tài khoản
 * - POST /v1/auth/logout
 * - POST /v1/auth/password   { current, next }   đổi mật khẩu, đăng xuất các phiên khác
 * - POST /v1/auth/ticket     vé vào game (như /v1/guest) cho tài khoản đang đăng nhập
 * - GET  /v1/admin/accounts  danh sách tài khoản (chỉ quản trị)
 *
 * Mã mời (INVITE_CODE) chỉ chặn việc TẠO tài khoản mới; tài khoản đã có thì đăng nhập không cần mã.
 * Tài khoản quản trị không tạo được qua web: dùng `npm run admin:account` (scripts/admin-account.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ChangePasswordRequest, GoogleSignInRequest, SignInRequest, SignUpRequest, type MeResponse } from '@te-liet/shared';
import { TICKET_TTL_SECONDS, type TicketIdentity } from '@te-liet/auth';
import { inviteMatches } from '../invite.js';
import { adminGuard } from '../admin/guard.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { googleVerifier, isGoogleClientId, type GoogleVerifier } from './google.js';
import { fromGamePage, hashToken, newSessionToken, readSession, sessionCookie, sessionExpiry } from './session.js';
import { AccountConflict, accountSummary, accountView, type AccountRecord, type AccountStore } from './store.js';

export interface AccountRoutesOptions {
  issueTicket: (who: TicketIdentity) => Promise<string>;
  inviteCode?: string;
  googleClientId?: string;
  /** Mặc định: xác minh bằng khóa công khai của Google. Test truyền bộ xác minh riêng. */
  verifyGoogle?: GoogleVerifier;
  webOrigin?: string;
  adminToken?: string;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const BAD_LOGIN = () => new HttpError(401, 'bad_credentials', 'Sai tên đăng nhập hoặc mật khẩu.');
/** Đăng ký / đăng nhập / Google: 10 lần mỗi phút cho một IP (chặn dò mật khẩu). */
const STRICT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function registerAccountRoutes(app: FastifyInstance, store: AccountStore, opts: AccountRoutesOptions) {
  const invite = opts.inviteCode?.trim() ?? '';
  const clientId = isGoogleClientId(opts.googleClientId) ? opts.googleClientId.trim() : null;
  if (opts.googleClientId?.trim() && !clientId) app.log.warn('GOOGLE_CLIENT_ID không đúng dạng <số>-<chuỗi>.apps.googleusercontent.com: tắt đăng nhập Google');
  const verifyGoogle = opts.verifyGoogle ?? (clientId ? googleVerifier(clientId) : null);

  const current = async (req: FastifyRequest): Promise<AccountRecord | null> => {
    const token = readSession(req);
    return token ? store.sessionAccount(hashToken(token)) : null;
  };
  const isAdmin = async (req: FastifyRequest) => (await current(req))?.role === 'admin';

  /** Bọc handler: chặn CSRF ở request đổi trạng thái, trả lỗi gọn (không lộ lỗi DB hay token). */
  const handle = <T>(mutation: boolean, fn: (req: FastifyRequest, reply: FastifyReply) => Promise<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        if (mutation && !fromGamePage(req, opts.webOrigin)) throw new HttpError(403, 'origin_forbidden', 'Yêu cầu phải xuất phát từ trang game.');
        return await fn(req, reply);
      } catch (error) {
        if (error instanceof HttpError) return reply.code(error.status).send({ code: error.code, error: error.message });
        req.log.error({ err: error instanceof Error ? error.message : String(error) }, 'accounts failed');
        return reply.code(503).send({ code: 'accounts_unavailable', error: 'Tạm chưa xử lý được tài khoản. Thử lại sau.' });
      }
    };
  const signIn = async (req: FastifyRequest, reply: FastifyReply, account: AccountRecord) => {
    const token = newSessionToken();
    await store.addSession(hashToken(token), account.id, sessionExpiry());
    const fresh = (await store.update(account.id, { lastLoginAt: new Date().toISOString() })) ?? account;
    reply.header('Set-Cookie', sessionCookie(req, token));
    return accountView(fresh);
  };
  const needInvite = (given: string | undefined) => {
    if (inviteMatches(invite, given)) return;
    throw given?.trim()
      ? new HttpError(403, 'invite_invalid', 'Mã mời không đúng')
      : new HttpError(403, 'invite_required', 'Cần mã mời để tạo tài khoản');
  };
  const invalid = (message = 'Dữ liệu không hợp lệ') => new HttpError(400, 'invalid_request', message);

  app.get('/v1/auth/me', handle(false, async (req): Promise<MeResponse> => {
    const account = await current(req);
    return { account: account ? accountView(account) : null, google: clientId, inviteRequired: !!invite };
  }));

  app.post('/v1/auth/signup', STRICT, handle(true, async (req, reply) => {
    const body = SignUpRequest.safeParse(req.body);
    if (!body.success) throw invalid(body.error.issues[0]?.message);
    needInvite(body.data.invite);
    let account: AccountRecord;
    try {
      account = await store.create({
        username: body.data.username, name: body.data.name ?? body.data.username, provider: 'password', role: 'player',
        passwordHash: await hashPassword(body.data.password), googleSub: null, email: null,
      });
    } catch (error) {
      if (error instanceof AccountConflict) throw new HttpError(409, 'username_taken', 'Tên đăng nhập đã có người dùng.');
      throw error;
    }
    req.log.info({ account: account.id }, 'account created (password)');
    return { account: await signIn(req, reply, account) };
  }));

  app.post('/v1/auth/login', STRICT, handle(true, async (req, reply) => {
    const body = SignInRequest.safeParse(req.body);
    if (!body.success) throw BAD_LOGIN();
    const account = await store.findByUsername(body.data.username);
    const ok = account?.passwordHash
      ? await verifyPassword(body.data.password, account.passwordHash)
      : await burnPasswordCheck(body.data.password);
    if (!ok || !account) throw BAD_LOGIN();
    return { account: await signIn(req, reply, account) };
  }));

  app.post('/v1/auth/google', STRICT, handle(true, async (req, reply) => {
    if (!verifyGoogle) throw new HttpError(503, 'google_off', 'Đăng nhập Google chưa được bật trên máy chủ này.');
    const body = GoogleSignInRequest.safeParse(req.body);
    if (!body.success) throw invalid();
    let who;
    try { who = await verifyGoogle(body.data.credential); }
    catch { throw new HttpError(401, 'google_invalid', 'Google không xác nhận được đăng nhập này. Thử lại.'); }
    let account = await store.findByGoogle(who.sub);
    let created = false;
    if (account) {
      if (who.email && who.email !== account.email) account = (await store.update(account.id, { email: who.email })) ?? account;
    } else {
      needInvite(body.data.invite);
      try {
        account = await store.create({ username: null, name: who.name, provider: 'google', role: 'player', passwordHash: null, googleSub: who.sub, email: who.email });
        created = true;
        req.log.info({ account: account.id }, 'account created (google)');
      } catch (error) {
        // hai tab cùng đăng nhập lần đầu: tài khoản vừa được tab kia tạo
        if (!(error instanceof AccountConflict)) throw error;
        account = await store.findByGoogle(who.sub);
        if (!account) throw error;
      }
    }
    return { account: await signIn(req, reply, account), created };
  }));

  app.post('/v1/auth/logout', handle(true, async (req, reply) => {
    const token = readSession(req);
    if (token) await store.removeSession(hashToken(token));
    reply.header('Set-Cookie', sessionCookie(req, null));
    return { ok: true };
  }));

  app.post('/v1/auth/password', STRICT, handle(true, async (req) => {
    const token = readSession(req);
    const account = await current(req);
    if (!token || !account) throw new HttpError(401, 'session_required', 'Cần đăng nhập.');
    if (!account.passwordHash) throw new HttpError(400, 'no_password', 'Tài khoản Google không có mật khẩu ở đây.');
    const body = ChangePasswordRequest.safeParse(req.body);
    if (!body.success) throw invalid(body.error.issues[0]?.message);
    if (!(await verifyPassword(body.data.current, account.passwordHash))) throw new HttpError(401, 'bad_credentials', 'Mật khẩu hiện tại không đúng.');
    await store.update(account.id, { passwordHash: await hashPassword(body.data.next) });
    await store.removeSessionsOf(account.id, hashToken(token));
    return { ok: true };
  }));

  app.post('/v1/auth/ticket', handle(true, async (req) => {
    const account = await current(req);
    if (!account) throw new HttpError(401, 'session_required', 'Phiên đăng nhập đã hết. Đăng nhập lại nhé.');
    const ticket = await opts.issueTicket({ id: account.id, name: account.name, trust: 1 });
    return { ticket, expiresIn: TICKET_TTL_SECONDS };
  }));

  app.register(async (admin) => {
    admin.addHook('onRequest', adminGuard({ token: opts.adminToken, isAdmin, webOrigin: opts.webOrigin }));
    admin.get('/v1/admin/accounts', async () => {
      const list = (await store.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { accounts: list.map(accountSummary), storage: store.kind };
    });
  });
  return { current, isAdmin };
}
