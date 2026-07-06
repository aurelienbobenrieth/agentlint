import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@ui/components/ui/button.js";

const STORAGE_KEY = "agentlint-theme";

function currentTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * ThemeToggle — flips the `dark` class on the document root and persists the
 * choice. Self-contained on purpose: theming is a presentation concern.
 */
export function ThemeToggle({ label }: { label: string }) {
  const [theme, setTheme] = useState<"dark" | "light">(() => currentTheme());

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  };

  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={toggle}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
