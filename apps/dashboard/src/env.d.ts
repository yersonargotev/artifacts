import type { PanelIdentity } from './identity.ts';

declare global {
  namespace App {
    interface Locals { identity?: PanelIdentity }
  }
}
