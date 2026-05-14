export function getAppBaseUrl(fallbackUrl?: string): string {
  const configured = process.env.APP_BASE_URL?.trim();
  const candidate = configured || fallbackUrl;

  if (!candidate) {
    throw new Error("APP_BASE_URL must be configured for auth flows.");
  }

  const url = new URL(candidate);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("APP_BASE_URL must use http or https.");
  }

  url.hash = "";
  url.search = "";

  return url.toString().replace(/\/$/, "");
}

export function buildInternalUrl(pathname: string, fallbackUrl?: string): URL {
  return new URL(pathname, getAppBaseUrl(fallbackUrl));
}
