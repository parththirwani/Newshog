import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Prompts live at the repo root; Next can run with cwd = apps/web or repo root.
export function loadPrompt(name: string): string {
  for (let up = 0; up <= 3; up++) {
    const candidate = join(process.cwd(), ...Array(up).fill(".."), "prompts", name);
    try {
      if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
    } catch {
      // keep walking up
    }
  }
  throw new Error(`Prompt not found: ${name}`);
}