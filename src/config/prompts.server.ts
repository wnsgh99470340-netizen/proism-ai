import { readFileSync } from 'fs';
import path from 'path';
import { BLOG_SYSTEM_PROMPT as BLOG_SYSTEM_PROMPT_TEMPLATE } from './prompts';

function loadAnalysisDoc(filename: string): string {
  try {
    return readFileSync(path.join(process.cwd(), '.claude', filename), 'utf-8').trim();
  } catch (err) {
    console.warn(`[prompts.server] Failed to load .claude/${filename}:`, err);
    return `(파일을 불러오지 못했습니다: .claude/${filename})`;
  }
}

const BLOG_ANALYSIS_DOC = loadAnalysisDoc('blog-analysis.md');
const COMPETITOR_ANALYSIS_DOC = loadAnalysisDoc('competitor-analysis.md');

export const BLOG_SYSTEM_PROMPT = BLOG_SYSTEM_PROMPT_TEMPLATE
  .replace('{{BLOG_ANALYSIS_DOC}}', BLOG_ANALYSIS_DOC)
  .replace('{{COMPETITOR_ANALYSIS_DOC}}', COMPETITOR_ANALYSIS_DOC);
