/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useMemo, useState, useEffect, useContext } from 'react';
import {
  type Question,
  QuestionType,
  ApprovalMode,
} from '@google/gemini-cli-core';
import { AskUserDialog } from './AskUserDialog.js';
import { UIStateContext } from '../contexts/UIStateContext.js';
import * as fs from 'node:fs';

interface PlanApprovalDialogProps {
  planPath: string;
  /** Called when user approves the plan with the selected approval mode. */
  onApprove: (approvalMode: ApprovalMode) => void;
  onFeedback: (feedback: string) => void;
  onCancel: () => void;
}

const APPROVE_AUTO_EDIT = 'Yes, automatically accept edits';
const APPROVE_DEFAULT = 'Yes, manually accept edits';

export const PlanApprovalDialog: React.FC<PlanApprovalDialogProps> = ({
  planPath,
  onApprove,
  onFeedback,
  onCancel,
}) => {
  const uiState = useContext(UIStateContext);
  const [planContent, setPlanContent] = useState<string | undefined>(undefined);

  useEffect(() => {
    let ignore = false;

    fs.promises
      .readFile(planPath, 'utf8')
      .then((content) => {
        if (ignore) return;
        setPlanContent(content);
      })
      .catch((err) => {
        if (ignore) return;
        setPlanContent(`Error reading plan file: ${err.message}`);
      });

    return () => {
      ignore = true;
    };
  }, [planPath]);

  const questions = useMemo(
    (): Question[] => [
      {
        question: 'Ready to start implementation?',
        header: 'Plan',
        type: QuestionType.CHOICE,
        options: [
          {
            label: APPROVE_AUTO_EDIT,
            description: 'Edits will be applied without confirmation',
          },
          {
            label: APPROVE_DEFAULT,
            description: 'You will be asked to confirm each edit',
          },
        ],
        content: planContent,
        customOptionPlaceholder: 'Provide feedback...',
        showAllOptions: true,
      },
    ],
    [planContent],
  );

  const handleSubmit = useCallback(
    (answers: { [questionIndex: string]: string }) => {
      const answer = answers['0'];
      if (answer === APPROVE_AUTO_EDIT) {
        onApprove(ApprovalMode.AUTO_EDIT);
      } else if (answer === APPROVE_DEFAULT) {
        onApprove(ApprovalMode.DEFAULT);
      } else if (answer) {
        onFeedback(answer);
      }
    },
    [onApprove, onFeedback],
  );

  const width = uiState?.mainAreaWidth ?? 80;
  const availableHeight = uiState?.availableTerminalHeight ?? 20;

  return (
    <AskUserDialog
      questions={questions}
      onSubmit={handleSubmit}
      onCancel={onCancel}
      width={width}
      availableHeight={availableHeight}
    />
  );
};
