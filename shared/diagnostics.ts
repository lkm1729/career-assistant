export interface AiDiagnostic {
  code: string;
  message: string;
  possibleCauses: string[];
  solutions: string[];
  httpStatus?: number;
}
export function httpDiagnostic(status: number): AiDiagnostic {
  const advice: Record<number, [string, string[], string[]]> = {
    400: [
      '请求参数不受支持。',
      ['接口协议或参数不匹配', '模型 ID、输入格式或上下文长度不符合要求'],
      ['检查供应商协议、模型 ID；先关闭可选参数再测试', '缩短输入或按供应商文档调整输出上限'],
    ],
    401: [
      '认证失败。',
      ['API Key 错误、过期或被撤销', '地址与 Key 所属供应商不一致'],
      [
        '在供应商设置用眼睛按钮确认本次输入的 Key',
        '检查 Base URL 和 Key 权限；勿将 Key 粘贴到求职资料中',
      ],
    ],
    403: [
      '认证失败或访问被拒绝。',
      ['Key 缺少模型权限', '供应商账号、地区或网关访问受限'],
      ['在供应商后台核对模型权限和访问范围', '确认协议及服务地址；联系供应商处理权限限制'],
    ],
    404: [
      '请求地址或模型不存在。',
      ['Base URL 路径前缀或模型 ID 有误', '代理没有实现这个协议/模型列表接口'],
      [
        '检查设置中展示的最终请求地址和模型 ID',
        '供应商列表探针失败时，再单独测试模型；列表不可用不等于模型不可用',
      ],
    ],
    405: [
      '接口不支持此请求方式。',
      ['网关没有开放该接口或 HTTP 方法'],
      ['检查协议和 Base URL', '如果仅模型列表探针失败，可尝试模型文本探针'],
    ],
    408: ['服务端等待请求超时。', ['网络不稳定或服务处理过慢'], ['检查网络或代理并稍后重试']],
    413: ['请求内容超过服务限制。', ['输入资料或图片过大'], ['缩短输入，减少图片数量或体积后重试']],
    422: [
      '服务无法处理请求参数。',
      ['模型不支持当前参数组合或输入格式'],
      ['关闭可选参数，核对模型 ID 和接口协议'],
    ],
    500: [
      '供应商内部服务错误。',
      ['供应商服务处理失败'],
      ['查看供应商服务状态或联系支持', '不要反复发送；先确认请求及计费状态再手动重试'],
    ],
    502: [
      '网关收到无效的上游响应。',
      ['代理与上游服务之间连接异常'],
      ['检查供应商或中转网关状态', '原有结果保持不变；确认请求状态后再手动重试'],
    ],
    503: [
      '供应商服务暂不可用。',
      ['服务过载或维护中'],
      ['等待供应商恢复，避免连续重复请求', '确认额度、服务状态后再手动重试'],
    ],
    429: [
      '服务限流或额度不足。',
      ['请求过于频繁', '账号余额、额度或并发限制'],
      ['稍后重试，避免连续重复请求', '在供应商后台核对额度和计费状态'],
    ],
  };
  const redirect = status >= 300 && status < 400;
  const entry =
    advice[status] ??
    (redirect
      ? [
          '请求被重定向，已停止；应用不会跟随重定向。',
          ['地址指向跳转页而非 API 终点'],
          ['改为供应商确认的最终 API 地址；程序不会转发密钥到重定向目标'],
        ]
      : status >= 500
        ? [
            '供应商服务暂时异常。',
            ['供应商或中转网关故障、过载'],
            ['稍后重试或查看供应商状态', '原有正文和版本不受影响；不要重复发送仍在运行的请求'],
          ]
        : ['服务请求失败。', ['服务返回了非成功状态'], ['检查供应商地址、协议和模型配置后重试']]);
  return {
    code: `AI_HTTP_${status}`,
    httpStatus: status,
    message: `${entry[0]}（HTTP ${status}）`,
    possibleCauses: entry[1],
    solutions: entry[2],
  };
}
/** Only pass app-authored messages here, never raw remote response bodies or network exception text. */
export function messageDiagnostic(message: string): AiDiagnostic {
  let code = 'AI_CONFIGURATION';
  let possibleCauses = ['当前配置、输入或操作状态不符合要求'];
  let solutions = ['根据提示修正设置或输入后重试；已有资料不会自动清空'];
  // Cancellation is a completed state only for these app-authored terminal messages.
  if (message === '有请求正在运行，请等待完成或先取消生成。') {
    code = 'AI_BUSY';
    possibleCauses = ['已有请求仍在运行，本次操作未启动'];
    solutions = ['等待当前请求结束；如需取消，请操作取消并等待结果，勿重复发送'];
  } else if (message === '取消请求未确认，请等待当前请求结束。') {
    code = 'AI_CANCEL_UNCONFIRMED';
    possibleCauses = ['尚未确认当前请求是否已停止'];
    solutions = ['等待当前请求结束或确认其状态；不要将取消操作视为完成，也不要重复发送'];
  } else if (
    message === '已取消获取模型列表。' ||
    message === '已取消供应商探针。' ||
    message === '已取消，本次不创建版本，旧内容保持不变。'
  ) {
    code = 'AI_CANCELLED';
    possibleCauses = ['请求已由用户取消'];
    solutions = ['不完整结果不会保存；如需继续，请重新确认发送'];
  } else if (/网络|连接失败/.test(message) && !/超时|等待时间/.test(message)) {
    code = 'AI_NETWORK';
    possibleCauses = ['DNS、网络、代理或 TLS 连接异常', '供应商地址不可达'];
    solutions = [
      '检查网络、代理和 Base URL；本机服务须先启动',
      '不要通过关闭证书校验来绕过安全检查',
    ];
  } else if (/超时|等待时间/.test(message)) {
    code = 'AI_TIMEOUT';
    possibleCauses = ['供应商响应过慢或连接卡住'];
    solutions = ['稍后重试或降低请求规模', '超时不代表供应商未计费，重试前请确认请求状态'];
  } else if (/流提前结束，未收到 response\.completed|未收到完整完成事件/.test(message)) {
    code = 'AI_STREAM_INCOMPLETE';
    possibleCauses = ['网络或代理截断了响应', '服务未按实际所选协议返回完整事件'];
    solutions = [
      '核对供应商的实际协议以及代理流式支持',
      '反馈错误码、协议与模型ID，不要提供Key、正文或原始响应；失败结果不会保存',
    ];
  } else if (
    // Match response-context messages, not generic validation words such as "格式" or "字段".
    /^(?:(?:Anthropic|Gemini|Responses) )?(?:响应|SSE |流事件|流提前结束|正文增量|正文格式|完成状态|未收到完整|没有完整的正文)/.test(
      message,
    ) ||
    /^(?:服务未返回 SSE 流|供应商模型列表(?:未返回 JSON| JSON 格式无效)|模型未返回完整的正文)/.test(
      message,
    ) ||
    message.endsWith('未保存不完整结果。')
  ) {
    code = 'AI_RESPONSE_FORMAT';
    possibleCauses = ['协议不兼容、响应中断或输出被截断', '模型没有遵守输出格式约束'];
    solutions = [
      '检查协议，先运行模型文本探针',
      '适当提高输出上限或减少输入；重试失败不会覆盖已有正文',
    ];
  } else if (/已改变|已变化|不一致|已变更/.test(message)) {
    code = 'AI_STALE_STATE';
    possibleCauses = ['确认后配置或草稿发生变化'];
    solutions = ['重新打开确认界面，核对最新草稿与接收方后再执行'];
  } else if (/存储|本地操作|无法读取|通信失败/.test(message)) {
    code = 'AI_LOCAL_OPERATION';
    possibleCauses = ['本地存储权限、磁盘空间或进程通信异常'];
    solutions = [
      '检查磁盘空间与应用数据目录权限',
      '保留原数据库，重试读取或重启；不要清空资料目录',
    ];
  }
  return { code, message, possibleCauses, solutions };
}

