import type { Metadata } from "next";
import "@fontsource-variable/inter/wght.css";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/toast";
import { getActiveProfile } from "@/lib/db/client";
import { hasValidSession } from "@/lib/auth/guard";
import { isAuthEnabled } from "@/lib/auth/store";
import { LockScreen } from "@/components/lock-screen";

export const metadata: Metadata = {
  title: "Personal Finance OS",
  description: "Aplikasi keuangan pribadi yang privat dan berjalan lokal",
};
export const dynamic = "force-dynamic";

// Applies the saved theme and sidebar state before first paint to avoid a flash. Inline, so no external request.
const themeScript = `try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.classList.toggle('dark',t==='dark');if(localStorage.getItem('sidebar')==='collapsed')document.documentElement.setAttribute('data-sidebar','collapsed')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locked = !hasValidSession();
  const profile = getActiveProfile();
  return (
    <html lang="id" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Lewati ke konten</a>
        <ToastProvider>{locked ? <LockScreen /> : <AppShell profile={profile} authEnabled={isAuthEnabled()}><div id="main">{children}</div></AppShell>}</ToastProvider>
      </body>
    </html>
  );
}
