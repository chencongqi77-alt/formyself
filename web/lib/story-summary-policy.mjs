export const storySummaryPolicy = Object.freeze({
  hardMin: 48,
  targetMin: 52,
  targetMax: 78,
  hardMax: 84,
  countingRule: "忽略空白、标点和符号后的有效汉字数。",
  aiRewriteInstruction:
    "在不新增未核实史实的前提下，将故事摘要调整到 52–78 个有效汉字；保留时间、地点、人物、事件与作品关联。若无法满足，返回待人工补充状态。",
});

export const placeIntroPolicy = Object.freeze({
  hardMin: 20,
  targetMin: 24,
  targetMax: 36,
  hardMax: 42,
  countingRule: "忽略空白、标点和符号后的有效汉字数。",
  aiRewriteInstruction:
    "在不新增未核实史实的前提下，将地点简介调整到 24–36 个有效汉字；用一句或两句说明地点与人物经历的关联。若无法满足，返回待人工补充状态。",
});

function countEffectiveCharacters(text) {
  return Array.from((text ?? "").replace(/[\s\p{P}\p{S}]/gu, "")).length;
}

function getCopyStatus(text, policy) {
  const length = countEffectiveCharacters(text);

  if (length < policy.hardMin) return "below-hard-min";
  if (length < policy.targetMin) return "below-target";
  if (length <= policy.targetMax) return "on-target";
  if (length <= policy.hardMax) return "above-target";
  return "above-hard-max";
}

export function countStorySummaryCharacters(text) {
  return countEffectiveCharacters(text);
}

export function getStorySummaryStatus(text) {
  return getCopyStatus(text, storySummaryPolicy);
}

export function countPlaceIntroCharacters(text) {
  return countEffectiveCharacters(text);
}

export function getPlaceIntroStatus(text) {
  return getCopyStatus(text, placeIntroPolicy);
}
