import type { ReactNode } from "react";

export interface ActivityBarItem {
  icon: ReactNode;
  id: string;
  title: string;
}

interface ActivityBarProps {
  activeItemId: string;
  items: readonly ActivityBarItem[];
  onSelect: (itemId: string) => void;
}

export function ActivityBar({
  activeItemId,
  items,
  onSelect
}: ActivityBarProps): JSX.Element {
  return (
    <nav aria-label="Sidebar navigation" className="activity-bar">
      <div className="activity-bar__items">
        {items.map((item) => {
          const selected = item.id === activeItemId;

          return (
            <button
              aria-label={item.title}
              aria-pressed={selected}
              className={`activity-bar__item${selected ? " is-active" : ""}`}
              key={item.id}
              onClick={() => {
                onSelect(item.id);
              }}
              title={item.title}
              type="button"
            >
              <span aria-hidden="true" className="activity-bar__icon">
                {item.icon}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
