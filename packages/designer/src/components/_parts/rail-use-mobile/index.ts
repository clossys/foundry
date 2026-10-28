import * as React from "react"

function mobileBreakpoint() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-mobile-lg").trim()
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(raw)
  if (!match) throw new Error("Missing mobile breakpoint token")
  return Number(match[1]) * (match[2] === "rem" ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1)
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const MOBILE_BREAKPOINT = mobileBreakpoint()
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
