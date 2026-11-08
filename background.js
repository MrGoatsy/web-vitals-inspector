/**
 * Enables or disables a site and reloads the tab.
 * @param {{tabId: number, site: string, enable: boolean}} msg
 * @returns {Promise<void>}
 */
async function toggleSite({ tabId, site, enable }) {
    const { sites = [] } = await browser.storage.local.get('sites');
    const next = enable ? [...new Set([...sites, site])] : sites.filter(s => s !== site);
    await browser.storage.local.set({ sites: next });
    await browser.tabs.reload(tabId);
}

browser.runtime.onMessage.addListener(msg => {
    if (msg.type === 'relay') return browser.tabs.sendMessage(msg.tabId, msg.payload);
    if (msg.type === 'toggle') return toggleSite(msg);
});
