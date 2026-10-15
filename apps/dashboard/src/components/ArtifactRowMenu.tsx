import { Button } from './ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';
import type { ArtifactLink } from './ArtifactTitleMenu.tsx';
import Icon from './Icon.tsx';

type Props = Readonly<{ title: string; actions: readonly ArtifactLink[] }>;

export default function ArtifactRowMenu({ title, actions }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="artifact-row-trigger" />} aria-label={`Opciones de ${title}`}>
        <Icon name="dots-vertical" />
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
