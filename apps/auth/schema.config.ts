import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';

export const auth = betterAuth({
  baseURL: "http://localhost:4100",
  plugins: [
    jwt(),
    mcp({ loginPage: '/sign-in', consentPage: '/consent', resource: 'http://127.0.0.1:4101/mcp' }),
    cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
  ],
});
