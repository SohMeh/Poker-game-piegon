import { AVATAR_COLORS } from '../../shared/constants';
import { initialOf } from '../lib/describe';

export function avatarColor(index: number): string {
  return AVATAR_COLORS[((index % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length]!;
}

export function Avatar({
  name,
  color,
  size = 44,
  className,
  children,
}: {
  name: string;
  color: number;
  size?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`avatar ${className ?? ''}`}
      style={{ '--av': avatarColor(color), width: size, height: size, fontSize: Math.round(size * 0.46) } as React.CSSProperties}
      aria-hidden
    >
      <span className="avatar-initial">{initialOf(name)}</span>
      {children}
    </div>
  );
}
