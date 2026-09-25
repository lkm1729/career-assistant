import {
  FileText,
  ChartNoAxesCombined,
  ScanSearch,
  Send,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceId } from '../shared/contracts';
export interface PageDefinition {
  name: string;
  english: string;
  eyebrow: string;
  title: string;
  accent: string;
  subtitle: string;
  icon: LucideIcon;
  inputLabel: string;
  placeholder: string;
  output: string;
  action: string;
}
export const pages: Record<WorkspaceId, PageDefinition> = {
  resume: {
    name: '设计简历',
    english: 'Resume studio',
    eyebrow: 'YOUR NEXT CHAPTER',
    title: '把你的经历，',
    accent: '写成下一次机会。',
    subtitle: '梳理优势，组织经历，让每一段真实的成长都被看见。',
    icon: FileText,
    inputLabel: '告诉我，你想呈现怎样的自己？',
    placeholder:
      '例如：我有 3 年产品运营经验，想申请互联网公司的用户增长岗位。请帮我突出项目成果，简历控制在一页以内。',
    output: '简历工作区',
    action: '生成简历',
  },
  score: {
    name: '简历评分',
    english: 'Resume review',
    eyebrow: 'A FRESH PERSPECTIVE',
    title: '让优势更清晰，',
    accent: '让改进有方向。',
    subtitle: '从内容、相关性、视觉排版与表达四个方面，重新认识你的简历。',
    icon: ChartNoAxesCombined,
    inputLabel: '有想投递的职位吗？',
    placeholder: '可选：填写目标职位或评价重点。留空时，按通用简历评价。',
    output: '简历评价',
    action: '开始评分',
  },
  match: {
    name: '岗位匹配',
    english: 'Role match',
    eyebrow: 'FIND YOUR RIGHT FIT',
    title: '不只看职位名称，',
    accent: '更看真实契合。',
    subtitle: '把岗位要求与真实经历逐项对照，让申请决定更有依据。',
    icon: ScanSearch,
    inputLabel: '这次想了解哪个岗位？',
    placeholder: '粘贴岗位要求，并说明你的关注点。例如：我的项目经验能否弥补行业经验的差距？',
    output: '匹配度评估',
    action: '评估匹配度',
  },
  letter: {
    name: '撰写求职信',
    english: 'Cover letter',
    eyebrow: 'MAKE IT PERSONAL',
    title: '写一封有温度的信，',
    accent: '开启新的对话。',
    subtitle: '用真实的经历回应岗位需要，让对方读懂你为什么适合。',
    icon: Send,
    inputLabel: '希望这封信传达什么？',
    placeholder:
      '粘贴岗位描述，并告诉我语言、语气、字数和重点。例如：英文，300 词以内，专业自然，突出跨团队协作。',
    output: '求职信工作区',
    action: '生成求职信',
  },
  interview: {
    name: '面试问答',
    english: 'Interview prep',
    eyebrow: 'PRACTICE WITH PURPOSE',
    title: '把经历讲清楚，',
    accent: '自信走进面试。',
    subtitle: '根据目标岗位与个人经历，准备约20组英文面试问题和参考答案。',
    icon: MessagesSquare,
    inputLabel: '目标岗位详情',
    placeholder: '粘贴岗位名称、职责、要求和公司背景。',
    output: '模拟面试问答',
    action: '生成面试问答',
  },
};
export const dimensions = [
  {
    name: '内容与证据',
    weight: '30%',
    description: '经历是否完整，成果是否有材料支持；不凭空补充数字。',
  },
  {
    name: '方向相关性',
    weight: '30%',
    description: '有目标岗位时逐项对应要求；没有目标时评价职业定位与内容聚焦。',
  },
  {
    name: '视觉与结构',
    weight: '20%',
    description: '检查页面层级、密度和可读性。需要实际页面图像，资料不足时不生成完整总分。',
  },
  {
    name: '专业表达',
    weight: '20%',
    description: '检查措辞准确性、语言一致性与冗余，提供可执行的改写建议。',
  },
];
