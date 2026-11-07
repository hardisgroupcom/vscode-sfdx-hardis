import { GitProviderBitbucket } from "../../utils/gitProviders/gitProviderBitbucket";

/**
 * A GitProviderBitbucket on workspace "ws", repository "repo", talking to the given fake client.
 *
 * The Bitbucket suites drive the real provider methods against a fake bitbucketClient, so they all
 * need the same workspace, slug, repoInfo and silenced logApiCall.
 */
export function newBitbucketProviderStub(bitbucketClient: any): any {
  const provider: any = Object.create(GitProviderBitbucket.prototype);
  provider.workspace = "ws";
  provider.repoSlug = "repo";
  provider.repoInfo = { webUrl: "https://bitbucket.org/ws/repo" };
  provider.logApiCall = async () => undefined;
  provider.bitbucketClient = bitbucketClient;
  return provider;
}
