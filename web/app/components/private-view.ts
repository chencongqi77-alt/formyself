export type PrivateViewKey = "journey" | "poemWorld" | "social";

export const PRIVATE_VIEW_LABELS: Record<PrivateViewKey, { label: string; subtitle: string }> = {
  journey: { label: "行迹卷", subtitle: "按时间与地点读人物的一生" },
  poemWorld: { label: "诗境图", subtitle: "把诗句里的山河放回地图" },
  social: { label: "交游录", subtitle: "浏览人物之间的关系网络" },
};
