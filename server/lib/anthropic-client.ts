import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let cachedClient: Anthropic | null = null;
let cachedToken: string | null = null;

function readClaudeToken(): string | null {
  try {
    const credsPath = join(homedir(), ".claude", ".credentials.json");
    const creds = JSON.parse(readFileSync(credsPath, "utf-8"));
    return creds?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

export function getAnthropicClient(): Anthropic {
  // Try Claude OAuth token first, fall back to ANTHROPIC_API_KEY env var
  const token = readClaudeToken();

  if (token) {
    if (token !== cachedToken || !cachedClient) {
      cachedToken = token;
      cachedClient = new Anthropic({ apiKey: token });
    }
    return cachedClient;
  }

  if (!cachedClient) {
    cachedClient = new Anthropic();
  }
  return cachedClient;
}
