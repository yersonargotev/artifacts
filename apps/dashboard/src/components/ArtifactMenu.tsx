import { useId, useState } from 'react';
import { Button } from './ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';
import Icon from './Icon.tsx';

export type ArtifactLink = Readonly<{ label: string; href: string; moveItems?: string; share?: boolean }>;
type Props = Readonly<{ title: string; revisionLabel: string; actions: string; deleteUrl: string }>;

export default function ArtifactMenu({ title, revisionLabel, actions, deleteUrl }: Props) {
  const id = useId();
  const [links] = useState<readonly ArtifactLink[]>(() => JSON.parse(actions));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger id={id} render={<Button variant="ghost" size="icon" className="artifact-title-trigger" />} aria-label={`Menú de ${title}`}>
        <Icon name="dots-vertical" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="artifact-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="artifact-menu-heading"><span>{title}</span><span className="artifact-menu-revision">{revisionLabel}</span></DropdownMenuLabel>
          <DropdownMenuSeparator />
          {links.map(({ label, href, moveItems, share }) => <DropdownMenuItem key={href} render={<a href={href} data-share-trigger={share ? "" : undefined} data-share-return={share ? id : undefined} data-move-trigger={moveItems === undefined ? undefined : ''} data-move-items={moveItems} data-move-return={moveItems === undefined ? undefined : id} />} nativeButton={false}>{label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="destructive-menu-item" render={<a href={deleteUrl} />} nativeButton={false}>Eliminar artefacto</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
