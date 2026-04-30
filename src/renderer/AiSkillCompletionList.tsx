import type { AiChatSkillSummary } from "../shared/aiChat";

interface AiSkillCompletionListProps {
  compact?: boolean;
  emptyMessage?: string;
  onHighlight: (index: number) => void;
  onSelect: (skill: AiChatSkillSummary) => void;
  selectedIndex: number;
  skills: readonly AiChatSkillSummary[];
}

export function AiSkillCompletionList({
  compact = false,
  emptyMessage = "一致する skill がありません。",
  onHighlight,
  onSelect,
  selectedIndex,
  skills
}: AiSkillCompletionListProps): JSX.Element {
  return (
    <div
      className={`ai-skill-completion${compact ? " ai-skill-completion--compact" : ""}`}
      role="listbox"
    >
      {skills.length > 0 ? (
        skills.map((skill, index) => (
          <button
            aria-selected={index === selectedIndex}
            className={`ai-skill-completion__item${
              index === selectedIndex ? " ai-skill-completion__item--selected" : ""
            }`}
            key={`${skill.name}:${skill.relativePath}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(skill);
            }}
            onMouseEnter={() => {
              onHighlight(index);
            }}
            role="option"
            title={skill.description || skill.relativePath}
            type="button"
          >
            <span className="ai-skill-completion__name">${skill.name}</span>
            <span className="ai-skill-completion__description">
              {skill.description || skill.relativePath}
            </span>
          </button>
        ))
      ) : (
        <div className="ai-skill-completion__empty">{emptyMessage}</div>
      )}
    </div>
  );
}
