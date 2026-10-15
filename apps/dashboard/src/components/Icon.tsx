import { icons, type IconName } from './icons.ts';

export default function Icon({ name, size = 20 }: Readonly<{ name: IconName; size?: number }>) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{icons[name].map((d) => <path key={d} d={d} />)}</svg>;
}
