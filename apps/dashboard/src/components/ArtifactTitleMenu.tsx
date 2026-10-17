import { Button } from './ui/button.tsx';
import { Fragment, useRef } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';
import Icon from './Icon.tsx';
import type { IconName } from './icons.ts';

const iconNames = { download: 'download', information: 'info-circle', files: 'file-text', comparison: 'arrows-diff', history: 'history', library: 'layout-dashboard', publication: 'external-link', move: 'folder' } as const satisfies Record<string, IconName>;
export type ArtifactLink = Readonly<{ label: string; href: string; icon?: keyof typeof iconNames; group?: 'revision' | 'sections' | 'destinations' | 'artifact' }>;
type Props = Readonly<{ title: string; revisionLabel: string; actions: readonly ArtifactLink[] }>;

export default function ArtifactTitleMenu({ title, revisionLabel, actions }: Props) {
  const navigationTarget = useRef<HTMLElement | null>(null);
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) navigationTarget.current = null; }}>
      <DropdownMenuTrigger render={<Button variant="ghost" className="artifact-title-trigger" />} aria-label={`Menú de ${title}`}>
        <span>{title}</span><Icon name="chevron-down" size={16} />
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
          }}>{icon && <Icon name={iconNames[icon]} size={18} />}{label}</DropdownMenuItem></Fragment>)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
