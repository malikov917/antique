import { useEffect } from "react";
import type { ReelPlayableItem } from "./useReelsFeed";

export function useVideoPrefetch(items: ReelPlayableItem[], activeIndex: number): void {
  useEffect(() => {
    const toPrefetch = [
      items[activeIndex + 1]?.streamUrl,
      items[activeIndex + 2]?.streamUrl,
      items[activeIndex - 1]?.streamUrl
    ].filter(Boolean) as string[];

    const controllers: AbortController[] = [];
    for (const url of toPrefetch) {
      const controller = new AbortController();
      controllers.push(controller);
      void fetch(url, {
        method: "HEAD",
        signal: controller.signal
      }).catch(() => undefined);
    }

    return () => {
      for (const controller of controllers) {
        controller.abort();
      }
    };
  }, [activeIndex, items]);
}

