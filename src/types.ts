export type SourceType = 'official' | 'github' | 'stackoverflow' | 'community';

export type VerificationStatus = 'verified' | 'unverified_model';

export interface Citation {
  id: string;
  sourceType: SourceType;
  sourceName: string;
  url: string;
  excerpt: string;
  highlight?: string;
  verificationStatus?: VerificationStatus;
  verificationDetails?: string;
}

export interface MicroDecisionCard {
  id: string;
  stepNumber: number;
  title: string;
  lineRange: [number, number]; // e.g. [12, 15]
  rationale: string;
  codeSnippet?: string;
  citations: Citation[];
  isExpanded?: boolean;
}

export interface GenerationSession {
  id: string;
  topic: string;
  isActive: boolean;
  cards: MicroDecisionCard[];
  startedAt: number;
}

export type WebviewToExtensionMessage =
  | { command: 'cancelGeneration' }
  | { command: 'clearCitations' }
  | { command: 'openExternal'; url: string }
  | { command: 'openInspectionPanel'; card: MicroDecisionCard }
  | { command: 'startDemoGeneration'; topic?: string }
  | { command: 'submitUserPrompt'; prompt: string }
  | { command: 'webviewReady' };

export type ExtensionToWebviewMessage =
  | { command: 'sessionStart'; topic: string }
  | { command: 'addCard'; card: MicroDecisionCard }
  | { command: 'updateCard'; cardId: string; updates: Partial<MicroDecisionCard> }
  | { command: 'updateActiveContext'; fileName?: string }
  | { command: 'sessionComplete' }
  | { command: 'sessionCancelled' }
  | { command: 'sessionError'; error: string }
  | { command: 'clearView' };
