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
