import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

/**
 * Shared Gemini API client instance.
 * Uses a single GoogleGenerativeAI instance with the service-level API key.
 */
const genai = new GoogleGenerativeAI(config.GEMINI_API_KEY);

/**
 * Fast model (gemini-2.5-flash) — used for executive summaries
 * and finding enrichment where low latency and cost matter.
 */
export const geminiFlash = genai.getGenerativeModel({ model: config.GEMINI_MODEL_FAST });

/**
 * Smart model (gemini-2.5-pro) — reserved for high-quality
 * fix suggestions (v2 scope). Not used in report generation.
 */
export const geminiPro = genai.getGenerativeModel({ model: config.GEMINI_MODEL_SMART });
