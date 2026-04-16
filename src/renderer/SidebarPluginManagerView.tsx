import type { InstalledPluginDefinition } from "../shared/plugins";

interface SidebarPluginManagerViewProps {
  installRootPath: string;
  onInstall: () => void;
  onRefresh: () => void;
  onUninstall: (pluginId: string) => void;
  pendingAction: string | null;
  plugins: InstalledPluginDefinition[];
}

export function SidebarPluginManagerView({
  installRootPath,
  onInstall,
  onRefresh,
  onUninstall,
  pendingAction,
  plugins
}: SidebarPluginManagerViewProps): JSX.Element {
  const isInstalling = pendingAction === "install";
  const isRefreshing = pendingAction === "refresh";
  const isBusy = pendingAction !== null;

  return (
    <div className="sidebar-plugin-manager">
      <div className="sidebar-plugin-manager__header">
        <div>
          <p className="sidebar__eyebrow">Plugin Manager</p>
          <h2 className="sidebar-plugin-manager__title">Plugins</h2>
          <p className="sidebar-plugin-manager__description">
            zip から install した external plugin を管理します。
          </p>
        </div>
      </div>

      <div className="sidebar-plugin-manager__toolbar">
        <div className="plugin-manager__summary">
          <strong>{plugins.length}</strong>
          <span>installed</span>
        </div>

        <div className="plugin-manager__actions">
          <button
            className="button button--ghost"
            disabled={isBusy}
            onClick={onRefresh}
            type="button"
          >
            {isRefreshing ? "更新中..." : "Refresh"}
          </button>
          <button
            className="button button--primary"
            disabled={isBusy}
            onClick={onInstall}
            type="button"
          >
            {isInstalling ? "zip を取込中..." : "Install ZIP"}
          </button>
        </div>
      </div>

      <div className="plugin-manager__install-root">
        <span className="plugin-manager__install-root-label">Install Root</span>
        <code>{installRootPath}</code>
      </div>

      <div className="sidebar-plugin-manager__list plugin-manager__list">
        {plugins.length === 0 ? (
          <div className="plugin-manager__empty">
            <strong>Plugin はまだ install されていません。</strong>
            <span>`Install ZIP` から plugin package を追加できます。</span>
          </div>
        ) : (
          plugins.map((plugin) => {
            const uninstallPending = pendingAction === `uninstall:${plugin.id}`;

            return (
              <section className="plugin-card" key={plugin.id}>
                <div className="plugin-card__header">
                  <div className="plugin-card__title">
                    <h3>{plugin.displayName}</h3>
                    <div className="plugin-card__badges">
                      <span className="plugin-card__badge">{plugin.id}</span>
                      <span className="plugin-card__badge">{plugin.version}</span>
                      {plugin.hasRenderer ? <span className="plugin-card__badge">renderer</span> : null}
                      {plugin.hasHost ? <span className="plugin-card__badge">host</span> : null}
                      {plugin.viewers.length > 0 ? (
                        <span className="plugin-card__badge">{plugin.viewers.length} viewers</span>
                      ) : null}
                      {plugin.sidebarViews.length > 0 ? (
                        <span className="plugin-card__badge">
                          {plugin.sidebarViews.length} sidebar views
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    className="button button--ghost"
                    disabled={isBusy}
                    onClick={() => {
                      onUninstall(plugin.id);
                    }}
                    type="button"
                  >
                    {uninstallPending ? "削除中..." : "Uninstall"}
                  </button>
                </div>

                <p className="plugin-card__description">{plugin.description}</p>

                <div className="plugin-card__meta">
                  <span>Namespace: {plugin.namespace}</span>
                  <span>Blocks: {plugin.blocks.length}</span>
                  <span>Viewers: {plugin.viewers.length}</span>
                  <span>Sidebar: {plugin.sidebarViews.length}</span>
                </div>

                {plugin.blocks.length > 0 ? (
                  <ul className="plugin-card__blocks">
                    {plugin.blocks.map((block) => (
                      <li key={block.type}>
                        <strong>{block.title}</strong>
                        <code>{block.type}</code>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {plugin.sidebarViews.length > 0 ? (
                  <ul className="plugin-card__blocks plugin-card__blocks--sidebar-views">
                    {plugin.sidebarViews.map((sidebarView) => (
                      <li key={sidebarView.id}>
                        <strong>{sidebarView.title}</strong>
                        <code>{sidebarView.id}</code>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
