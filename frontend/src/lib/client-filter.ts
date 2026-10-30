type Named = { name: string };

/**
 * Filters the projects rail by client or campaign name.
 *
 * A client whose own name matches keeps all of its campaigns. Otherwise it is kept only if
 * one of its campaigns matches, and then only those campaigns are shown — so searching for
 * a project name surfaces the project, not just the client it belongs to.
 */
export type ClientTreeRow<C extends Named & { campaigns: Named[] }> = { client: C; campaigns: C["campaigns"]; matchedCampaign: boolean };

export function filterClientTree<C extends Named & { campaigns: Named[] }>(clients: C[], query: string): ClientTreeRow<C>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return clients.map((client) => ({ client, campaigns: client.campaigns, matchedCampaign: false }));
  return clients.flatMap((client): ClientTreeRow<C>[] => {
    if (client.name.toLowerCase().includes(needle)) return [{ client, campaigns: client.campaigns, matchedCampaign: false }];
    const campaigns = client.campaigns.filter((campaign) => campaign.name.toLowerCase().includes(needle));
    return campaigns.length ? [{ client, campaigns, matchedCampaign: true }] : [];
  });
}
