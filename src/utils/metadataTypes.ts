import { listMetadataTypes } from "./metadataList";

/**
 * Memoized access to the Salesforce metadata registry.
 *
 * metadataList.ts is a verbatim copy of the sfdx-hardis file, overwritten by
 * `yarn sync:metadata-list` before every build, so it cannot hold the cache
 * itself: listMetadataTypes() rebuilds an array literal of ~570 objects on
 * every call, and the Metadata Retriever calls it several times per operation.
 */

let cachedMetadataTypes: any[] | undefined;
let cachedByXmlName: Map<string, any> | undefined;

export function getMetadataTypes(): any[] {
  if (!cachedMetadataTypes) {
    cachedMetadataTypes = listMetadataTypes();
  }
  return cachedMetadataTypes;
}

/** Metadata type descriptor by xmlName, or undefined when it is unknown */
export function getMetadataType(xmlName: string): any | undefined {
  if (!cachedByXmlName) {
    cachedByXmlName = new Map();
    for (const metadataType of getMetadataTypes()) {
      if (metadataType?.xmlName) {
        cachedByXmlName.set(metadataType.xmlName, metadataType);
      }
    }
  }
  return cachedByXmlName.get(xmlName);
}

/**
 * Metadata type and API name of a local source file, read from its path with the bundled registry,
 * or null when the path matches no type. Only used to show the component at once in the Metadata
 * Dependencies panel: the CLI resolves the file itself and its answer replaces this guess.
 */
export function guessMetadataFromSourceFile(
  filePath: string,
): { type: string; name: string } | null {
  const segments = filePath.split(/[\\/]+/).filter((segment) => segment !== "");
  const leaf = segments[segments.length - 1] || "";
  for (let index = segments.length - 2; index >= 0; index--) {
    const rest = segments.slice(index + 1);
    for (const metadataType of getMetadataTypes()) {
      if (metadataType?.directoryName !== segments[index]) {
        continue;
      }
      // A bundle (LWC, Aura...) is named by its folder
      if (!metadataType.suffix) {
        if (rest.length >= 2) {
          return { type: metadataType.xmlName, name: rest[0] };
        }
        continue;
      }
      const match = leaf.match(
        new RegExp(`^(.+)\\.${metadataType.suffix}(-meta\\.xml)?$`),
      );
      if (!match) {
        continue;
      }
      const componentName = match[1];
      // A child of an object: objects/<Object>/fields/<Field>.field-meta.xml
      if (metadataType.parentXmlName) {
        const parent = getMetadataType(metadataType.parentXmlName);
        if (
          rest.length === 1 &&
          index >= 2 &&
          segments[index - 2] === parent?.directoryName
        ) {
          return {
            type: metadataType.xmlName,
            name: `${segments[index - 1]}.${componentName}`,
          };
        }
        continue;
      }
      if (rest.length === 1) {
        return { type: metadataType.xmlName, name: componentName };
      }
      // A component in its own folder: objects/<Object>/<Object>.object-meta.xml
      if (rest.length === 2 && rest[0] === componentName) {
        return { type: metadataType.xmlName, name: componentName };
      }
      // A component in a folder: reports/<Folder>/<Report>.report-meta.xml
      if (metadataType.inFolder) {
        return {
          type: metadataType.xmlName,
          name: [...rest.slice(0, -1), componentName].join("/"),
        };
      }
    }
  }
  return null;
}
