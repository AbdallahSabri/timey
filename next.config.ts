import path from "path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the Docker runner stage — bundles only the files needed
  // to run the app into .next/standalone.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
