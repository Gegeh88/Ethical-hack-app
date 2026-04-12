import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // Pulse green — verified / active states
        default:
          "bg-pulse/10 text-pulse border-pulse/20",
        // Surface — neutral secondary
        secondary:
          "bg-surface-high text-onSurface-variant border-outline-variant/30",
        // Error / destructive
        destructive:
          "bg-error-container/30 text-error border-error/20",
        // Ghost outline
        outline:
          "border-outline-variant text-onSurface-variant",
        // Minimal ghost
        ghost:
          "text-onSurface-variant hover:bg-surface-high",
        // Link
        link: "text-pulse underline-offset-4 hover:underline",
        // Severity — critical
        critical:
          "bg-severity-critical/15 text-severity-critical border-severity-critical/30 font-semibold",
        // Severity — high
        high:
          "bg-severity-high/15 text-severity-high border-severity-high/30 font-semibold",
        // Severity — medium
        medium:
          "bg-severity-medium/15 text-severity-medium border-severity-medium/30 font-semibold",
        // Severity — low
        low:
          "bg-severity-low/15 text-severity-low border-severity-low/30 font-semibold",
        // Severity — info
        info:
          "bg-severity-info/15 text-severity-info border-severity-info/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
