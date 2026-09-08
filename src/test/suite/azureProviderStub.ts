import { GitProviderAzure } from "../../utils/gitProviders/gitProviderAzure";

/**
 * A GitProviderAzure with its repoInfo filled in and its API surface left empty.
 *
 * The Azure suites all drive the real provider methods against fake API objects, so they all need
 * the same repoInfo fixture and the same silenced logApiCall. Each suite then attaches the API it
 * is about (gitApi, buildApi) to the object it gets back.
 */
export function newAzureProviderStub(): any {
  const provider: any = Object.create(GitProviderAzure.prototype);
  provider.repoInfo = {
    owner: "Project",
    repo: "repo",
    remoteUrl: "https://dev.azure.com/acme/Project/_git/repo",
    host: "dev.azure.com",
    webUrl: "https://dev.azure.com/acme/Project/_git/repo",
    providerName: "azure",
  };
  provider.logApiCall = async () => {};
  return provider;
}
