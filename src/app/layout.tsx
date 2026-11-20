import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { getActiveProfile } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Personal Finance OS",
  description: "Aplikasi keuangan pribadi yang privat dan berjalan lokal",
};
export const dynamic = "force-dynamic";

// Applies the saved theme before first paint to avoid a flash. Inline, so no external request.
const themeScript = `try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const profile = getActiveProfile();
  return (
    <html lang="id" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Lewati ke konten</a>
        <AppShell profile={profile}><div id="main">{children}</div></AppShell>
      </body>
    </html>
  );
}
