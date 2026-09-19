import { AiError, type Protocol } from '../shared/ai.js';
import { streamChat } from './chat-completions.js';
import { streamGemini } from './gemini.js';
import { streamAnthropic } from './anthropic.js';
import { streamResponses } from './responses.js';
export function streamModel(protocol: Protocol, options: Parameters<typeof streamChat>[0]) {
  if (protocol === 'chat-completions') return streamChat(options);
  if (protocol === 'responses') return streamResponses(options);
  if (protocol === 'gemini') return streamGemini(options);
  if (protocol === 'anthropic') return streamAnthropic(options);
  throw new AiError('此接口协议尚未实现。');
}
