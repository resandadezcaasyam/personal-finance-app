/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { serverComponentsExternalPackages: ["better-sqlite3", "tesseract.js", "pdfjs-dist", "@hyzyla/pdfium", "read-excel-file", "pngjs"] },
};
export default nextConfig;
