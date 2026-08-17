import { Loader2Icon } from "lucide-react"

import { cn } from "../../lib/utils"

function Spinner({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span role="status" aria-label="Loading" {...props}>
      <Loader2Icon
        aria-hidden
        className={cn("size-4 animate-spin", className)}
      />
    </span>
  )
}

export { Spinner }
