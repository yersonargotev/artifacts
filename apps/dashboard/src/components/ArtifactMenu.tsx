import { Button } from './ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';
import Icon from './Icon.tsx';

export type ArtifactLink = Readonly<{ label: string; href: string }>;
type Props = Readonly<{ title: string; revisionLabel: string; actions: readonly ArtifactLink[]; deleteUrl: string }>;

export default function ArtifactMenu({ title, revisionLabel, actions, deleteUrl }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="artifact-title-trigger" />} aria-label={`Menú de ${title}`}>
        <Icon name="dots-vertical" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="artifact-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="artifact-menu-heading"><span>{title}</span><span className="artifact-menu-revision">{revisionLabel}</span></DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map(({ label, href }) => <DropdownMenuItem key={href} render={<a href={href} />} nativeButton={false}>{label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="destructive-menu-item" render={<a href={deleteUrl} />} nativeButton={false}>Eliminar artefacto</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
