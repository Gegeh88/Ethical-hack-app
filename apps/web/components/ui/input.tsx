import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 border-0 border-b border-outline-variant bg-transparent px-0 py-1 text-sm text-onSurface transition-colors outline-none",
        "placeholder:text-onSurface-variant",
        "focus-visible:border-pulse focus-visible:shadow-[0_1px_0_0_#00FF41]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-error aria-invalid:shadow-[0_1px_0_0_#ff4444]",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-onSurface",
        className
      )}
      {...props}
    />
  )
}

export { Input }
