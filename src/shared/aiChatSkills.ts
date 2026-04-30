import type { AiChatSkillInvocation, AiChatSkillSummary } from "./aiChat";

const EXPLICIT_SKILL_TOKEN_PATTERN =
  /(^|\s)\$([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?=$|[\s\])}.,:;!?])/gu;
const SKILL_NAME_CHARACTER_PATTERN = /^[A-Za-z0-9_-]$/u;
const MAX_SKILL_SUGGESTIONS = 8;

export interface AiSkillTextTrigger {
  query: string;
  replaceFrom: number;
  replaceTo: number;
}

export function findExplicitAiSkillMentions(
  text: string,
  availableSkills: readonly AiChatSkillSummary[]
): AiChatSkillInvocation[] {
  if (text.trim().length === 0 || availableSkills.length === 0) {
    return [];
  }

  const skillsByKey = new Map(
    availableSkills.map((skill) => [normalizeAiSkillNameKey(skill.name), skill] as const)
  );
  const mentionedSkills: AiChatSkillInvocation[] = [];
  const seenKeys = new Set<string>();

  const addMention = (rawName: string): void => {
    const key = normalizeAiSkillNameKey(rawName);
    const skill = skillsByKey.get(key);

    if (!skill || seenKeys.has(key)) {
      return;
    }

    mentionedSkills.push(toAiSkillInvocation(skill));
    seenKeys.add(key);
  };

  EXPLICIT_SKILL_TOKEN_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(EXPLICIT_SKILL_TOKEN_PATTERN)) {
    addMention(match[2] ?? "");
  }

  return mentionedSkills;
}

export function findActiveAiSkillTrigger(
  text: string,
  cursorPosition: number
): AiSkillTextTrigger | null {
  const cursor = Math.max(0, Math.min(cursorPosition, text.length));
  let index = cursor - 1;

  while (index >= 0 && isAiSkillNameCharacter(text.charAt(index))) {
    index -= 1;
  }

  if (text.charAt(index) !== "$") {
    return null;
  }

  const triggerIndex = index;
  const previousCharacter = triggerIndex === 0 ? "" : text.charAt(triggerIndex - 1);

  if (triggerIndex > 0 && !/\s/u.test(previousCharacter)) {
    return null;
  }

  let replaceTo = cursor;

  while (replaceTo < text.length && isAiSkillNameCharacter(text.charAt(replaceTo))) {
    replaceTo += 1;
  }

  return {
    query: text.slice(triggerIndex + 1, cursor),
    replaceFrom: triggerIndex,
    replaceTo
  };
}

export function getAiSkillSuggestions(
  availableSkills: readonly AiChatSkillSummary[],
  query: string
): AiChatSkillSummary[] {
  const normalizedQuery = normalizeAiSkillNameKey(query);
  const sortedSkills = [...availableSkills].sort((left, right) =>
    left.name.localeCompare(right.name, "ja")
  );

  if (normalizedQuery.length === 0) {
    return sortedSkills.slice(0, MAX_SKILL_SUGGESTIONS);
  }

  const startsWithMatches = sortedSkills.filter((skill) =>
    normalizeAiSkillNameKey(skill.name).startsWith(normalizedQuery)
  );
  const containsMatches = sortedSkills.filter((skill) => {
    const key = normalizeAiSkillNameKey(skill.name);
    return !key.startsWith(normalizedQuery) && key.includes(normalizedQuery);
  });

  return [...startsWithMatches, ...containsMatches].slice(0, MAX_SKILL_SUGGESTIONS);
}

export function normalizeAiSkillNameKey(value: string): string {
  return value.trim().toLowerCase();
}

export function toAiSkillInvocation(skill: AiChatSkillSummary): AiChatSkillInvocation {
  return {
    ...(skill.description.trim().length > 0 ? { description: skill.description.trim() } : {}),
    name: skill.name,
    ...(skill.relativePath.trim().length > 0 ? { relativePath: skill.relativePath.trim() } : {})
  };
}

function isAiSkillNameCharacter(value: string): boolean {
  return SKILL_NAME_CHARACTER_PATTERN.test(value);
}
