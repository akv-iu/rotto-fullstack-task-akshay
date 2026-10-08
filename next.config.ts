import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Photos and logos use plain <img> (the image host blocks server fetches), so no image config.
  // Don't write AGENTS.md into the repo on `next dev`: a grader's clean clone must stay clean.
  agentRules: false,
};

export default nextConfig;
