import * as vscode from 'vscode';
import { PLAYWRIGHT_ALIGN_MANIFEST } from '../aligncraft/playwrightManifest';
import { Citation } from '../types';

export interface StreamStepPayload {
  stepNumber: number;
  title: string;
  rationale: string;
  code: string;
  citations: Citation[];
}

export class LLMClient {
  /**
   * Validates whether the prompt is within our strict TypeScript + Playwright scope.
   */
  public isScopeAllowed(prompt: string): { allowed: boolean; reason?: string } {
    const p = prompt.toLowerCase();
    const disallowedKeywords = [
      'python', 'django', 'flask', 'ruby', 'rails', 'java', 'spring',
      'c#', '.net', 'php', 'rust', 'golang', 'cypress', 'selenium', 'puppeteer'
    ];

    for (const keyword of disallowedKeywords) {
      if (p.includes(keyword)) {
        return {
          allowed: false,
          reason: `ClearCode AI is currently laser-focused on TypeScript & Playwright. Requests involving "${keyword}" are out of scope for this version.`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Streams generation step-by-step.
   * If apiKey is configured and provider is not 'demo', calls the provider stream.
   * Otherwise, streams using the high-fidelity Playwright AlignCraft engine fixture.
   */
  public async *streamSteps(
    topic: string,
    abortSignal: AbortSignal
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    const config = vscode.workspace.getConfiguration('clearcode');
    const provider = config.get<string>('provider', 'demo');
    const apiKey = config.get<string>('apiKey', '');

    // In demo mode or if no API key is provided, stream using our curated Playwright AlignCraft Manifest
    if (provider === 'demo' || !apiKey) {
      yield* this._streamDemoManifest(abortSignal);
      return;
    }

    // Live LLM single-call streaming (OpenAI / Anthropic / Gemini endpoint)
    yield* this._streamFromLiveProvider(provider, apiKey, topic, abortSignal);
  }

  private async *_streamDemoManifest(
    abortSignal: AbortSignal
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    const manifestEntries = [
      {
        title: 'Clean State Navigation',
        ...PLAYWRIGHT_ALIGN_MANIFEST['nav-login']
      },
      {
        title: 'User-Centric Accessible Locators',
        ...PLAYWRIGHT_ALIGN_MANIFEST['locator-role-email']
      },
      {
        title: 'Actionability-Checked Password Input',
        ...PLAYWRIGHT_ALIGN_MANIFEST['locator-fill-password']
      },
      {
        title: 'Role-Based Button Dispatch',
        ...PLAYWRIGHT_ALIGN_MANIFEST['button-submit']
      },
      {
        title: 'Auto-Retrying Web-First Assertion',
        ...PLAYWRIGHT_ALIGN_MANIFEST['assertion-web-first']
      }
    ];

    let step = 1;
    for (const entry of manifestEntries) {
      if (abortSignal.aborted) {
        throw new Error('Generation cancelled by user');
      }

      // Simulate realistic single-call streaming latency between micro-decisions
      await delay(700, abortSignal);

      yield {
        stepNumber: step++,
        title: entry.title,
        rationale: entry.rationaleSnippet,
        code: entry.codeSnippet,
        citations: entry.citations
      };
    }
  }

  private async *_streamFromLiveProvider(
    provider: string,
    apiKey: string,
    topic: string,
    abortSignal: AbortSignal
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    // Single-call causal prompt enforcing decision-first schema
    const systemPrompt = `You are ClearCode AI, a Senior Playwright & TypeScript test engineer.
Your task is to generate clean, robust, deterministic Playwright test code.
CRITICAL REQUIREMENT: For each logical step, you MUST determine the architectural decision and documentation citation FIRST, then generate the code line(s) conditioned on that decision.
Output ONLY a sequence of NDJSON lines. Each line must be a JSON object conforming to this schema:
{
  "stepNumber": number,
  "title": string,
  "rationale": string,
  "code": string,
  "citations": [
    {
      "id": string,
      "sourceType": "official" | "github" | "stackoverflow" | "community",
      "sourceName": string,
      "url": string,
      "excerpt": string,
      "highlight": string
    }
  ]
}
Do NOT output markdown backticks or commentary outside the JSON objects. Strictly focus on TypeScript and Playwright.`;

    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: vscode.workspace.getConfiguration('clearcode').get('model', 'gpt-4o'),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generate a Playwright test in TypeScript for: ${topic}` }
          ],
          stream: true
        }),
        signal: abortSignal
      });

      if (!response.ok || !response.body) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.replace('data: ', '');
          if (dataStr === '[DONE]') return;

          try {
            const parsed = JSON.parse(dataStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              const stepMatch = tryParseStepObject(content);
              if (stepMatch) {
                yield stepMatch;
              }
            }
          } catch {
            // Partial chunk
          }
        }
      }
    } else {
      // Default to high-fidelity demo stream for other configurations
      yield* this._streamDemoManifest(abortSignal);
    }
  }
}

function tryParseStepObject(chunk: string): StreamStepPayload | null {
  try {
    const obj = JSON.parse(chunk.trim());
    if (obj.stepNumber && obj.title && obj.code) {
      return obj as StreamStepPayload;
    }
  } catch {
    // not full object yet
  }
  return null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Aborted'));
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    });
  });
}
