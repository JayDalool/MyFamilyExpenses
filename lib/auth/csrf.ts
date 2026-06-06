export const CSRF_COOKIE_NAME = "mfe_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_FORM_FIELD_NAME = "_csrf";
export const CSRF_REQUEST_HEADER_NAME = "x-mfe-request-csrf-token";

export const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function getCsrfTokenFromCookieString(cookieString: string, cookieName = CSRF_COOKIE_NAME) {
  const cookie = cookieString
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));

  if (!cookie) {
    return "";
  }

  const value = cookie.slice(cookieName.length + 1);

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isStateChangingMethod(method: string) {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}
