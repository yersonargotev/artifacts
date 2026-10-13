import { Button } from './ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';
import type { ArtifactLink } from './ArtifactTitleMenu.tsx';

type Props = Readonly<{ title: string; actions: readonly ArtifactLink[] }>;

export default function ArtifactRowMenu({ title, actions }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="artifact-row-trigger" />} aria-label={`Opciones de ${title}`}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="artifact-menu row-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          {actions.map(({ label, href }) => <DropdownMenuItem key={href} render={<a href={href} />} nativeButton={false}>{label}</DropdownMenuItem>)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
