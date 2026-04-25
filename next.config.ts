import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/chat': ['./.claude/blog-analysis.md', './.claude/competitor-analysis.md'],
    '/api/qa': ['./.claude/blog-analysis.md', './.claude/competitor-analysis.md'],
    '/api/marketing': ['./.claude/blog-analysis.md', './.claude/competitor-analysis.md'],
  },
};

export default nextConfig;
