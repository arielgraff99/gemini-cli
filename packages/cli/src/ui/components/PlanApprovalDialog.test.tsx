/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { PlanApprovalDialog } from './PlanApprovalDialog.js';
import * as fs from 'node:fs';

// Mock only the fs.promises.readFile method, keeping the rest of the module
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

// Helper to write to stdin with proper act() wrapping
const writeKey = (stdin: { write: (data: string) => void }, key: string) => {
  act(() => {
    stdin.write(key);
  });
};

// Helper to wait for content to be loaded with act()
const waitForContentLoad = async () => {
  // Allow the promise to resolve and state to update
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('PlanApprovalDialog', () => {
  const samplePlanContent = `## Overview

Add user authentication to the CLI application.

## Implementation Steps

1. Create \`src/auth/AuthService.ts\` with login/logout methods
2. Add session storage in \`src/storage/SessionStore.ts\`
3. Update \`src/commands/index.ts\` to check auth status
4. Add tests in \`src/auth/__tests__/\`

## Files to Modify

- \`src/index.ts\` - Add auth middleware
- \`src/config.ts\` - Add auth configuration options`;

  beforeEach(() => {
    vi.mocked(fs.promises.readFile).mockResolvedValue(samplePlanContent);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    planPath: '/mock/plans/test-plan.md',
    onApprove: vi.fn(),
    onFeedback: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders correctly with plan content', async () => {
    const { lastFrame } = renderWithProviders(
      <PlanApprovalDialog {...defaultProps} />,
    );

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        '/mock/plans/test-plan.md',
        'utf8',
      );
    });

    expect(lastFrame()).toMatchSnapshot();
  });

  it('calls onApprove when approve option is selected', async () => {
    const onApprove = vi.fn();
    const { stdin } = renderWithProviders(
      <PlanApprovalDialog {...defaultProps} onApprove={onApprove} />,
    );

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalled();
    });

    writeKey(stdin, '\r');

    await waitFor(() => {
      expect(onApprove).toHaveBeenCalled();
    });
  });

  it('calls onFeedback when feedback is typed and submitted', async () => {
    const onFeedback = vi.fn();
    const { stdin, lastFrame } = renderWithProviders(
      <PlanApprovalDialog {...defaultProps} onFeedback={onFeedback} />,
    );

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalled();
    });

    // Navigate past the approve option to the feedback input
    writeKey(stdin, '\x1b[B'); // Down arrow

    for (const char of 'Add tests') {
      writeKey(stdin, char);
    }

    await waitFor(() => {
      expect(lastFrame()).toMatchSnapshot();
    });

    writeKey(stdin, '\r');

    await waitFor(() => {
      expect(onFeedback).toHaveBeenCalledWith('Add tests');
    });
  });

  it('calls onCancel when Esc is pressed', async () => {
    const onCancel = vi.fn();
    const { stdin } = renderWithProviders(
      <PlanApprovalDialog {...defaultProps} onCancel={onCancel} />,
    );

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalled();
    });

    writeKey(stdin, '\x1b'); // Escape

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it('handles file read error gracefully', async () => {
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      new Error('File not found'),
    );

    const { lastFrame } = renderWithProviders(
      <PlanApprovalDialog {...defaultProps} />,
    );

    await waitForContentLoad();

    await waitFor(() => {
      expect(lastFrame()).toContain('Error reading plan file');
    });
  });
});
