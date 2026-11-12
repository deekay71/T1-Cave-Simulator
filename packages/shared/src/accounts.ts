/**
 * Tài khoản người chơi: hình dạng request/response dùng chung giữa API (apps/api/src/accounts) và
 * web (màn đăng nhập, trang quản trị).
 *
 * - Đăng ký nhanh: tên đăng nhập + mật khẩu (+ tên trong hang, mã mời khi close test đòi).
 * - Google: nút chính thức của Google Identity Services trả về một ID token, API tự xác minh chữ ký.
 * - Khách (Chơi thử) vẫn đi đường /v1/guest như trước, không có tài khoản.
 */
import { z } from "zod";

/** 3–24 ký tự, chữ thường không dấu, số, dấu chấm, gạch dưới, gạch ngang; bắt đầu bằng chữ hoặc số. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,23}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, "Tên đăng nhập 3–24 ký tự: chữ không dấu, số, dấu . _ -");
export const Password = z
  .string()
  .min(PASSWORD_MIN, `Mật khẩu ít nhất ${PASSWORD_MIN} ký tự`)
  .max(PASSWORD_MAX, `Mật khẩu tối đa ${PASSWORD_MAX} ký tự`);
export const DisplayName = z.string().trim().min(1, "Tên trong hang cần 1–24 ký tự").max(24, "Tên trong hang cần 1–24 ký tự");
const Invite = z.string().max(64).optional();

export const SignUpRequest = z
  .object({ username: Username, password: Password, name: DisplayName.optional(), invite: Invite })
  .strict();
export type SignUpRequest = z.input<typeof SignUpRequest>;
export const SignInRequest = z.object({ username: z.string().trim().toLowerCase().max(64), password: z.string().max(PASSWORD_MAX) }).strict();
export type SignInRequest = z.input<typeof SignInRequest>;
export const GoogleSignInRequest = z.object({ credential: z.string().min(20).max(4096), invite: Invite }).strict();
export const ChangePasswordRequest = z.object({ current: z.string().max(PASSWORD_MAX), next: Password }).strict();

export type AccountProvider = "password" | "google";
export type AccountRole = "player" | "admin";
/** Những gì trình duyệt được biết về tài khoản đang đăng nhập (không bao giờ có mật khẩu hay email). */
export interface AccountView {
  id: string;
  /** null với tài khoản Google. */
  username: string | null;
  /** Tên hiện trên đầu nhân vật. */
  name: string;
  provider: AccountProvider;
  role: AccountRole;
}
/** GET /v1/auth/me */
export interface MeResponse {
  account: AccountView | null;
  /** OAuth client ID (công khai) khi API bật đăng nhập Google, không thì null. */
  google: string | null;
  /** Đăng ký mới cần mã mời (close test). */
  inviteRequired: boolean;
}
/** Một dòng ở tab Tài khoản của trang quản trị. */
export interface AccountSummary extends AccountView {
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Tên trong hang mặc định cho tài khoản Google: tên trên Google, cắt còn 24 ký tự. */
export function googleDisplayName(name: unknown, email: unknown): string {
  const raw = typeof name === "string" && name.trim() ? name : typeof email === "string" ? email.split("@")[0] : "";
  const clean = raw.replace(/\s+/g, " ").trim();
  return Array.from(clean).slice(0, 24).join("").trim() || "Người trong hang";
}
