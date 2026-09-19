import { anthropicAssessmentWait } from '../shared/assessment-wait';
export function AssessmentWaitNotice() {
  return (
    <p className="confirmation-warning">
      最多等待{anthropicAssessmentWait.timeoutMs / 60_000}分钟（包含连接、排队、思考与正文输出），
      连续{anthropicAssessmentWait.idleTimeoutMs / 60_000}分钟无任何响应数据会停止。
      可随时取消；不会自动重试。等待上限不代表供应商一定能完成，取消或超时也不代表未计费。
    </p>
  );
}
