/**
 * Gọi /v1/auth/* của API. Phiên nằm trong cookie HttpOnly do API đặt, nên trang không bao giờ thấy
 * token; mọi request gửi kèm cookie (credentials: "include") và header X-T1-Request (API dùng để
 * chặn trang khác giả request).
 */
import type { AccountView, MeResponse, SignInRequest, SignUpRequest } from "@te-liet/shared";
import { apiRoot } from "../content/api.js";

export class AuthError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiRoot()}${path}`, {
      method,
      credentials: "include",
      headers: { "X-T1-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AuthError("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.", 0, "network");
  }
  const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (res.status === 429) throw new AuthError("Thử nhiều lần quá, đợi một phút rồi thử lại nhé.", 429, "rate_limited");
  if (!res.ok) throw new AuthError(data.error || `Lỗi ${res.status}`, res.status, data.code || "error");
  return data as T;
}

export const auth = {
  me: () => call<MeResponse>("GET", "/v1/auth/me"),
  signup: (form: SignUpRequest) => call<{ account: AccountView }>("POST", "/v1/auth/signup", form),
  login: (form: SignInRequest) => call<{ account: AccountView }>("POST", "/v1/auth/login", form),
  google: (credential: string, invite?: string) =>
    call<{ account: AccountView; created: boolean }>("POST", "/v1/auth/google", invite ? { credential, invite } : { credential }),
  logout: () => call<{ ok: true }>("POST", "/v1/auth/logout", {}),
  /** Vé vào game cho tài khoản đang đăng nhập (như /v1/guest của khách). */
  ticket: () => call<{ ticket: string; expiresIn: number }>("POST", "/v1/auth/ticket", {}),
  changePassword: (current: string, next: string) => call<{ ok: true }>("POST", "/v1/auth/password", { current, next }),
};
