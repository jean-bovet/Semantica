import React from 'react';
import { LucideIcon } from 'lucide-react';

interface IconProps {
  icon: LucideIcon;
  size?: number;
  color?: string;
  className?: string;
}

function Icon({ icon: IconComponent, size = 20, color, className = '' }: IconProps) {
  return (
    <IconComponent
      size={size}
      color={color}
      strokeWidth={1.5}
      className={className}
    />
  );
}

export default Icon;