import { NextResponse } from "next/server";
import { buildInternalUrl } from "@/lib/auth/app-url";

export function isNativeFormRequest(request: Request) {
  return request.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith("application/x-www-form-urlencoded");
}

export async function readJsonOrFormPayload(request: Request) {
  if (isNativeFormRequest(request)) {
    return Object.fromEntries(await request.formData());
  }

  return request.json().catch(() => null);
}

export function redirectNativeForm(request: Request, pathname: string) {
  return NextResponse.redirect(buildInternalUrl(pathname, request.url), 303);
}
