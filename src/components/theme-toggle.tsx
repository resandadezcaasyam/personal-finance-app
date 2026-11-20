"use client";
import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";

type Mode = "light" | "dark";

export function applyTheme(mode: Mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  try { localStorage.setItem("theme", mode); } catch { /* storage unavailable */ }
}

export function ThemeToggle() {
  const [mode, setMode] = React.useState<Mode | null>(null);
  React.useEffect(() => setMode(document.documentElement.classList.contains("dark") ? "dark" : "light"), []);
  const next: Mode = mode === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={next === "dark" ? "Aktifkan mode gelap" : "Aktifkan mode terang"}
      onClick={() => { applyTheme(next); setMode(next); }}
    >
      {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
