import { forwardRef, type ForwardRefExoticComponent, type RefAttributes, type SVGProps } from "react";

/** Props match lucide-react's so existing call sites keep working unchanged. */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}
export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;
/** Kept so `LucideIcon`-typed maps keep compiling during the migration. */
export type LucideIcon = Icon;
export type LucideProps = IconProps;

/** Our geometric set is drawn at 1.25; lucide's default is 2. Scale callers' widths to keep their relative weight. */
const BASE = 1.25;
const LUCIDE_DEFAULT = 2;

export function createIcon(name: string, body: string): Icon {
  const Component = forwardRef<SVGSVGElement, IconProps>(function GeometricIcon(
    { size = 24, color = "currentColor", strokeWidth, absoluteStrokeWidth, className, children, ...rest },
    ref,
  ) {
    let sw = strokeWidth === undefined ? BASE : (Number(strokeWidth) * BASE) / LUCIDE_DEFAULT;
    if (absoluteStrokeWidth) sw = (sw * 24) / Number(size);
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeMiterlimit={10}
        aria-hidden={rest["aria-label"] ? undefined : true}
        className={["bf-icon", `bf-icon-${name}`, className].filter(Boolean).join(" ")}
        data-icon={name}
        {...rest}
      >
        <g dangerouslySetInnerHTML={{ __html: body }} />
        {children}
      </svg>
    );
  });
  Component.displayName = name;
  return Component;
}