/** App-authored parser stages only: never pass provider response bodies or field values. */
export function protocolStreamDiagnostic(
  protocol: 'Gemini' | 'Anthropic',
  stage: string,
  message: string,
): AiDiagnostic {
  return {
    code: `AI_${protocol.toUpperCase()}_STREAM_${stage}`,
    message: `${message}（解析阶段：${stage}）`,
    possibleCauses: [
      '供应商或代理返回的流字段/事件顺序与所选原生协议不一致',
      '客户端尚未兼容该流变体，或响应确实不完整',
    ],
    solutions: [
      '先在该供应商下测试具体模型的连通性探针，区分连通与正文输出格式问题',
      '核对供应商支持的是原生协议还是 OpenAI 兼容协议',
      '反馈本错误码、模型 ID 和发生于探针还是生成；不要提供 Key、正文或原始响应。已有正文保持不变',
    ],
  };
}

/** Safe terminal facts only: no remote values, reasoning text, keys or source material. */
export function completionDiagnostic(
  protocol: string,
  kind: 'limit' | 'incomplete' | 'empty' | 'blocked',
): AiDiagnostic {
  const value = {
    limit: {
      code: 'AI_OUTPUT_LIMIT',
      message: `${protocol} 明确报告达到输出限制，未保存不完整结果。`,
      possibleCauses: [
        '供应商返回了输出上限结束原因，不能视为完整结果',
        '输出预算可能包含推理token；连通性探针不验证长任务预算',
      ],
      solutions: [
        '在该模型启用输出上限参数，并在本页调整支持的输出上限；新请求仍需确认，可能额外计费',
        '减少无关资料、重复岗位和冗长要求；不会自动续写或重试付费请求',
      ],
    },
    incomplete: {
      code: 'AI_STREAM_INCOMPLETE',
      message: `${protocol} 流提前结束，缺少正常完成标记或末尾帧不完整；原有内容保持不变。`,
      possibleCauses: [
        '网络或代理截断了响应',
        '服务未按实际所选协议返回完整事件；尚不能判断为输出上限',
      ],
      solutions: [
        '核对供应商的实际协议以及代理流式支持',
        '反馈错误码、协议与模型ID，不要提供Key或原始正文；失败结果不会保存',
      ],
    },
    empty: {
      code: 'AI_EMPTY_OUTPUT',
      message: `${protocol} 已结束但没有可用正文，未保存结果。`,
      possibleCauses: ['只返回推理/空内容，没有正文'],
      solutions: ['核对模型和输出预算，重试前重新确认发送；不会把推理内容当正文保存'],
    },
    blocked: {
      code: 'AI_UNSUPPORTED_COMPLETION',
      message: `${protocol} 返回非正常完成状态，未保存结果。`,
      possibleCauses: ['工具调用、拒绝、安全限制或其他不支持的结束状态；不是已确认的输出上限'],
      solutions: [
        '核对协议和模型能力；本任务不启用工具调用',
        '不要关闭校验或把不完整响应当作正式结果',
      ],
    },
  };
  return value[kind];
}
