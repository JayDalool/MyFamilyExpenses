import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
};

export default nextConfig;
