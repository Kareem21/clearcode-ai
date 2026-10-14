import { Citation } from '../types';

export interface PlaywrightManifestEntry {
  key: string;
  topic: string;
  rationaleSnippet: string;
  codeSnippet: string;
  citations: Citation[];
}

export const PLAYWRIGHT_MANIFEST: Record<string, PlaywrightManifestEntry> = {
  'nav-login': {
    key: 'nav-login',
    topic: 'Session Initialization & Clean State',
    rationaleSnippet: 'Direct navigation ensures a clean browser context with isolated cookie/storage state before assertions run.',
    codeSnippet: "  // 1. Navigate to target auth endpoint\n  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });\n",
    citations: [
      {
        id: 'cit-nav-1',
        sourceType: 'official',
        sourceName: 'Playwright Docs: Page.goto',
        url: 'https://playwright.dev/docs/api/class-page#page-goto',
        excerpt: "Navigates to the given url. By default, Playwright waits for the 'load' event, but 'domcontentloaded' is recommended when single-page application hydration handles the remaining lifecycle.",
        highlight: "recommended when single-page application hydration handles the remaining lifecycle"
      }
    ]
  },
  'locator-role-email': {
    key: 'locator-role-email',
    topic: 'User-Centric Accessible Locators',
    rationaleSnippet: 'Using getByRole and getByLabel prioritizes user-visible accessibility semantics over brittle CSS selectors or dynamic test IDs.',
    codeSnippet: "  // 2. Locate and fill email using accessible locator\n  const emailInput = page.getByLabel('Email Address');\n  await emailInput.fill('user@enterprise.com');\n",
    citations: [
      {
        id: 'cit-loc-1',
        sourceType: 'official',
        sourceName: 'Playwright Docs: Best Practices Locators',
        url: 'https://playwright.dev/docs/best-practices#use-locators',
        excerpt: "Locators are strict and user-facing by default. Prefer role, text, or label locators over CSS/XPath: 'Prioritize user-facing attributes like getByRole, getByText, getByLabel.'",
        highlight: "Prioritize user-facing attributes like getByRole, getByText, getByLabel"
      },
      {
        id: 'cit-loc-2',
        sourceType: 'community',
        sourceName: 'Testing Guidelines: Resilient Selectors',
        url: 'https://playwright.dev/docs/locators#locate-by-role',
        excerpt: "Avoid brittle implementation-detail selectors like div > input.form-control which break on design refactors without functional changes.",
        highlight: "Avoid brittle implementation-detail selectors like div > input.form-control"
      }
    ]
  },
  'locator-fill-password': {
    key: 'locator-fill-password',
    topic: 'Safe Input Masking & Fill Actionability',
    rationaleSnippet: 'page.getByLabel automatically performs actionability checks (visible, enabled, editable) before typing, preventing flakiness.',
    codeSnippet: "  // 3. Fill credentials with automatic actionability verification\n  const passwordInput = page.getByLabel('Password');\n  await passwordInput.fill('SecurePassword123!');\n",
    citations: [
      {
        id: 'cit-fill-1',
        sourceType: 'official',
        sourceName: 'Playwright Docs: Actionability',
        url: 'https://playwright.dev/docs/actionability',
        excerpt: "Playwright checks that the element is visible, stable, receives events, and is enabled before performing the action. If checks fail within timeout, the action is retried.",
        highlight: "Playwright checks that the element is visible, stable, receives events, and is enabled before performing the action"
      }
    ]
  },
  'button-submit': {
    key: 'button-submit',
    topic: 'Intentional Button Dispatch',
    rationaleSnippet: 'Role-based button locator guarantees keyboard-accessible interactive targets rather than unclickable decorative containers.',
    codeSnippet: "  // 4. Submit form via accessible role button\n  const submitButton = page.getByRole('button', { name: 'Sign In', exact: true });\n  await submitButton.click();\n",
    citations: [
      {
        id: 'cit-btn-1',
        sourceType: 'official',
        sourceName: 'Playwright Docs: getByRole',
        url: 'https://playwright.dev/docs/api/class-page#page-get-by-role',
        excerpt: "Locates an element by its ARIA role, ARIA attributes, and accessible name. Exact match avoids selecting secondary buttons with matching sub-strings.",
        highlight: "Exact match avoids selecting secondary buttons with matching sub-strings"
      },
      {
        id: 'cit-btn-2',
        sourceType: 'stackoverflow',
        sourceName: 'Stack Overflow: Playwright Strict Mode Violations',
        url: 'https://stackoverflow.com/questions/68903348/playwright-strict-mode-violation-resolved-to-multiple-elements',
        excerpt: "When multiple buttons exist (e.g. 'Sign In' and 'Sign In with Google'), pass { exact: true } to prevent strict mode locator errors.",
        highlight: "pass { exact: true } to prevent strict mode locator errors"
      }
    ]
  },
  'assertion-web-first': {
    key: 'assertion-web-first',
    topic: 'Auto-Retrying Web-First Assertions',
    rationaleSnippet: 'expect(locator).toBeVisible() auto-retries until DOM stability, completely eliminating arbitrary sleeps (page.waitForTimeout).',
    codeSnippet: "  // 5. Web-first auto-retrying assertion on dashboard greeting\n  const dashboardGreeting = page.getByRole('heading', { name: 'Welcome Back' });\n  await expect(dashboardGreeting).toBeVisible({ timeout: 10_000 });\n",
    citations: [
      {
        id: 'cit-assert-1',
        sourceType: 'official',
        sourceName: 'Playwright Docs: Web-First Assertions',
        url: 'https://playwright.dev/docs/test-assertions',
        excerpt: "By using web-first assertions, Playwright will wait until the expected condition is met. Do not use page.waitForTimeout() in production tests as it introduces flakiness and slow suites.",
        highlight: "Do not use page.waitForTimeout() in production tests as it introduces flakiness"
      },
      {
        id: 'cit-assert-2',
        sourceType: 'github',
        sourceName: 'GitHub Discussion: microsoft/playwright#11382',
        url: 'https://github.com/microsoft/playwright/issues/11382',
        excerpt: "Web-first assertions like expect(locator).toBeVisible automatically poll the DOM state at high frequency, making tests deterministic across varying network conditions.",
        highlight: "automatically poll the DOM state at high frequency, making tests deterministic"
      }
    ]
  }
};
