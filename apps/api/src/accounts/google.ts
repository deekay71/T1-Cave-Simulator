/**
 * Đăng nhập Google: trình duyệt dùng nút chính thức của Google Identity Services, nhận một ID token
 * (JWT do Google ký) rồi gửi lên POST /v1/auth/google. API tự xác minh chữ ký bằng khóa công khai
 * của Google (tải từ googleapis.com và cache), đúng issuer, đúng audience (GOOGLE_CLIENT_ID của mình)
 * và còn hạn. Không cần client secret, không có trang callback.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { googleDisplayName } from '@te-liet/shared';

export interface GoogleIdentity {
  /** Mã người dùng Google, cố định suốt đời tài khoản Google. */
  sub: string;
  name: string;
  /** Chỉ khi Google xác nhận email (email_verified). */
  email: string | null;
}
export type GoogleVerifier = (credential: string) => Promise<GoogleIdentity>;

const GOOGLE_CERTS = new URL('https://www.googleapis.com/oauth2/v3/certs');
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** OAuth client ID dạng "<số>-<chuỗi>.apps.googleusercontent.com". */
export const isGoogleClientId = (id: string | undefined): id is string =>
  !!id && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id.trim());

export function googleVerifier(clientId: string, keys: JWTVerifyGetKey = createRemoteJWKSet(GOOGLE_CERTS)): GoogleVerifier {
  return async (credential) => {
    const { payload } = await jwtVerify(credential, keys, {
      issuer: ISSUERS, audience: clientId, algorithms: ['RS256'], clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string' || !/^[0-9A-Za-z_-]{1,255}$/.test(payload.sub)) throw new Error('Google token has no subject');
    const email = typeof payload.email === 'string' && payload.email_verified === true ? payload.email.slice(0, 254) : null;
    return { sub: payload.sub, name: googleDisplayName(payload.name, email), email };
  };
}
