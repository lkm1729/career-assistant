import {
  matchFormatInstruction,
  matchTaskInstruction,
  matchOutputInstruction,
  matchSources,
  type MatchConfirmation,
} from '../shared/matching';
import { materialContent } from './material-store';
import type { streamChat } from './chat-completions';

type ConfirmedInput = Pick<MatchConfirmation, 'input' | 'sources' | 'materials' | 'outputMode'>;

/** Build only from the main-process revalidated confirmation, never renderer-supplied instructions.
 * Keep images adjacent to their source, emit each body once, and end with the fixed output contract.
 */
export function matchMessages(
  current: ConfirmedInput,
): Parameters<typeof streamChat>[0]['messages'] {
  return [
    {
      role: 'system',
      content: current.input.systemPrompt + '\n' + matchFormatInstruction(current.outputMode),
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: matchTaskInstruction },
        {
          type: 'text',
          text: JSON.stringify({
            job: current.input.job,
            resume: current.input.resume,
            evidence: current.input.evidence,
            sources: matchSources(
              current.input.job,
              current.input.resume,
              current.input.evidence,
              current.sources,
            ).map(({ text, ...source }) => source),
            warnings: current.materials?.warnings,
          }),
        },
        ...(current.materials ? materialContent(current.materials) : []),
        { type: 'text', text: matchOutputInstruction },
      ],
    },
  ];
}
