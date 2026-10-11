import { chromium } from '/tmp/artifacts-identity-implementation/node_modules/playwright/index.mjs';

chromium.launch = async () => {
  throw new Error('SECURITY_REVIEW_FORCED_CHROME_LAUNCH_FAILURE');
};
