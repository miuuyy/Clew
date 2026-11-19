from __future__ import annotations

from app.core.locale import AppLocale
from app.models.domain import GraphAssessment, GraphAssessmentCard, StudyGraph


ASSESSMENT_COPY = {
    "en": {
        "roadmap": "Roadmap",
        "level": "Level Achieved",
        "closure": "Closure",
        "review": "Review Pressure",
        "empty": "Empty graph",
        "empty_reason": "This subject graph has no topics yet.",
        "no_baseline": "No baseline",
        "no_baseline_reason": "No completed topics exist yet.",
        "broad": "Broad runway",
        "broad_reason": "The graph already spans multiple layers and has enough width for a longer track.",
        "usable": "Usable runway",
        "usable_reason": "The graph has enough structure to study and expand safely.",
        "thin": "Thin runway",
        "thin_reason": "The graph still needs more breadth or depth before it feels like a full roadmap.",
        "ml_base": "ML-adjacent base",
        "secondary": "Secondary-school core",
        "early": "Early foundation",
        "not_closed": "Not closed yet",
        "level_reason": "This is estimated from the deepest layer whose prerequisite chain is already closed.",
        "closure_reason": "Share of topics currently marked solid or mastered.",
        "review_reason": "Topics currently marked shaky or needing review.",
    },
    "zh-CN": {
        "roadmap": "学习路线",
        "level": "当前水平",
        "closure": "完成度",
        "review": "复习需求",
        "empty": "空图谱",
        "empty_reason": "此学科图谱还没有主题。",
        "no_baseline": "尚无完成记录",
        "no_baseline_reason": "还没有已完成的主题。",
        "broad": "路线较完整",
        "broad_reason": "图谱已包含多层主题，覆盖面足以支持长期学习。",
        "usable": "路线可用",
        "usable_reason": "图谱已具备可用于学习和扩展的结构。",
        "thin": "路线待补充",
        "thin_reason": "补充主题或深化先修路径，可让学习路线更完整。",
        "ml_base": "已具备机器学习相关基础",
        "secondary": "中学核心基础",
        "early": "入门基础",
        "not_closed": "尚无已完成主题",
        "level_reason": "根据先修链已全部完成的最深层主题估算。",
        "closure_reason": "已掌握或熟练掌握的主题占比。",
        "review_reason": "尚不熟练或待复习的主题。",
    },
}


class AssessmentService:
    def assess_graph(self, graph: StudyGraph, locale: AppLocale = "en") -> GraphAssessment:
        copy = ASSESSMENT_COPY[locale]
        topic_count = len(graph.topics)
        if topic_count == 0:
            return GraphAssessment(
                graph_id=graph.graph_id,
                cards=[
                    GraphAssessmentCard(
                        kind="roadmap",
                        label=copy["roadmap"],
                        value=copy["empty"],
                        tone="warn",
                        rationale=copy["empty_reason"],
                    ),
                    GraphAssessmentCard(
                        kind="level",
                        label=copy["level"],
                        value=copy["no_baseline"],
                        tone="warn",
                        rationale=copy["no_baseline_reason"],
                    ),
                ],
            )

        closed_count = sum(1 for topic in graph.topics if topic.state in {"solid", "mastered"})
        review_count = sum(1 for topic in graph.topics if topic.state in {"needs_review", "shaky"})
        max_level = max((topic.level for topic in graph.topics), default=0)
        closed_levels = [topic.level for topic in graph.topics if topic.state in {"solid", "mastered"}]
        achieved_level = max(closed_levels, default=-1)
        closure_ratio = closed_count / topic_count

        if topic_count >= 12 and max_level >= 5:
            roadmap_value = copy["broad"]
            roadmap_tone = "good"
            roadmap_reason = copy["broad_reason"]
        elif topic_count >= 6 and max_level >= 3:
            roadmap_value = copy["usable"]
            roadmap_tone = "neutral"
            roadmap_reason = copy["usable_reason"]
        else:
            roadmap_value = copy["thin"]
            roadmap_tone = "warn"
            roadmap_reason = copy["thin_reason"]

        if achieved_level >= 4:
            level_value = copy["ml_base"]
            level_tone = "good"
        elif achieved_level >= 2:
            level_value = copy["secondary"]
            level_tone = "neutral"
        elif achieved_level >= 0:
            level_value = copy["early"]
            level_tone = "warn"
        else:
            level_value = copy["not_closed"]
            level_tone = "warn"

        cards = [
            GraphAssessmentCard(
                kind="roadmap",
                label=copy["roadmap"],
                value=roadmap_value,
                tone=roadmap_tone,
                rationale=roadmap_reason,
            ),
            GraphAssessmentCard(
                kind="level",
                label=copy["level"],
                value=level_value,
                tone=level_tone,
                rationale=copy["level_reason"],
            ),
            GraphAssessmentCard(
                kind="closure",
                label=copy["closure"],
                value=f"{round(closure_ratio * 100)}%",
                tone="good" if closure_ratio >= 0.5 else "neutral" if closure_ratio >= 0.2 else "warn",
                rationale=copy["closure_reason"],
            ),
        ]
        if review_count > 0:
            cards.append(
                GraphAssessmentCard(
                    kind="review",
                    label=copy["review"],
                    value=str(review_count),
                    tone="warn",
                    rationale=copy["review_reason"],
                )
            )
        return GraphAssessment(graph_id=graph.graph_id, cards=cards)
