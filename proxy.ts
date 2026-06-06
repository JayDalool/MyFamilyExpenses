import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_FORM_FIELD_NAME,
  CSRF_HEADER_NAME,
  CSRF_REQUEST_HEADER_NAME,
  getCsrfTokenFromCookieString,
  isStateChangingMethod,
} from "@/lib/auth/csrf";

function getContentSecurityPolicy(allowSameOriginFraming: boolean) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${allowSameOriginFraming ? "'self'" : "'none'"}`,
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-src 'self' blob:",
  ].join("; ");
}

function shouldUseSecureCookies() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

function createCsrfToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
}

function isValidCsrfToken(token: string) {
  return token.length >= 32 && /^[a-zA-Z0-9_-]+$/.test(token);
}

function isExpenseFileRoute(pathname: string) {
  return /^\/api\/expenses\/[^/]+\/file$/.test(pathname);
}

function applySecurityHeaders(response: NextResponse, pathname: string) {
  const allowSameOriginFraming = isExpenseFileRoute(pathname);

  response.headers.set("X-Frame-Options", allowSameOriginFraming ? "SAMEORIGIN" : "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Content-Security-Policy",
    getContentSecurityPolicy(allowSameOriginFraming),
  );
  return response;
}

function setCsrfCookie(response: NextResponse, token: string) {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

function forbidden() {
  return NextResponse.json(
    { error: { message: "Invalid security token. Refresh the page and try again." } },
    { status: 403 },
  );
}

async function getSubmittedCsrfToken(request: NextRequest) {
  const headerToken = request.headers.get(CSRF_HEADER_NAME) ?? "";
  if (headerToken) return headerToken;

  if (
    request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded")
  ) {
    const formData = await request.clone().formData().catch(() => null);
    return String(formData?.get(CSRF_FORM_FIELD_NAME) ?? "");
  }

  return "";
}

export async function proxy(request: NextRequest) {
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value ?? "";
  const pathname = request.nextUrl.pathname;

  if (isStateChangingMethod(request.method)) {
    const submittedToken = await getSubmittedCsrfToken(request);

    if (!cookieToken || !submittedToken || cookieToken !== submittedToken) {
      return applySecurityHeaders(forbidden(), pathname);
    }
  }

  const existingToken = getCsrfTokenFromCookieString(
    request.headers.get("cookie") ?? "",
  );
  const requestToken = isValidCsrfToken(existingToken) ? existingToken : createCsrfToken();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSRF_REQUEST_HEADER_NAME, requestToken);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  if (!isValidCsrfToken(existingToken)) {
    setCsrfCookie(response, requestToken);
  }

  return applySecurityHeaders(response, pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
