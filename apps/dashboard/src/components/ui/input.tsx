import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn('flex h-11 w-full min-w-0 rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary disabled:pointer-events-none disabled:opacity-50', className)} {...props} />;
}

export { Input };
