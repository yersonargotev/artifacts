import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { cn } from '../../lib/utils.ts';
import { Input } from './input.tsx';

const Combobox = ComboboxPrimitive.Root;
const ComboboxGroup = ComboboxPrimitive.Group;
const ComboboxLabel = ComboboxPrimitive.GroupLabel;

function ComboboxInput(props: ComboboxPrimitive.Input.Props) {
  return <ComboboxPrimitive.Input render={<Input />} {...props} />;
}

function ComboboxContent({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return <ComboboxPrimitive.Portal>
    <ComboboxPrimitive.Positioner sideOffset={6} align="start" className="combobox-positioner">
      <ComboboxPrimitive.Popup data-slot="combobox-content" className={cn('combobox-content', className)} {...props} />
    </ComboboxPrimitive.Positioner>
  </ComboboxPrimitive.Portal>;
}

function ComboboxList(props: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List className="combobox-list" {...props} />;
}

function ComboboxItem(props: ComboboxPrimitive.Item.Props) {
  return <ComboboxPrimitive.Item className="combobox-item" {...props} />;
}

export { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxGroup, ComboboxLabel };
