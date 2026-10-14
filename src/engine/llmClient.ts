import * as fs from 'fs';
import * as path from 'path';
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
          reason: `ClearCode AI is strictly tailored for TypeScript & Playwright. Requests involving "${keyword}" are out of scope for this version.`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Streams generation step-by-step.
   */
  public async *streamSteps(
    topic: string,
    abortSignal: AbortSignal
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    const env = loadEnvFile();
    const config = vscode.workspace.getConfiguration('clearcode');
    const provider = config.get<string>('provider') || env['CLEARCODE_PROVIDER'] || 'gemini';
    const apiKey =
      config.get<string>('apiKey') ||
      env['GEMINI_API_KEY'] ||
      env['OPENAI_API_KEY'] ||
      process.env.GEMINI_API_KEY ||
      '';
    const model =
      config.get<string>('model') ||
      env['CLEARCODE_MODEL'] ||
      (provider === 'gemini' ? 'gemini-3.8-flash' : 'gpt-4o');

    if (provider === 'demo' || !apiKey) {
      yield* this._streamDemoManifest(abortSignal);
      return;
    }

    if (provider === 'gemini') {
      yield* this._streamFromGemini(apiKey, model, topic, abortSignal);
      return;
    }

    if (provider === 'openai') {
      yield* this._streamFromOpenAI(apiKey, model, topic, abortSignal);
      return;
    }

    yield* this._streamDemoManifest(abortSignal);
  }

  private async *_streamFromGemini(
    apiKey: string,
    model: string,
    topic: string,
    abortSignal: AbortSignal
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
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
Do NOT output markdown code blocks (no \`\`\`json). Do NOT output conversational prose. Output ONLY valid NDJSON lines. Focus exclusively on TypeScript and Playwright.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          parts: [{ text: `Generate a Playwright test suite in TypeScript for: ${topic}` }]
        }
      ],
      generationConfig: {
        temperature: 0.1
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Gemini API returned empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let textAccumulator = '';
    const emittedStepNumbers = new Set<number>();

    while (true) {
      if (abortSignal.aborted) {
        throw new Error('Generation cancelled by user');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.replace('data: ', '').trim();
        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr);
          const candidate = parsed.candidates?.[0];
          const textPart = candidate?.content?.parts?.[0]?.text;

          if (textPart) {
            textAccumulator += textPart;
            // Parse completed NDJSON lines from accumulated text
            const result = extractAndYieldSteps(textAccumulator, emittedStepNumbers);
            textAccumulator = result.remaining;
            for (const step of result.steps) {
              yield step;
            }
          }
        } catch {
          // Incomplete SSE chunk
        }
      }
    }

    // Flush any remaining line
    if (textAccumulator.trim()) {
      const remainingResult = extractAndYieldSteps(textAccumulator, emittedStepNumbers);
      for (const step of remainingResult.steps) {
        yield step;
      }
    }
  }

  private async *_streamFromOpenAI(
    apiKey: string,
    model: string,
    topic: string,
    abortSignal: AbortSignal
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    const systemPrompt = `You are ClearCode AI, a Senior Playwright & TypeScript test engineer.
Output ONLY a sequence of NDJSON lines conforming to schema:
{"stepNumber": number, "title": string, "rationale": string, "code": string, "citations": [{"id": string, "sourceType": "official"|"github"|"stackoverflow"|"community", "sourceName": string, "url": string, "excerpt": string, "highlight": string}]}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
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
    let textAccumulator = '';
    const emittedStepNumbers = new Set<number>();

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
            textAccumulator += content;
            const result = extractAndYieldSteps(textAccumulator, emittedStepNumbers);
            textAccumulator = result.remaining;
            for (const step of result.steps) {
              yield step;
            }
          }
        } catch {
          // Incomplete chunk
        }
      }
    }
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
}

function extractAndYieldSteps(
  text: string,
  emitted: Set<number>
): { steps: StreamStepPayload[]; remaining: string } {
  const steps: StreamStepPayload[] = [];
  const lines = text.split('\n');
  const remaining = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Strip markdown wrappers if any
    const cleanLine = trimmed.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    if (!cleanLine) continue;

    try {
      const obj = JSON.parse(cleanLine);
      if (obj.stepNumber && obj.title && obj.code && !emitted.has(obj.stepNumber)) {
        emitted.add(obj.stepNumber);
        steps.push(obj as StreamStepPayload);
      }
    } catch {
      // Incomplete line
    }
  }

  return { steps, remaining };
}

function loadEnvFile(): Record<string, string> {
  const envMap: Record<string, string> = {};
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return envMap;

  for (const folder of workspaceFolders) {
    const envPath = path.join(folder.uri.fsPath, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eq = trimmed.indexOf('=');
            if (eq !== -1) {
              const key = trimmed.slice(0, eq).trim();
              const val = trimmed.slice(eq + 1).trim();
              envMap[key] = val;
            }
          }
        }
      } catch {
        // Ignore file read error
      }
    }
  }
  return envMap;
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
