import {
  CSRF_HEADER_NAME,
  getCsrfTokenFromCookieString,
  isStateChangingMethod,
} from "@/lib/auth/csrf";

export function getBrowserCsrfToken() {
  if (typeof document === "undefined") {
    return "";
  }

  return getCsrfTokenFromCookieString(document.cookie);
}

export function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);

  if (isStateChangingMethod(method) && !headers.has(CSRF_HEADER_NAME)) {
    const token = getBrowserCsrfToken();
    if (token) {
      headers.set(CSRF_HEADER_NAME, token);
    }
  }

  return fetch(input, { ...init, headers });
}
