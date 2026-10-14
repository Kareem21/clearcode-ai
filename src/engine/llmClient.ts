import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PLAYWRIGHT_MANIFEST } from '../manifest/playwrightManifest';
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
   * Validates whether the prompt is allowed.
   * Open to any coding prompt.
   */
  public isScopeAllowed(_prompt: string): { allowed: boolean; reason?: string } {
    return { allowed: true };
  }

  /**
   * Streams generation step-by-step using live Gemini 3.8 Flash.
   */
  public async *streamSteps(
    topic: string,
    abortSignal: AbortSignal,
    editorContext?: { fileName: string; content: string }
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    const env = loadEnvFile();
    const config = vscode.workspace.getConfiguration('clearcode');
    const provider = config.get<string>('provider') || env['CLEARCODE_PROVIDER'] || 'gemini';
    const apiKey =
      config.get<string>('apiKey') ||
      env['GEMINI_API_KEY'] ||
      process.env.GEMINI_API_KEY ||
      '';
    const model =
      config.get<string>('model') ||
      env['CLEARCODE_MODEL'] ||
      'gemini-3.8-flash';

    if (provider === 'demo') {
      yield* this._streamDemoManifest(abortSignal);
      return;
    }

    if (provider === 'gemini' || apiKey) {
      yield* this._streamFromGemini(apiKey, model, topic, abortSignal, editorContext);
      return;
    }

    if (provider === 'openai') {
      yield* this._streamFromOpenAI(apiKey, model, topic, abortSignal, editorContext);
      return;
    }

    yield* this._streamDemoManifest(abortSignal);
  }

  private async *_streamFromGemini(
    apiKey: string,
    model: string,
    topic: string,
    abortSignal: AbortSignal,
    editorContext?: { fileName: string; content: string }
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    const systemPrompt = `You are ClearCode AI, a Senior Software & TypeScript Engineer with real-time web search grounding.
Your task is to write clean, modern, reliable, and production-ready code directly answering the user's prompt.
CRITICAL REQUIREMENT: For each logical step or micro-decision in your implementation, determine the architectural decision and documentation citation FIRST, then generate the code line(s) conditioned on that decision.
When citing documentation, provide real URLs (such as https://playwright.dev/docs/... or https://www.typescriptlang.org/docs/...) and relevant excerpts.
Output ONLY a sequence of NDJSON lines, one JSON object per line. Each line must be a JSON object conforming to this schema:
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
Do NOT output markdown code fences (\`\`\`json). Do NOT output conversational prose. Output ONLY valid JSON objects.`;

    const userPromptText = editorContext?.content?.trim()
      ? `Active File Context (${editorContext.fileName}):\n\`\`\`typescript\n${editorContext.content.slice(0, 4000)}\n\`\`\`\n\nUser Request: ${topic}\nGenerate the requested code and micro-decision citations.`
      : `User Request: ${topic}\nGenerate the requested code and micro-decision citations.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const body: Record<string, unknown> = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          parts: [{ text: userPromptText }]
        }
      ],
      tools: [
        {
          google_search: {}
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
            const result = extractJsonObjects(textAccumulator, emittedStepNumbers);
            textAccumulator = result.remaining;
            for (const step of result.steps) {
              yield step;
            }
          }
        } catch {
          // Partial SSE chunk
        }
      }
    }

    // Flush any remaining text
    if (textAccumulator.trim()) {
      const remainingResult = extractJsonObjects(textAccumulator, emittedStepNumbers);
      for (const step of remainingResult.steps) {
        yield step;
      }
    }
  }

  private async *_streamFromOpenAI(
    apiKey: string,
    model: string,
    topic: string,
    abortSignal: AbortSignal,
    editorContext?: { fileName: string; content: string }
  ): AsyncGenerator<StreamStepPayload, void, unknown> {
    const systemPrompt = `You are ClearCode AI, a Senior Software & TypeScript Engineer.
Output ONLY a sequence of NDJSON lines conforming to schema:
{"stepNumber": number, "title": string, "rationale": string, "code": string, "citations": [{"id": string, "sourceType": "official"|"github"|"stackoverflow"|"community", "sourceName": string, "url": string, "excerpt": string, "highlight": string}]}`;

    const userPromptText = editorContext?.content?.trim()
      ? `Active File (${editorContext.fileName}):\n${editorContext.content.slice(0, 3000)}\n\nPrompt: ${topic}`
      : topic;

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
          { role: 'user', content: userPromptText }
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
            const result = extractJsonObjects(textAccumulator, emittedStepNumbers);
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
        ...PLAYWRIGHT_MANIFEST['nav-login']
      },
      {
        title: 'User-Centric Accessible Locators',
        ...PLAYWRIGHT_MANIFEST['locator-role-email']
      },
      {
        title: 'Actionability-Checked Password Input',
        ...PLAYWRIGHT_MANIFEST['locator-fill-password']
      },
      {
        title: 'Role-Based Button Dispatch',
        ...PLAYWRIGHT_MANIFEST['button-submit']
      },
      {
        title: 'Auto-Retrying Web-First Assertion',
        ...PLAYWRIGHT_MANIFEST['assertion-web-first']
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

/**
 * Robust brace-balanced JSON extractor.
 * Parses JSON step objects even if surrounded by markdown code blocks or multi-line formatting.
 */
function extractJsonObjects(
  text: string,
  emitted: Set<number>
): { steps: StreamStepPayload[]; remaining: string } {
  const steps: StreamStepPayload[] = [];
  let remaining = text;

  while (true) {
    const startIdx = remaining.indexOf('{');
    if (startIdx === -1) break;

    let depth = 0;
    let inString = false;
    let escape = false;
    let endIdx = -1;

    for (let i = startIdx; i < remaining.length; i++) {
      const char = remaining[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
    }

    if (endIdx !== -1) {
      const candidateStr = remaining.slice(startIdx, endIdx + 1);
      try {
        const obj = JSON.parse(candidateStr);
        if (
          obj &&
          typeof obj.stepNumber === 'number' &&
          (obj.title || obj.code) &&
          !emitted.has(obj.stepNumber)
        ) {
          emitted.add(obj.stepNumber);
          steps.push({
            stepNumber: obj.stepNumber,
            title: obj.title || `Step ${obj.stepNumber}`,
            rationale: obj.rationale || '',
            code: obj.code || '',
            citations: Array.isArray(obj.citations) ? obj.citations : []
          });
        }
      } catch {
        // Not a valid JSON object yet
      }
      remaining = remaining.slice(endIdx + 1);
    } else {
      // Incomplete object, keep from startIdx for next incoming chunk
      remaining = remaining.slice(startIdx);
      break;
    }
  }

  return { steps, remaining };
}

function loadEnvFile(): Record<string, string> {
  const envMap: Record<string, string> = {};
  const candidates: string[] = [
    path.join(os.homedir(), '.clearcode_env'),
    path.join(__dirname, '../../.env'),
    path.join(process.cwd(), '.env'),
    '/Users/kareemyoussef/Desktop/clearcode/.env'
  ];

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      candidates.push(path.join(folder.uri.fsPath, '.env'));
    }
  }

  for (const envPath of candidates) {
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
              if (!envMap[key]) {
                envMap[key] = val;
              }
            }
          }
        }
      } catch {
        // Ignore read errors
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
