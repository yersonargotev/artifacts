import { Button } from './ui/button.tsx';
import { Fragment, useRef } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';

const iconPaths = {
  download: 'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5',
  information: 'M12 11v6m0-10v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  files: 'M6 3h8l4 4v14H6zM14 3v5h4',
  comparison: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
  history: 'M3 4v5h5M3 9a9 9 0 1 1 0 6m9-9v6l4 2',
  library: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  publication: 'M14 3h7v7m0-7-11 11M11 3H3v18h18v-8',
};
export type ArtifactLink = Readonly<{ label: string; href: string; icon?: keyof typeof iconPaths; group?: 'revision' | 'sections' | 'destinations' }>;
type Props = Readonly<{ title: string; revisionLabel: string; actions: readonly ArtifactLink[] }>;

export default function ArtifactTitleMenu({ title, revisionLabel, actions }: Props) {
  const navigationTarget = useRef<HTMLElement | null>(null);
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) navigationTarget.current = null; }}>
      <DropdownMenuTrigger render={<Button variant="ghost" className="artifact-title-trigger" />} aria-label={`Menú de ${title}`}>
        <span>{title}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 9 6 6 6-6" /></svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="artifact-menu" finalFocus={() => navigationTarget.current ?? true}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="artifact-menu-heading"><span>{title}</span><span className="artifact-menu-revision">{revisionLabel}</span></DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map(({ label, href, icon, group }, index) => <Fragment key={href}>
          {index > 0 && group !== actions[index - 1].group && <DropdownMenuSeparator />}
          <DropdownMenuItem render={<a href={href} />} nativeButton={false} onClick={() => {
            if (!href.startsWith('#')) return;
            const target = document.getElementById(href.slice(1));
            if (!target) return;
            if (target instanceof HTMLDetailsElement) {
              target.open = true;
              navigationTarget.current = target.querySelector<HTMLElement>('summary');
            } else {
              navigationTarget.current = target.querySelector<HTMLElement>('h2') ?? target;
            }
          }}>{icon && <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d={iconPaths[icon]} /></svg>}{label}</DropdownMenuItem></Fragment>)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
