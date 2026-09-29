import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCommandByMenuEvent } from '@/lib/commands/registry';

/**
 * The native menu's web side. Every menu-event payload is dispatched
 * through the command registry (registry.ts) — menu and palette run
 * the same run() bodies, so they cannot drift. The registry's
 * menuEventId keys are the Rust MenuItem ids (src-tauri/src/lib.rs);
 * a payload with no registry entry is dropped (logged), never crashed.
 */
export function useMenuEvents() {
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      const command = getCommandByMenuEvent(event.payload);
      if (!command) {
        console.warn(`No command registered for menu event: ${event.payload}`);
        return;
      }
      // hidden is a PALETTE-visibility filter only — the menu always
      // dispatches (e.g. 'new' stub, quit).
      void command.run();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
