import * as React from "react"

const MOBILE_BREAKPOINT = 640

/** 与 shadcn Sheet 方案配套的手机断点：640px 以下用列表 + 底部抽屉查看详情。 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => (typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false)
  )
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return isMobile
}
