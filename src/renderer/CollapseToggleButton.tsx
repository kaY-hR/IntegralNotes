import { type MouseEvent as ReactMouseEvent } from "react";

interface CollapseToggleButtonProps {
  className?: string;
  collapsed: boolean;
  collapseTitle?: string;
  expandTitle?: string;
  onToggle: () => void;
}

export function CollapseToggleButton({
  className,
  collapsed,
  collapseTitle = "折り畳む",
  expandTitle = "展開",
  onToggle
}: CollapseToggleButtonProps): JSX.Element {
  const title = collapsed ? expandTitle : collapseTitle;
  const buttonClassName = [
    "collapse-toggle-button",
    collapsed ? "collapse-toggle-button--collapsed" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  const stopEditorEvent = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <button
      aria-expanded={!collapsed}
      aria-label={title}
      className={buttonClassName}
      onClick={(event) => {
        stopEditorEvent(event);
        onToggle();
      }}
      onMouseDown={stopEditorEvent}
      title={title}
      type="button"
    >
      <span aria-hidden="true" className="collapse-toggle-button__chevron" />
    </button>
  );
}
