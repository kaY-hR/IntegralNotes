import type { AiChatSkillInvocation } from "../shared/aiChat";

interface AiSkillChipsProps {
  compact?: boolean;
  skills: readonly AiChatSkillInvocation[];
}

export function AiSkillChips({ compact = false, skills }: AiSkillChipsProps): JSX.Element | null {
  if (skills.length === 0) {
    return null;
  }

  return (
    <div className={`ai-skill-chips${compact ? " ai-skill-chips--compact" : ""}`}>
      {skills.map((skill) => (
        <span
          className="ai-skill-chip"
          key={`${skill.name}:${skill.relativePath ?? ""}`}
          title={skill.description ?? skill.relativePath ?? skill.name}
        >
          <span className="ai-skill-chip__kind">Skill</span>
          <span className="ai-skill-chip__name">{skill.name}</span>
        </span>
      ))}
    </div>
  );
}
