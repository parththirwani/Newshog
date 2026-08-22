export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const LLM_MODEL = "anthropic/claude-3-haiku";
export const LLM_MAX_TOKENS = 1500;
export const LLM_MAX_INPUT_CHARS = 8000;

export const SCORE_THRESHOLD_LOW = 30;
export const SCORE_THRESHOLD_HIGH = 60;

export const MAX_ANGLES = 3;

// Cost per 1M tokens (USD), for the /stats dashboard. Hardcoded, not a
// live price lookup — bump the number when the model or plan changes.
export const LLM_PROMPT_PRICE_PER_M = 0.25;
export const LLM_COMPLETION_PRICE_PER_M = 1.25;
export const LLM_DAILY_ALERT_USD = 5;

export const ANALYSIS_DEDUPE_HOURS = 24;
