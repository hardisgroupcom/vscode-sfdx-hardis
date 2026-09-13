/*
The authenticated orgs or the default org changed: the default org was set in a config file, or
sfdx-hardis asked the extension to refresh its status (end of hardis:org:select). Fired by
HardisStatusProvider.refreshOrgRelatedUis, which already refreshes the status view and the Orgs
Manager, so a panel listening here needs no file watcher of its own.
*/

type OrgChangeListener = () => void;

const listeners = new Set<OrgChangeListener>();

export function onOrgsChanged(listener: OrgChangeListener): { dispose: () => void } {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}

export function emitOrgsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener that fails must not keep the others from refreshing
    }
  }
}
