import { handle } from '@astrojs/cloudflare/handler';
import { withMonitoring } from '@artifacts/monitoring';

export default withMonitoring('artifacts-panel', { fetch: handle });
