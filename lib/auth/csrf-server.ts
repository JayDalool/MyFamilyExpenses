import { headers } from "next/headers";
import { CSRF_REQUEST_HEADER_NAME } from "@/lib/auth/csrf";

export async function getRequestCsrfToken() {
  return (await headers()).get(CSRF_REQUEST_HEADER_NAME) ?? "";
}
