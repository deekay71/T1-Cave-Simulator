/**
 * Nút "Đăng nhập bằng Google" chính thức (Google Identity Services). Google vẽ nút trong iframe của
 * họ; bấm xong Google trả về một ID token (credential) qua callback, trang chuyển nguyên token đó cho
 * API xác minh (POST /v1/auth/google). Thư viện chỉ được tải khi API báo đã bật Google.
 *
 * Origin của trang (vd. https://<tunnel>.trycloudflare.com, http://localhost:5190) phải nằm trong
 * "Authorized JavaScript origins" của OAuth client trên Google Cloud, không thì Google báo lỗi
 * origin_mismatch ngay trong popup (docs/accounts.md).
 */
const GIS_URL = "https://accounts.google.com/gsi/client";

interface GisId {
  initialize(options: Record<string, unknown>): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GisId } };
  }
}

let loading: Promise<GisId> | null = null;
function loadGis(): Promise<GisId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  loading ??= new Promise<GisId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_URL;
    script.async = true;
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("gis")));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Không tải được nút Google."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

let initializedFor: string | null = null;
let onCredential: ((credential: string) => void) | null = null;

/** Vẽ nút Google vào `el` (rộng `width` px, Google cho 200–400). Lỗi tải thư viện thì ném lỗi. */
export async function renderGoogleButton(el: HTMLElement, clientId: string, width: number, handler: (credential: string) => void): Promise<void> {
  const gis = await loadGis();
  onCredential = handler;
  if (initializedFor !== clientId) {
    gis.initialize({
      client_id: clientId,
      callback: (response: { credential?: string }) => {
        if (response.credential) onCredential?.(response.credential);
      },
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    initializedFor = clientId;
  }
  el.replaceChildren();
  gis.renderButton(el, {
    type: "standard",
    theme: "filled_black",
    size: "large",
    shape: "rectangular",
    text: "continue_with",
    logo_alignment: "left",
    locale: "vi",
    width: Math.max(200, Math.min(400, Math.round(width))),
  });
}

/** Sau khi đăng xuất: Google không tự chọn lại tài khoản vừa dùng. */
export function forgetGoogleChoice() {
  window.google?.accounts?.id?.disableAutoSelect();
}
