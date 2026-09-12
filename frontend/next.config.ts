import type { NextConfig } from "next";

const API_ORIGIN = process.env.BLAZEFLOW_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["unenvying-atheistically-romeo.ngrok-free.dev"],
  /**
   * Django owns trailing slashes (`APPEND_SLASH`) and every one of its API routes ends in
   * one. Next, by default, answers `/api/auth/login/` with a 308 to the slashless path,
   * which Django 301s straight back — an infinite redirect that broke every browser-side
   * API call. `skipTrailingSlashRedirect` drops Next's 308.
   */
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [{
      source: "/api/:path*",
      /**
       * Next strips the trailing slash before filling `:path*`, so the slash is restored
       * here — otherwise Django receives `/api/auth/login` and 301s it back, moving the
       * same redirect loop server-side. Unconditional because all 89 API routes end in a
       * slash; revisit if a slashless route is ever added.
       */
      destination: `${API_ORIGIN}/api/:path*/`,
    }];
  },
};

export default nextConfig;
