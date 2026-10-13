/*
An sfdx-hardis command launched in the command runner ended: sfdx-hardis said so to the WebSocket
server. A panel whose data such a command changes listens here and reads its data again, the way
the panels showing orgs listen to orgChangeEvents.
*/

type CommandCompletedListener = (command: string, status: string) => void;

const listeners = new Set<CommandCompletedListener>();

export function onCommandCompleted(listener: CommandCompletedListener): {
  dispose: () => void;
} {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}

/**
 * @param command the command as sfdx-hardis names it (ex: hardis:scratch:pool:refresh)
 * @param status how it ended: success, error or aborted
 */
export function emitCommandCompleted(command: string, status: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(command, status);
    } catch {
      // A listener that fails must not keep the others from refreshing
    }
  }
}
