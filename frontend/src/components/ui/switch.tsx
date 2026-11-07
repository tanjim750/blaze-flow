"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";

export function Switch({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string }) {
  return <SwitchPrimitive.Root className="ui-switch" checked={checked} onCheckedChange={onCheckedChange} aria-label={label}><SwitchPrimitive.Thumb className="ui-switch-thumb" /></SwitchPrimitive.Root>;
}
