/** @type {import('next').NextConfig} */
const nextConfig = {
  // Exported as static files and served by nginx. See Dockerfile and nginx.conf.
  output: 'export',
  // Keeps /icons/arrow-up/ as a directory URL, matching what's in the sitemap.
  trailingSlash: true,
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
