/** The message a preview frame posts when the owner follows one of its links to a panel page. */
export const frameLinkMessage = 'artifacts:follow-link';

/**
 * Runs inside an interactive HTML preview. The frame's sandbox cannot navigate the panel, so a click on a link to another panel page asks the parent to follow it.
 * It registers first and in the capture phase, so a page's own handlers cannot hide the click from it. Links within the page and to other sites keep their own behavior.
 */
export const frameLinkScript = `<script>addEventListener('click',function(e){var a=e.target instanceof Element&&e.target.closest('a[href]');if(!a)return;var u=new URL(a.href);if(u.origin!==location.origin||u.pathname===location.pathname&&u.search===location.search)return;e.preventDefault();parent.postMessage({type:'${frameLinkMessage}',href:u.href,newTab:e.metaKey||e.ctrlKey||e.shiftKey},'*')},true)</script>`;

// Only these panel pages may be opened from a frame, so a page's script cannot reach a GET route with an effect, such as signing out.
const followable = [/^\/read$/, /^\/artifacts\/[^/]+$/];

/**
 * Follows the links that the frames returned by `frames` ask for. The message comes from the artifact's own scripts, so it counts only for a followable panel page, while a click is still active and focus is in that frame, as it is after the owner clicks inside it.
 */
export function followFrameLinks(frames: () => Iterable<HTMLIFrameElement>, follow: (url: URL) => void) {
  addEventListener('message', (event) => {
    const source = [...frames()].find((frame) => frame.contentWindow === event.source);
    if (!source || document.activeElement !== source || !navigator.userActivation.isActive) return;
    const { data } = event;
    if (typeof data !== 'object' || data === null || data.type !== frameLinkMessage || typeof data.href !== 'string') return;
    const url = URL.parse(data.href);
    if (!url || url.origin !== location.origin || !followable.some((path) => path.test(url.pathname))) return;
    if (data.newTab === true) open(url.href, '_blank', 'noopener');
    else follow(url);
  });
}
